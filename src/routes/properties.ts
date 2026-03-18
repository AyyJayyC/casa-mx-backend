import { FastifyPluginAsync } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { verifyJWT, requireAnyRole } from '../utils/guards.js';
import { LandlordService } from '../services/landlord.service.js';
import { cacheService } from '../services/cache.service.js';
import {
  propertyFilterSchema,
  createPropertySchema,
  updatePropertySchema,
  type PropertyFilter,
  type CreatePropertyInput,
  type UpdatePropertyInput,
} from '../schemas/properties.js';

class PropertyService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Get all Mexican states with their cities (with Redis caching)
   * Cache TTL: 24 hours
   * Cache Key: location:filter:options
   */
  async getFilterOptions() {
    const cacheKey = 'location:filter:options';

    // Try to get from cache first
    const cached = await cacheService.get<any>(cacheKey);
    if (cached) {
      console.log('[CACHE HIT] Location filter options retrieved from Redis');
      return cached;
    }

    console.log('[CACHE MISS] Fetching location filter options from database');

    // Get all unique estados
    const estados = await this.prisma.property.findMany({
      select: { estado: true },
      distinct: ['estado'],
      orderBy: { estado: 'asc' },
    });

    // For each estado, get its unique ciudades
    const filterOptions: Record<string, any> = {
      estados: [],
      ciudades: {},
    };

    for (const { estado } of estados) {
      if (estado) {
        filterOptions.estados.push(estado);

        const ciudades = await this.prisma.property.findMany({
          select: { ciudad: true },
          where: { estado },
          distinct: ['ciudad'],
          orderBy: { ciudad: 'asc' },
        });

        filterOptions.ciudades[estado] = ciudades
          .map(c => c.ciudad)
          .filter(c => c !== null);
      }
    }

    // Cache for 24 hours (86400 seconds)
    await cacheService.set(cacheKey, filterOptions, 86400);

    return filterOptions;
  }

  /**
   * Get properties with optional filters
   */
  async getProperties(filters: PropertyFilter) {
    const {
      estado,
      ciudad,
      colonia,
      codigoPostal,
      listingType, // NEW: Filter by sale/rent
      minPrice,
      maxPrice,
      minRent, // NEW: Filter by rent range
      maxRent,
      furnished, // NEW: Filter by furnished
      limit,
      offset,
    } = filters;

    // Build where clause dynamically
    const where: any = {};

    if (estado) where.estado = estado;
    if (ciudad) where.ciudad = ciudad;
    if (colonia) where.colonia = colonia;
    if (codigoPostal) where.codigoPostal = codigoPostal;
    if (listingType) where.listingType = listingType; // NEW: Filter by listing type

    // Price range filter (for sale properties)
    if (minPrice !== undefined || maxPrice !== undefined) {
      where.price = {};
      if (minPrice !== undefined) where.price.gte = minPrice;
      if (maxPrice !== undefined) where.price.lte = maxPrice;
    }

    // Rent range filter (for rental properties)
    if (minRent !== undefined || maxRent !== undefined) {
      where.monthlyRent = {};
      if (minRent !== undefined) where.monthlyRent.gte = minRent;
      if (maxRent !== undefined) where.monthlyRent.lte = maxRent;
    }

    // Furnished filter
    if (furnished !== undefined) {
      where.furnished = furnished;
    }

    // Get total count for pagination
    const total = await this.prisma.property.count({ where });

    // Get filtered properties
    const properties = await this.prisma.property.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    return { properties, total };
  }
}

const propertiesPlugin: FastifyPluginAsync = async (app) => {
  const propertyService = new PropertyService(app.prisma);
  const landlordService = new LandlordService(app.prisma);

  // GET /properties - Get filtered properties (public, but JWT-aware)
  app.route({
    method: 'GET',
    url: '/properties',
    schema: {
      querystring: {
        type: 'object',
        properties: {
          estado: { type: 'string' },
          ciudad: { type: 'string' },
          colonia: { type: 'string' },
          codigoPostal: { type: 'string' },
          listingType: { type: 'string', enum: ['for_sale', 'for_rent'] }, // NEW
          minPrice: { type: 'number' },
          maxPrice: { type: 'number' },
          minRent: { type: 'number' }, // NEW
          maxRent: { type: 'number' }, // NEW
          furnished: { type: 'boolean' }, // NEW
          limit: { type: 'number', default: 20 },
          offset: { type: 'number', default: 0 },
        },
      },
    },
    handler: async (request, reply) => {
      try {
        // Validate query parameters
        const filters = propertyFilterSchema.parse(request.query);

        // Get properties with filters
        const { properties, total } = await propertyService.getProperties(filters);

        return reply.code(200).send({
          success: true,
          data: properties,
          total,
        });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            success: false,
            error: 'Invalid query parameters',
            details: error.errors,
          });
        }

        app.log.error(error);
        return reply.code(500).send({
          success: false,
          error: 'Failed to fetch properties',
        });
      }
    },
  });

  // GET /properties/filter-options - Get available filter options
  app.route({
    method: 'GET',
    url: '/properties/filter-options',
    handler: async (request, reply) => {
      try {
        // Note: This endpoint is public to allow UI to populate filter dropdowns
        const options = await propertyService.getFilterOptions();

        return reply.code(200).send({
          success: true,
          data: options,
        });
      } catch (error: any) {
        app.log.error(error);
        return reply.code(500).send({
          success: false,
          error: 'Failed to fetch filter options',
        });
      }
    },
  });

  // POST /properties - Create a new property (protected - seller/wholesaler/landlord)
  app.route({
    method: 'POST',
    url: '/properties',
    onRequest: [verifyJWT, requireAnyRole(['seller', 'wholesaler', 'landlord', 'admin'])],
    handler: async (request, reply) => {
      try {
        const user = (request as any).user;

        // Validate input with Zod
        const input = createPropertySchema.parse(request.body);

        // Create property
        const property = await app.prisma.property.create({
          data: {
            title: input.title,
            description: input.description,
            address: input.address,
            imageUrls: input.imageUrls ?? [],
            price: input.price ?? null,
            lat: input.lat ?? null,
            lng: input.lng ?? null,
            estado: input.estado,
            ciudad: input.ciudad,
            colonia: input.colonia,
            codigoPostal: input.codigoPostal,
            status: input.status,
            listingType: input.listingType,
            monthlyRent: input.monthlyRent ?? null,
            securityDeposit: input.securityDeposit ?? null,
            leaseTermMonths: input.leaseTermMonths ?? null,
            availableFrom: input.availableFrom ? new Date(input.availableFrom) : null,
            furnished: input.furnished ?? false,
            utilitiesIncluded: input.utilitiesIncluded ?? false,
            sellerId: user.id,
          },
        });

        // If creating a rental property, add landlord role
        if (input.listingType === 'for_rent') {
          await landlordService.addLandlordRoleIfNeeded(user.id);
        }

        // Invalidate location filter cache since new location data added
        await cacheService.invalidate('location:filter:*');

        return reply.code(201).send({
          success: true,
          data: property,
        });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            details: error.errors,
          });
        }

        app.log.error(error);
        return reply.code(500).send({
          success: false,
          error: 'Failed to create property',
        });
      }
    },
  });

  // GET /properties/map - Get properties with coordinates (must be before /:id)
  app.route({
    method: 'GET',
    url: '/properties/map',
    handler: async (request, reply) => {
      try {
        const properties = await app.prisma.property.findMany({
          where: {
            lat: { not: null },
            lng: { not: null },
          },
          select: {
            id: true,
            title: true,
            address: true,
            lat: true,
            lng: true,
            price: true,
            monthlyRent: true,
            listingType: true,
            status: true,
            estado: true,
            ciudad: true,
            colonia: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 500,
        });

        return reply.code(200).send({
          success: true,
          data: properties,
          total: properties.length,
        });
      } catch (error: any) {
        app.log.error(error);
        return reply.code(500).send({
          success: false,
          error: 'Failed to fetch map properties',
        });
      }
    },
  });

  // GET /properties/:id - Get property by ID
  app.route({
    method: 'GET',
    url: '/properties/:id',
    handler: async (request, reply) => {
      try {
        const { id } = request.params as { id: string };

        const property = await app.prisma.property.findUnique({
          where: { id },
          include: {
            propertyRequests: {
              select: { id: true, buyerId: true, status: true },
            },
          },
        });

        if (!property) {
          return reply.code(404).send({
            success: false,
            error: 'Property not found',
          });
        }

        return reply.code(200).send({
          success: true,
          data: property,
        });
      } catch (error: any) {
        app.log.error(error);
        return reply.code(500).send({
          success: false,
          error: 'Failed to fetch property',
        });
      }
    },
  });

  // PATCH /properties/:id - Update property (protected - owner only)
  app.route({
    method: 'PATCH',
    url: '/properties/:id',
    onRequest: [verifyJWT],
    handler: async (request, reply) => {
      try {
        const user = (request as any).user;
        const { id } = request.params as { id: string };

        // Check if property exists and user owns it
        const existingProperty = await app.prisma.property.findUnique({
          where: { id },
        });

        if (!existingProperty) {
          return reply.code(404).send({
            success: false,
            error: 'Property not found',
          });
        }

        if (existingProperty.sellerId !== user.id) {
          return reply.code(403).send({
            success: false,
            error: 'You can only update your own properties',
          });
        }

        // Validate update input
        const input = updatePropertySchema.parse(request.body);

        // Update property
        const updated = await app.prisma.property.update({
          where: { id },
          data: {
            ...input,
            availableFrom: input.availableFrom ? new Date(input.availableFrom) : undefined,
          },
        });

        // If changed to rental, add landlord role
        if (input.listingType === 'for_rent' && existingProperty.listingType !== 'for_rent') {
          await landlordService.addLandlordRoleIfNeeded(user.id);
        }

        // If changed from rental to sale, check if should remove landlord role
        if (input.listingType === 'for_sale' && existingProperty.listingType === 'for_rent') {
          await landlordService.removeLandlordRoleIfNeeded(user.id);
        }

        // Invalidate location filter cache when property is updated
        await cacheService.invalidate('location:filter:*');

        return reply.code(200).send({
          success: true,
          data: updated,
        });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            details: error.errors,
          });
        }

        app.log.error(error);
        return reply.code(500).send({
          success: false,
          error: 'Failed to update property',
        });
      }
    },
  });

  // DELETE /properties/:id - Delete property (protected - owner only)
  app.route({
    method: 'DELETE',
    url: '/properties/:id',
    onRequest: [verifyJWT],
    handler: async (request, reply) => {
      try {
        const user = (request as any).user;
        const { id } = request.params as { id: string };

        // Check if property exists and user owns it
        const property = await app.prisma.property.findUnique({
          where: { id },
        });

        if (!property) {
          return reply.code(404).send({
            success: false,
            error: 'Property not found',
          });
        }

        if (property.sellerId !== user.id) {
          return reply.code(403).send({
            success: false,
            error: 'You can only delete your own properties',
          });
        }

        // Delete property
        await app.prisma.property.delete({
          where: { id },
        });

        // If was a rental, check if should remove landlord role
        if (property.listingType === 'for_rent') {
          await landlordService.removeLandlordRoleIfNeeded(user.id);
        }

        return reply.code(200).send({
          success: true,
          message: 'Property deleted successfully',
        });
      } catch (error: any) {
        app.log.error(error);
        return reply.code(500).send({
          success: false,
          error: 'Failed to delete property',
        });
      }
    },
  });
};

export default propertiesPlugin;

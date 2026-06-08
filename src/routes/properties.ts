import { FastifyPluginAsync } from "fastify";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { verifyJWT, requireAnyRole } from "../utils/guards.js";
import { LandlordService } from "../services/landlord.service.js";
import { cacheService } from "../services/cache.service.js";
import { mapsService } from "../services/maps.service.js";
import { notifyTagSubscribers } from "../services/notification.service.js";
import {
  propertyFilterSchema,
  createPropertySchema,
  updatePropertySchema,
  promotePropertySchema,
  type PropertyFilter,
  type CreatePropertyInput,
  type UpdatePropertyInput,
} from "../schemas/properties.js";

class PropertyService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Get all Mexican states with their cities (with Redis caching)
   * Cache TTL: 24 hours
   * Cache Key: location:filter:options
   */
  async getFilterOptions() {
    const cacheKey = "location:filter:options";

    // Try to get from cache first
    const cached = await cacheService.get<any>(cacheKey);
    if (cached) {
      // Cache hit - return cached location filter options
      return cached;
    }

    // Cache miss - fetch all estado+ciudad pairs in a single query
    const allPairs = await this.prisma.property.findMany({
      select: { estado: true, ciudad: true },
      where: {
        ciudad: { not: null },
        visibility: "public",
        status: { not: "incompleto" },
      },
      distinct: ["estado", "ciudad"],
      orderBy: [{ estado: "asc" }, { ciudad: "asc" }],
    });

    // Group ciudades by estado in JavaScript
    const filterOptions: Record<string, any> = {
      estados: [] as string[],
      ciudades: {} as Record<string, string[]>,
    };

    const seenEstados = new Set<string>();
    for (const { estado, ciudad } of allPairs) {
      if (estado && ciudad) {
        if (!seenEstados.has(estado)) {
          seenEstados.add(estado);
          filterOptions.estados.push(estado);
          filterOptions.ciudades[estado] = [];
        }
        filterOptions.ciudades[estado].push(ciudad);
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
      listingType,
      minPrice,
      maxPrice,
      minRent,
      maxRent,
      furnished,
      promoted,
      limit,
      offset,
    } = filters;

    // Expire stale promotions
    await this.prisma.property.updateMany({
      where: { featuredUntil: { lt: new Date() } },
      data: { promotionTier: null, featuredUntil: null },
    });

    const where: any = {
      visibility: "public",
      status: { not: "incompleto" },
    };

    if (estado) where.estado = estado;
    if (ciudad) where.ciudad = ciudad;
    if (colonia) where.colonia = colonia;
    if (codigoPostal) where.codigoPostal = codigoPostal;
    if (listingType) where.listingType = listingType;

    if (minPrice !== undefined || maxPrice !== undefined) {
      where.price = {};
      if (minPrice !== undefined) where.price.gte = minPrice;
      if (maxPrice !== undefined) where.price.lte = maxPrice;
    }

    if (minRent !== undefined || maxRent !== undefined) {
      where.monthlyRent = {};
      if (minRent !== undefined) where.monthlyRent.gte = minRent;
      if (maxRent !== undefined) where.monthlyRent.lte = maxRent;
    }

    if (furnished !== undefined) where.furnished = furnished;
    if (promoted) where.promotionTier = { not: null };

    const orderBy: any[] = [
      { featuredUntil: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
    ];

    const total = await this.prisma.property.count({ where });
    const properties = await this.prisma.property.findMany({
      where,
      orderBy,
      take: limit,
      skip: offset,
      include: {
        seller: { select: { agency: { select: { name: true } } } },
      },
    });

    return { properties, total };
  }

  async getOwnedProperties(ownerId: string, filters: PropertyFilter) {
    const {
      estado,
      ciudad,
      colonia,
      codigoPostal,
      listingType,
      minPrice,
      maxPrice,
      minRent,
      maxRent,
      furnished,
      status,
      visibility,
      limit,
      offset,
    } = filters;

    const where: any = {
      sellerId: ownerId,
    };

    if (estado) where.estado = estado;
    if (ciudad) where.ciudad = ciudad;
    if (colonia) where.colonia = colonia;
    if (codigoPostal) where.codigoPostal = codigoPostal;
    if (listingType) where.listingType = listingType;
    if (status) where.status = status;
    if (visibility) where.visibility = visibility;

    if (minPrice !== undefined || maxPrice !== undefined) {
      where.price = {};
      if (minPrice !== undefined) where.price.gte = minPrice;
      if (maxPrice !== undefined) where.price.lte = maxPrice;
    }

    if (minRent !== undefined || maxRent !== undefined) {
      where.monthlyRent = {};
      if (minRent !== undefined) where.monthlyRent.gte = minRent;
      if (maxRent !== undefined) where.monthlyRent.lte = maxRent;
    }

    if (furnished !== undefined) {
      where.furnished = furnished;
    }

    const total = await this.prisma.property.count({ where });

    const properties = await this.prisma.property.findMany({
      where,
      orderBy: { createdAt: "desc" },
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
    method: "GET",
    url: "/properties",
    schema: {
      querystring: {
        type: "object",
        properties: {
          estado: { type: "string" },
          ciudad: { type: "string" },
          colonia: { type: "string" },
          codigoPostal: { type: "string" },
          listingType: { type: "string", enum: ["for_sale", "for_rent"] }, // NEW
          minPrice: { type: "number" },
          maxPrice: { type: "number" },
          minRent: { type: "number" }, // NEW
          maxRent: { type: "number" }, // NEW
          furnished: {
            type: "string",
            enum: ["unfurnished", "semi_furnished", "furnished", "equipada"],
          },
          limit: { type: "number", default: 20 },
          offset: { type: "number", default: 0 },
        },
      },
    },
    handler: async (request, reply) => {
      try {
        // Validate query parameters
        const filters = propertyFilterSchema.parse(request.query);

        // Get properties with filters
        const { properties, total } =
          await propertyService.getProperties(filters);

        return reply.code(200).send({
          success: true,
          data: properties,
          total,
        });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            success: false,
            error: "Invalid query parameters",
            details: error.errors,
          });
        }

        app.log.error(error);
        return reply.code(500).send({
          success: false,
          error: "Failed to fetch properties",
        });
      }
    },
  });

  // GET /properties/filter-options - Get available filter options
  app.route({
    method: "GET",
    url: "/properties/filter-options",
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
          error: "Failed to fetch filter options",
        });
      }
    },
  });

  // POST /properties - Create a new property (protected - seller/wholesaler/landlord)
  app.route({
    method: "POST",
    url: "/properties",
    config: {
      rateLimit: {
        max: 100,
        timeWindow: "15 minutes",
        keyGenerator: (req) =>
          "props:create:" + ((req as any).user?.id || req.ip),
      },
    },
    onRequest: [
      verifyJWT,
      requireAnyRole(["seller", "wholesaler", "landlord", "admin"]),
    ],
    handler: async (request, reply) => {
      try {
        const user = (request as any).user;
        const isSoft = (request.query as any)?.soft === "true";
        const body = request.body as any;

        let input: any;
        let warnings: string[] = [];
        let isIncomplete = false;

        if (isSoft) {
          const result = createPropertySchema.safeParse(body);
          if (result.success) {
            input = result.data;
          } else {
            // Extract valid fields, fill dangerous/invalid ones with safe defaults
            warnings = result.error.errors.map(
              (e) => `${e.path.join(".")}: ${e.message}`,
            );
            isIncomplete = true;

            // Build input from raw body with safe defaults for missing/invalid fields
            const safeString = (v: any, min = 1, max = 200) =>
              typeof v === "string" && v.length >= min && v.length <= max
                ? v
                : "Sin título";

            input = {
              title: safeString(body.title, 1, 200) || "Propiedad importada",
              description:
                typeof body.description === "string" ? body.description : "",
              address: typeof body.address === "string" ? body.address : "",
              estado: typeof body.estado === "string" ? body.estado : "Sonora",
              ciudad: typeof body.ciudad === "string" ? body.ciudad : "",
              colonia: typeof body.colonia === "string" ? body.colonia : "",
              codigoPostal: body.codigoPostal || undefined,
              propertyType:
                typeof body.propertyType === "string"
                  ? body.propertyType
                  : "Casa",
              bedrooms:
                typeof body.bedrooms === "number" && body.bedrooms >= 0
                  ? body.bedrooms
                  : 0,
              bathrooms:
                typeof body.bathrooms === "number" && body.bathrooms >= 0
                  ? body.bathrooms
                  : 0,
              squareMeters:
                typeof body.squareMeters === "number" && body.squareMeters >= 1
                  ? body.squareMeters
                  : 1,
              price:
                typeof body.price === "number" && body.price > 0
                  ? body.price
                  : undefined,
              listingType:
                body.listingType === "for_rent" ? "for_rent" : "for_sale",
              status: "incompleto",
              visibility: "private",
              yearBuilt:
                typeof body.yearBuilt === "number" && body.yearBuilt >= 1800
                  ? body.yearBuilt
                  : undefined,
              petFriendly:
                typeof body.petFriendly === "boolean"
                  ? body.petFriendly
                  : false,
            };
          }
        } else {
          input = createPropertySchema.parse(body);
        }

        // Soft upload: all imported properties stay private as drafts
        // until the user manually adds photos and publishes
        if (isSoft) {
          isIncomplete = true;
          input.status = "incompleto";
          input.visibility = "private";
        }

        // Non-soft upload without images: force draft (private + incomplete)
        // User must add photos then call POST /:id/publish to go public
        const hasImages =
          Array.isArray(input.imageUrls) && input.imageUrls.length > 0;
        if (!isSoft && !hasImages) {
          isIncomplete = true;
          input.status = "incompleto";
          input.visibility = "private";
        }

        // ─── Duplicate detection (soft upload only) ──────────────────
        if (isSoft && input.address) {
          const addr = input.address.trim().toLowerCase();
          const colonia = (input.colonia || "").trim().toLowerCase();
          const ciudad = (input.ciudad || "").trim().toLowerCase();

          // Self-check: user's own properties with same address
          const selfDuplicate = await app.prisma.property.findFirst({
            where: {
              sellerId: user.id,
              colonia: input.colonia,
              ciudad: input.ciudad,
              address: { contains: addr, mode: "insensitive" },
            },
            orderBy: { updatedAt: "desc" },
          });

          if (selfDuplicate) {
            const daysSinceCreated = Math.floor(
              (Date.now() - selfDuplicate.createdAt.getTime()) /
                (1000 * 60 * 60 * 24),
            );
            const daysRemaining = Math.max(0, 180 - daysSinceCreated);

            if (daysRemaining > 0) {
              // Free reactivation within 180 days of original upload
              const updated = await app.prisma.property.update({
                where: { id: selfDuplicate.id },
                data: { status: "incompleto", visibility: "private" },
              });
              return reply.code(201).send({
                success: true,
                data: updated,
                duplicateSelf: true,
                reactivatedFree: true,
                daysRemaining,
              });
            } else {
              // Charge 10 credits after 180 days
              const balance = await app.prisma.creditBalance.findUnique({
                where: { userId: user.id },
              });
              if (!balance || balance.balance < 10) {
                return reply.code(402).send({
                  success: false,
                  error:
                    "Saldo insuficiente para reactivar. Se requieren 10 créditos.",
                  duplicateId: selfDuplicate.id,
                });
              }
              await app.prisma.creditBalance.update({
                where: { userId: user.id },
                data: { balance: { decrement: 10 } },
              });
              await app.prisma.property.update({
                where: { id: selfDuplicate.id },
                data: { status: "incompleto", visibility: "private" },
              });
              return reply.code(201).send({
                success: true,
                data: { ...selfDuplicate, status: "incompleto" },
                duplicateSelf: true,
                reactivatedCharged: true,
                cost: 10,
              });
            }
          }

          // Cross-user check: other users' active properties
          const crossDuplicate = await app.prisma.property.findFirst({
            where: {
              colonia: input.colonia,
              ciudad: input.ciudad,
              address: { contains: addr, mode: "insensitive" },
              NOT: { sellerId: user.id },
              status: { notIn: ["retirado", "vendido", "rentado"] },
            },
            select: {
              id: true,
              title: true,
              colonia: true,
              ciudad: true,
              status: true,
            },
          });

          if (crossDuplicate) {
            // Still create the property, but flag it
            warnings.push(
              `Ya existe en la plataforma: "${crossDuplicate.title}" en ${crossDuplicate.colonia}, ${crossDuplicate.ciudad}`,
            );
          }
        }

        const data: any = {
          title: input.title,
          description: input.description || "",
          address: input.address || "",
          imageUrls: [],
          price: input.price ?? null,
          lat: input.lat ?? null,
          lng: input.lng ?? null,
          estado: input.estado,
          ciudad: input.ciudad || "",
          colonia: input.colonia || "",
          codigoPostal: input.codigoPostal || null,
          propertyType: input.propertyType || "Casa",
          bedrooms: input.bedrooms ?? 0,
          bathrooms: input.bathrooms ?? 0,
          squareMeters: input.squareMeters ?? 1,
          includedServices: input.includedServices ?? [],
          amenities: input.amenities ?? [],
          financeOptions: input.financeOptions ?? [],
          status: input.status || "disponible",
          listingType: input.listingType || "for_sale",
          monthlyRent: input.monthlyRent ?? null,
          securityDeposit: input.securityDeposit ?? null,
          leaseTermMonths: input.leaseTermMonths ?? null,
          availableFrom: input.availableFrom
            ? new Date(input.availableFrom)
            : null,
          furnished: input.furnished ?? "unfurnished",
          utilitiesIncluded:
            (input.includedServices?.length ?? 0) > 0 ||
            (input.utilitiesIncluded ?? false),
          condition: input.condition ?? null,
          parkingType: input.parkingType ?? null,
          parkingSpaces: input.parkingSpaces ?? null,
          miniSplits: input.miniSplits ?? null,
          petFriendly: input.petFriendly ?? false,
          petFee: input.petFee ?? null,
          petDeposit: input.petDeposit ?? null,
          yearBuilt: input.yearBuilt ?? null,
          floors: input.floors ?? null,
          lotSize: input.lotSize ?? null,
          maintenanceFee: input.maintenanceFee ?? null,
          halfBaths: input.halfBaths ?? null,
          childrenWelcome: input.childrenWelcome ?? false,
          issuesInvoice: input.issuesInvoice ?? false,
          visibility: isIncomplete ? "private" : (input.visibility ?? "public"),
          sellerId: user.id,
        };

        if (warnings.length > 0) {
          data.inventoryNotes = JSON.stringify({
            warnings,
            importedAt: new Date().toISOString(),
          });
        }

        const property = await app.prisma.property.create({ data });

        // Auto-geocode address to populate lat/lng
        if (!input.lat || !input.lng) {
          const locationTypeRank: Record<string, number> = {
            ROOFTOP: 1,
            RANGE_INTERPOLATED: 2,
            GEOMETRIC_CENTER: 3,
            APPROXIMATE: 4,
          };

          // Strategy 1: full address with city/state context (precise)
          const fullAddress = [
            input.address,
            input.colonia,
            input.ciudad,
            input.estado,
            "México",
            input.codigoPostal,
          ]
            .filter(Boolean)
            .join(", ");

          // Strategy 2: minimal address (lets Google figure out location)
          const minimalAddress = [input.address, "México", input.codigoPostal]
            .filter(Boolean)
            .join(", ");

          const attempts: Array<{ address: string }> = [
            { address: fullAddress },
          ];
          if (minimalAddress !== fullAddress) {
            attempts.push({ address: minimalAddress });
          }

          let bestResult: { lat: number; lng: number } | null = null;
          let bestRank = 99;

          for (const attempt of attempts) {
            try {
              const geoResult = await mapsService.geocodeAddress(
                attempt.address,
              );
              const geoLat = geoResult?.geometry?.location?.lat;
              const geoLng = geoResult?.geometry?.location?.lng;
              const locationType =
                (geoResult?.geometry?.location_type as string) ?? "";
              const partialMatch = geoResult?.partial_match as
                | boolean
                | undefined;
              const rank =
                (locationTypeRank[locationType] ?? 99) + (partialMatch ? 1 : 0);

              if (
                typeof geoLat === "number" &&
                typeof geoLng === "number" &&
                rank < bestRank
              ) {
                bestRank = rank;
                bestResult = { lat: geoLat, lng: geoLng };
              }
              if (locationType === "ROOFTOP" && !partialMatch) break; // perfect match, stop
            } catch (geoErr) {
              app.log.warn(
                { geoErr, address: attempt.address },
                "Geocoding attempt failed",
              );
            }
          }

          if (bestResult) {
            await app.prisma.property.update({
              where: { id: property.id },
              data: { lat: bestResult.lat, lng: bestResult.lng },
            });
            property.lat = bestResult.lat;
            property.lng = bestResult.lng;
          }
        }

        if (input.listingType === "for_rent") {
          await landlordService.addLandlordRoleIfNeeded(user.id);
        }

        await cacheService.invalidate("location:filter:*");

        return reply.code(201).send({
          success: true,
          data: property,
          warnings: warnings.length > 0 ? warnings : undefined,
          isIncomplete,
        });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            success: false,
            error: "Validation error",
            details: error.errors,
          });
        }

        app.log.error(error);
        return reply.code(500).send({
          success: false,
          error: "Failed to create property",
        });
      }
    },
  });

  // GET /properties/mine - Get current user's owned properties
  app.route({
    method: "GET",
    url: "/properties/mine",
    onRequest: [
      verifyJWT,
      requireAnyRole(["seller", "wholesaler", "landlord", "admin"]),
    ],
    handler: async (request, reply) => {
      try {
        const user = (request as any).user;
        const filters = propertyFilterSchema.parse(request.query);
        const { properties, total } = await propertyService.getOwnedProperties(
          user.id,
          filters,
        );

        return reply.code(200).send({
          success: true,
          data: properties,
          total,
        });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            success: false,
            error: "Invalid query parameters",
            details: error.errors,
          });
        }

        app.log.error(error);
        return reply.code(500).send({
          success: false,
          error: "Failed to fetch owned properties",
        });
      }
    },
  });

  // GET /properties/map - Get properties with coordinates (must be before /:id)
  app.route({
    method: "GET",
    url: "/properties/map",
    handler: async (request, reply) => {
      try {
        const properties = await app.prisma.property.findMany({
          where: {
            lat: { not: null },
            lng: { not: null },
            visibility: "public",
            status: { not: "incompleto" },
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
          orderBy: { createdAt: "desc" },
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
          error: "Failed to fetch map properties",
        });
      }
    },
  });

  // GET /properties/:id - Get property by ID
  app.route({
    method: "GET",
    url: "/properties/:id",
    handler: async (request, reply) => {
      try {
        const { id } = request.params as { id: string };

        let sellerId: string | null = null;
        try {
          const token =
            request.headers?.authorization?.replace("Bearer ", "") ||
            (request as any).cookies?.accessToken;
          if (token) {
            const decoded = app.jwt.verify(token) as any;
            sellerId = decoded.id;
          }
        } catch {
          // Token invalid or expired — proceed as unauthenticated for public property view
        }

        let where: any = { id };
        if (!sellerId) {
          where.visibility = "public";
          where.status = { not: "incompleto" };
        }

        const property = await app.prisma.property.findUnique({
          where,
          include: sellerId
            ? {
                propertyRequests: {
                  select: { id: true, buyerId: true, status: true },
                },
              }
            : undefined,
        });

        if (!property) {
          return reply.code(404).send({
            success: false,
            error: "Property not found",
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
          error: "Failed to fetch property",
        });
      }
    },
  });

  // PATCH /properties/:id - Update property (protected - owner only)
  app.route({
    method: "PATCH",
    url: "/properties/:id",
    config: {
      rateLimit: { max: 20, timeWindow: "15 minutes" },
    },
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
            error: "Property not found",
          });
        }

        if (existingProperty.sellerId !== user.id) {
          return reply.code(403).send({
            success: false,
            error: "You can only update your own properties",
          });
        }

        // Validate update input
        const input = updatePropertySchema.parse(request.body);

        // Update property
        const updated = await app.prisma.property.update({
          where: { id },
          data: {
            title: input.title,
            description: input.description,
            address: input.address,
            imageUrls: input.imageUrls,
            price: input.price,
            lat: input.lat,
            lng: input.lng,
            estado: input.estado,
            ciudad: input.ciudad,
            colonia: input.colonia,
            codigoPostal: input.codigoPostal,
            propertyType: input.propertyType,
            bedrooms: input.bedrooms,
            bathrooms: input.bathrooms,
            squareMeters: input.squareMeters,
            status: input.status,
            listingType: input.listingType,
            monthlyRent: input.monthlyRent,
            securityDeposit: input.securityDeposit,
            leaseTermMonths: input.leaseTermMonths,
            furnished: input.furnished,
            utilitiesIncluded:
              input.includedServices !== undefined
                ? input.includedServices.length > 0
                : input.utilitiesIncluded,
            includedServices: input.includedServices,
            amenities: input.amenities,
            financeOptions: input.financeOptions,
            availableFrom: input.availableFrom
              ? new Date(input.availableFrom)
              : undefined,
            condition: input.condition,
            parkingType: input.parkingType,
            parkingSpaces: input.parkingSpaces,
            miniSplits: input.miniSplits,
            petFriendly: input.petFriendly,
            petFee: input.petFee,
            petDeposit: input.petDeposit,
            yearBuilt: input.yearBuilt,
            floors: input.floors,
            lotSize: input.lotSize,
            maintenanceFee: input.maintenanceFee,
            halfBaths: input.halfBaths,
            childrenWelcome: input.childrenWelcome,
            issuesInvoice: input.issuesInvoice,
            visibility: input.visibility,
          },
        });

        // If changed to rental, add landlord role
        if (
          input.listingType === "for_rent" &&
          existingProperty.listingType !== "for_rent"
        ) {
          await landlordService.addLandlordRoleIfNeeded(user.id);
        }

        // If changed from rental to sale, check if should remove landlord role
        if (
          input.listingType === "for_sale" &&
          existingProperty.listingType === "for_rent"
        ) {
          await landlordService.removeLandlordRoleIfNeeded(user.id);
        }

        // Invalidate location filter cache when property is updated
        await cacheService.invalidate("location:filter:*");

        return reply.code(200).send({
          success: true,
          data: updated,
        });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            success: false,
            error: "Validation error",
            details: error.errors,
          });
        }

        app.log.error(error);
        return reply.code(500).send({
          success: false,
          error: "Failed to update property",
        });
      }
    },
  });

  // POST /properties/:id/publish — publish a draft property (owner only)
  app.route({
    method: "POST",
    url: "/properties/:id/publish",
    onRequest: [verifyJWT],
    handler: async (request, reply) => {
      try {
        const user = (request as any).user;
        const { id } = request.params as { id: string };

        const property = await app.prisma.property.findUnique({
          where: { id },
        });
        if (!property) {
          return reply
            .code(404)
            .send({ success: false, error: "Propiedad no encontrada" });
        }
        if (property.sellerId !== user.id) {
          return reply
            .code(403)
            .send({ success: false, error: "No autorizado" });
        }
        if (!property.imageUrls || property.imageUrls.length === 0) {
          return reply
            .code(400)
            .send({
              success: false,
              error: "Se requiere al menos una foto para publicar",
            });
        }

        const updated = await app.prisma.property.update({
          where: { id },
          data: { status: "disponible", visibility: "public" },
        });

        // Notify users subscribed to this ciudad/colonia area
        notifyTagSubscribers(
          app.prisma,
          updated.id,
          updated.title,
          updated.ciudad,
          updated.colonia,
        ).catch((err: any) =>
          app.log.warn({ err }, "Failed to send tag notifications"),
        );

        return reply.send({ success: true, data: updated });
      } catch (error: any) {
        app.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Failed to publish property" });
      }
    },
  });

  // POST /properties/:id/promote — boost property visibility (owner only)
  app.route({
    method: "POST",
    url: "/properties/:id/promote",
    config: {
      rateLimit: { max: 5, timeWindow: "15 minutes" },
    },
    onRequest: [verifyJWT],
    handler: async (request, reply) => {
      try {
        const user = (request as any).user;
        const { id } = request.params as { id: string };
        const { tier, days } = promotePropertySchema.parse(request.body);

        const property = await app.prisma.property.findUnique({
          where: { id },
        });
        if (!property) {
          return reply
            .code(404)
            .send({ success: false, error: "Propiedad no encontrada" });
        }
        if (property.sellerId !== user.id) {
          return reply
            .code(403)
            .send({ success: false, error: "Solo el dueño puede promocionar" });
        }

        // Carousel slot limit (max 4)
        if (tier === "carousel") {
          const activeCarousel = await app.prisma.property.count({
            where: {
              promotionTier: "carousel",
              featuredUntil: { gt: new Date() },
            },
          });
          if (activeCarousel >= 4 && property.promotionTier !== "carousel") {
            return reply
              .code(409)
              .send({
                success: false,
                error:
                  "El carrusel está lleno (máximo 4 propiedades). Espera a que se libere un espacio.",
              });
          }
        }

        const RATES: Record<string, number> = { featured: 300, carousel: 2000 };
        const cost = RATES[tier] * days;
        const featuredUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

        // Atomic check + deduct using interactive transaction to prevent race conditions
        const promoResult = await app.prisma.$transaction(async (tx) => {
          const balance = await tx.creditBalance.findUnique({
            where: { userId: user.id },
          });
          if (!balance || balance.balance < cost) {
            return { success: false, newBalance: balance?.balance ?? 0 };
          }
          const updated = await tx.creditBalance.update({
            where: { userId: user.id },
            data: { balance: { decrement: cost } },
          });
          await tx.creditTransaction.create({
            data: {
              userId: user.id,
              type: "promotion",
              amount: -cost,
              description: `Promoción ${tier === "carousel" ? "Promocionado" : "Destacado"} × ${days} días`,
              referenceId: id,
            },
          });
          await tx.property.update({
            where: { id },
            data: { promotionTier: tier, featuredUntil },
          });
          return { success: true, newBalance: updated.balance };
        });

        if (!promoResult.success) {
          return reply
            .code(402)
            .send({
              success: false,
              error: `Saldo insuficiente. Necesitas ${cost} créditos.`,
            });
        }

        return reply.send({ success: true, cost, tier, days, featuredUntil });
      } catch (error: any) {
        if (error.constructor?.name === "ZodError") {
          return reply
            .code(400)
            .send({
              success: false,
              error: "Datos inválidos",
              details: error.errors,
            });
        }
        app.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Error al promocionar" });
      }
    },
  });

  // DELETE /properties/:id - Delete property (owner only)
  app.route({
    method: "DELETE",
    url: "/properties/:id",
    config: {
      rateLimit: { max: 10, timeWindow: "15 minutes" },
    },
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
            error: "Property not found",
          });
        }

        if (property.sellerId !== user.id) {
          return reply.code(403).send({
            success: false,
            error: "You can only delete your own properties",
          });
        }

        // Delete property
        await app.prisma.property.delete({
          where: { id },
        });

        // If was a rental, check if should remove landlord role
        if (property.listingType === "for_rent") {
          await landlordService.removeLandlordRoleIfNeeded(user.id);
        }

        return reply.code(200).send({
          success: true,
          message: "Property deleted successfully",
        });
      } catch (error: any) {
        app.log.error(error);
        return reply.code(500).send({
          success: false,
          error: "Failed to delete property",
        });
      }
    },
  });

  // GET /properties/most-viewed — public, top properties by page views
  app.get("/properties/most-viewed", async (req, reply) => {
    try {
      const limit = Math.min(Number((req.query as any)?.limit) || 6, 20);

      // Use raw query to avoid Prisma 5.22 groupBy circular type issue
      const topViewed = await app.prisma.$queryRawUnsafe<
        Array<{ entityId: string; cnt: number }>
      >(
        `SELECT "entityId", COUNT("entityId")::int as cnt FROM "AnalyticsEvent" WHERE "eventName" = 'property_view' AND "entityType" = 'property' GROUP BY "entityId" ORDER BY cnt DESC LIMIT $1`,
        limit,
      );

      if (topViewed.length === 0) {
        const latest = await app.prisma.property.findMany({
          where: { status: "disponible", visibility: "public" },
          orderBy: { createdAt: "desc" },
          take: limit,
        });
        return reply.send({ properties: latest });
      }

      const ids = topViewed.map((e) => e.entityId);
      const properties = await app.prisma.property.findMany({
        where: { id: { in: ids }, status: "disponible", visibility: "public" },
      });

      // Sort by view count order
      const viewCounts = new Map(topViewed.map((e) => [e.entityId, e.cnt]));
      properties.sort(
        (a, b) => (viewCounts.get(b.id) ?? 0) - (viewCounts.get(a.id) ?? 0),
      );

      return reply.send({ properties });
    } catch (error: any) {
      app.log.error(error);
      return reply
        .code(500)
        .send({ error: "Failed to fetch most viewed properties" });
    }
  });
};

export default propertiesPlugin;

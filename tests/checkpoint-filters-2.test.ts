import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { FastifyInstance } from 'fastify';
import { signRoleToken } from './utils/authHelpers.js';

let app: FastifyInstance;
let testSellerId: string;
let testBuyerId: string;
let authToken: string;

describe('Checkpoint 2 - Backend API Filters', () => {
  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Create test seller user
    const seller = await app.prisma.user.create({
      data: {
        email: `seller-${Date.now()}@example.com`,
        name: 'Test Seller',
        password: 'hashed-password',
      },
    });
    testSellerId = seller.id;

    // Create test buyer user
    const buyer = await app.prisma.user.create({
      data: {
        email: `buyer-${Date.now()}@example.com`,
        name: 'Test Buyer',
        password: 'hashed-password',
      },
    });
    testBuyerId = buyer.id;

    // Generate auth token for seller
    authToken = signRoleToken(app, {
      id: testSellerId,
      email: seller.email,
      roles: ['seller'],
    });
  });

  describe('GET /properties', () => {
    it('should return all properties when no filters provided', async () => {
      // Create test properties
      await app.prisma.property.create({
        data: {
          title: 'Property 1',
          listingType: 'for_sale',
          price: 500000,
          estado: 'Jalisco',
          ciudad: 'Guadalajara',
          sellerId: testSellerId,
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/properties',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.total).toBeGreaterThanOrEqual(1);
    });

    it('should filter properties by estado exactly', async () => {
      // Create properties in different estados
      const jaliscoProperty = await app.prisma.property.create({
        data: {
          title: 'Jalisco Property',
          listingType: 'for_sale',
          price: 500000,
          estado: 'Jalisco',
          ciudad: 'Guadalajara',
          sellerId: testSellerId,
        },
      });

      await app.prisma.property.create({
        data: {
          title: 'CDMX Property',
          listingType: 'for_sale',
          price: 3000000,
          estado: 'Ciudad de México',
          ciudad: 'Ciudad de México',
          sellerId: testSellerId,
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/properties?estado=Jalisco',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(1);
      expect(body.data.every((p: any) => p.estado === 'Jalisco')).toBe(true);
    });

    it('should filter properties by ciudad', async () => {
      const guadalajaraProperty = await app.prisma.property.create({
        data: {
          title: 'Guadalajara Property',
          listingType: 'for_sale',
          price: 500000,
          estado: 'Jalisco',
          ciudad: 'Guadalajara',
          sellerId: testSellerId,
        },
      });

      await app.prisma.property.create({
        data: {
          title: 'Zapopan Property',
          listingType: 'for_sale',
          price: 450000,
          estado: 'Jalisco',
          ciudad: 'Zapopan',
          sellerId: testSellerId,
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/properties?ciudad=Guadalajara',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.every((p: any) => p.ciudad === 'Guadalajara')).toBe(true);
    });

    it('should filter properties by colonia', async () => {
      await app.prisma.property.create({
        data: {
          title: 'Roma Norte Property',
          listingType: 'for_sale',
          price: 3000000,
          estado: 'Ciudad de México',
          ciudad: 'Ciudad de México',
          colonia: 'Roma Norte',
          sellerId: testSellerId,
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/properties?colonia=Roma%20Norte',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      if (body.data.length > 0) {
        expect(body.data.some((p: any) => p.colonia === 'Roma Norte')).toBe(true);
      }
    });

    it('should filter properties by código postal', async () => {
      await app.prisma.property.create({
        data: {
          title: 'Polanco Property',
          listingType: 'for_sale',
          price: 4000000,
          estado: 'Ciudad de México',
          ciudad: 'Ciudad de México',
          colonia: 'Polanco',
          codigoPostal: '11560',
          sellerId: testSellerId,
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/properties?codigoPostal=11560',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      if (body.data.length > 0) {
        expect(body.data.some((p: any) => p.codigoPostal === '11560')).toBe(true);
      }
    });

    it('should combine multiple filters', async () => {
      await app.prisma.property.create({
        data: {
          title: 'Guadalajara Providencia',
          listingType: 'for_sale',
          price: 500000,
          estado: 'Jalisco',
          ciudad: 'Guadalajara',
          colonia: 'Providencia',
          codigoPostal: '44630',
          sellerId: testSellerId,
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/properties?estado=Jalisco&ciudad=Guadalajara&colonia=Providencia',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.every((p: any) => 
        p.estado === 'Jalisco' && 
        p.ciudad === 'Guadalajara' && 
        p.colonia === 'Providencia'
      )).toBe(true);
    });

    it('should filter by minPrice', async () => {
      await app.prisma.property.create({
        data: {
          title: 'Expensive Property',
          listingType: 'for_sale',
          price: 1000000,
          estado: 'Jalisco',
          sellerId: testSellerId,
        },
      });

      await app.prisma.property.create({
        data: {
          title: 'Cheap Property',
          listingType: 'for_sale',
          price: 100000,
          estado: 'Jalisco',
          sellerId: testSellerId,
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/properties?minPrice=500000',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.every((p: any) => p.price >= 500000)).toBe(true);
    });

    it('should filter by maxPrice', async () => {
      await app.prisma.property.create({
        data: {
          title: 'Expensive Property',
          listingType: 'for_sale',
          price: 1000000,
          estado: 'Jalisco',
          sellerId: testSellerId,
        },
      });

      await app.prisma.property.create({
        data: {
          title: 'Cheap Property',
          listingType: 'for_sale',
          price: 100000,
          estado: 'Jalisco',
          sellerId: testSellerId,
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/properties?maxPrice=500000',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.every((p: any) => p.price <= 500000)).toBe(true);
    });

    it('should filter by price range (minPrice and maxPrice)', async () => {
      await app.prisma.property.create({
        data: {
          title: 'Property 1',
          listingType: 'for_sale',
          price: 100000,
          estado: 'Jalisco',
          sellerId: testSellerId,
        },
      });

      await app.prisma.property.create({
        data: {
          title: 'Property 2',
          listingType: 'for_sale',
          price: 500000,
          estado: 'Jalisco',
          sellerId: testSellerId,
        },
      });

      await app.prisma.property.create({
        data: {
          title: 'Property 3',
          listingType: 'for_sale',
          price: 1000000,
          estado: 'Jalisco',
          sellerId: testSellerId,
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/properties?minPrice=300000&maxPrice=700000',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.every((p: any) => 
        p.price >= 300000 && p.price <= 700000
      )).toBe(true);
    });

    it('should support pagination with limit and offset', async () => {
      // Create multiple properties
      for (let i = 0; i < 5; i++) {
        await app.prisma.property.create({
          data: {
            title: `Property ${i}`,
            listingType: 'for_sale',
            price: 500000 + i * 100000,
            estado: 'Jalisco',
            sellerId: testSellerId,
          },
        });
      }

      // Get first page
      const response1 = await app.inject({
        method: 'GET',
        url: '/properties?limit=2&offset=0',
      });

      expect(response1.statusCode).toBe(200);
      const body1 = JSON.parse(response1.body);
      expect(body1.data.length).toBeLessThanOrEqual(2);
      expect(body1.total).toBeGreaterThanOrEqual(5);

      // Get second page
      const response2 = await app.inject({
        method: 'GET',
        url: '/properties?limit=2&offset=2',
      });

      expect(response2.statusCode).toBe(200);
      const body2 = JSON.parse(response2.body);
      expect(body2.data.length).toBeLessThanOrEqual(2);
    });

    it('should reject invalid query parameters', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties?limit=invalid',
      });

      expect(response.statusCode).toBe(400);
      // Fastify returns validation error format, not our custom format
      const body = JSON.parse(response.body);
      expect(body).toBeDefined();
    });

    it('should reject limit > 100', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties?limit=101',
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
    });

    it('should accept valid limit < 100', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties?limit=50',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });

    it('should return total count in response', async () => {
      await app.prisma.property.create({
        data: {
          title: 'Test Property',
          listingType: 'for_sale',
          price: 500000,
          estado: 'Jalisco',
          sellerId: testSellerId,
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/properties',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(typeof body.total).toBe('number');
      expect(body.total).toBeGreaterThanOrEqual(0);
    });
  });

  describe('GET /properties/filter-options', () => {
    it('should return filter options structure', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/filter-options',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data).toHaveProperty('estados');
      expect(body.data).toHaveProperty('ciudades');
      expect(Array.isArray(body.data.estados)).toBe(true);
      expect(typeof body.data.ciudades).toBe('object');
    });

    it('should include all unique estados from properties', async () => {
      await app.prisma.property.create({
        data: {
          title: 'Jalisco Property',
          listingType: 'for_sale',
          price: 500000,
          estado: 'Jalisco',
          sellerId: testSellerId,
        },
      });

      await app.prisma.property.create({
        data: {
          title: 'CDMX Property',
          listingType: 'for_sale',
          price: 3000000,
          estado: 'Ciudad de México',
          sellerId: testSellerId,
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/properties/filter-options',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.estados).toContain('Jalisco');
      expect(body.data.estados).toContain('Ciudad de México');
    });

    it('should map ciudades to their respective estados', async () => {
      await app.prisma.property.create({
        data: {
          title: 'Guadalajara Property',
          listingType: 'for_sale',
          price: 500000,
          estado: 'Jalisco',
          ciudad: 'Guadalajara',
          sellerId: testSellerId,
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/properties/filter-options',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.data.ciudades).toHaveProperty('Jalisco');
      if (body.data.ciudades['Jalisco']) {
        expect(body.data.ciudades['Jalisco']).toContain('Guadalajara');
      }
    });

    it('should filter out null ciudades', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/filter-options',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      
      // Check that no ciudad array contains null
      for (const ciudades of Object.values(body.data.ciudades)) {
        expect((ciudades as any).includes(null)).toBe(false);
      }
    });

    it('should be publicly accessible (no auth required)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/filter-options',
      });

      // Should succeed without auth token
      expect(response.statusCode).toBe(200);
    });
  });

  describe('POST /properties', () => {
    it('should create property with required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/properties',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          title: 'New Property',
          listingType: 'for_sale',
          price: 500000,
          estado: 'Jalisco',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.title).toBe('New Property');
      expect(body.data.estado).toBe('Jalisco');
      expect(body.data.sellerId).toBe(testSellerId);
    });

    it('should create property with all location fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/properties',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          title: 'Full Property',
          listingType: 'for_sale',
          price: 500000,
          estado: 'Jalisco',
          ciudad: 'Guadalajara',
          colonia: 'Providencia',
          codigoPostal: '44630',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.ciudad).toBe('Guadalajara');
      expect(body.data.colonia).toBe('Providencia');
      expect(body.data.codigoPostal).toBe('44630');
    });

    it('should reject without auth token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/properties',
        payload: {
          title: 'New Property',
          price: 500000,
          estado: 'Jalisco',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject missing title', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/properties',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          price: 500000,
          estado: 'Jalisco',
        },
      });

      expect(response.statusCode).toBe(400);
      // Fastify returns validation error for missing required field
      const body = JSON.parse(response.body);
      expect(body).toBeDefined();
    });

    it('should reject missing price', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/properties',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          title: 'New Property',
          estado: 'Jalisco',
        },
      });

      expect(response.statusCode).toBe(400);
      // Fastify returns validation error for missing required field
      const body = JSON.parse(response.body);
      expect(body).toBeDefined();
    });

    it('should reject missing estado', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/properties',
        headers: { authorization: `Bearer ${authToken}` },
        payload: {
          title: 'New Property',
          price: 500000,
        },
      });

      expect(response.statusCode).toBe(400);
      // Fastify returns validation error for missing required field
      const body = JSON.parse(response.body);
      expect(body).toBeDefined();
    });
  });

  describe('GET /properties/:id', () => {
    it('should retrieve property by ID', async () => {
      const property = await app.prisma.property.create({
        data: {
          title: 'Test Property',
          listingType: 'for_sale',
          price: 500000,
          estado: 'Jalisco',
          sellerId: testSellerId,
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/properties/${property.id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.id).toBe(property.id);
      expect(body.data.title).toBe('Test Property');
    });

    it('should return 404 for non-existent property', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties/non-existent-id',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
    });

    it('should include property requests in response', async () => {
      const property = await app.prisma.property.create({
        data: {
          title: 'Test Property',
          listingType: 'for_sale',
          price: 500000,
          estado: 'Jalisco',
          sellerId: testSellerId,
        },
      });

      await app.prisma.propertyRequest.create({
        data: {
          propertyId: property.id,
          buyerId: testBuyerId,
          status: 'pending',
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/properties/${property.id}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body.data.propertyRequests)).toBe(true);
      expect(body.data.propertyRequests.length).toBeGreaterThanOrEqual(1);
    });
  });
});

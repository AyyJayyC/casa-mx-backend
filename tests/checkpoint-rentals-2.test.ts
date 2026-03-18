import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { FastifyInstance } from 'fastify';
import { approveUserRole, loginAndGetToken } from './utils/authHelpers.js';

/**
 * Checkpoint 2: Backend API - Rental Listings & Filtering
 * 
 * Tests rental property API functionality:
 * - Create rental properties with validation
 * - Filter properties by listingType
 * - Landlord role auto-management
 * - Update/delete rental properties
 */

describe('Checkpoint 2 - Rental Properties API', () => {
  let app: FastifyInstance;
  let authToken: string;
  let userId: string;
  let rentalPropertyId: string;
  let salePropertyId: string;

  beforeAll(async () => {
    app = await buildApp({ logger: false });
    await app.ready();

    // Create test user and login
    const registerRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        name: 'Rental Test User',
        email: `rental-test-${Date.now()}@test.com`,
        password: 'TestPassword123!',
        roles: ['seller'],
      },
    });

    const registerData = registerRes.json();
    userId = registerData.user.id;

    await approveUserRole(app, userId, 'seller');
    authToken = await loginAndGetToken(app, registerData.user.email, 'TestPassword123!');
  });

  afterAll(async () => {
    // Cleanup: Delete test properties and user
    await app.prisma.property.deleteMany({
      where: { sellerId: userId },
    });
    await app.prisma.user.deleteMany({
      where: { email: { contains: 'rental-test-' } },
    });
    await app.close();
  });

  describe('POST /properties - Create Rental Property', () => {
    it('should create a rental property with required rental fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/properties',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          title: 'Modern Apartment for Rent',
          description: 'Beautiful 2BR apartment in Polanco',
          estado: 'Ciudad de México',
          ciudad: 'Ciudad de México',
          colonia: 'Polanco',
          listingType: 'for_rent',
          monthlyRent: 25000,
          securityDeposit: 50000,
          leaseTermMonths: 12,
          furnished: true,
          utilitiesIncluded: false,
        },
      });

      expect(response.statusCode).toBe(201);
      const data = response.json();
      expect(data.success).toBe(true);
      expect(data.data.listingType).toBe('for_rent');
      expect(data.data.monthlyRent).toBe(25000);
      expect(data.data.securityDeposit).toBe(50000);
      expect(data.data.furnished).toBe(true);
      expect(data.data.price).toBeNull(); // Price not required for rentals

      rentalPropertyId = data.data.id;
    });

    it('should auto-add landlord role when creating first rental', async () => {
      // Check user has landlord role
      const user = await app.prisma.user.findUnique({
        where: { id: userId },
        include: {
          roles: {
            include: { role: true },
          },
        },
      });

      const hasLandlordRole = user?.roles.some(
        (ur) => ur.role.name === 'landlord' && ur.status === 'approved'
      );

      expect(hasLandlordRole).toBe(true);
    });

    it('should create a sale property with required sale fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/properties',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          title: 'House for Sale',
          description: 'Spacious house in Condesa',
          estado: 'Ciudad de México',
          ciudad: 'Ciudad de México',
          colonia: 'Condesa',
          listingType: 'for_sale',
          price: 5500000,
        },
      });

      expect(response.statusCode).toBe(201);
      const data = response.json();
      expect(data.success).toBe(true);
      expect(data.data.listingType).toBe('for_sale');
      expect(data.data.price).toBe(5500000);
      expect(data.data.monthlyRent).toBeNull(); // Rent not required for sales

      salePropertyId = data.data.id;
    });

    it('should reject rental property without monthlyRent', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/properties',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          title: 'Invalid Rental',
          estado: 'Ciudad de México',
          listingType: 'for_rent',
          // Missing monthlyRent
        },
      });

      expect(response.statusCode).toBe(400);
      const data = response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Validation error');
    });

    it('should reject sale property without price', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/properties',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          title: 'Invalid Sale',
          estado: 'Jalisco',
          listingType: 'for_sale',
          // Missing price
        },
      });

      expect(response.statusCode).toBe(400);
      const data = response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe('Validation error');
    });

    it('should reject property creation without authentication', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/properties',
        payload: {
          title: 'Unauthorized',
          estado: 'Jalisco',
          listingType: 'for_rent',
          monthlyRent: 10000,
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /properties - Filter by listingType', () => {
    it('should return only rental properties when filtered by for_rent', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties?listingType=for_rent',
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
      
      // All returned properties should be rentals
      data.data.forEach((property: any) => {
        expect(property.listingType).toBe('for_rent');
      });
    });

    it('should return only sale properties when filtered by for_sale', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties?listingType=for_sale',
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
      
      // All returned properties should be for sale
      data.data.forEach((property: any) => {
        expect(property.listingType).toBe('for_sale');
      });
    });

    it('should return all properties when no listingType filter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties',
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data.length).toBeGreaterThan(0);
    });

    it('should filter rentals by rent range', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties?listingType=for_rent&minRent=20000&maxRent=30000',
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.success).toBe(true);
      
      // All returned rentals should be in range
      data.data.forEach((property: any) => {
        if (property.monthlyRent) {
          expect(property.monthlyRent).toBeGreaterThanOrEqual(20000);
          expect(property.monthlyRent).toBeLessThanOrEqual(30000);
        }
      });
    });

    it('should filter by furnished status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/properties?listingType=for_rent&furnished=true',
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.success).toBe(true);
      
      // All returned properties should be furnished
      data.data.forEach((property: any) => {
        expect(property.furnished).toBe(true);
      });
    });
  });

  describe('PATCH /properties/:id - Update Property', () => {
    it('should update rental property fields', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/properties/${rentalPropertyId}`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          monthlyRent: 28000,
          furnished: false,
          utilitiesIncluded: true,
        },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.success).toBe(true);
      expect(data.data.monthlyRent).toBe(28000);
      expect(data.data.furnished).toBe(false);
      expect(data.data.utilitiesIncluded).toBe(true);
    });

    it('should not allow updating another user\'s property', async () => {
      // Create another user
      const otherUserRes = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          name: 'Other User',
          email: `other-user-${Date.now()}@test.com`,
          password: 'TestPassword123!',
          roles: ['seller'],
        },
      });

      await approveUserRole(app, otherUserRes.json().user.id, 'seller');
      const otherToken = await loginAndGetToken(
        app,
        otherUserRes.json().user.email,
        'TestPassword123!'
      );

      const response = await app.inject({
        method: 'PATCH',
        url: `/properties/${rentalPropertyId}`,
        headers: {
          authorization: `Bearer ${otherToken}`,
        },
        payload: {
          monthlyRent: 50000,
        },
      });

      expect(response.statusCode).toBe(403);
      const data = response.json();
      expect(data.success).toBe(false);
      expect(data.error).toContain('your own properties');
    });

    it('should return 404 for non-existent property', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/properties/00000000-0000-0000-0000-000000000000',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          title: 'Updated',
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /properties/:id - Delete Property', () => {
    it('should delete a sale property', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/properties/${salePropertyId}`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.success).toBe(true);

      // Verify it's deleted
      const checkRes = await app.inject({
        method: 'GET',
        url: `/properties/${salePropertyId}`,
      });

      expect(checkRes.statusCode).toBe(404);
    });

    it('should delete rental property and remove landlord role when last rental', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/properties/${rentalPropertyId}`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);

      // Check landlord role is removed
      const user = await app.prisma.user.findUnique({
        where: { id: userId },
        include: {
          roles: {
            include: { role: true },
          },
        },
      });

      const hasLandlordRole = user?.roles.some(
        (ur) => ur.role.name === 'landlord'
      );

      expect(hasLandlordRole).toBe(false);
    });

    it('should not allow deleting another user\'s property', async () => {
      // Create a property with another user
      const otherUserRes = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          name: 'Property Owner',
          email: `prop-owner-${Date.now()}@test.com`,
          password: 'TestPassword123!',
          roles: ['seller'],
        },
      });

      const otherLoginRes = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: otherUserRes.json().user.email,
          password: 'TestPassword123!',
        },
      });

      const otherToken = otherLoginRes.json().token;

      await approveUserRole(app, otherUserRes.json().user.id, 'seller');
      const approvedOtherToken = await loginAndGetToken(
        app,
        otherUserRes.json().user.email,
        'TestPassword123!'
      );

      const propertyRes = await app.inject({
        method: 'POST',
        url: '/properties',
        headers: {
          authorization: `Bearer ${approvedOtherToken}`,
        },
        payload: {
          title: 'Someone Else Property',
          estado: 'Jalisco',
          listingType: 'for_sale',
          price: 1000000,
        },
      });

      const propertyId = propertyRes.json().data.id;

      // Try to delete with our test user
      const deleteRes = await app.inject({
        method: 'DELETE',
        url: `/properties/${propertyId}`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
      });

      expect(deleteRes.statusCode).toBe(403);
    });
  });

  describe('Landlord Role Management', () => {
    it('should not add duplicate landlord roles', async () => {
      // Create first rental
      const res1 = await app.inject({
        method: 'POST',
        url: '/properties',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          title: 'First Rental',
          estado: 'Jalisco',
          listingType: 'for_rent',
          monthlyRent: 15000,
        },
      });

      expect(res1.statusCode).toBe(201);

      // Create second rental
      const res2 = await app.inject({
        method: 'POST',
        url: '/properties',
        headers: {
          authorization: `Bearer ${authToken}`,
        },
        payload: {
          title: 'Second Rental',
          estado: 'Jalisco',
          listingType: 'for_rent',
          monthlyRent: 16000,
        },
      });

      expect(res2.statusCode).toBe(201);

      // Check only one landlord role exists
      const roles = await app.prisma.userRole.findMany({
        where: {
          userId,
        },
        include: {
          role: true,
        },
      });

      const landlordRoles = roles.filter((ur) => ur.role.name === 'landlord');
      expect(landlordRoles.length).toBe(1);
    });

    it('should keep landlord role when still has rentals', async () => {
      // User should have 2 rentals from previous test
      const rentals = await app.prisma.property.findMany({
        where: {
          sellerId: userId,
          listingType: 'for_rent',
        },
      });

      expect(rentals.length).toBeGreaterThan(0);

      // Delete one rental
      await app.inject({
        method: 'DELETE',
        url: `/properties/${rentals[0].id}`,
        headers: {
          authorization: `Bearer ${authToken}`,
        },
      });

      // Should still have landlord role
      const user = await app.prisma.user.findUnique({
        where: { id: userId },
        include: {
          roles: {
            include: { role: true },
          },
        },
      });

      const hasLandlordRole = user?.roles.some(
        (ur) => ur.role.name === 'landlord'
      );

      expect(hasLandlordRole).toBe(true);
    });
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { FastifyInstance } from 'fastify';

describe('Checkpoint 3 - Rental Application Endpoints', () => {
  let app: FastifyInstance;
  let tenantToken: string;
  let tenantId: string;
  let landlordToken: string;
  let landlordId: string;
  let rentalPropertyId: string;
  let salePropertyId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // Create tenant user
    const tenantRegister = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        name: 'Test Tenant',
        email: 'tenant@test.com',
        password: 'TestPassword123!',
        roles: ['buyer'],
      },
    });
    const tenantData = JSON.parse(tenantRegister.body);
    tenantId = tenantData.user.id;

    // Login as tenant
    const tenantLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'tenant@test.com',
        password: 'TestPassword123!',
      },
    });
    tenantToken = JSON.parse(tenantLogin.body).token;

    // Approve buyer role for tenant
    const buyerRole = await app.prisma.role.findUnique({
      where: { name: 'buyer' },
    });
    await app.prisma.userRole.updateMany({
      where: { userId: tenantId, roleId: buyerRole!.id },
      data: { status: 'approved' },
    });

    // Create landlord user
    const landlordRegister = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        name: 'Test Landlord',
        email: 'landlord@test.com',
        password: 'TestPassword123!',
        roles: ['seller'],
      },
    });
    const landlordData = JSON.parse(landlordRegister.body);
    landlordId = landlordData.user.id;

    // Add and approve landlord role
    const landlordRole = await app.prisma.role.findUnique({
      where: { name: 'landlord' },
    });
    await app.prisma.userRole.create({
      data: {
        userId: landlordId,
        roleId: landlordRole!.id,
        status: 'approved',
      },
    });

    // Login as landlord (AFTER role added to get correct token)
    const landlordLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'landlord@test.com',
        password: 'TestPassword123!',
      },
    });
    landlordToken = JSON.parse(landlordLogin.body).token;

    // Create rental property
    const rentalProperty = await app.prisma.property.create({
      data: {
        title: 'Test Rental Property',
        listingType: 'for_rent',
        monthlyRent: 20000,
        securityDeposit: 40000,
        leaseTermMonths: 12,
        furnished: true,
        estado: 'Jalisco',
        sellerId: landlordId,
      },
    });
    rentalPropertyId = rentalProperty.id;

    // Create sale property (to test rejection)
    const saleProperty = await app.prisma.property.create({
      data: {
        title: 'Test Sale Property',
        listingType: 'for_sale',
        price: 3000000,
        estado: 'Jalisco',
        sellerId: landlordId,
      },
    });
    salePropertyId = saleProperty.id;
  });

  afterAll(async () => {
    // Cleanup
    await app.prisma.rentalApplication.deleteMany({
      where: { applicantId: tenantId },
    });
    await app.prisma.property.deleteMany({
      where: { sellerId: landlordId },
    });
    await app.prisma.user.deleteMany({
      where: { email: { in: ['tenant@test.com', 'landlord@test.com'] } },
    });
    await app.close();
  });

  beforeEach(async () => {
    // Clean applications before each test
    await app.prisma.rentalApplication.deleteMany({
      where: { applicantId: tenantId },
    });
  });

  describe('POST /applications - Create rental application', () => {
    it('should create application with valid data', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/applications',
        headers: { authorization: `Bearer ${tenantToken}` },
        payload: {
          propertyId: rentalPropertyId,
          fullName: 'John Doe',
          email: 'john@example.com',
          phone: '5551234567',
          employer: 'Tech Corp',
          jobTitle: 'Software Engineer',
          monthlyIncome: 50000,
          employmentDuration: '2 years',
          desiredMoveInDate: new Date('2026-03-01').toISOString(),
          desiredLeaseTerm: 12,
          numberOfOccupants: 2,
          reference1Name: 'Jane Smith',
          reference1Phone: '5559876543',
          messageToLandlord: 'I am very interested in this property',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.propertyId).toBe(rentalPropertyId);
      expect(body.data.applicantId).toBe(tenantId);
      expect(body.data.status).toBe('pending');
      expect(body.data.fullName).toBe('John Doe');
      expect(body.data.monthlyIncome).toBe(50000);
    });

    it('should reject application for non-rental property', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/applications',
        headers: { authorization: `Bearer ${tenantToken}` },
        payload: {
          propertyId: salePropertyId,
          fullName: 'John Doe',
          email: 'john@example.com',
          phone: '5551234567',
          employer: 'Tech Corp',
          jobTitle: 'Software Engineer',
          monthlyIncome: 50000,
          employmentDuration: '2 years',
          desiredMoveInDate: new Date('2026-03-01').toISOString(),
          desiredLeaseTerm: 12,
          numberOfOccupants: 2,
          reference1Name: 'Jane Smith',
          reference1Phone: '5559876543',
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error).toContain('rental properties');
    });

    it('should reject application for non-existent property', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/applications',
        headers: { authorization: `Bearer ${tenantToken}` },
        payload: {
          propertyId: '00000000-0000-0000-0000-000000000000',
          fullName: 'John Doe',
          email: 'john@example.com',
          phone: '5551234567',
          employer: 'Tech Corp',
          jobTitle: 'Software Engineer',
          monthlyIncome: 50000,
          employmentDuration: '2 years',
          desiredMoveInDate: new Date('2026-03-01').toISOString(),
          desiredLeaseTerm: 12,
          numberOfOccupants: 2,
          reference1Name: 'Jane Smith',
          reference1Phone: '5559876543',
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error).toBe('Property not found');
    });

    it('should reject duplicate application for same property', async () => {
      // First application
      await app.inject({
        method: 'POST',
        url: '/applications',
        headers: { authorization: `Bearer ${tenantToken}` },
        payload: {
          propertyId: rentalPropertyId,
          fullName: 'John Doe',
          email: 'john@example.com',
          phone: '5551234567',
          employer: 'Tech Corp',
          jobTitle: 'Software Engineer',
          monthlyIncome: 50000,
          employmentDuration: '2 years',
          desiredMoveInDate: new Date('2026-03-01').toISOString(),
          desiredLeaseTerm: 12,
          numberOfOccupants: 2,
          reference1Name: 'Jane Smith',
          reference1Phone: '5559876543',
        },
      });

      // Second application (duplicate)
      const response = await app.inject({
        method: 'POST',
        url: '/applications',
        headers: { authorization: `Bearer ${tenantToken}` },
        payload: {
          propertyId: rentalPropertyId,
          fullName: 'John Doe',
          email: 'john@example.com',
          phone: '5551234567',
          employer: 'Tech Corp',
          jobTitle: 'Software Engineer',
          monthlyIncome: 50000,
          employmentDuration: '2 years',
          desiredMoveInDate: new Date('2026-03-01').toISOString(),
          desiredLeaseTerm: 12,
          numberOfOccupants: 2,
          reference1Name: 'Jane Smith',
          reference1Phone: '5559876543',
        },
      });

      expect(response.statusCode).toBe(409);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error).toContain('already submitted');
    });

    it('should reject application without authentication', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/applications',
        payload: {
          propertyId: rentalPropertyId,
          fullName: 'John Doe',
          email: 'john@example.com',
          phone: '5551234567',
          employer: 'Tech Corp',
          jobTitle: 'Software Engineer',
          monthlyIncome: 50000,
          employmentDuration: '2 years',
          desiredMoveInDate: new Date('2026-03-01').toISOString(),
          desiredLeaseTerm: 12,
          numberOfOccupants: 2,
          reference1Name: 'Jane Smith',
          reference1Phone: '5559876543',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should validate required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/applications',
        headers: { authorization: `Bearer ${tenantToken}` },
        payload: {
          propertyId: rentalPropertyId,
          // Missing required fields
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(false);
      expect(body.error).toBe('Validation error');
    });
  });

  describe('GET /applications - View own applications', () => {
    it('should return tenant\'s applications', async () => {
      // Create an application first
      await app.inject({
        method: 'POST',
        url: '/applications',
        headers: { authorization: `Bearer ${tenantToken}` },
        payload: {
          propertyId: rentalPropertyId,
          fullName: 'John Doe',
          email: 'john@example.com',
          phone: '5551234567',
          employer: 'Tech Corp',
          jobTitle: 'Software Engineer',
          monthlyIncome: 50000,
          employmentDuration: '2 years',
          desiredMoveInDate: new Date('2026-03-01').toISOString(),
          desiredLeaseTerm: 12,
          numberOfOccupants: 2,
          reference1Name: 'Jane Smith',
          reference1Phone: '5559876543',
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/applications',
        headers: { authorization: `Bearer ${tenantToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data[0].applicantId).toBe(tenantId);
      expect(body.data[0].property).toBeDefined();
      expect(body.data[0].property.title).toBe('Test Rental Property');
    });

    it('should filter applications by status', async () => {
      // Create an application
      const createResponse = await app.inject({
        method: 'POST',
        url: '/applications',
        headers: { authorization: `Bearer ${tenantToken}` },
        payload: {
          propertyId: rentalPropertyId,
          fullName: 'John Doe',
          email: 'john@example.com',
          phone: '5551234567',
          employer: 'Tech Corp',
          jobTitle: 'Software Engineer',
          monthlyIncome: 50000,
          employmentDuration: '2 years',
          desiredMoveInDate: new Date('2026-03-01').toISOString(),
          desiredLeaseTerm: 12,
          numberOfOccupants: 2,
          reference1Name: 'Jane Smith',
          reference1Phone: '5559876543',
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/applications?status=pending',
        headers: { authorization: `Bearer ${tenantToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.every((app: any) => app.status === 'pending')).toBe(true);
    });

    it('should return empty array when no applications', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/applications',
        headers: { authorization: `Bearer ${tenantToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data).toEqual([]);
    });
  });

  describe('GET /applications/property/:propertyId - Landlord views applications', () => {
    it('should return applications for landlord\'s property', async () => {
      // Tenant submits application
      await app.inject({
        method: 'POST',
        url: '/applications',
        headers: { authorization: `Bearer ${tenantToken}` },
        payload: {
          propertyId: rentalPropertyId,
          fullName: 'John Doe',
          email: 'john@example.com',
          phone: '5551234567',
          employer: 'Tech Corp',
          jobTitle: 'Software Engineer',
          monthlyIncome: 50000,
          employmentDuration: '2 years',
          desiredMoveInDate: new Date('2026-03-01').toISOString(),
          desiredLeaseTerm: 12,
          numberOfOccupants: 2,
          reference1Name: 'Jane Smith',
          reference1Phone: '5559876543',
        },
      });

      // Landlord views applications
      const response = await app.inject({
        method: 'GET',
        url: `/applications/property/${rentalPropertyId}`,
        headers: { authorization: `Bearer ${landlordToken}` },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data[0].propertyId).toBe(rentalPropertyId);
    });

    it('should reject non-landlord viewing applications', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/applications/property/${rentalPropertyId}`,
        headers: { authorization: `Bearer ${tenantToken}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should reject landlord viewing applications for property they don\'t own', async () => {
      // Create another landlord with unique email
      const uniqueEmail = `other-landlord-${Date.now()}@test.com`;
      const otherLandlordRegister = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          name: 'Other Landlord',
          email: uniqueEmail,
          password: 'TestPassword123!',
          roles: ['seller'],
        },
      });

      const registerBody = JSON.parse(otherLandlordRegister.body);
      if (!registerBody.user) {
        throw new Error(`Registration failed: ${JSON.stringify(registerBody)}`);
      }
      const otherLandlordId = registerBody.user.id;

      // Add landlord role
      const landlordRole = await app.prisma.role.findUnique({
        where: { name: 'landlord' },
      });
      await app.prisma.userRole.create({
        data: {
          userId: otherLandlordId,
          roleId: landlordRole!.id,
          status: 'approved',
        },
      });

      const otherLandlordLogin = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: uniqueEmail,
          password: 'TestPassword123!',
        },
      });
      const otherLandlordToken = JSON.parse(otherLandlordLogin.body).token;

      const response = await app.inject({
        method: 'GET',
        url: `/applications/property/${rentalPropertyId}`,
        headers: { authorization: `Bearer ${otherLandlordToken}` },
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('your own properties');

      // Cleanup
      await app.prisma.user.delete({
        where: { id: otherLandlordId },
      });
    });
  });

  describe('PATCH /applications/:id - Update application status', () => {
    it('should allow landlord to approve application', async () => {
      // Create application
      const createResponse = await app.inject({
        method: 'POST',
        url: '/applications',
        headers: { authorization: `Bearer ${tenantToken}` },
        payload: {
          propertyId: rentalPropertyId,
          fullName: 'John Doe',
          email: 'john@example.com',
          phone: '5551234567',
          employer: 'Tech Corp',
          jobTitle: 'Software Engineer',
          monthlyIncome: 50000,
          employmentDuration: '2 years',
          desiredMoveInDate: new Date('2026-03-01').toISOString(),
          desiredLeaseTerm: 12,
          numberOfOccupants: 2,
          reference1Name: 'Jane Smith',
          reference1Phone: '5559876543',
        },
      });
      const applicationId = JSON.parse(createResponse.body).data.id;

      // Approve application
      const response = await app.inject({
        method: 'PATCH',
        url: `/applications/${applicationId}`,
        headers: { authorization: `Bearer ${landlordToken}` },
        payload: {
          status: 'approved',
          landlordNote: 'Great application!',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('approved');
      expect(body.data.landlordNote).toBe('Great application!');

      // Verify property status changed to rented
      const property = await app.prisma.property.findUnique({
        where: { id: rentalPropertyId },
      });
      expect(property?.status).toBe('rented');
    });

    it('should auto-reject other applications when one is approved', async () => {
      // Reset property status to available
      await app.prisma.property.update({
        where: { id: rentalPropertyId },
        data: { status: 'available' },
      });

      // Create first application from tenant
      const app1Response = await app.inject({
        method: 'POST',
        url: '/applications',
        headers: { authorization: `Bearer ${tenantToken}` },
        payload: {
          propertyId: rentalPropertyId,
          fullName: 'John Doe',
          email: 'john@example.com',
          phone: '5551234567',
          employer: 'Tech Corp',
          jobTitle: 'Software Engineer',
          monthlyIncome: 50000,
          employmentDuration: '2 years',
          desiredMoveInDate: new Date('2026-03-01').toISOString(),
          desiredLeaseTerm: 12,
          numberOfOccupants: 2,
          reference1Name: 'Jane Smith',
          reference1Phone: '5559876543',
        },
      });
      const app1Body = JSON.parse(app1Response.body);
      if (!app1Body.data) {
        throw new Error(`Application creation failed: ${JSON.stringify(app1Body)}`);
      }
      const app1Id = app1Body.data.id;

      // Create second tenant and application
      const uniqueTenant2Email = `tenant2-${Date.now()}@test.com`;
      const tenant2Register = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          name: 'Test Tenant 2',
          email: uniqueTenant2Email,
          password: 'TestPassword123!',
          roles: ['buyer'],
        },
      });
      const registerBody = JSON.parse(tenant2Register.body);
      if (!registerBody.user) {
        throw new Error(`Tenant 2 registration failed: ${JSON.stringify(registerBody)}`);
      }
      const tenant2Id = registerBody.user.id;

      const tenant2Login = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: uniqueTenant2Email,
          password: 'TestPassword123!',
        },
      });
      const tenant2Token = JSON.parse(tenant2Login.body).token;

      const app2Response = await app.inject({
        method: 'POST',
        url: '/applications',
        headers: { authorization: `Bearer ${tenant2Token}` },
        payload: {
          propertyId: rentalPropertyId,
          fullName: 'Jane Smith',
          email: 'jane@example.com',
          phone: '5559876543',
          employer: 'Design Co',
          jobTitle: 'Designer',
          monthlyIncome: 45000,
          employmentDuration: '3 years',
          desiredMoveInDate: new Date('2026-03-01').toISOString(),
          desiredLeaseTerm: 12,
          numberOfOccupants: 1,
          reference1Name: 'Bob Johnson',
          reference1Phone: '5551112222',
        },
      });
      const app2Id = JSON.parse(app2Response.body).data.id;

      // Approve first application
      await app.inject({
        method: 'PATCH',
        url: `/applications/${app1Id}`,
        headers: { authorization: `Bearer ${landlordToken}` },
        payload: {
          status: 'approved',
        },
      });

      // Check second application was auto-rejected
      const app2 = await app.prisma.rentalApplication.findUnique({
        where: { id: app2Id },
      });
      expect(app2?.status).toBe('rejected');
      expect(app2?.landlordNote).toContain('Another application was approved');

      // Cleanup
      await app.prisma.user.delete({ where: { id: tenant2Id } });
    });

    it('should reject non-landlord updating application', async () => {
      // Reset property status to available
      await app.prisma.property.update({
        where: { id: rentalPropertyId },
        data: { status: 'available' },
      });

      // Create application
      const createResponse = await app.inject({
        method: 'POST',
        url: '/applications',
        headers: { authorization: `Bearer ${tenantToken}` },
        payload: {
          propertyId: rentalPropertyId,
          fullName: 'John Doe',
          email: 'john@example.com',
          phone: '5551234567',
          employer: 'Tech Corp',
          jobTitle: 'Software Engineer',
          monthlyIncome: 50000,
          employmentDuration: '2 years',
          desiredMoveInDate: new Date('2026-03-01').toISOString(),
          desiredLeaseTerm: 12,
          numberOfOccupants: 2,
          reference1Name: 'Jane Smith',
          reference1Phone: '5559876543',
        },
      });
      const createBody = JSON.parse(createResponse.body);
      if (!createBody.data) {
        throw new Error(`Application creation failed: ${JSON.stringify(createBody)}`);
      }
      const applicationId = createBody.data.id;

      // Try to update as tenant
      const response = await app.inject({
        method: 'PATCH',
        url: `/applications/${applicationId}`,
        headers: { authorization: `Bearer ${tenantToken}` },
        payload: {
          status: 'approved',
        },
      });

      expect(response.statusCode).toBe(403);
    });
  });
});

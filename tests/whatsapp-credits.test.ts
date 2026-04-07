import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { FastifyInstance } from 'fastify';

describe('WhatsApp Credit-Based Access', () => {
  let app: FastifyInstance;

  let landlordToken: string;
  let landlordId: string;
  let tenantToken: string;
  let tenantId: string;
  let propertyId: string;
  let applicationId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // Register landlord
    const landlordReg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        name: 'WA Test Landlord',
        email: `wa-landlord-${Date.now()}@test.com`,
        password: 'TestPassword123!',
        roles: ['seller'],
      },
    });
    const landlordData = JSON.parse(landlordReg.body);
    landlordId = landlordData.user.id;

    const landlordRole = await app.prisma.role.findUnique({ where: { name: 'landlord' } });
    await app.prisma.userRole.create({
      data: { userId: landlordId, roleId: landlordRole!.id, status: 'approved' },
    });

    const landlordLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: JSON.parse(landlordReg.body).user.email,
        password: 'TestPassword123!',
      },
    });
    landlordToken = JSON.parse(landlordLogin.body).token;

    // Register tenant
    const tenantReg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        name: 'WA Test Tenant',
        email: `wa-tenant-${Date.now()}@test.com`,
        password: 'TestPassword123!',
        roles: ['buyer'],
      },
    });
    const tenantData = JSON.parse(tenantReg.body);
    tenantId = tenantData.user.id;

    const buyerRole = await app.prisma.role.findUnique({ where: { name: 'buyer' } });
    await app.prisma.userRole.updateMany({
      where: { userId: tenantId, roleId: buyerRole!.id },
      data: { status: 'approved' },
    });

    const tenantLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: JSON.parse(tenantReg.body).user.email,
        password: 'TestPassword123!',
      },
    });
    tenantToken = JSON.parse(tenantLogin.body).token;

    // Create rental property
    const property = await app.prisma.property.create({
      data: {
        title: 'WA Test Property',
        listingType: 'for_rent',
        monthlyRent: 15000,
        estado: 'Jalisco',
        sellerId: landlordId,
      },
    });
    propertyId = property.id;

    // Create a rental application from the tenant
    const appRes = await app.inject({
      method: 'POST',
      url: '/applications',
      headers: { authorization: `Bearer ${tenantToken}` },
      payload: {
        propertyId,
        fullName: 'WA Tenant',
        email: 'wa-tenant@example.com',
        phone: '5551112233',
        employer: 'ACME Corp',
        jobTitle: 'Engineer',
        monthlyIncome: 40000,
        employmentDuration: '1 year',
        desiredMoveInDate: new Date('2026-05-01').toISOString(),
        desiredLeaseTerm: 12,
        numberOfOccupants: 1,
        reference1Name: 'Ref One',
        reference1Phone: '5559998877',
      },
    });
    applicationId = JSON.parse(appRes.body).data.id;
  });

  afterAll(async () => {
    await app.prisma.whatsAppUnlock.deleteMany({ where: { landlordId } });
    await app.prisma.creditTransaction.deleteMany({ where: { userId: landlordId } });
    await app.prisma.creditBalance.deleteMany({ where: { userId: landlordId } });
    await app.prisma.rentalApplication.deleteMany({ where: { propertyId } });
    await app.prisma.property.deleteMany({ where: { id: propertyId } });
    await app.prisma.user.deleteMany({ where: { id: { in: [landlordId, tenantId] } } });
    await app.close();
  });

  // ---------------------------------------------------------------------------
  // Credits balance
  // ---------------------------------------------------------------------------

  describe('GET /credits/balance', () => {
    it('should return 0 balance for a new landlord', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/credits/balance',
        headers: { authorization: `Bearer ${landlordToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data.balance).toBe(0);
      expect(body.data.packages).toBeDefined();
    });

    it('should require landlord role', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/credits/balance',
        headers: { authorization: `Bearer ${tenantToken}` },
      });

      expect(res.statusCode).toBe(403);
    });

    it('should require authentication', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/credits/balance',
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // ---------------------------------------------------------------------------
  // Credit packages
  // ---------------------------------------------------------------------------

  describe('GET /credits/packages', () => {
    it('should return available packages for any authenticated user', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/credits/packages',
        headers: { authorization: `Bearer ${tenantToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data.basic).toBeDefined();
      expect(body.data.standard).toBeDefined();
      expect(body.data.premium).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Purchase credits
  // ---------------------------------------------------------------------------

  describe('POST /credits/purchase/confirm', () => {
    it('should add credits for valid package', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/credits/purchase/confirm',
        headers: { authorization: `Bearer ${landlordToken}` },
        payload: { packageType: 'basic' },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data.creditsAdded).toBe(5);
      expect(body.data.newBalance).toBe(5);
    });

    it('should reject invalid package type', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/credits/purchase/confirm',
        headers: { authorization: `Bearer ${landlordToken}` },
        payload: { packageType: 'invalid' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('should require landlord role', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/credits/purchase/confirm',
        headers: { authorization: `Bearer ${tenantToken}` },
        payload: { packageType: 'basic' },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // Phone number masking in application list
  // ---------------------------------------------------------------------------

  describe('GET /applications/property/:propertyId - phone masking', () => {
    it('should mask phone numbers when landlord has no unlocks', async () => {
      // Reset credits to 0 first to test masked state
      await app.prisma.creditBalance.deleteMany({ where: { userId: landlordId } });
      await app.prisma.whatsAppUnlock.deleteMany({ where: { landlordId } });

      const res = await app.inject({
        method: 'GET',
        url: `/applications/property/${propertyId}`,
        headers: { authorization: `Bearer ${landlordToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data.length).toBeGreaterThan(0);

      const application = body.data[0];
      expect(application.phone).toBe('***-***-****');
      expect(application.whatsAppUnlocked).toBe(false);
    });

    it('should show real phone number after WhatsApp unlock', async () => {
      // Give landlord 1 credit
      await app.prisma.creditBalance.upsert({
        where: { userId: landlordId },
        update: { balance: 1 },
        create: { userId: landlordId, balance: 1 },
      });

      // Unlock WhatsApp for this application
      const unlockRes = await app.inject({
        method: 'POST',
        url: `/applications/${applicationId}/whatsapp`,
        headers: { authorization: `Bearer ${landlordToken}` },
      });
      expect(unlockRes.statusCode).toBe(200);

      // Now fetch applications — phone should be visible
      const res = await app.inject({
        method: 'GET',
        url: `/applications/property/${propertyId}`,
        headers: { authorization: `Bearer ${landlordToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      const application = body.data.find((a: any) => a.id === applicationId);
      expect(application).toBeDefined();
      expect(application.phone).toBe('5551112233');
      expect(application.whatsAppUnlocked).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // WhatsApp unlock endpoint
  // ---------------------------------------------------------------------------

  describe('POST /applications/:id/whatsapp', () => {
    it('should return 402 when landlord has no credits', async () => {
      // Ensure balance is 0 and no prior unlock
      await app.prisma.creditBalance.deleteMany({ where: { userId: landlordId } });
      await app.prisma.whatsAppUnlock.deleteMany({ where: { landlordId } });

      const res = await app.inject({
        method: 'POST',
        url: `/applications/${applicationId}/whatsapp`,
        headers: { authorization: `Bearer ${landlordToken}` },
      });

      expect(res.statusCode).toBe(402);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(false);
      expect(body.error).toContain('credits');
    });

    it('should return WhatsApp link and deduct 1 credit', async () => {
      // Give landlord 3 credits
      await app.prisma.creditBalance.upsert({
        where: { userId: landlordId },
        update: { balance: 3 },
        create: { userId: landlordId, balance: 3 },
      });
      await app.prisma.whatsAppUnlock.deleteMany({ where: { landlordId } });

      const res = await app.inject({
        method: 'POST',
        url: `/applications/${applicationId}/whatsapp`,
        headers: { authorization: `Bearer ${landlordToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data.phone).toBe('5551112233');
      expect(body.data.whatsAppUrl).toContain('wa.me');
      expect(body.data.creditsUsed).toBe(1);
      expect(body.data.remainingBalance).toBe(2);
    });

    it('should not deduct credits on repeated unlock of same application', async () => {
      // Already has unlock from previous test; balance should be 2
      const res = await app.inject({
        method: 'POST',
        url: `/applications/${applicationId}/whatsapp`,
        headers: { authorization: `Bearer ${landlordToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.creditsUsed).toBe(0);
      expect(body.data.remainingBalance).toBe(2);
    });

    it('should return 403 when landlord does not own property', async () => {
      // Create another landlord
      const otherReg = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          name: 'Other WA Landlord',
          email: `other-wa-${Date.now()}@test.com`,
          password: 'TestPassword123!',
          roles: ['seller'],
        },
      });
      const otherId = JSON.parse(otherReg.body).user.id;
      const landlordRole = await app.prisma.role.findUnique({ where: { name: 'landlord' } });
      await app.prisma.userRole.create({
        data: { userId: otherId, roleId: landlordRole!.id, status: 'approved' },
      });
      const otherLogin = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: JSON.parse(otherReg.body).user.email,
          password: 'TestPassword123!',
        },
      });
      const otherToken = JSON.parse(otherLogin.body).token;

      const res = await app.inject({
        method: 'POST',
        url: `/applications/${applicationId}/whatsapp`,
        headers: { authorization: `Bearer ${otherToken}` },
      });

      expect(res.statusCode).toBe(403);

      // Cleanup
      await app.prisma.user.delete({ where: { id: otherId } });
    });

    it('should return 404 for non-existent application', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/applications/00000000-0000-0000-0000-000000000000/whatsapp',
        headers: { authorization: `Bearer ${landlordToken}` },
      });

      expect(res.statusCode).toBe(404);
    });

    it('should require landlord role', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/applications/${applicationId}/whatsapp`,
        headers: { authorization: `Bearer ${tenantToken}` },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // ---------------------------------------------------------------------------
  // Credit transactions
  // ---------------------------------------------------------------------------

  describe('GET /credits/transactions', () => {
    it('should return transaction history for landlord', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/credits/transactions',
        headers: { authorization: `Bearer ${landlordToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('should require landlord role', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/credits/transactions',
        headers: { authorization: `Bearer ${tenantToken}` },
      });

      expect(res.statusCode).toBe(403);
    });
  });
});

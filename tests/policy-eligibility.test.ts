import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { AuthService } from '../src/services/auth.service.js';
import { loginAndGetToken } from './utils/authHelpers.js';

describe('Policy: role auto-approval and eligibility gates', () => {
  let app: FastifyInstance;
  const userIds: string[] = [];
  const propertyIds: string[] = [];

  const createVerifiedIne = async (userId: string) => {
    await app.prisma.userDocument.create({
      data: {
        userId,
        documentType: 'official_id',
        fileUrl: `local/user-docs/${userId}/official_id/ine.pdf`,
        fileName: 'ine.pdf',
        fileMimeType: 'application/pdf',
        isVerified: true,
        verifiedAt: new Date(),
      },
    });
  };

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    if (propertyIds.length) {
      await app.prisma.property.deleteMany({ where: { id: { in: propertyIds } } });
    }
    if (userIds.length) {
      await app.prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await app.close();
  });

  it('auto-approves non-admin roles on registration', async () => {
    const suffix = Date.now();
    const email = `policy-seller-${suffix}@test.com`;
    const password = 'TestPassword123!';

    const registerRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        name: 'Policy Seller',
        email,
        password,
        roles: ['seller'],
      },
    });

    expect(registerRes.statusCode).toBe(201);
    const body = registerRes.json();
    userIds.push(body.user.id);

    const sellerRole = body.user.roles.find((r: any) => r.roleName === 'seller');
    expect(sellerRole?.status).toBe('approved');
  });

  it('keeps admin role pending by default', async () => {
    const suffix = Date.now() + 1;
    const email = `policy-admin-${suffix}@test.com`;
    const password = 'TestPassword123!';

    const authService = new AuthService(app.prisma as any);
    const user = await authService.register({
      name: 'Policy Admin',
      email,
      password,
      roles: ['admin'] as any,
    } as any);

    userIds.push(user.id);
    const adminRole = user.roles.find((r: any) => r.roleName === 'admin');
    expect(adminRole?.status).toBe('pending');
  });

  it('blocks offer submission when email is not verified', async () => {
    const suffix = Date.now() + 2;
    const password = 'TestPassword123!';

    const sellerEmail = `policy-offer-seller-${suffix}@test.com`;
    const buyerEmail = `policy-offer-buyer-${suffix}@test.com`;

    const sellerRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Offer Seller', email: sellerEmail, password, roles: ['seller'] },
    });
    expect(sellerRes.statusCode).toBe(201);
    const sellerId = sellerRes.json().user.id;
    userIds.push(sellerId);

    const buyerRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Offer Buyer', email: buyerEmail, password, roles: ['buyer'] },
    });
    expect(buyerRes.statusCode).toBe(201);
    const buyerId = buyerRes.json().user.id;
    userIds.push(buyerId);

    // Make seller eligible so property can be published/available.
    await app.prisma.user.update({ where: { id: sellerId }, data: { emailVerified: true } });
    await createVerifiedIne(sellerId);

    const sellerToken = await loginAndGetToken(app, sellerEmail, password);
    const buyerToken = await loginAndGetToken(app, buyerEmail, password);

    const propertyRes = await app.inject({
      method: 'POST',
      url: '/properties',
      headers: { authorization: `Bearer ${sellerToken}` },
      payload: {
        title: `Policy Offer Property ${suffix}`,
        estado: 'Puebla',
        ciudad: 'Puebla',
        colonia: 'Centro',
        listingType: 'for_sale',
        price: 2500000,
        status: 'available',
      },
    });
    expect(propertyRes.statusCode).toBe(201);
    const propertyId = propertyRes.json().data.id;
    propertyIds.push(propertyId);

    const offerRes = await app.inject({
      method: 'POST',
      url: `/properties/${propertyId}/offers`,
      headers: { authorization: `Bearer ${buyerToken}` },
      payload: {
        offerAmount: 2300000,
        financing: 'cash',
        buyerName: 'Offer Buyer',
        buyerEmail,
        buyerPhone: '5512345678',
      },
    });

    expect(offerRes.statusCode).toBe(403);
    expect(offerRes.json().code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('blocks offer submission when INE is missing', async () => {
    const suffix = Date.now() + 3;
    const password = 'TestPassword123!';

    const sellerEmail = `policy-offer2-seller-${suffix}@test.com`;
    const buyerEmail = `policy-offer2-buyer-${suffix}@test.com`;

    const sellerRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Offer2 Seller', email: sellerEmail, password, roles: ['seller'] },
    });
    expect(sellerRes.statusCode).toBe(201);
    const sellerId = sellerRes.json().user.id;
    userIds.push(sellerId);

    const buyerRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Offer2 Buyer', email: buyerEmail, password, roles: ['buyer'] },
    });
    expect(buyerRes.statusCode).toBe(201);
    const buyerId = buyerRes.json().user.id;
    userIds.push(buyerId);

    await app.prisma.user.update({ where: { id: sellerId }, data: { emailVerified: true } });
    await createVerifiedIne(sellerId);

    // Buyer email verified but no INE uploaded.
    await app.prisma.user.update({ where: { id: buyerId }, data: { emailVerified: true } });

    const sellerToken = await loginAndGetToken(app, sellerEmail, password);
    const buyerToken = await loginAndGetToken(app, buyerEmail, password);

    const propertyRes = await app.inject({
      method: 'POST',
      url: '/properties',
      headers: { authorization: `Bearer ${sellerToken}` },
      payload: {
        title: `Policy Offer2 Property ${suffix}`,
        estado: 'Jalisco',
        ciudad: 'Guadalajara',
        colonia: 'Centro',
        listingType: 'for_sale',
        price: 2600000,
        status: 'available',
      },
    });
    expect(propertyRes.statusCode).toBe(201);
    const propertyId = propertyRes.json().data.id;
    propertyIds.push(propertyId);

    const offerRes = await app.inject({
      method: 'POST',
      url: `/properties/${propertyId}/offers`,
      headers: { authorization: `Bearer ${buyerToken}` },
      payload: {
        offerAmount: 2400000,
        financing: 'cash',
        buyerName: 'Offer2 Buyer',
        buyerEmail,
        buyerPhone: '5512345678',
      },
    });

    expect(offerRes.statusCode).toBe(403);
    expect(offerRes.json().code).toBe('INE_NOT_VERIFIED');
  });

  it('allows property draft creation but blocks publish until email+INE are verified', async () => {
    const suffix = Date.now() + 4;
    const sellerEmail = `policy-publish-${suffix}@test.com`;
    const password = 'TestPassword123!';

    const sellerRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Publish Seller', email: sellerEmail, password, roles: ['seller'] },
    });
    expect(sellerRes.statusCode).toBe(201);
    const sellerId = sellerRes.json().user.id;
    userIds.push(sellerId);

    const sellerToken = await loginAndGetToken(app, sellerEmail, password);

    const createRes = await app.inject({
      method: 'POST',
      url: '/properties',
      headers: { authorization: `Bearer ${sellerToken}` },
      payload: {
        title: `Policy Publish Property ${suffix}`,
        estado: 'Nuevo León',
        ciudad: 'Monterrey',
        colonia: 'Centro',
        listingType: 'for_sale',
        price: 3000000,
        status: 'available',
      },
    });

    expect(createRes.statusCode).toBe(201);
    expect(createRes.json().data.status).toBe('pending');
    expect(createRes.json().publishEligibility.canPublish).toBe(false);

    const propertyId = createRes.json().data.id;
    propertyIds.push(propertyId);

    const publishBlocked = await app.inject({
      method: 'POST',
      url: `/properties/${propertyId}/publish`,
      headers: { authorization: `Bearer ${sellerToken}` },
    });

    expect(publishBlocked.statusCode).toBe(403);
    expect(['EMAIL_NOT_VERIFIED', 'INE_NOT_VERIFIED']).toContain(publishBlocked.json().code);

    await app.prisma.user.update({ where: { id: sellerId }, data: { emailVerified: true } });
    await createVerifiedIne(sellerId);

    const publishOk = await app.inject({
      method: 'POST',
      url: `/properties/${propertyId}/publish`,
      headers: { authorization: `Bearer ${sellerToken}` },
    });

    expect(publishOk.statusCode).toBe(200);
    expect(publishOk.json().data.status).toBe('available');
  });
});

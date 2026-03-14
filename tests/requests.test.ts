import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { FastifyInstance } from 'fastify';

describe('Requests API', () => {
  let app: FastifyInstance;
  let buyerToken: string;
  let buyerId: string;
  let otherBuyerToken: string;
  let otherBuyerId: string;
  let propertyAId: string;
  let propertyBId: string;

  const suffix = Date.now();
  const buyerEmail = `requests-buyer-${suffix}@test.com`;
  const otherBuyerEmail = `requests-buyer2-${suffix}@test.com`;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const buyerRegister = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        name: 'Requests Buyer',
        email: buyerEmail,
        password: 'TestPassword123!',
      },
    });

    expect(buyerRegister.statusCode).toBe(201);
    buyerId = JSON.parse(buyerRegister.body).user.id;

    const buyerLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: buyerEmail,
        password: 'TestPassword123!',
      },
    });

    expect(buyerLogin.statusCode).toBe(200);
    buyerToken = JSON.parse(buyerLogin.body).token;

    const otherBuyerRegister = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        name: 'Requests Buyer 2',
        email: otherBuyerEmail,
        password: 'TestPassword123!',
      },
    });

    expect(otherBuyerRegister.statusCode).toBe(201);
    otherBuyerId = JSON.parse(otherBuyerRegister.body).user.id;

    const otherBuyerLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: otherBuyerEmail,
        password: 'TestPassword123!',
      },
    });

    expect(otherBuyerLogin.statusCode).toBe(200);
    otherBuyerToken = JSON.parse(otherBuyerLogin.body).token;

    const propertyA = await app.prisma.property.create({
      data: {
        title: 'Requests Test Property A',
        listingType: 'for_sale',
        price: 1500000,
        estado: 'Jalisco',
        sellerId: buyerId,
      },
    });

    const propertyB = await app.prisma.property.create({
      data: {
        title: 'Requests Test Property B',
        listingType: 'for_rent',
        monthlyRent: 18000,
        estado: 'Jalisco',
        sellerId: buyerId,
      },
    });

    propertyAId = propertyA.id;
    propertyBId = propertyB.id;
  });

  afterAll(async () => {
    await app.prisma.propertyRequest.deleteMany({
      where: {
        buyerId: { in: [buyerId, otherBuyerId] },
      },
    });

    await app.prisma.property.deleteMany({
      where: {
        id: { in: [propertyAId, propertyBId] },
      },
    });

    await app.prisma.user.deleteMany({
      where: {
        email: { in: [buyerEmail, otherBuyerEmail] },
      },
    });

    await app.close();
  });

  it('rejects unauthenticated GET /requests', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/requests',
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
  });

  it('rejects unauthenticated POST /requests', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/requests',
      payload: {
        propertyId: propertyAId,
        name: 'No Auth User',
        phone: '5551112233',
      },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
  });

  it('returns 404 when posting request for non-existent property', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/requests',
      headers: { authorization: `Bearer ${buyerToken}` },
      payload: {
        propertyId: '00000000-0000-0000-0000-000000000000',
        name: 'Test User',
        phone: '5559998888',
      },
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Property not found');
  });

  it('creates a request for an authenticated user', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/requests',
      headers: { authorization: `Bearer ${buyerToken}` },
      payload: {
        propertyId: propertyAId,
        name: 'Buyer Name',
        phone: '5551234567',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(body.data.propertyId).toBe(propertyAId);
    expect(body.data.buyerId).toBe(buyerId);
    expect(body.data.status).toBe('pending');
    expect(body.message).toBe('Request submitted successfully');
  });

  it('rejects duplicate request for same property and buyer', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/requests',
      headers: { authorization: `Bearer ${buyerToken}` },
      payload: {
        propertyId: propertyAId,
        name: 'Buyer Name Again',
        phone: '5551234567',
      },
    });

    expect(response.statusCode).toBe(409);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(false);
    expect(body.error).toContain('already requested information');
  });

  it('returns only authenticated buyer requests from GET /requests', async () => {
    const otherBuyerCreate = await app.inject({
      method: 'POST',
      url: '/requests',
      headers: { authorization: `Bearer ${otherBuyerToken}` },
      payload: {
        propertyId: propertyBId,
        name: 'Other Buyer',
        phone: '5550001111',
      },
    });
    expect(otherBuyerCreate.statusCode).toBe(201);

    const response = await app.inject({
      method: 'GET',
      url: '/requests',
      headers: { authorization: `Bearer ${buyerToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(1);
    expect(body.data[0].buyerId).toBe(buyerId);
    expect(body.data[0].property.id).toBe(propertyAId);
  });
});

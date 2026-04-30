import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { approveUserRole, loginAndGetToken } from './utils/authHelpers.js';

describe('Property offer negotiation tree', () => {
  let app: FastifyInstance;
  let sellerId: string;
  let buyerId: string;
  let outsiderId: string;
  let sellerToken: string;
  let buyerToken: string;
  let outsiderToken: string;
  let propertyId: string;
  let offerId: string;

  const suffix = Date.now();

  const ensureEligible = async (userId: string) => {
    await app.prisma.user.update({
      where: { id: userId },
      data: { emailVerified: true },
    });

    await app.prisma.userDocument.create({
      data: {
        userId,
        documentType: 'official_id',
        fileUrl: `local/user-docs/${userId}/official_id/test.pdf`,
        fileName: 'ine-test.pdf',
        fileMimeType: 'application/pdf',
        isVerified: true,
        verifiedAt: new Date(),
      },
    });
  };

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const password = 'TestPassword123!';
    const sellerEmail = `neg-seller-${suffix}@test.com`;
    const buyerEmail = `neg-buyer-${suffix}@test.com`;
    const outsiderEmail = `neg-outsider-${suffix}@test.com`;

    const sellerRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        name: 'Negotiation Seller',
        email: sellerEmail,
        password,
        roles: ['seller'],
      },
    });
    expect(sellerRes.statusCode).toBe(201);
    sellerId = sellerRes.json().user.id;
    await approveUserRole(app, sellerId, 'seller');

    const buyerRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        name: 'Negotiation Buyer',
        email: buyerEmail,
        password,
        roles: ['buyer'],
      },
    });
    expect(buyerRes.statusCode).toBe(201);
    buyerId = buyerRes.json().user.id;
    await approveUserRole(app, buyerId, 'buyer');

    const outsiderRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        name: 'Negotiation Outsider',
        email: outsiderEmail,
        password,
        roles: ['buyer'],
      },
    });
    expect(outsiderRes.statusCode).toBe(201);
    outsiderId = outsiderRes.json().user.id;
    await approveUserRole(app, outsiderId, 'buyer');

    sellerToken = await loginAndGetToken(app, sellerEmail, password);
    buyerToken = await loginAndGetToken(app, buyerEmail, password);
    outsiderToken = await loginAndGetToken(app, outsiderEmail, password);

    await ensureEligible(sellerId);
    await ensureEligible(buyerId);

    const propertyRes = await app.inject({
      method: 'POST',
      url: '/properties',
      headers: { authorization: `Bearer ${sellerToken}` },
      payload: {
        title: `Negotiation Tree Property ${suffix}`,
        estado: 'Puebla',
        ciudad: 'Puebla',
        colonia: 'Centro',
        listingType: 'for_sale',
        price: 2800000,
      },
    });

    expect(propertyRes.statusCode).toBe(201);
    propertyId = propertyRes.json().data.id;

    const offerRes = await app.inject({
      method: 'POST',
      url: `/properties/${propertyId}/offers`,
      headers: { authorization: `Bearer ${buyerToken}` },
      payload: {
        offerAmount: 2400000,
        financing: 'cash',
        message: 'Oferta inicial',
        buyerName: 'Negotiation Buyer',
        buyerEmail,
        buyerPhone: '5512345678',
      },
    });

    expect(offerRes.statusCode).toBe(201);
    offerId = offerRes.json().data.id;
  });

  afterAll(async () => {
    await app.prisma.property.deleteMany({ where: { id: propertyId } });
    await app.prisma.user.deleteMany({ where: { id: { in: [sellerId, buyerId, outsiderId] } } });
    await app.close();
  });

  it('blocks rejection before multiple counters', async () => {
    const rejectEarly = await app.inject({
      method: 'POST',
      url: `/offers/${offerId}/respond`,
      headers: { authorization: `Bearer ${sellerToken}` },
      payload: {
        action: 'reject',
        message: 'No acuerdo todavía',
      },
    });

    expect(rejectEarly.statusCode).toBe(400);
    expect(rejectEarly.json().error).toContain('Rejection is available only after multiple counter rounds');
  });

  it('supports 4 counter rounds and returns timeline/tree', async () => {
    const steps = [
      { actor: 'seller', token: sellerToken, amount: 2650000, message: 'Contra 1' },
      { actor: 'buyer', token: buyerToken, amount: 2480000, message: 'Contra 2' },
      { actor: 'seller', token: sellerToken, amount: 2580000, message: 'Contra 3' },
      { actor: 'buyer', token: buyerToken, amount: 2520000, message: 'Contra 4' },
    ];

    for (const step of steps) {
      const response = await app.inject({
        method: 'POST',
        url: `/offers/${offerId}/respond`,
        headers: { authorization: `Bearer ${step.token}` },
        payload: {
          action: 'counter',
          amount: step.amount,
          message: step.message,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.offer.status).toBe('countered');
      expect(response.json().data.timeline.length).toBeGreaterThanOrEqual(2);
    }

    const threadAsBuyer = await app.inject({
      method: 'GET',
      url: `/offers/${offerId}/thread?includeTree=true`,
      headers: { authorization: `Bearer ${buyerToken}` },
    });

    expect(threadAsBuyer.statusCode).toBe(200);
    expect(threadAsBuyer.json().data.timeline.length).toBe(5); // root offer + 4 counters
    expect(threadAsBuyer.json().data.counterCount).toBeUndefined();
    expect(threadAsBuyer.json().data.canReject).toBe(true);
    expect(Array.isArray(threadAsBuyer.json().data.tree)).toBe(true);
    expect(threadAsBuyer.json().data.tree.length).toBe(1);
  });

  it('rejects same-actor consecutive response attempts', async () => {
    const first = await app.inject({
      method: 'POST',
      url: `/offers/${offerId}/respond`,
      headers: { authorization: `Bearer ${sellerToken}` },
      payload: {
        action: 'counter',
        amount: 2550000,
        message: 'Turn seller',
      },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: `/offers/${offerId}/respond`,
      headers: { authorization: `Bearer ${sellerToken}` },
      payload: {
        action: 'counter',
        amount: 2540000,
        message: 'Seller twice',
      },
    });
    expect(second.statusCode).toBe(400);
    expect(second.json().error).toContain('Wait for the other party to respond');

    // Hand turn back to seller for next tests
    const buyerResponse = await app.inject({
      method: 'POST',
      url: `/offers/${offerId}/respond`,
      headers: { authorization: `Bearer ${buyerToken}` },
      payload: {
        action: 'counter',
        amount: 2530000,
        message: 'Turn buyer',
      },
    });
    expect(buyerResponse.statusCode).toBe(200);
  });

  it('enforces authorization on thread endpoint', async () => {
    const forbidden = await app.inject({
      method: 'GET',
      url: `/offers/${offerId}/thread?includeTree=true`,
      headers: { authorization: `Bearer ${outsiderToken}` },
    });

    expect(forbidden.statusCode).toBe(403);
  });

  it('allows terminal rejection after multiple counters and locks the negotiation', async () => {
    const reject = await app.inject({
      method: 'POST',
      url: `/offers/${offerId}/respond`,
      headers: { authorization: `Bearer ${sellerToken}` },
      payload: {
        action: 'reject',
        message: 'No logramos acuerdo final',
      },
    });

    expect(reject.statusCode).toBe(200);
    expect(reject.json().data.offer.status).toBe('rejected');
    expect(reject.json().data.isTerminal).toBe(true);

    const postTerminal = await app.inject({
      method: 'POST',
      url: `/offers/${offerId}/respond`,
      headers: { authorization: `Bearer ${buyerToken}` },
      payload: {
        action: 'counter',
        amount: 2510000,
        message: 'Try after terminal',
      },
    });

    expect(postTerminal.statusCode).toBe(400);
    expect(postTerminal.json().error).toContain('already closed');
  });

  it('buyer can propose a furnished status and seller sees it in the thread', async () => {
    const suffix2 = Date.now() + 1;
    const buyerEmail2 = `fs-buyer-${suffix2}@test.com`;
    const password = 'TestPassword123!';

    const buyerRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'FS Buyer', email: buyerEmail2, password, roles: ['buyer'] },
    });
    expect(buyerRes.statusCode).toBe(201);
    const buyer2Id = buyerRes.json().user.id;
    await approveUserRole(app, buyer2Id, 'buyer');
    await ensureEligible(buyer2Id);
    const buyer2Token = await loginAndGetToken(app, buyerEmail2, password);

    // Create fresh property
    const propRes = await app.inject({
      method: 'POST',
      url: '/properties',
      headers: { authorization: `Bearer ${sellerToken}` },
      payload: {
        title: `FS Property ${suffix2}`,
        estado: 'Jalisco',
        ciudad: 'Guadalajara',
        colonia: 'Zapopan',
        listingType: 'for_sale',
        price: 3000000,
      },
    });
    expect(propRes.statusCode).toBe(201);
    const propId = propRes.json().data.id;

    // Buyer submits offer proposing 'equipada'
    const offerRes = await app.inject({
      method: 'POST',
      url: `/properties/${propId}/offers`,
      headers: { authorization: `Bearer ${buyer2Token}` },
      payload: {
        offerAmount: 2700000,
        financing: 'cash',
        buyerName: 'FS Buyer',
        buyerEmail: buyerEmail2,
        buyerPhone: '5512345678',
        proposedFurnishedStatus: 'equipada',
        message: 'Me quedo con solo los electrodomésticos',
      },
    });
    expect(offerRes.statusCode).toBe(201);
    const fsOfferId = offerRes.json().data.id;

    // Seller reads the thread and sees proposedFurnishedStatus on the root event
    const threadRes = await app.inject({
      method: 'GET',
      url: `/offers/${fsOfferId}/thread`,
      headers: { authorization: `Bearer ${sellerToken}` },
    });
    expect(threadRes.statusCode).toBe(200);
    const thread = threadRes.json().data;
    const rootEvent = thread.timeline[0];
    expect(rootEvent.proposedFurnishedStatus).toBe('equipada');
  });

  it('seller accepts with a furnished status and agreedFurnishedStatus is stored on the offer', async () => {
    const suffix3 = Date.now() + 2;
    const buyerEmail3 = `fs2-buyer-${suffix3}@test.com`;
    const password = 'TestPassword123!';

    const buyerRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'FS2 Buyer', email: buyerEmail3, password, roles: ['buyer'] },
    });
    expect(buyerRes.statusCode).toBe(201);
    const buyer3Id = buyerRes.json().user.id;
    await approveUserRole(app, buyer3Id, 'buyer');
    await ensureEligible(buyer3Id);
    const buyer3Token = await loginAndGetToken(app, buyerEmail3, password);

    // Fresh property
    const propRes = await app.inject({
      method: 'POST',
      url: '/properties',
      headers: { authorization: `Bearer ${sellerToken}` },
      payload: {
        title: `FS2 Property ${suffix3}`,
        estado: 'Nuevo León',
        ciudad: 'Monterrey',
        colonia: 'San Pedro',
        listingType: 'for_sale',
        price: 4000000,
      },
    });
    expect(propRes.statusCode).toBe(201);
    const propId3 = propRes.json().data.id;

    // Buyer initial offer
    const offerRes = await app.inject({
      method: 'POST',
      url: `/properties/${propId3}/offers`,
      headers: { authorization: `Bearer ${buyer3Token}` },
      payload: {
        offerAmount: 3800000,
        financing: 'cash',
        buyerName: 'FS2 Buyer',
        buyerEmail: buyerEmail3,
        buyerPhone: '5512345678',
        proposedFurnishedStatus: 'sin_muebles',
      },
    });
    expect(offerRes.statusCode).toBe(201);
    const fsOffer3Id = offerRes.json().data.id;

    // Seller accepts with affirmed furnished status
    const acceptRes = await app.inject({
      method: 'POST',
      url: `/offers/${fsOffer3Id}/respond`,
      headers: { authorization: `Bearer ${sellerToken}` },
      payload: {
        action: 'accept',
        amount: 3800000,
        proposedFurnishedStatus: 'sin_muebles',
      },
    });
    expect(acceptRes.statusCode).toBe(200);
    const accepted = acceptRes.json().data;
    expect(accepted.offer.agreedFurnishedStatus).toBe('sin_muebles');
    expect(accepted.offer.status).toBe('accepted');
  });
});

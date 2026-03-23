import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { approveUserRole, loginAndGetToken } from './utils/authHelpers.js';

describe('Owned properties API', () => {
  let app: FastifyInstance;
  let landlordId: string;
  let otherOwnerId: string;
  let landlordToken: string;
  let ownedRentalId: string;
  let ownedSaleId: string;
  let otherRentalId: string;
  const suffix = Date.now();

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const password = 'TestPassword123!';
    const landlordEmail = `mine-landlord-${suffix}@test.com`;
    const otherEmail = `mine-other-${suffix}@test.com`;

    const landlordRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        name: 'Owned Property Landlord',
        email: landlordEmail,
        password,
        roles: ['landlord'],
      },
    });

    expect(landlordRes.statusCode).toBe(201);
    landlordId = landlordRes.json().user.id;
    await approveUserRole(app, landlordId, 'landlord');
    landlordToken = await loginAndGetToken(app, landlordEmail, password);

    const otherRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        name: 'Other Owner',
        email: otherEmail,
        password,
        roles: ['landlord'],
      },
    });

    expect(otherRes.statusCode).toBe(201);
  otherOwnerId = otherRes.json().user.id;
  await approveUserRole(app, otherOwnerId, 'landlord');
    const otherToken = await loginAndGetToken(app, otherEmail, password);

    const ownedRentalRes = await app.inject({
      method: 'POST',
      url: '/properties',
      headers: { authorization: `Bearer ${landlordToken}` },
      payload: {
        title: 'Owned Rental Property',
        estado: 'Ciudad de México',
        ciudad: 'Ciudad de México',
        colonia: 'Roma Norte',
        listingType: 'for_rent',
        monthlyRent: 18000,
      },
    });

    expect(ownedRentalRes.statusCode).toBe(201);
    ownedRentalId = ownedRentalRes.json().data.id;

    const ownedSaleRes = await app.inject({
      method: 'POST',
      url: '/properties',
      headers: { authorization: `Bearer ${landlordToken}` },
      payload: {
        title: 'Owned Sale Property',
        estado: 'Jalisco',
        ciudad: 'Guadalajara',
        listingType: 'for_sale',
        price: 2500000,
      },
    });

    expect(ownedSaleRes.statusCode).toBe(201);
    ownedSaleId = ownedSaleRes.json().data.id;

    const otherRentalRes = await app.inject({
      method: 'POST',
      url: '/properties',
      headers: { authorization: `Bearer ${otherToken}` },
      payload: {
        title: 'Other Owner Rental',
        estado: 'Nuevo León',
        ciudad: 'Monterrey',
        listingType: 'for_rent',
        monthlyRent: 21000,
      },
    });

    expect(otherRentalRes.statusCode).toBe(201);
    otherRentalId = otherRentalRes.json().data.id;
  });

  afterAll(async () => {
    await app.prisma.property.deleteMany({ where: { id: { in: [ownedRentalId, ownedSaleId, otherRentalId] } } });
    await app.prisma.user.deleteMany({ where: { id: { in: [landlordId, otherOwnerId] } } });
    await app.close();
  });

  it('returns only current user properties and supports listingType filter', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/properties/mine?listingType=for_rent',
      headers: {
        authorization: `Bearer ${landlordToken}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as any;
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(ownedRentalId);
    expect(body.data[0].listingType).toBe('for_rent');
    expect(body.data.some((property: any) => property.id === otherRentalId)).toBe(false);
  });
});
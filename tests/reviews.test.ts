import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { approveUserRole, loginAndGetToken } from './utils/authHelpers.js';

async function registerUser(app: FastifyInstance, payload: { name: string; email: string; password: string; roles: string[] }) {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload,
  });

  expect(response.statusCode).toBe(201);
  return response.json() as any;
}

describe('Reviews API', () => {
  let app: FastifyInstance;
  let landlordId: string;
  let tenantId: string;
  let landlordToken: string;
  let tenantToken: string;
  let propertyId: string;
  let applicationId: string;
  const suffix = Date.now();

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const landlordEmail = `landlord-review-${suffix}@test.com`;
    const tenantEmail = `tenant-review-${suffix}@test.com`;
    const password = 'TestPassword123!';

    const landlordRes = await registerUser(app, {
      name: 'Review Landlord',
      email: landlordEmail,
      password,
      roles: ['landlord'],
    });

    landlordId = landlordRes.user.id;
    await approveUserRole(app, landlordId, 'landlord');
    landlordToken = await loginAndGetToken(app, landlordEmail, password);

    const tenantRes = await registerUser(app, {
      name: 'Review Tenant',
      email: tenantEmail,
      password,
      roles: ['tenant'],
    });

    tenantId = tenantRes.user.id;
    tenantToken = await loginAndGetToken(app, tenantEmail, password);

    const propertyResponse = await app.inject({
      method: 'POST',
      url: '/properties',
      headers: {
        authorization: `Bearer ${landlordToken}`,
      },
      payload: {
        title: 'Review-Eligible Rental',
        description: 'Rental used for reviews',
        estado: 'Ciudad de México',
        ciudad: 'Ciudad de México',
        colonia: 'Roma Norte',
        listingType: 'for_rent',
        monthlyRent: 22000,
        securityDeposit: 22000,
        leaseTermMonths: 12,
      },
    });

    expect(propertyResponse.statusCode).toBe(201);
    propertyId = propertyResponse.json().data.id;

    const applicationResponse = await app.inject({
      method: 'POST',
      url: '/applications',
      headers: {
        authorization: `Bearer ${tenantToken}`,
      },
      payload: {
        propertyId,
        fullName: 'Review Tenant',
        email: tenantEmail,
        phone: '5551234567',
        employer: 'Casa MX',
        jobTitle: 'Analyst',
        monthlyIncome: 60000,
        employmentDuration: '2 years',
        desiredMoveInDate: '2026-04-01',
        desiredLeaseTerm: 12,
        numberOfOccupants: 2,
        reference1Name: 'Reference One',
        reference1Phone: '5550001111',
      },
    });

    expect(applicationResponse.statusCode).toBe(201);
    applicationId = applicationResponse.json().data.id;

    const approveResponse = await app.inject({
      method: 'PATCH',
      url: `/applications/${applicationId}`,
      headers: {
        authorization: `Bearer ${landlordToken}`,
      },
      payload: {
        status: 'approved',
      },
    });

    expect(approveResponse.statusCode).toBe(200);
  });

  afterAll(async () => {
    await app.prisma.reviewCategoryScore.deleteMany({});
    await app.prisma.review.deleteMany({});
    await app.prisma.rentalApplication.deleteMany({ where: { id: applicationId } });
    await app.prisma.property.deleteMany({ where: { id: propertyId } });
    await app.prisma.user.deleteMany({ where: { id: { in: [landlordId, tenantId] } } });
    await app.close();
  });

  it('allows tenant to review landlord after approved rental application', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/reviews',
      headers: {
        authorization: `Bearer ${tenantToken}`,
      },
      payload: {
        rentalApplicationId: applicationId,
        reviewerRole: 'tenant',
        overallRating: 5,
        comment: 'Excellent communication and very fair throughout the process.',
        categoryScores: [
          { category: 'communication', score: 5 },
          { category: 'listing_accuracy', score: 5 },
        ],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.reviewerRole).toBe('tenant');
    expect(body.data.revieweeRole).toBe('landlord');
  });

  it('blocks duplicate same-direction reviews for the same application', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/reviews',
      headers: {
        authorization: `Bearer ${tenantToken}`,
      },
      payload: {
        rentalApplicationId: applicationId,
        reviewerRole: 'tenant',
        overallRating: 4,
        comment: 'Trying to review twice should fail for the same relationship.',
        categoryScores: [{ category: 'communication', score: 4 }],
      },
    });

    expect(response.statusCode).toBe(400);
    expect((response.json() as any).error).toContain('already reviewed');
  });

  it('allows landlord to review tenant after approved rental application', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/reviews',
      headers: {
        authorization: `Bearer ${landlordToken}`,
      },
      payload: {
        rentalApplicationId: applicationId,
        reviewerRole: 'landlord',
        overallRating: 5,
        comment: 'Reliable tenant with clear communication and strong follow-through.',
        categoryScores: [
          { category: 'communication', score: 5 },
          { category: 'payment_reliability', score: 5 },
        ],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as any;
    expect(body.data.reviewerRole).toBe('landlord');
    expect(body.data.revieweeRole).toBe('tenant');
  });

  it('returns review summary for a landlord profile', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/reviews/summary/${landlordId}?role=landlord`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.totalReviews).toBe(1);
    expect(body.data.averageRating).toBe(5);
  });

  it('returns authored reviews for the current reviewer', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/reviews/mine?role=tenant',
      headers: {
        authorization: `Bearer ${tenantToken}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as any;
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].reviewerRole).toBe('tenant');
    expect(body.data[0].rentalApplicationId).toBe(applicationId);
  });
});

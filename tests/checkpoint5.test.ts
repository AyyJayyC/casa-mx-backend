import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';

let app: FastifyInstance;
let prisma: PrismaClient;
let adminToken: string;
let userToken: string;
let adminUserId: string;
let testUserId: string;

beforeAll(async () => {
  app = await buildApp();
  prisma = app.prisma as unknown as PrismaClient;

  // Register admin and user
  const adminEmail = `admin-${Date.now()}@test.local`;
  const userEmail = `user-${Date.now()}@test.local`;

  // Create admin user
  const adminResponse = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      email: adminEmail,
      name: 'Admin User',
      password: 'AdminPassword123!',
    },
  });
  expect(adminResponse.statusCode).toBe(201);

  // Create test user
  const userResponse = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      email: userEmail,
      name: 'Test User',
      password: 'TestPassword123!',
    },
  });
  expect(userResponse.statusCode).toBe(201);

  // Get user IDs
  const adminUser = await prisma.user.findUnique({
    where: { email: adminEmail },
  });
  const testUser = await prisma.user.findUnique({
    where: { email: userEmail },
  });

  adminUserId = adminUser!.id;
  testUserId = testUser!.id;

  // Give admin role to admin user
  const adminRole = await prisma.role.findUnique({
    where: { name: 'admin' },
  });

  // First approve existing roles
  const adminUserRoles = await prisma.userRole.findMany({
    where: { userId: adminUserId },
  });

  for (const userRole of adminUserRoles) {
    await prisma.userRole.update({
      where: { id: userRole.id },
      data: { status: 'approved' },
    });
  }

  // Add admin role
  await prisma.userRole.create({
    data: {
      userId: adminUserId,
      roleId: adminRole!.id,
      status: 'approved',
    },
  });

  // Approve test user's roles
  const testUserRoles = await prisma.userRole.findMany({
    where: { userId: testUserId },
  });

  for (const userRole of testUserRoles) {
    await prisma.userRole.update({
      where: { id: userRole.id },
      data: { status: 'approved' },
    });
  }

  // Login to get tokens
  const adminLoginResponse = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: {
      email: adminEmail,
      password: 'AdminPassword123!',
    },
  });
  expect(adminLoginResponse.statusCode).toBe(200);
  const adminLoginData = JSON.parse(adminLoginResponse.payload);
  adminToken = adminLoginData.token;

  const userLoginResponse = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: {
      email: userEmail,
      password: 'TestPassword123!',
    },
  });
  expect(userLoginResponse.statusCode).toBe(200);
  const userLoginData = JSON.parse(userLoginResponse.payload);
  userToken = userLoginData.token;
});

afterAll(async () => {
  await app.close();
});

describe('Checkpoint 5: Backend Analytics API', () => {
  describe('POST /analytics/events', () => {
    it('authenticated user can track an event', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/analytics/events',
        headers: {
          authorization: `Bearer ${userToken}`,
        },
        payload: {
          eventName: 'property_viewed',
          entityId: 'prop-123',
        },
      });

      expect(response.statusCode).toBe(201);
      const data = JSON.parse(response.payload);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.eventName).toBe('property_viewed');
      expect(data.data.userId).toBe(testUserId);
      expect(data.data.entityId).toBe('prop-123');
    });

    it('event is persisted to database', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/analytics/events',
        headers: {
          authorization: `Bearer ${userToken}`,
        },
        payload: {
          eventName: 'property_saved',
          entityId: 'prop-456',
          metadata: { source: 'search' },
        },
      });

      expect(response.statusCode).toBe(201);
      const data = JSON.parse(response.payload);

      // Query database to verify
      const event = await prisma.analyticsEvent.findUnique({
        where: { id: data.data.id },
      });

      expect(event).toBeDefined();
      expect(event!.eventName).toBe('property_saved');
      expect(event!.entityId).toBe('prop-456');
      expect(event!.userId).toBe(testUserId);
      expect(event!.metadata).toEqual({ source: 'search' });
    });

    it('accepts metadata as optional JSON', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/analytics/events',
        headers: {
          authorization: `Bearer ${userToken}`,
        },
        payload: {
          eventName: 'request_made',
          metadata: {
            propertyType: 'residential',
            priceRange: '100k-200k',
            interest_level: 'high',
          },
        },
      });

      expect(response.statusCode).toBe(201);
      const data = JSON.parse(response.payload);
      expect(data.data.metadata).toEqual({
        propertyType: 'residential',
        priceRange: '100k-200k',
        interest_level: 'high',
      });
    });

    it('invalid event payload returns 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/analytics/events',
        headers: {
          authorization: `Bearer ${userToken}`,
        },
        payload: {
          // Missing required eventName
          entityId: 'prop-789',
        },
      });

      expect(response.statusCode).toBe(400);
      const data = JSON.parse(response.payload);
      expect(data.success).toBe(false);
    });

    it('non-authenticated user cannot post events (401)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/analytics/events',
        payload: {
          eventName: 'property_viewed',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('invalid token returns 401', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/analytics/events',
        headers: {
          authorization: 'Bearer invalid.token.here',
        },
        payload: {
          eventName: 'property_viewed',
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /admin/analytics/summary', () => {
    beforeAll(async () => {
      // Create test events
      await prisma.analyticsEvent.createMany({
        data: [
          {
            eventName: 'property_viewed',
            userId: testUserId,
            entityId: 'prop-1',
          },
          {
            eventName: 'property_viewed',
            userId: testUserId,
            entityId: 'prop-2',
          },
          {
            eventName: 'property_saved',
            userId: testUserId,
            entityId: 'prop-3',
          },
          {
            eventName: 'request_made',
            userId: adminUserId,
            entityId: 'prop-4',
          },
        ],
      });
    });

    it('admin can access analytics summary', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/analytics/summary',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
    });

    it('summary includes total event count', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/analytics/summary',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      const data = JSON.parse(response.payload);
      expect(data.data.totalEvents).toBeGreaterThanOrEqual(4);
    });

    it('summary includes unique user count', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/analytics/summary',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      const data = JSON.parse(response.payload);
      expect(data.data.uniqueUsers).toBeGreaterThanOrEqual(2);
    });

    it('summary includes event types', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/analytics/summary',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      const data = JSON.parse(response.payload);
      expect(Array.isArray(data.data.eventTypes)).toBe(true);
      expect(data.data.eventTypes.length).toBeGreaterThan(0);
    });

    it('summary includes event counts by type', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/analytics/summary',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      const data = JSON.parse(response.payload);
      expect(data.data.eventCounts).toBeDefined();
      expect(typeof data.data.eventCounts).toBe('object');
    });

    it('non-admin user cannot access summary (403)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/analytics/summary',
        headers: {
          authorization: `Bearer ${userToken}`,
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('unauthenticated user cannot access summary (401)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/analytics/summary',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /admin/analytics/events', () => {
    it('admin can fetch all events', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/analytics/events',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
    });

    it('events list includes all created events', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/analytics/events',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      const data = JSON.parse(response.payload);
      expect(data.data.length).toBeGreaterThanOrEqual(4);
    });

    it('events are ordered by creation date descending', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/analytics/events',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      const data = JSON.parse(response.payload);
      const dates = data.data.map((e: any) => new Date(e.createdAt).getTime());

      for (let i = 1; i < dates.length; i++) {
        expect(dates[i]).toBeLessThanOrEqual(dates[i - 1]);
      }
    });

    it('respects limit parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/analytics/events?limit=2',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      const data = JSON.parse(response.payload);
      expect(data.data.length).toBeLessThanOrEqual(2);
    });

    it('non-admin user cannot access events (403)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/analytics/events',
        headers: {
          authorization: `Bearer ${userToken}`,
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('unauthenticated user cannot access events (401)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/analytics/events',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /admin/analytics/events-by-name', () => {
    it('admin can filter events by name', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/analytics/events-by-name?eventName=property_viewed',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const data = JSON.parse(response.payload);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
    });

    it('filtered events contain only matching event names', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/analytics/events-by-name?eventName=property_viewed',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      const data = JSON.parse(response.payload);
      data.data.forEach((event: any) => {
        expect(event.eventName).toBe('property_viewed');
      });
    });

    it('returns empty array when no matching events', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/analytics/events-by-name?eventName=nonexistent_event',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      const data = JSON.parse(response.payload);
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data.length).toBe(0);
    });

    it('respects limit parameter on filtered results', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/analytics/events-by-name?eventName=property_viewed&limit=1',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      const data = JSON.parse(response.payload);
      expect(data.data.length).toBeLessThanOrEqual(1);
    });

    it('non-admin user cannot filter events (403)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/analytics/events-by-name?eventName=property_viewed',
        headers: {
          authorization: `Bearer ${userToken}`,
        },
      });

      expect(response.statusCode).toBe(403);
    });

    it('unauthenticated user cannot filter events (401)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/analytics/events-by-name?eventName=property_viewed',
      });

      expect(response.statusCode).toBe(401);
    });

    it('missing eventName parameter returns 400', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/analytics/events-by-name',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});

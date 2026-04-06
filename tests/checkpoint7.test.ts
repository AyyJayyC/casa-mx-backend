import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app';
import { FastifyInstance } from 'fastify';

describe('CHECKPOINT 7 — Hardening & Production Readiness (Core Tests)', () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // Login as admin to get token
    const adminLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'admin@casamx.local',
        password: 'admin123',
      },
    });

    const adminData = JSON.parse(adminLogin.body);
    adminToken = adminData.token;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Input Validation', () => {
    it('should reject invalid email format on register', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          name: 'Test User',
          email: 'invalid-email',
          password: 'Password123!',
          roles: ['buyer'],
        },
      });

      expect(response.statusCode).toBe(400);
      const data = JSON.parse(response.body);
      expect(data.success).toBe(false);
      expect(data.error).toContain('Validation');
    });

    it('should reject short password on register', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          name: 'Test User',
          email: 'test@example.com',
          password: '123',
          roles: ['buyer'],
        },
      });

      expect(response.statusCode).toBe(400);
      const data = JSON.parse(response.body);
      expect(data.success).toBe(false);
    });

    it('should reject missing required fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: {
          email: 'test@example.com',
          // Missing name and password
        },
      });

      expect(response.statusCode).toBe(400);
      const data = JSON.parse(response.body);
      expect(data.success).toBe(false);
    });

    it('should reject invalid UUID in admin routes', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/admin/roles/not-a-uuid/approve',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(400);
      const data = JSON.parse(response.body);
      expect(data.success).toBe(false);
    });

    it('should reject invalid analytics event', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/analytics/events',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {
          // Missing required fields like eventName
          metadata: { test: 'data' },
        },
      });

      expect(response.statusCode).toBe(400);
      const data = JSON.parse(response.body);
      expect(data.success).toBe(false);
    });

    it('should reject invalid geocode payload', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/maps/geocode',
        payload: {
          address: 'a',
        },
      });

      expect(response.statusCode).toBe(400);
      const data = JSON.parse(response.body);
      expect(data.error).toBe('invalid_request');
    });

    it('should reject invalid autocomplete query payload', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/maps/autocomplete?input=ab',
      });

      expect(response.statusCode).toBe(400);
      const data = JSON.parse(response.body);
      expect(data.error).toBe('invalid_request');
    });

    it('should reject invalid admin maps service type', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/admin/maps/service/not-real/enable',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(400);
      const data = JSON.parse(response.body);
      expect(data.error).toBe('invalid_request');
    });

    it('should reject empty admin maps limits patch body', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/admin/maps/limits/geocoding',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const data = JSON.parse(response.body);
      expect(data.error).toBe('invalid_request');
    });
  });

  describe('Token Security', () => {
    it('should reject expired token', async () => {
      // Create a token with very short expiry
      const expiredToken = app.jwt.sign(
        { id: 'test-id', email: 'test@example.com', roles: [] },
        { expiresIn: '1ms' }
      );

      // Wait to ensure expiry
      await new Promise(resolve => setTimeout(resolve, 10));

      const response = await app.inject({
        method: 'GET',
        url: '/admin/users',
        headers: {
          authorization: `Bearer ${expiredToken}`,
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject invalid token format', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/users',
        headers: {
          authorization: 'Bearer invalid-token',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject missing token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/users',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('CORS Configuration', () => {
    it('should include CORS headers', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health',
        headers: {
          origin: 'http://localhost:3000',
        },
      });

      expect(response.headers['access-control-allow-origin']).toBeDefined();
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });

    it('should handle preflight OPTIONS request', async () => {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/auth/login',
        headers: {
          origin: 'http://localhost:3000',
          'access-control-request-method': 'POST',
        },
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers['access-control-allow-methods']).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should return proper error format for 404', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/nonexistent-route',
      });

      expect(response.statusCode).toBe(404);
      const data = JSON.parse(response.body);
      expect(data.error).toBe('Not Found');
    });

    it('should handle database errors gracefully', async () => {
      // Try to approve a non-existent role
      const fakeUuid = '00000000-0000-0000-0000-000000000000';
      const response = await app.inject({
        method: 'POST',
        url: `/admin/roles/${fakeUuid}/approve`,
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      expect(response.statusCode).toBe(404);
      const data = JSON.parse(response.body);
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });
  });
});

describe('CHECKPOINT 7 — Hardening & Production Readiness (Rate Limiting)', () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // Login as admin to get token
    const adminLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'admin@casamx.local',
        password: 'admin123',
      },
    });

    const adminData = JSON.parse(adminLogin.body);
    adminToken = adminData.token;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits on register endpoint', async () => {
      const timestamp = Date.now();
      const requests = [];
      
      // Make 52 requests (limit is 50 in test mode)
      for (let i = 0; i < 52; i++) {
        requests.push(
          app.inject({
            method: 'POST',
            url: '/auth/register',
            payload: {
              name: `Test User ${i}`,
              email: `rate-test-${timestamp}-${i}@example.com`,
              password: 'Password123!',
              roles: ['buyer'],
            },
          })
        );
      }

      const responses = await Promise.all(requests);
      
      // Last request should be rate limited
      const lastResponse = responses[responses.length - 1];
      expect(lastResponse.statusCode).toBe(429);
    }, 30000);

    it('should enforce rate limits on login endpoint', async () => {
      const requests = [];
      
      // Make 102 requests (limit is 100 in test mode)
      for (let i = 0; i < 102; i++) {
        requests.push(
          app.inject({
            method: 'POST',
            url: '/auth/login',
            payload: {
              email: 'nonexistent@example.com',
              password: 'WrongPassword',
            },
          })
        );
      }

      const responses = await Promise.all(requests);
      
      // Last request should be rate limited
      const lastResponse = responses[responses.length - 1];
      expect(lastResponse.statusCode).toBe(429);
    }, 30000);

    it('should enforce global rate limits', async () => {
      const requests = [];
      
      // Make 510 requests (global limit is 500 in test mode)
      for (let i = 0; i < 510; i++) {
        requests.push(
          app.inject({
            method: 'GET',
            url: '/health',
          })
        );
      }

      const responses = await Promise.all(requests);
      
      // Some requests should be rate limited
      const rateLimitedCount = responses.filter(r => r.statusCode === 429).length;
      expect(rateLimitedCount).toBeGreaterThan(0);
    }, 30000);
  });
});

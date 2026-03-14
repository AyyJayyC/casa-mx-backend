import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let adminToken: string;
let userToken: string;
let userId: string;
let userRoleId: string;

describe('Checkpoint 3 - Authorization & Guards', () => {
  beforeAll(async () => {
    app = await buildApp();

    // Setup: Login as admin to get token
    const adminLoginResponse = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'admin@casamx.local',
        password: 'admin123',
      },
    });

    const adminLoginBody = adminLoginResponse.json() as any;
    adminToken = adminLoginBody.token;

    // Setup: Create test user
    const testEmail = `authz-test-${Date.now()}@example.com`;
    const registerResponse = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: testEmail,
        name: 'Authorization Test User',
        password: 'password123',
      },
    });

    // Setup: Login as regular user with SAME email
    const userLoginResponse = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: testEmail,
        password: 'password123',
      },
    });

    const userLoginBody = userLoginResponse.json() as any;
    userToken = userLoginBody.token;
    userId = userLoginBody.user.id;
    userRoleId = userLoginBody.user.roles[0]?.id;

    // Get actual userRoleId from pending roles
    const pendingResponse = await app.inject({
      method: 'GET',
      url: '/admin/pending-roles',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    const pendingBody = pendingResponse.json() as any;
    if (pendingBody.data && pendingBody.data.length > 0) {
      // Find the one we just created
      const pendingRole = pendingBody.data.find((p: any) => p.user.id === userId);
      if (pendingRole) {
        userRoleId = pendingRole.id;
      }
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('should reject requests without token to protected routes', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/pending-roles',
    });

    expect(response.statusCode).toBe(401);
    const body = response.json() as any;
    expect(body.error).toContain('Unauthorized');
  });

  it('should reject requests with invalid token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/pending-roles',
      headers: {
        authorization: 'Bearer invalid-token',
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it('should allow admin to access /admin/pending-roles', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/pending-roles',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as any;
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('should allow admin to access /admin/users', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as any;
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('should allow admin to access /admin/audit-logs', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/audit-logs',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as any;
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('should reject non-admin access to /admin/pending-roles', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/pending-roles',
      headers: {
        authorization: `Bearer ${userToken}`,
      },
    });

    expect(response.statusCode).toBe(403);
    const body = response.json() as any;
    expect(body.error).toContain('Forbidden');
  });

  it('should reject non-admin access to /admin/users', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: {
        authorization: `Bearer ${userToken}`,
      },
    });

    expect(response.statusCode).toBe(403);
  });

  it('should reject non-admin access to /admin/audit-logs', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/audit-logs',
      headers: {
        authorization: `Bearer ${userToken}`,
      },
    });

    expect(response.statusCode).toBe(403);
  });

  it('should allow valid JWT verification', async () => {
    // Use /auth/me endpoint which requires JWT
    const response = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as any;
    expect(body.user).toBeDefined();
  });

  it('should verify JWT signature (cannot spoof roles)', async () => {
    // Try to use a JWT with manually modified roles
    const spoofedToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6InVzZXItMTIzIiwiZW1haWwiOiJ1c2VyQGV4YW1wbGUuY29tIiwicm9sZXMiOlsiYWRtaW4iXX0.invalid_signature';

    const response = await app.inject({
      method: 'GET',
      url: '/admin/pending-roles',
      headers: {
        authorization: `Bearer ${spoofedToken}`,
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it('should have admin role with approved status', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as any;
    const adminRole = body.user.roles.find((r: any) => r.roleName === 'admin');
    expect(adminRole).toBeDefined();
    expect(adminRole?.status).toBe('approved');
  });

  it('should not grant admin access to unapproved roles', async () => {
    // Create new user - roles start as pending
    const testEmail2 = `pending-test-${Date.now()}@example.com`;
    const registerResponse = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: testEmail2,
        name: 'Pending Test',
        password: 'password123',
      },
    });

    // Try to login
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: testEmail2,
        password: 'password123',
      },
    });

    const loginBody = loginResponse.json() as any;
    const testToken = loginBody.token;

    // Try to access admin route
    const adminResponse = await app.inject({
      method: 'GET',
      url: '/admin/pending-roles',
      headers: {
        authorization: `Bearer ${testToken}`,
      },
    });

    expect(adminResponse.statusCode).toBe(403);
  });
});

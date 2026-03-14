import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let userToken: string;
let userId: string;
let adminToken: string;

describe('Users Routes', () => {
  beforeAll(async () => {
    app = await buildApp();

    const email = `users-test-${Date.now()}@example.com`;
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email,
        name: 'Users Test',
        password: 'password123',
      },
    });

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email,
        password: 'password123',
      },
    });

    const loginBody = loginResponse.json() as any;
    userToken = loginBody.token;
    userId = loginBody.user.id;

    const adminLoginResponse = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'admin@casamx.local',
        password: 'admin123',
      },
    });
    adminToken = (adminLoginResponse.json() as any).token;
  });

  afterAll(async () => {
    await app.prisma.user.deleteMany({ where: { email: { startsWith: 'users-test-' } } });
    await app.close();
  });

  it('GET /users/me should return current user profile', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: {
        authorization: `Bearer ${userToken}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(userId);
    expect(body.data.email).toContain('users-test-');
  });

  it('PATCH /users/me should update current user profile', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/users/me',
      headers: {
        authorization: `Bearer ${userToken}`,
      },
      payload: {
        name: 'Updated Users Test',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.name).toBe('Updated Users Test');
  });

  it('PATCH /users/me should reject empty payload', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/users/me',
      headers: {
        authorization: `Bearer ${userToken}`,
      },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it('GET /users/:id should allow self access', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/users/${userId}`,
      headers: {
        authorization: `Bearer ${userToken}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(userId);
  });

  it('GET /users/:id should reject access to another user for non-admin', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/users/00000000-0000-0000-0000-000000000001',
      headers: {
        authorization: `Bearer ${userToken}`,
      },
    });

    expect(response.statusCode).toBe(403);
  });

  it('GET /users/:id should allow admin access to another user id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/users/${userId}`,
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(userId);
  });

  it('GET /users/:id should validate UUID format', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/users/not-a-uuid',
      headers: {
        authorization: `Bearer ${userToken}`,
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('GET /users/me should require authentication', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/users/me',
    });

    expect(response.statusCode).toBe(401);
  });
});

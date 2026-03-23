import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildApp } from '../src/app.js';
import { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { refreshTokenStoreService } from '../src/services/refreshTokenStore.service.js';

let app: FastifyInstance;

describe('Checkpoint 2 - Authentication & Admin Bootstrap', () => {
  beforeAll(async () => {
    app = await buildApp();
    await refreshTokenStoreService.clearMemoryStateForTests();
    // Clean up test users before running tests
    await app.prisma.user.deleteMany({
      where: { email: { startsWith: 'test-' } }
    });
  });

  afterAll(async () => {
    // Clean up test users
    await app.prisma.user.deleteMany({
      where: { email: { startsWith: 'test-' } }
    });
    await app.close();
  });

  it('should allow user registration with selected roles and auto-approve tenant', async () => {
    const email = `test-${Date.now()}@example.com`;

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email,
        name: 'Test User',
        password: 'password123',
        roles: ['tenant'],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as any;
    expect(body.success).toBe(true);
    expect(body.user.email).toBe(email);
    expect(body.user.roles.length).toBeGreaterThan(0);

    // Verify user was created in database
    const user = await app.prisma.user.findUnique({
      where: { email },
      include: { roles: { include: { role: true } } }
    });

    expect(user).toBeDefined();
    expect(user?.roles.some(r => r.role.name === 'tenant')).toBe(true);
    expect(user?.roles.find(r => r.role.name === 'tenant')?.status).toBe('approved');
  });

  it('should prevent duplicate email registration', async () => {
    const email = `test-duplicate-${Date.now()}@example.com`;

    // First registration
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email,
        name: 'User 1',
        password: 'password123',
      },
    });

    // Second registration with same email
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email,
        name: 'User 2',
        password: 'password123',
      },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json() as any;
    expect(body.error).toContain('Email already exists');
  });

  it('should reject invalid email format', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: 'not-an-email',
        name: 'Test User',
        password: 'password123',
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('should reject password shorter than 8 characters', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: `test-short-${Date.now()}@example.com`,
        name: 'Test User',
        password: 'short',
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('should allow login with valid credentials', async () => {
    const email = `test-login-${Date.now()}@example.com`;
    const password = 'password123';

    // Register user
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email,
        name: 'Test User',
        password,
      },
    });

    // Login
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email,
        password,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as any;
    expect(body.success).toBe(true);
    expect(body.token).toBeDefined();
    expect(body.refreshToken).toBeDefined();
  });

  it('should reject login with invalid password', async () => {
    const email = `test-invalid-${Date.now()}@example.com`;

    // Register user
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email,
        name: 'Test User',
        password: 'password123',
      },
    });

    // Try to login with wrong password
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email,
        password: 'wrongpassword',
      },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json() as any;
    expect(body.error).toContain('Invalid email or password');
  });

  it('should reject login with non-existent email', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'nonexistent@example.com',
        password: 'password123',
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it('should issue valid JWT token on login', async () => {
    const email = `test-jwt-${Date.now()}@example.com`;

    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email,
        name: 'Test User',
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
    const token = loginBody.token;

    // Verify token is valid by using it
    const response = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as any;
    expect(body.user.email).toBe(email);
  });

  it('should allow token refresh with valid refresh token', async () => {
    const email = `test-refresh-${Date.now()}@example.com`;

    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email,
        name: 'Test User',
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
    const refreshToken = loginBody.refreshToken;

    // Use refresh token to get new access token
    const refreshResponse = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: {
        refreshToken,
      },
    });

    expect(refreshResponse.statusCode).toBe(200);
    const refreshBody = refreshResponse.json() as any;
    expect(refreshBody.token).toBeDefined();
  });

  it('should persist active refresh token jti in token store', async () => {
    const email = `test-refresh-store-${Date.now()}@example.com`;

    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email,
        name: 'Refresh Store User',
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
    const decodedRefresh = app.jwt.decode(loginBody.refreshToken) as any;

    const activeJti = await refreshTokenStoreService.getActiveJtiForUser(loginBody.user.id);

    expect(decodedRefresh?.jti).toBeDefined();
    expect(activeJti).toBe(decodedRefresh.jti);
  });

  it('should revoke old refresh jti and rotate active jti on refresh', async () => {
    const email = `test-refresh-rotate-${Date.now()}@example.com`;

    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email,
        name: 'Refresh Rotate User',
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
    const firstRefreshToken = loginBody.refreshToken;
    const firstDecoded = app.jwt.decode(firstRefreshToken) as any;

    const refreshResponse = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: {
        refreshToken: firstRefreshToken,
      },
    });

    expect(refreshResponse.statusCode).toBe(200);
    const refreshBody = refreshResponse.json() as any;
    const secondDecoded = app.jwt.decode(refreshBody.refreshToken) as any;

    const wasRevoked = await refreshTokenStoreService.isJtiRevoked(firstDecoded.jti);
    const activeJti = await refreshTokenStoreService.getActiveJtiForUser(loginBody.user.id);

    expect(secondDecoded?.jti).toBeDefined();
    expect(secondDecoded.jti).not.toBe(firstDecoded.jti);
    expect(wasRevoked).toBe(true);
    expect(activeJti).toBe(secondDecoded.jti);
  });

  it('should reject invalid refresh token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: {
        refreshToken: 'invalid-token',
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it('should have admin user created via seed', async () => {
    const admin = await app.prisma.user.findUnique({
      where: { email: 'admin@casamx.local' },
      include: { roles: { include: { role: true } } }
    });

    expect(admin).toBeDefined();
    expect(admin?.email).toBe('admin@casamx.local');
    expect(admin?.roles.some(r => r.role.name === 'admin')).toBe(true);
    expect(admin?.roles.find(r => r.role.name === 'admin')?.status).toBe('approved');
  });

  it('should allow admin to login with correct password', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: 'admin@casamx.local',
        password: 'admin123',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as any;
    expect(body.token).toBeDefined();
  });

  it('should retrieve authenticated user profile with valid token', async () => {
    const email = `test-profile-${Date.now()}@example.com`;

    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email,
        name: 'Profile Test',
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

    const meResponse = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: {
        authorization: `Bearer ${loginBody.token}`,
      },
    });

    expect(meResponse.statusCode).toBe(200);
    const meBody = meResponse.json() as any;
    expect(meBody.user.email).toBe(email);
    expect(meBody.user.name).toBe('Profile Test');
  });

  it('should reject requests without valid token to /auth/me', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/auth/me',
    });

    expect(response.statusCode).toBe(401);
  });

  it('should logout successfully', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/logout',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as any;
    expect(body.success).toBe(true);
  });
});

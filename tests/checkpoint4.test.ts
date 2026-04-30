import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let adminToken: string;
let testEmail: string;
let userId: string;
let userRoleId: string;

async function createPendingAdminRoleForUser(userId: string) {
  const adminRole = await app.prisma.role.findUnique({
    where: { name: 'admin' },
    select: { id: true },
  });

  expect(adminRole).toBeDefined();

  const userRole = await app.prisma.userRole.create({
    data: {
      userId,
      roleId: adminRole!.id,
      status: 'pending',
    },
    select: { id: true },
  });

  return userRole.id;
}

async function getPendingRoleIdByEmail(email: string) {
  const pendingResponse = await app.inject({
    method: 'GET',
    url: '/admin/pending-roles',
    headers: {
      authorization: `Bearer ${adminToken}`,
    },
  });

  expect(pendingResponse.statusCode).toBe(200);
  const pendingBody = pendingResponse.json() as any;
  const pendingRole = pendingBody.data.find((p: any) => p.user.email === email);
  expect(pendingRole).toBeDefined();
  return pendingRole.id as string;
}

describe('Checkpoint 4 - Admin Authority & Audit Logs', () => {
  beforeAll(async () => {
    app = await buildApp();

    // Setup: Login as admin
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
    testEmail = `admin-test-${Date.now()}@example.com`;
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: testEmail,
        name: 'Admin Test User',
        password: 'password123',
        roles: ['seller'],
      },
    });
    const createdUser = await app.prisma.user.findUnique({
      where: { email: testEmail },
      select: { id: true },
    });
    expect(createdUser).toBeDefined();
    userId = createdUser!.id;
    userRoleId = await createPendingAdminRoleForUser(userId);
  });

  afterAll(async () => {
    await app.close();
  });

  it('should allow admin to approve a pending role', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/admin/roles/${userRoleId}/approve`,
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('approved');
  });

  it('should create audit log when role is approved', async () => {
    // Get audit logs
    const response = await app.inject({
      method: 'GET',
      url: '/admin/audit-logs',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as any;
    expect(Array.isArray(body.data)).toBe(true);

    // Check for APPROVE_ROLE action
    const approveLog = body.data.find((log: any) => log.action === 'APPROVE_ROLE');
    expect(approveLog).toBeDefined();
    expect(approveLog.previousState.status).toBe('pending');
    expect(approveLog.newState.status).toBe('approved');
  });

  it('should prevent approving already-approved role', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/admin/roles/${userRoleId}/approve`,
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json() as any;
    expect(body.error).toContain('Cannot approve');
  });

  it('should allow admin to deny a pending role', async () => {
    // Create another test user for deny test
    const denyTestEmail = `deny-test-${Date.now()}@example.com`;
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: denyTestEmail,
        name: 'Deny Test User',
        password: 'password123',
        roles: ['seller'],
      },
    });
    const denyTestUser = await app.prisma.user.findUnique({
      where: { email: denyTestEmail },
      select: { id: true },
    });
    expect(denyTestUser).toBeDefined();
    const denyTestRoleId = await createPendingAdminRoleForUser(denyTestUser!.id);

    // Deny the role
    const denyResponse = await app.inject({
      method: 'POST',
      url: `/admin/roles/${denyTestRoleId}/deny`,
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(denyResponse.statusCode).toBe(200);
    const denyBody = denyResponse.json() as any;
    expect(denyBody.success).toBe(true);
    expect(denyBody.data.status).toBe('denied');
  });

  it('should create audit log when role is denied', async () => {
    // Get audit logs
    const response = await app.inject({
      method: 'GET',
      url: '/admin/audit-logs',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    const body = response.json() as any;

    // Check for DENY_ROLE action
    const denyLog = body.data.find((log: any) => log.action === 'DENY_ROLE');
    expect(denyLog).toBeDefined();
    expect(denyLog.previousState.status).toBe('pending');
    expect(denyLog.newState.status).toBe('denied');
  });

  it('should reject non-admin from approving roles', async () => {
    // Create regular user token
    const userEmail = `nonaction-${Date.now()}@example.com`;
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: userEmail,
        name: 'Non-Admin User',
        password: 'password123',
      },
    });

    const userLoginResponse = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: userEmail,
        password: 'password123',
      },
    });

    const userLoginBody = userLoginResponse.json() as any;
    const userToken = userLoginBody.token;

    // Try to approve
    const response = await app.inject({
      method: 'POST',
      url: `/admin/roles/${userRoleId}/approve`,
      headers: {
        authorization: `Bearer ${userToken}`,
      },
    });

    expect(response.statusCode).toBe(403);
  });

  it('should reject non-admin from denying roles', async () => {
    // Use existing non-admin user
    const userEmail = `deny-nonaction-${Date.now()}@example.com`;
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: userEmail,
        name: 'Deny Non-Admin',
        password: 'password123',
      },
    });

    const userLoginResponse = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: userEmail,
        password: 'password123',
      },
    });

    const userLoginBody = userLoginResponse.json() as any;
    const userToken = userLoginBody.token;

    const response = await app.inject({
      method: 'POST',
      url: `/admin/roles/${userRoleId}/deny`,
      headers: {
        authorization: `Bearer ${userToken}`,
      },
    });

    expect(response.statusCode).toBe(403);
  });

  it('should reject approval of non-existent role', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/admin/roles/00000000-0000-0000-0000-000000000000/approve',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(response.statusCode).toBe(404);
    const body = response.json() as any;
    expect(body.error).toContain('not found');
  });

  it('should have audit log with correct fields', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/audit-logs',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    const body = response.json() as any;
    const auditLog = body.data[0];

    expect(auditLog).toHaveProperty('id');
    expect(auditLog).toHaveProperty('actorUserId');
    expect(auditLog).toHaveProperty('targetUserId');
    expect(auditLog).toHaveProperty('action');
    expect(auditLog).toHaveProperty('previousState');
    expect(auditLog).toHaveProperty('newState');
    expect(auditLog).toHaveProperty('createdAt');
  });

  it('should reject non-admin from viewing audit logs', async () => {
    const userEmail = `audit-viewer-${Date.now()}@example.com`;
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: userEmail,
        name: 'Audit Viewer',
        password: 'password123',
      },
    });

    const userLoginResponse = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: userEmail,
        password: 'password123',
      },
    });

    const userLoginBody = userLoginResponse.json() as any;
    const userToken = userLoginBody.token;

    const response = await app.inject({
      method: 'GET',
      url: '/admin/audit-logs',
      headers: {
        authorization: `Bearer ${userToken}`,
      },
    });

    expect(response.statusCode).toBe(403);
  });

  it('should store previousState and newState as JSON', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/audit-logs',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    const body = response.json() as any;
    const auditLog = body.data.find((log: any) => log.action === 'APPROVE_ROLE');

    expect(typeof auditLog.previousState).toBe('object');
    expect(typeof auditLog.newState).toBe('object');
    expect(auditLog.previousState.status).toBeDefined();
    expect(auditLog.newState.status).toBeDefined();
  });
});

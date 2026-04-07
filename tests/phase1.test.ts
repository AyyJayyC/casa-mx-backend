/**
 * Phase 1 Tests - User Authentication, Profiles & Document Management
 * Tests for new features added in Phase 1:
 *  - Phone number registration & profile updates
 *  - Bio and profile picture updates
 *  - Email verification workflow
 *  - Password change
 *  - Document upload, listing, retrieval, deletion, and admin verification
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

let app: FastifyInstance;
let userToken: string;
let userId: string;
let adminToken: string;

const testEmail = `phase1-test-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`;
const testPassword = 'password123';

describe('Phase 1 - User Profile & Auth Enhancements', () => {
  beforeAll(async () => {
    app = await buildApp();

    // Register a test user with phone
    const registerRes = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: testEmail,
        name: 'Phase1 Tester',
        password: testPassword,
        phone: '+525551234567',
      },
    });

    expect(registerRes.statusCode).toBe(201);
    const registerBody = registerRes.json() as any;
    expect(registerBody.user.phone).toBe('+525551234567');
    expect(registerBody.user.isEmailVerified).toBe(false);

    // Login
    const loginRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: testEmail, password: testPassword },
    });

    const loginBody = loginRes.json() as any;
    userToken = loginBody.token;
    userId = loginBody.user.id;

    // Admin login
    const adminLoginRes = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'admin@casamx.local', password: 'admin123' },
    });

    adminToken = (adminLoginRes.json() as any).token;
  });

  afterAll(async () => {
    await app.prisma.user.deleteMany({ where: { email: { startsWith: 'phase1-test-' } } });
    await app.close();
  });

  // ===== USER PROFILE =====

  it('GET /users/me should return phone, bio, profilePictureUrl, isEmailVerified', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { authorization: `Bearer ${userToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('phone');
    expect(body.data).toHaveProperty('bio');
    expect(body.data).toHaveProperty('profilePictureUrl');
    expect(body.data).toHaveProperty('isEmailVerified');
    expect(body.data.phone).toBe('+525551234567');
    expect(body.data.isEmailVerified).toBe(false);
  });

  it('PATCH /users/me should update phone and bio', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/users/me',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { bio: 'Hola, soy comprador', phone: '+525559876543' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.bio).toBe('Hola, soy comprador');
    expect(body.data.phone).toBe('+525559876543');
  });

  it('PATCH /users/me should reject bio longer than 500 chars', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/users/me',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { bio: 'x'.repeat(501) },
    });

    expect(res.statusCode).toBe(400);
  });

  it('PATCH /users/me/picture should update profile picture URL', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/users/me/picture',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { profilePictureUrl: 'https://cdn.example.com/avatar.jpg' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.profilePictureUrl).toBe('https://cdn.example.com/avatar.jpg');
  });

  it('PATCH /users/me/picture should reject invalid URL', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/users/me/picture',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { profilePictureUrl: 'not-a-url' },
    });

    expect(res.statusCode).toBe(400);
  });

  // ===== PASSWORD CHANGE =====

  it('POST /auth/change-password should change the password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { currentPassword: testPassword, newPassword: 'newpassword456' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.success).toBe(true);

    // Login with old password should fail
    const loginOld = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: testEmail, password: testPassword },
    });
    expect(loginOld.statusCode).toBe(401);

    // Login with new password should succeed
    const loginNew = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: testEmail, password: 'newpassword456' },
    });
    expect(loginNew.statusCode).toBe(200);

    // Get a new token for subsequent tests
    userToken = (loginNew.json() as any).token;
  });

  it('POST /auth/change-password should reject wrong current password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      headers: { authorization: `Bearer ${userToken}` },
      payload: { currentPassword: 'wrongpassword', newPassword: 'anothernew123' },
    });

    expect(res.statusCode).toBe(400);
    expect((res.json() as any).error).toContain('Current password is incorrect');
  });

  it('POST /auth/change-password should require authentication', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/change-password',
      payload: { currentPassword: 'x', newPassword: 'anothernew123' },
    });

    expect(res.statusCode).toBe(401);
  });

  // ===== EMAIL VERIFICATION =====

  it('POST /auth/request-verification should return token in non-production', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/request-verification',
      payload: { email: testEmail },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.success).toBe(true);
    // In test/dev mode, token is returned in the response
    expect(body.verificationToken).toBeDefined();
  });

  it('POST /auth/verify-email should verify email with valid token', async () => {
    // Request a fresh token
    const reqRes = await app.inject({
      method: 'POST',
      url: '/auth/request-verification',
      payload: { email: testEmail },
    });

    const { verificationToken } = reqRes.json() as any;
    expect(verificationToken).toBeDefined();

    // Verify the email
    const verifyRes = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { token: verificationToken },
    });

    expect(verifyRes.statusCode).toBe(200);
    expect((verifyRes.json() as any).success).toBe(true);

    // Confirm isEmailVerified is now true
    const meRes = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { authorization: `Bearer ${userToken}` },
    });

    expect((meRes.json() as any).data.isEmailVerified).toBe(true);
  });

  it('POST /auth/verify-email should reject invalid token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { token: 'invalid-token-abc' },
    });

    expect(res.statusCode).toBe(400);
    expect((res.json() as any).error).toContain('Invalid verification token');
  });

  it('POST /auth/request-verification should reject already-verified email', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/request-verification',
      payload: { email: testEmail },
    });

    expect(res.statusCode).toBe(409);
    expect((res.json() as any).error).toContain('already verified');
  });

  // ===== DOCUMENT MANAGEMENT =====

  let documentId: string;

  it('POST /documents/upload should upload a document', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/documents/upload',
      headers: { authorization: `Bearer ${userToken}` },
      payload: {
        documentType: 'government_id',
        fileName: 'ine-frontal.pdf',
        fileSize: 102400,
        mimeType: 'application/pdf',
        fileContent: Buffer.from('fake-pdf-content').toString('base64'),
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.documentType).toBe('government_id');
    expect(body.data.status).toBe('pending');
    expect(body.data.fileName).toBe('ine-frontal.pdf');
    documentId = body.data.id;
    expect(documentId).toBeDefined();
  });

  it('POST /documents/upload should reject unknown documentType', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/documents/upload',
      headers: { authorization: `Bearer ${userToken}` },
      payload: {
        documentType: 'invalid_type',
        fileName: 'file.pdf',
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('POST /documents/upload should require authentication', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/documents/upload',
      payload: {
        documentType: 'government_id',
        fileName: 'ine.pdf',
      },
    });

    expect(res.statusCode).toBe(401);
  });

  it('GET /documents should list user documents', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/documents',
      headers: { authorization: `Bearer ${userToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.data.some((d: any) => d.id === documentId)).toBe(true);
  });

  it('GET /documents/:id should return specific document to owner', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/documents/${documentId}`,
      headers: { authorization: `Bearer ${userToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(documentId);
  });

  it('GET /documents/:id should return 404 for non-owned document', async () => {
    // Register another user
    const otherEmail = `phase1-other-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`;
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: otherEmail, name: 'Other User', password: 'password123' },
    });

    const otherLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: otherEmail, password: 'password123' },
    });

    const otherToken = (otherLogin.json() as any).token;

    const res = await app.inject({
      method: 'GET',
      url: `/documents/${documentId}`,
      headers: { authorization: `Bearer ${otherToken}` },
    });

    expect(res.statusCode).toBe(404);

    // Cleanup
    await app.prisma.user.deleteMany({ where: { email: otherEmail } });
  });

  it('PUT /documents/:id/verify should allow admin to approve document', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/documents/${documentId}/verify`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { status: 'approved', verifierNotes: 'Document looks valid' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('approved');
    expect(body.data.verifierNotes).toBe('Document looks valid');
  });

  it('PUT /documents/:id/verify should reject non-admin users', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/documents/${documentId}/verify`,
      headers: { authorization: `Bearer ${userToken}` },
      payload: { status: 'approved' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('DELETE /documents/:id should allow owner to delete their document', async () => {
    // Upload another document first
    const uploadRes = await app.inject({
      method: 'POST',
      url: '/documents/upload',
      headers: { authorization: `Bearer ${userToken}` },
      payload: {
        documentType: 'income_proof',
        fileName: 'nomina.pdf',
        mimeType: 'application/pdf',
      },
    });

    const toDeleteId = (uploadRes.json() as any).data.id;

    const res = await app.inject({
      method: 'DELETE',
      url: `/documents/${toDeleteId}`,
      headers: { authorization: `Bearer ${userToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect((res.json() as any).success).toBe(true);

    // Confirm it's gone
    const getRes = await app.inject({
      method: 'GET',
      url: `/documents/${toDeleteId}`,
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(getRes.statusCode).toBe(404);
  });
});

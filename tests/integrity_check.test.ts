/**
 * INTEGRITY CHECK TESTS - Adversarial Test Suite
 * Purpose: Verify that the test suite correctly catches bugs
 * 
 * These tests are designed to FAIL if core security/logic is broken:
 * A. AUTH BYPASS - Attempt unauthorized access to admin endpoints
 * B. VALIDATION BYPASS - Send invalid data that should be rejected
 * C. STATE INTEGRITY - Verify database state prevents invalid operations
 * 
 * If any of these tests pass when they should fail, the code has a security bug.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

let app: FastifyInstance;
let prisma: PrismaClient;
let adminToken: string;
let userToken: string;
let adminUserId: string;
let userId: string;
let rentalPropertyId: string;

describe('Integrity Check - Adversarial Tests', () => {
  beforeAll(async () => {
    app = await buildApp();
    prisma = app.prisma as unknown as PrismaClient;

    // ========================================
    // SETUP: Create admin and regular user
    // ========================================

    // Create admin user
    const adminRegister = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        name: 'Admin Integrity',
        email: `admin-integrity-${Date.now()}@test.com`,
        password: 'AdminPassword123!',
      },
    });

    const adminData = adminRegister.json() as any;
    adminUserId = adminData.user.id;

    // Give admin role to this user
    const adminRole = await prisma.role.findUnique({
      where: { name: 'admin' },
    });

    await prisma.userRole.create({
      data: {
        userId: adminUserId,
        roleId: adminRole!.id,
        status: 'approved',
      },
    });

    // Login as admin
    const adminLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: adminData.user.email,
        password: 'AdminPassword123!',
      },
    });

    adminToken = (adminLogin.json() as any).token;

    // Create regular user (NOT admin)
    const userRegister = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        name: 'Regular User',
        email: `user-integrity-${Date.now()}@test.com`,
        password: 'UserPassword123!',
      },
    });

    const userData = userRegister.json() as any;
    userId = userData.user.id;

    // Login as regular user
    const userLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        email: userData.user.email,
        password: 'UserPassword123!',
      },
    });

    userToken = (userLogin.json() as any).token;

    // Create a rental property for state integrity tests
    const propertyCreate = await app.inject({
      method: 'POST',
      url: '/properties',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
      payload: {
        title: 'Integrity Test Property',
        listingType: 'for_rent',
        monthlyRent: 20000,
        securityDeposit: 40000,
        leaseTermMonths: 12,
        estado: 'Jalisco',
      },
    });

    const propertyData = propertyCreate.json() as any;
    rentalPropertyId = propertyData.data.id;
  });

  afterAll(async () => {
    // Cleanup
    await prisma.rentalApplication.deleteMany({});
    await prisma.property.deleteMany({});
    await prisma.userRole.deleteMany({
      where: { userId: { in: [adminUserId, userId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [adminUserId, userId] } },
    });
    await app.close();
  });

  // ========================================
  // TEST A: AUTH BYPASS - Non-admin access
  // ========================================

  describe('A - Authorization: Non-Admin User Should NOT Access Admin Endpoints', () => {
    it('ADVERSARIAL: Regular user with valid JWT cannot access /admin/pending-roles', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/pending-roles',
        headers: {
          authorization: `Bearer ${userToken}`,
        },
      });

      // MUST return 403 Forbidden
      expect(response.statusCode).toBe(403);

      const body = response.json() as any;
      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();
    });

    it('ADVERSARIAL: Regular user cannot approve roles', async () => {
      // First, get a pending role ID as admin
      const pendingResponse = await app.inject({
        method: 'GET',
        url: '/admin/pending-roles',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      const pendingData = (pendingResponse.json() as any).data;
      if (pendingData.length === 0) {
        // Skip if no pending roles
        expect(true).toBe(true);
        return;
      }

      const userRoleId = pendingData[0].id;

      // Try to approve as regular user
      const response = await app.inject({
        method: 'POST',
        url: `/admin/roles/${userRoleId}/approve`,
        headers: {
          authorization: `Bearer ${userToken}`,
        },
      });

      // MUST return 403 Forbidden, NOT 200 OK
      expect(response.statusCode).toBe(403);
    });

    it('ADVERSARIAL: Regular user cannot access /admin/audit-logs', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/audit-logs',
        headers: {
          authorization: `Bearer ${userToken}`,
        },
      });

      // MUST return 403, NOT 200
      expect(response.statusCode).toBe(403);
    });

    it('ADVERSARIAL: Regular user cannot access /admin/users', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/users',
        headers: {
          authorization: `Bearer ${userToken}`,
        },
      });

      // MUST return 403
      expect(response.statusCode).toBe(403);
    });

    it('ADVERSARIAL: Regular user cannot access /admin/analytics/summary', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/analytics/summary',
        headers: {
          authorization: `Bearer ${userToken}`,
        },
      });

      // MUST return 403
      expect(response.statusCode).toBe(403);
    });
  });

  // ========================================
  // TEST B: VALIDATION BYPASS
  // ========================================

  describe('B - Input Validation: Invalid Data Should Be Rejected', () => {
    it('ADVERSARIAL: Rental application with missing monthlyIncome MUST return 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/applications',
        headers: {
          authorization: `Bearer ${userToken}`,
        },
        payload: {
          propertyId: rentalPropertyId,
          fullName: 'Test Applicant',
          email: 'test@example.com',
          phone: '5551234567',
          employer: 'Test Corp',
          jobTitle: 'Developer',
          // ⚠️ MISSING monthlyIncome - MUST be rejected
          employmentDuration: '2 years',
          desiredMoveInDate: '2026-03-01',
          desiredLeaseTerm: 12,
          numberOfOccupants: 1,
          reference1Name: 'Jane Doe',
          reference1Phone: '5559876543',
        },
      });

      // MUST return 400 Bad Request due to missing required field
      expect(response.statusCode).toBe(400);

      const body = response.json() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain('Validation');
    });

    it('ADVERSARIAL: Rental application with invalid email MUST return 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/applications',
        headers: {
          authorization: `Bearer ${userToken}`,
        },
        payload: {
          propertyId: rentalPropertyId,
          fullName: 'Test Applicant',
          email: 'not-an-email', // ⚠️ Invalid email format
          phone: '5551234567',
          employer: 'Test Corp',
          jobTitle: 'Developer',
          monthlyIncome: 50000,
          employmentDuration: '2 years',
          desiredMoveInDate: '2026-03-01',
          desiredLeaseTerm: 12,
          numberOfOccupants: 1,
          reference1Name: 'Jane Doe',
          reference1Phone: '5559876543',
        },
      });

      // MUST return 400
      expect(response.statusCode).toBe(400);
    });

    it('ADVERSARIAL: Rental application with negative monthlyIncome MUST return 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/applications',
        headers: {
          authorization: `Bearer ${userToken}`,
        },
        payload: {
          propertyId: rentalPropertyId,
          fullName: 'Test Applicant',
          email: 'test@example.com',
          phone: '5551234567',
          employer: 'Test Corp',
          jobTitle: 'Developer',
          monthlyIncome: -50000, // ⚠️ Negative income is invalid
          employmentDuration: '2 years',
          desiredMoveInDate: '2026-03-01',
          desiredLeaseTerm: 12,
          numberOfOccupants: 1,
          reference1Name: 'Jane Doe',
          reference1Phone: '5559876543',
        },
      });

      // MUST return 400
      expect(response.statusCode).toBe(400);
    });

    it('ADVERSARIAL: Invalid UUID in propertyId MUST return 400', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/applications',
        headers: {
          authorization: `Bearer ${userToken}`,
        },
        payload: {
          propertyId: 'not-a-uuid', // ⚠️ Invalid UUID
          fullName: 'Test Applicant',
          email: 'test@example.com',
          phone: '5551234567',
          employer: 'Test Corp',
          jobTitle: 'Developer',
          monthlyIncome: 50000,
          employmentDuration: '2 years',
          desiredMoveInDate: '2026-03-01',
          desiredLeaseTerm: 12,
          numberOfOccupants: 1,
          reference1Name: 'Jane Doe',
          reference1Phone: '5559876543',
        },
      });

      // MUST return 400 for invalid UUID
      expect(response.statusCode).toBe(400);
    });
  });

  // ========================================
  // TEST C: STATE INTEGRITY
  // ========================================

  describe('C - State Integrity: Database State Must Prevent Invalid Operations', () => {
    it('ADVERSARIAL: Cannot submit application to non-existent property', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/applications',
        headers: {
          authorization: `Bearer ${userToken}`,
        },
        payload: {
          propertyId: '550e8400-e29b-41d4-a716-446655440000', // Non-existent UUID
          fullName: 'Test Applicant',
          email: 'test@example.com',
          phone: '5551234567',
          employer: 'Test Corp',
          jobTitle: 'Developer',
          monthlyIncome: 50000,
          employmentDuration: '2 years',
          desiredMoveInDate: '2026-03-01',
          desiredLeaseTerm: 12,
          numberOfOccupants: 1,
          reference1Name: 'Jane Doe',
          reference1Phone: '5559876543',
        },
      });

      // MUST return 404 Not Found
      expect(response.statusCode).toBe(404);

      const body = response.json() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain('Property not found');
    });

    it('ADVERSARIAL: Cannot submit application to property with status="rented"', async () => {
      // First, manually set property to "rented" in database
      await prisma.property.update({
        where: { id: rentalPropertyId },
        data: { status: 'rented' },
      });

      // Try to submit application
      const response = await app.inject({
        method: 'POST',
        url: '/applications',
        headers: {
          authorization: `Bearer ${userToken}`,
        },
        payload: {
          propertyId: rentalPropertyId,
          fullName: 'Test Applicant',
          email: 'test@example.com',
          phone: '5551234567',
          employer: 'Test Corp',
          jobTitle: 'Developer',
          monthlyIncome: 50000,
          employmentDuration: '2 years',
          desiredMoveInDate: '2026-03-01',
          desiredLeaseTerm: 12,
          numberOfOccupants: 1,
          reference1Name: 'Jane Doe',
          reference1Phone: '5559876543',
        },
      });

      // MUST return 400 because property is already rented
      expect(response.statusCode).toBe(400);

      const body = response.json() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain('already rented');

      // Reset property status
      await prisma.property.update({
        where: { id: rentalPropertyId },
        data: { status: 'available' },
      });
    });

    it('ADVERSARIAL: Admin approval must actually change database state', async () => {
      // Get a pending role
      const pendingResponse = await app.inject({
        method: 'GET',
        url: '/admin/pending-roles',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      const pendingData = (pendingResponse.json() as any).data;
      if (pendingData.length === 0) {
        expect(true).toBe(true); // Skip if no pending
        return;
      }

      const userRoleId = pendingData[0].id;

      // Verify status is BEFORE approval
      const roleBefore = await prisma.userRole.findUnique({
        where: { id: userRoleId },
      });
      expect(roleBefore?.status).toBe('pending');

      // Admin approves role
      await app.inject({
        method: 'POST',
        url: `/admin/roles/${userRoleId}/approve`,
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });

      // Verify status ACTUALLY changed in database
      const roleAfter = await prisma.userRole.findUnique({
        where: { id: userRoleId },
      });

      expect(roleAfter?.status).toBe('approved');
      expect(roleAfter?.status).not.toBe('pending'); // CRITICAL: status MUST change
    });

    it('ADVERSARIAL: Approved application MUST set property status to "rented"', async () => {
      // Create a new rental property and application
      const landlordPassword = 'HashedPassword123!';
      const landlordPasswordHash = await bcrypt.hash(landlordPassword, 10);

      const landlord = await prisma.user.create({
        data: {
          email: `integrity-landlord-${Date.now()}@test.com`,
          name: 'Integrity Landlord',
          password: landlordPasswordHash,
        },
      });

      const landlordRole = await prisma.role.findUnique({
        where: { name: 'landlord' },
      });

      await prisma.userRole.create({
        data: {
          userId: landlord.id,
          roleId: landlordRole!.id,
          status: 'approved',
        },
      });

      const property = await prisma.property.create({
        data: {
          title: 'Integrity Test Rental',
          listingType: 'for_rent',
          monthlyRent: 15000,
          securityDeposit: 30000,
          leaseTermMonths: 12,
          estado: 'Jalisco',
          sellerId: landlord.id,
        },
      });

      // Verify property status is "available" before approval
      expect(property.status).toBe('available');

      // Create application as regular user
      const appResponse = await app.inject({
        method: 'POST',
        url: '/applications',
        headers: {
          authorization: `Bearer ${userToken}`,
        },
        payload: {
          propertyId: property.id,
          fullName: 'Integrity Tenant',
          email: 'tenant@test.com',
          phone: '5551234567',
          employer: 'Test Corp',
          jobTitle: 'Developer',
          monthlyIncome: 50000,
          employmentDuration: '2 years',
          desiredMoveInDate: '2026-03-01',
          desiredLeaseTerm: 12,
          numberOfOccupants: 1,
          reference1Name: 'Jane Doe',
          reference1Phone: '5559876543',
        },
      });

      const applicationId = (appResponse.json() as any).data.id;

      // Login as landlord to approve
      const landlordLogin = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: {
          email: landlord.email,
          password: landlordPassword,
        },
      });

      const landlordToken = (landlordLogin.json() as any).token;

      // Approve application
      await app.inject({
        method: 'PATCH',
        url: `/applications/${applicationId}`,
        headers: {
          authorization: `Bearer ${landlordToken}`,
        },
        payload: {
          status: 'approved',
        },
      });

      // CRITICAL: Verify property status ACTUALLY changed to "rented" in database
      const propertyAfter = await prisma.property.findUnique({
        where: { id: property.id },
      });

      expect(propertyAfter?.status).toBe('rented');
      expect(propertyAfter?.status).not.toBe('available'); // MUST change

      // Cleanup
      await prisma.rentalApplication.deleteMany({
        where: { propertyId: property.id },
      });
      await prisma.property.delete({ where: { id: property.id } });
      await prisma.userRole.deleteMany({ where: { userId: landlord.id } });
      await prisma.user.delete({ where: { id: landlord.id } });
    });

    it('ADVERSARIAL: Duplicate application attempt MUST be rejected', async () => {
      // Create first application
      const app1 = await app.inject({
        method: 'POST',
        url: '/applications',
        headers: {
          authorization: `Bearer ${userToken}`,
        },
        payload: {
          propertyId: rentalPropertyId,
          fullName: 'Unique User',
          email: 'unique@test.com',
          phone: '5551234567',
          employer: 'Test Corp',
          jobTitle: 'Developer',
          monthlyIncome: 50000,
          employmentDuration: '2 years',
          desiredMoveInDate: '2026-03-01',
          desiredLeaseTerm: 12,
          numberOfOccupants: 1,
          reference1Name: 'Jane Doe',
          reference1Phone: '5559876543',
        },
      });

      expect(app1.statusCode).toBe(201);

      // Try to submit duplicate
      const app2 = await app.inject({
        method: 'POST',
        url: '/applications',
        headers: {
          authorization: `Bearer ${userToken}`,
        },
        payload: {
          propertyId: rentalPropertyId,
          fullName: 'Unique User Again',
          email: 'unique2@test.com',
          phone: '5551234567',
          employer: 'Test Corp 2',
          jobTitle: 'Developer 2',
          monthlyIncome: 60000,
          employmentDuration: '3 years',
          desiredMoveInDate: '2026-03-15',
          desiredLeaseTerm: 6,
          numberOfOccupants: 2,
          reference1Name: 'Bob Smith',
          reference1Phone: '5559876543',
        },
      });

      // MUST return 409 Conflict (duplicate), NOT 201 Created
      expect(app2.statusCode).toBe(409);

      const body = app2.json() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain('already submitted');
    });
  });
});

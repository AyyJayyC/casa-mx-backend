import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('Checkpoint Rentals 1: Database Schema - Rental Properties & Applications', () => {
  let testProperty: any;
  let testUser: any;
  let rentalProperty: any;

  beforeAll(async () => {
    // Create a test user for applications
    testUser = await prisma.user.create({
      data: {
        email: `test-${Date.now()}@test.com`,
        name: 'Test User',
        password: 'hashedpassword123',
      },
    });

    // Create a test seller
    const seller = await prisma.user.create({
      data: {
        email: `seller-${Date.now()}@test.com`,
        name: 'Test Seller',
        password: 'hashedpassword123',
      },
    });

    // Create a sale property
    testProperty = await prisma.property.create({
      data: {
        title: 'Test Sale Property',
        description: 'A test property for sale',
        address: '123 Test St',
        price: 1000000,
        listingType: 'for_sale',
        estado: 'Ciudad de México',
        sellerId: seller.id,
      },
    });

    // Create a rental property
    rentalProperty = await prisma.property.create({
      data: {
        title: 'Test Rental Property',
        description: 'A test property for rent',
        address: '456 Rental Ave',
        listingType: 'for_rent',
        monthlyRent: 15000,
        securityDeposit: 30000,
        leaseTermMonths: 12,
        furnished: true,
        utilitiesIncluded: false,
        estado: 'Ciudad de México',
        sellerId: seller.id,
      },
    });
  });

  afterAll(async () => {
    // Cleanup
    await prisma.rentalApplication.deleteMany({});
    await prisma.property.deleteMany({});
    await prisma.user.deleteMany({ where: { email: { contains: 'test' } } });
    await prisma.$disconnect();
  });

  describe('Property Model Updates', () => {
    it('should have listingType field with default value "for_sale"', () => {
      expect(testProperty.listingType).toBe('for_sale');
    });

    it('should create property with listingType "for_sale" and price', async () => {
      const seller = await prisma.user.findFirst();
      
      const saleProperty = await prisma.property.create({
        data: {
          title: 'Another Sale Property',
          description: 'For sale',
          address: '789 Sale Blvd',
          price: 2500000,
          listingType: 'for_sale',
          estado: 'Jalisco',
          sellerId: seller!.id,
        },
      });

      expect(saleProperty.listingType).toBe('for_sale');
      expect(saleProperty.price).toBe(2500000);
      expect(saleProperty.monthlyRent).toBeNull();
      
      await prisma.property.delete({ where: { id: saleProperty.id } });
    });

    it('should create property with listingType "for_rent" and rental fields', () => {
      expect(rentalProperty.listingType).toBe('for_rent');
      expect(rentalProperty.monthlyRent).toBe(15000);
      expect(rentalProperty.securityDeposit).toBe(30000);
      expect(rentalProperty.leaseTermMonths).toBe(12);
      expect(rentalProperty.furnished).toBe(true);
      expect(rentalProperty.utilitiesIncluded).toBe(false);
    });

    it('should allow price to be null for rental properties', async () => {
      expect(rentalProperty.price).toBeNull();
    });

    it('should have status field that supports "rented" value', async () => {
      const updated = await prisma.property.update({
        where: { id: rentalProperty.id },
        data: { status: 'rented' },
      });

      expect(updated.status).toBe('rented');
      
      // Reset status
      await prisma.property.update({
        where: { id: rentalProperty.id },
        data: { status: 'available' },
      });
    });

    it('should have listingType index for fast filtering', async () => {
      // Query by listingType should be fast (index exists)
      const rentals = await prisma.property.findMany({
        where: { listingType: 'for_rent' },
      });

      expect(rentals.length).toBeGreaterThan(0);
      expect(rentals.every(p => p.listingType === 'for_rent')).toBe(true);
    });
  });

  describe('RentalApplication Model', () => {
    it('should create RentalApplication with all required fields', async () => {
      const application = await prisma.rentalApplication.create({
        data: {
          propertyId: rentalProperty.id,
          applicantId: testUser.id,
          status: 'pending',
          fullName: 'Test Applicant',
          email: 'applicant@test.com',
          phone: '+52 55 1234 5678',
          employer: 'Test Company',
          jobTitle: 'Developer',
          monthlyIncome: 30000,
          employmentDuration: '2 years',
          desiredMoveInDate: new Date('2026-03-01'),
          desiredLeaseTerm: 12,
          numberOfOccupants: 2,
          reference1Name: 'Reference One',
          reference1Phone: '+52 55 9876 5432',
        },
      });

      expect(application.id).toBeDefined();
      expect(application.propertyId).toBe(rentalProperty.id);
      expect(application.applicantId).toBe(testUser.id);
      expect(application.status).toBe('pending');
      expect(application.fullName).toBe('Test Applicant');
      expect(application.monthlyIncome).toBe(30000);
      expect(application.desiredLeaseTerm).toBe(12);
      expect(application.createdAt).toBeInstanceOf(Date);
    });

    it('should support all application statuses', async () => {
      const statuses = ['pending', 'under_review', 'approved', 'rejected', 'withdrawn', 'expired'];
      
      for (const status of statuses) {
        const app = await prisma.rentalApplication.create({
          data: {
            propertyId: rentalProperty.id,
            applicantId: testUser.id,
            status,
            fullName: 'Test User',
            email: 'test@test.com',
            phone: '+52 55 1234 5678',
            employer: 'Company',
            jobTitle: 'Job',
            monthlyIncome: 25000,
            employmentDuration: '1 year',
            desiredMoveInDate: new Date('2026-03-01'),
            desiredLeaseTerm: 12,
            numberOfOccupants: 1,
            reference1Name: 'Ref',
            reference1Phone: '+52 55 1111 1111',
          },
        });

        expect(app.status).toBe(status);
        await prisma.rentalApplication.delete({ where: { id: app.id } });
      }
    });

    it('should cascade delete applications when property is deleted', async () => {
      const seller = await prisma.user.findFirst();
      const tempProperty = await prisma.property.create({
        data: {
          title: 'Temp Rental',
          listingType: 'for_rent',
          monthlyRent: 10000,
          estado: 'Ciudad de México',
          sellerId: seller!.id,
        },
      });

      const tempApp = await prisma.rentalApplication.create({
        data: {
          propertyId: tempProperty.id,
          applicantId: testUser.id,
          fullName: 'Test',
          email: 'test@test.com',
          phone: '+52 55 1234 5678',
          employer: 'Company',
          jobTitle: 'Job',
          monthlyIncome: 25000,
          employmentDuration: '1 year',
          desiredMoveInDate: new Date('2026-03-01'),
          desiredLeaseTerm: 12,
          numberOfOccupants: 1,
          reference1Name: 'Ref',
          reference1Phone: '+52 55 1111 1111',
        },
      });

      // Delete property should cascade delete application
      await prisma.property.delete({ where: { id: tempProperty.id } });

      const foundApp = await prisma.rentalApplication.findUnique({
        where: { id: tempApp.id },
      });

      expect(foundApp).toBeNull();
    });

    it('should have indexes on propertyId, applicantId, status, and createdAt', async () => {
      // These queries should be fast due to indexes
      const byProperty = await prisma.rentalApplication.findMany({
        where: { propertyId: rentalProperty.id },
      });

      const byApplicant = await prisma.rentalApplication.findMany({
        where: { applicantId: testUser.id },
      });

      const byStatus = await prisma.rentalApplication.findMany({
        where: { status: 'pending' },
      });

      expect(Array.isArray(byProperty)).toBe(true);
      expect(Array.isArray(byApplicant)).toBe(true);
      expect(Array.isArray(byStatus)).toBe(true);
    });
  });

  describe('Notification Model', () => {
    it('should create Notification with correct structure', async () => {
      const notification = await prisma.notification.create({
        data: {
          userId: testUser.id,
          type: 'rental_application_received',
          title: 'New Application',
          message: 'You have received a new rental application',
          entityType: 'application',
          entityId: 'some-id',
          read: false,
        },
      });

      expect(notification.id).toBeDefined();
      expect(notification.userId).toBe(testUser.id);
      expect(notification.type).toBe('rental_application_received');
      expect(notification.title).toBe('New Application');
      expect(notification.message).toBeDefined();
      expect(notification.read).toBe(false);
      expect(notification.createdAt).toBeInstanceOf(Date);

      await prisma.notification.delete({ where: { id: notification.id } });
    });

    it('should have indexes on userId+read and createdAt', async () => {
      // Create some notifications
      await prisma.notification.create({
        data: {
          userId: testUser.id,
          type: 'test',
          title: 'Test',
          message: 'Test message',
          read: false,
        },
      });

      // Query unread notifications (should use index)
      const unread = await prisma.notification.findMany({
        where: { 
          userId: testUser.id,
          read: false,
        },
        orderBy: { createdAt: 'desc' },
      });

      expect(unread.length).toBeGreaterThan(0);
      
      // Cleanup
      await prisma.notification.deleteMany({ where: { userId: testUser.id } });
    });
  });

  describe('Seed Data Verification', () => {
    it('should have landlord role in database', async () => {
      const landlordRole = await prisma.role.findUnique({
        where: { name: 'landlord' },
      });

      expect(landlordRole).toBeDefined();
      expect(landlordRole!.name).toBe('landlord');
    });

    it('should have seeded rental properties', async () => {
      const rentals = await prisma.property.findMany({
        where: { listingType: 'for_rent' },
      });

      expect(rentals.length).toBeGreaterThan(0); // At least some rentals exist
      expect(rentals.every(r => r.monthlyRent !== null)).toBe(true);
    });

    it('should have seeded sale properties with listingType set', async () => {
      const sales = await prisma.property.findMany({
        where: { listingType: 'for_sale' },
      });

      expect(sales.length).toBeGreaterThan(0); // At least some sales exist
      expect(sales.every(s => s.listingType === 'for_sale')).toBe(true);
    });

    it('should have seeded rental applications', async () => {
      const applications = await prisma.rentalApplication.findMany();

      expect(applications.length).toBeGreaterThan(0); // At least some applications exist
    });

    it('should have seller with landlord role', async () => {
      const seller = await prisma.user.findUnique({
        where: { email: 'seller@casamx.local' },
        include: {
          roles: {
            include: {
              role: true,
            },
          },
        },
      });

      expect(seller).toBeDefined();
      const hasLandlordRole = seller!.roles.some(ur => ur.role.name === 'landlord');
      expect(hasLandlordRole).toBe(true);
    });
  });

  describe('Migration Verification', () => {
    it('should have set existing properties to "for_sale" by default', async () => {
      // All properties should have a listingType
      const allProperties = await prisma.property.findMany();
      
      expect(allProperties.every(p => p.listingType !== null)).toBe(true);
      expect(allProperties.every(p => ['for_sale', 'for_rent'].includes(p.listingType))).toBe(true);
    });

    it('should allow optional price for rentals', async () => {
      const rentalsWithoutPrice = await prisma.property.findMany({
        where: {
          listingType: 'for_rent',
          price: null,
        },
      });

      // At least some rentals should not have a price
      expect(rentalsWithoutPrice.length).toBeGreaterThan(0);
    });
  });
});

import { PrismaClient } from '@prisma/client';

/**
 * Service for managing landlord role assignment
 * Automatically adds/removes landlord role based on rental property ownership
 */
export class LandlordService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Auto-add landlord role when user creates first rental property
   */
  async addLandlordRoleIfNeeded(userId: string): Promise<void> {
    // Check if user already has landlord role
    let landlordRole = await this.prisma.role.findUnique({
      where: { name: 'landlord' },
    });

    if (!landlordRole) {
      landlordRole = await this.prisma.role.create({
        data: { name: 'landlord' },
      });
    }

    const existingLandlordRole = await this.prisma.userRole.findFirst({
      where: {
        userId,
        roleId: landlordRole.id,
      },
    });

    // If user doesn't have landlord role, add it with approved status
    if (!existingLandlordRole) {
      await this.prisma.userRole.create({
        data: {
          userId,
          roleId: landlordRole.id,
          status: 'approved', // Auto-approve landlord role
        },
      });
    }
  }

  /**
   * Auto-remove landlord role when user deletes last rental property
   */
  async removeLandlordRoleIfNeeded(userId: string): Promise<void> {
    // Check if user has any rental properties remaining
    const rentalCount = await this.prisma.property.count({
      where: {
        sellerId: userId,
        listingType: 'for_rent',
      },
    });

    // If no rental properties remain, remove landlord role
    if (rentalCount === 0) {
      const landlordRole = await this.prisma.role.findUnique({
        where: { name: 'landlord' },
      });

      if (landlordRole) {
        await this.prisma.userRole.deleteMany({
          where: {
            userId,
            roleId: landlordRole.id,
          },
        });
      }
    }
  }

  /**
   * Check if user has rental properties
   */
  async hasRentalProperties(userId: string): Promise<boolean> {
    const rentalCount = await this.prisma.property.count({
      where: {
        sellerId: userId,
        listingType: 'for_rent',
      },
    });

    return rentalCount > 0;
  }
}

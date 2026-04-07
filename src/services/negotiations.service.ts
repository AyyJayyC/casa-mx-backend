import { PrismaClient } from '@prisma/client';

export class NegotiationsService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Get all negotiation offers for a given application.
   */
  async getOffers(applicationId: string) {
    return this.prisma.negotiationOffer.findMany({
      where: { applicationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Submit a new offer for a rental application.
   * The application status is updated to 'negotiating'.
   * Any previously pending offer by the other party is superseded.
   */
  async submitOffer(
    applicationId: string,
    offerByUserId: string,
    offerByRole: 'landlord' | 'tenant',
    proposedRent: number,
    proposedDeposit: number,
    proposedServices: string[],
    proposedLeaseTerm: number | undefined,
    message: string | undefined,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const application = await tx.rentalApplication.findUnique({
        where: { id: applicationId },
        include: { property: true },
      });

      if (!application) {
        throw new Error('Application not found');
      }

      // Validate authorization
      const otherRole = offerByRole === 'landlord' ? 'tenant' : 'landlord';

      // Supersede any pending offer from the other party
      await tx.negotiationOffer.updateMany({
        where: {
          applicationId,
          offerByRole: otherRole,
          status: 'pending',
        },
        data: { status: 'superseded' },
      });

      // Create new offer
      const offer = await tx.negotiationOffer.create({
        data: {
          applicationId,
          offerByUserId,
          offerByRole,
          proposedRent,
          proposedDeposit,
          proposedServices,
          proposedLeaseTerm,
          message,
          status: 'pending',
        },
      });

      // Update application status to negotiating
      await tx.rentalApplication.update({
        where: { id: applicationId },
        data: {
          status: 'negotiating',
          proposedRent,
          proposedDeposit,
          proposedServices,
        },
      });

      return offer;
    });
  }

  /**
   * Accept the latest pending offer on an application.
   * - If tenant accepts landlord offer: application moves to 'approved'.
   * - If landlord accepts tenant offer: application moves to 'approved'.
   */
  async acceptOffer(
    offerId: string,
    acceptingUserId: string,
    acceptingRole: 'landlord' | 'tenant',
  ) {
    return this.prisma.$transaction(async (tx) => {
      const offer = await tx.negotiationOffer.findUnique({
        where: { id: offerId },
        include: { application: { include: { property: true } } },
      });

      if (!offer) throw new Error('Offer not found');
      if (offer.status !== 'pending') throw new Error('Offer is no longer pending');
      if (offer.offerByRole === acceptingRole) {
        throw new Error('Cannot accept your own offer');
      }

      await tx.negotiationOffer.update({
        where: { id: offerId },
        data: { status: 'accepted', respondedAt: new Date() },
      });

      // Finalize application with agreed terms
      const updatedApp = await tx.rentalApplication.update({
        where: { id: offer.applicationId },
        data: {
          status: 'approved',
          proposedRent: offer.proposedRent,
          proposedDeposit: offer.proposedDeposit,
          proposedServices: offer.proposedServices,
        },
      });

      // Auto-reject other applications for the same property when landlord approves
      if (acceptingRole === 'landlord') {
        await tx.rentalApplication.updateMany({
          where: {
            propertyId: offer.application.propertyId,
            id: { not: offer.applicationId },
            status: { in: ['pending', 'under_review', 'negotiating'] },
          },
          data: {
            status: 'rejected',
            landlordNote: 'Another application was approved for this property',
          },
        });

        await tx.property.update({
          where: { id: offer.application.propertyId },
          data: { status: 'rented' },
        });
      }

      return updatedApp;
    });
  }

  /**
   * Reject/decline a pending offer.
   * The application returns to 'under_review'.
   */
  async rejectOffer(
    offerId: string,
    rejectingUserId: string,
    rejectingRole: 'landlord' | 'tenant',
  ) {
    return this.prisma.$transaction(async (tx) => {
      const offer = await tx.negotiationOffer.findUnique({
        where: { id: offerId },
      });

      if (!offer) throw new Error('Offer not found');
      if (offer.status !== 'pending') throw new Error('Offer is no longer pending');
      if (offer.offerByRole === rejectingRole) {
        throw new Error('Cannot reject your own offer');
      }

      await tx.negotiationOffer.update({
        where: { id: offerId },
        data: { status: 'rejected', respondedAt: new Date() },
      });

      // Move application back to under_review
      await tx.rentalApplication.update({
        where: { id: offer.applicationId },
        data: { status: 'under_review' },
      });

      return { success: true };
    });
  }
}

import { PrismaClient } from '@prisma/client';
import { CreateReviewInput } from '../schemas/reviews.js';
import { computeBadgeFlags } from '../utils/badges.js';

export class ReviewsService {
  constructor(private prisma: PrismaClient) {}

  async createReview(reviewerUserId: string, input: CreateReviewInput) {
    const application = await this.prisma.rentalApplication.findUnique({
      where: { id: input.rentalApplicationId },
      include: {
        property: {
          select: {
            id: true,
            sellerId: true,
            title: true,
          },
        },
      },
    });

    if (!application) {
      throw new Error('Rental application not found');
    }

    if (application.status !== 'approved') {
      throw new Error('Reviews are only allowed for approved rental applications');
    }

    const relationship = this.resolveReviewRelationship(reviewerUserId, input.reviewerRole, application.applicantId, application.property.sellerId);

    const existingReview = await this.prisma.review.findUnique({
      where: {
        reviewerUserId_revieweeUserId_rentalApplicationId: {
          reviewerUserId,
          revieweeUserId: relationship.revieweeUserId,
          rentalApplicationId: application.id,
        },
      },
      select: { id: true },
    });

    if (existingReview) {
      throw new Error('You have already reviewed this user for the selected rental application');
    }

    const review = await this.prisma.review.create({
      data: {
        reviewerUserId,
        revieweeUserId: relationship.revieweeUserId,
        reviewerRole: input.reviewerRole,
        revieweeRole: relationship.revieweeRole,
        propertyId: application.propertyId,
        rentalApplicationId: application.id,
        overallRating: input.overallRating,
        comment: input.comment,
        status: 'published',
        categoryScores: {
          create: input.categoryScores.map((item) => ({
            category: item.category,
            score: item.score,
          })),
        },
      },
      include: {
        categoryScores: true,
      },
    });

    return review;
  }

  async getUserReviews(userId: string, role?: 'tenant' | 'landlord') {
    const reviews = await this.prisma.review.findMany({
      where: {
        revieweeUserId: userId,
        status: 'published',
        ...(role ? { revieweeRole: role } : {}),
      },
      include: {
        categoryScores: true,
        reviewer: {
          select: {
            id: true,
            name: true,
            userDocuments: {
              where: { documentType: 'official_id' },
              select: { documentType: true, isVerified: true },
            },
            subscription: {
              select: { status: true, currentPeriodEnd: true },
            },
          },
        },
        property: {
          select: {
            id: true,
            title: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return reviews.map((review) => {
      const reviewerBadges = computeBadgeFlags(review.reviewer as any);
      return {
        ...review,
        reviewer: {
          id: review.reviewer.id,
          name: review.reviewer.name,
          officialIdUploaded: reviewerBadges.officialIdUploaded,
          officialIdVerified: reviewerBadges.officialIdVerified,
          paidSubscriber: reviewerBadges.paidSubscriber,
          subscriptionStatus: reviewerBadges.subscriptionStatus,
        },
      };
    });
  }

  async getAuthoredReviews(userId: string, role?: 'tenant' | 'landlord') {
    return this.prisma.review.findMany({
      where: {
        reviewerUserId: userId,
        ...(role ? { reviewerRole: role } : {}),
      },
      include: {
        categoryScores: true,
        reviewee: {
          select: {
            id: true,
            name: true,
          },
        },
        property: {
          select: {
            id: true,
            title: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getReviewSummary(userId: string, role?: 'tenant' | 'landlord') {
    const reviews = await this.getUserReviews(userId, role);

    const totalReviews = reviews.length;
    const averageRating = totalReviews > 0
      ? Number((reviews.reduce((sum, review) => sum + review.overallRating, 0) / totalReviews).toFixed(2))
      : null;

    const categoryBuckets = new Map<string, { total: number; count: number }>();

    reviews.forEach((review) => {
      review.categoryScores.forEach((categoryScore) => {
        const existing = categoryBuckets.get(categoryScore.category) ?? { total: 0, count: 0 };
        existing.total += categoryScore.score;
        existing.count += 1;
        categoryBuckets.set(categoryScore.category, existing);
      });
    });

    const categoryAverages = Array.from(categoryBuckets.entries()).map(([category, value]) => ({
      category,
      average: Number((value.total / value.count).toFixed(2)),
      count: value.count,
    }));

    return {
      userId,
      role: role ?? null,
      totalReviews,
      averageRating,
      categoryAverages,
      recentReviews: reviews.slice(0, 5),
    };
  }

  private resolveReviewRelationship(
    reviewerUserId: string,
    reviewerRole: 'tenant' | 'landlord',
    applicantId: string,
    landlordId: string
  ) {
    if (reviewerRole === 'tenant') {
      if (reviewerUserId !== applicantId) {
        throw new Error('Only the approved tenant can review the landlord for this application');
      }

      return {
        revieweeUserId: landlordId,
        revieweeRole: 'landlord' as const,
      };
    }

    if (reviewerUserId !== landlordId) {
      throw new Error('Only the property landlord can review the tenant for this application');
    }

    return {
      revieweeUserId: applicantId,
      revieweeRole: 'tenant' as const,
    };
  }
}

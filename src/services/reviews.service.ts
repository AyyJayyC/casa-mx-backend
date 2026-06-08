import { PrismaClient } from "@prisma/client";
import { CreateReviewInput } from "../schemas/reviews.js";

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
      throw new Error("Rental application not found");
    }

    if (application.status !== "approved") {
      throw new Error(
        "Reviews are only allowed for approved rental applications",
      );
    }

    const relationship = this.resolveReviewRelationship(
      reviewerUserId,
      input.reviewerRole,
      application.applicantId,
      application.property.sellerId,
    );

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
      throw new Error(
        "You have already reviewed this user for the selected rental application",
      );
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
        status: "published",
      },
    });

    return review;
  }

  async getUserReviews(userId: string, role?: "tenant" | "landlord") {
    return this.prisma.review.findMany({
      where: {
        revieweeUserId: userId,
        status: "published",
        ...(role ? { revieweeRole: role } : {}),
      },
      include: {
        reviewer: {
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
      orderBy: { createdAt: "desc" },
    });
  }

  async getAuthoredReviews(userId: string, role?: "tenant" | "landlord") {
    return this.prisma.review.findMany({
      where: {
        reviewerUserId: userId,
        ...(role ? { reviewerRole: role } : {}),
      },
      include: {
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
      orderBy: { createdAt: "desc" },
    });
  }

  async getReviewSummary(userId: string, role?: "tenant" | "landlord") {
    const reviews = await this.getUserReviews(userId, role);

    const totalReviews = reviews.length;
    const averageRating =
      totalReviews > 0
        ? Number(
            (
              reviews.reduce((sum, review) => sum + review.overallRating, 0) /
              totalReviews
            ).toFixed(2),
          )
        : null;

    return {
      userId,
      role: role ?? null,
      totalReviews,
      averageRating,
      recentReviews: reviews.slice(0, 5),
    };
  }

  private resolveReviewRelationship(
    reviewerUserId: string,
    reviewerRole: "tenant" | "landlord",
    applicantId: string,
    landlordId: string,
  ) {
    if (reviewerRole === "tenant") {
      if (reviewerUserId !== applicantId) {
        throw new Error(
          "Only the approved tenant can review the landlord for this application",
        );
      }

      return {
        revieweeUserId: landlordId,
        revieweeRole: "landlord" as const,
      };
    }

    if (reviewerUserId !== landlordId) {
      throw new Error(
        "Only the property landlord can review the tenant for this application",
      );
    }

    return {
      revieweeUserId: applicantId,
      revieweeRole: "tenant" as const,
    };
  }
}

import { z } from 'zod';

const tenantReviewCategories = [
  'communication',
  'payment_reliability',
  'property_care',
  'lease_compliance',
  'overall_reliability',
] as const;

const landlordReviewCategories = [
  'communication',
  'listing_accuracy',
  'fairness',
  'maintenance_responsiveness',
  'move_in_experience',
] as const;

export const reviewRoleSchema = z.enum(['tenant', 'landlord']);

export const reviewCategorySchema = z.object({
  category: z.string().min(1, 'Category is required'),
  score: z.number().int().min(1, 'Score must be at least 1').max(5, 'Score must be at most 5'),
});

export const createReviewSchema = z
  .object({
    rentalApplicationId: z.string().uuid('Invalid rental application ID'),
    overallRating: z.number().int().min(1, 'Overall rating must be at least 1').max(5, 'Overall rating must be at most 5'),
    comment: z.string().trim().min(10, 'Comment must be at least 10 characters').max(1000, 'Comment must be at most 1000 characters').optional(),
    reviewerRole: reviewRoleSchema,
    categoryScores: z.array(reviewCategorySchema).min(1, 'At least one category score is required').max(5, 'Too many category scores'),
  })
  .superRefine((value, ctx) => {
    const allowedCategories = value.reviewerRole === 'landlord' ? tenantReviewCategories : landlordReviewCategories;
    const seen = new Set<string>();

    value.categoryScores.forEach((item, index) => {
      if (!allowedCategories.includes(item.category as never)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['categoryScores', index, 'category'],
          message: `Category '${item.category}' is not valid for ${value.reviewerRole} reviews`,
        });
      }

      if (seen.has(item.category)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['categoryScores', index, 'category'],
          message: `Duplicate category '${item.category}' is not allowed`,
        });
      }

      seen.add(item.category);
    });

    if (value.overallRating <= 2 && (!value.comment || value.comment.trim().length < 20)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['comment'],
        message: 'A detailed comment is required for ratings of 2 stars or below',
      });
    }
  });

export const reviewUserParamsSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
});

export const reviewSummaryQuerySchema = z.object({
  role: reviewRoleSchema.optional(),
});

export type CreateReviewInput = z.infer<typeof createReviewSchema>;

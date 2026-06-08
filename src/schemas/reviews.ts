import { z } from "zod";

export const reviewRoleSchema = z.enum(["tenant", "landlord"]);

export const createReviewSchema = z
  .object({
    rentalApplicationId: z.string().uuid("Invalid rental application ID"),
    overallRating: z
      .number()
      .int()
      .min(1, "Overall rating must be at least 1")
      .max(5, "Overall rating must be at most 5"),
    comment: z
      .string()
      .trim()
      .min(10, "Comment must be at least 10 characters")
      .max(1000, "Comment must be at most 1000 characters")
      .optional(),
    reviewerRole: reviewRoleSchema,
  })
  .superRefine((value, ctx) => {
    if (
      value.overallRating <= 2 &&
      (!value.comment || value.comment.trim().length < 20)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["comment"],
        message:
          "A detailed comment is required for ratings of 2 stars or below",
      });
    }
  });

export const reviewUserParamsSchema = z.object({
  userId: z.string().uuid("Invalid user ID"),
});

export const reviewSummaryQuerySchema = z.object({
  role: reviewRoleSchema.optional(),
});

export type CreateReviewInput = z.infer<typeof createReviewSchema>;

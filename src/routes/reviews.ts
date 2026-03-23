import { FastifyPluginAsync } from 'fastify';
import { verifyJWT, requireAnyRole } from '../utils/guards.js';
import { z } from 'zod';
import { createReviewSchema, reviewSummaryQuerySchema, reviewUserParamsSchema } from '../schemas/reviews.js';
import { ReviewsService } from '../services/reviews.service.js';

const reviewsRoutes: FastifyPluginAsync = async (fastify) => {
  const reviewsService = new ReviewsService(fastify.prisma);

  fastify.post(
    '/reviews',
    { onRequest: [verifyJWT, requireAnyRole(['tenant', 'landlord'])] },
    async (request, reply) => {
      try {
        const input = createReviewSchema.parse(request.body);
        const review = await reviewsService.createReview(request.user.id, input);

        return reply.code(201).send({
          success: true,
          data: review,
          message: 'Review submitted successfully',
        });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            details: error.errors,
          });
        }

        if (error instanceof Error) {
          const statusCode = thisIsClientError(error.message) ? 400 : 500;
          return reply.code(statusCode).send({
            success: false,
            error: error.message,
          });
        }

        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: 'Failed to submit review',
        });
      }
    }
  );

  fastify.get('/reviews/user/:userId', async (request, reply) => {
    try {
      const params = reviewUserParamsSchema.parse(request.params);
      const query = reviewSummaryQuerySchema.parse(request.query);
      const reviews = await reviewsService.getUserReviews(params.userId, query.role);

      return reply.send({
        success: true,
        data: reviews,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          success: false,
          error: 'Validation error',
          details: error.errors,
        });
      }

      fastify.log.error(error);
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch reviews',
      });
    }
  });

  fastify.get('/reviews/summary/:userId', async (request, reply) => {
    try {
      const params = reviewUserParamsSchema.parse(request.params);
      const query = reviewSummaryQuerySchema.parse(request.query);
      const summary = await reviewsService.getReviewSummary(params.userId, query.role);

      return reply.send({
        success: true,
        data: summary,
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          success: false,
          error: 'Validation error',
          details: error.errors,
        });
      }

      fastify.log.error(error);
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch review summary',
      });
    }
  });
};

function thisIsClientError(message: string) {
  return [
    'Rental application not found',
    'Reviews are only allowed for approved rental applications',
    'You have already reviewed this user for the selected rental application',
    'Only the approved tenant can review the landlord for this application',
    'Only the property landlord can review the tenant for this application',
  ].includes(message);
}

export default reviewsRoutes;

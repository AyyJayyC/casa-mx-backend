import { FastifyPluginAsync } from 'fastify';
import { verifyJWT, requireAnyRole } from '../utils/guards.js';
import { z } from 'zod';
import { createReviewSchema, reviewSummaryQuerySchema, reviewUserParamsSchema } from '../schemas/reviews.js';
import { ReviewsService } from '../services/reviews.service.js';
import { isClientError } from '../utils/errorClassification.js';

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
          const statusCode = isClientError(error.message) ? 400 : 500;
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

  fastify.get(
    '/reviews/mine',
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const query = reviewSummaryQuerySchema.parse(request.query);
        const reviews = await reviewsService.getAuthoredReviews(request.user.id, query.role);

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
          error: 'Failed to fetch authored reviews',
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

export default reviewsRoutes;

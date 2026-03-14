import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { verifyJWT } from '../utils/guards.js';

const createRequestSchema = z.object({
  propertyId: z.string().min(1),
  name: z.string().min(2).optional(),
  phone: z.string().min(7).optional(),
  message: z.string().optional(),
});

const requestsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/requests', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      const user = (request as any).user;
      const input = createRequestSchema.parse(request.body);

      const property = await fastify.prisma.property.findUnique({
        where: { id: input.propertyId },
        select: { id: true },
      });

      if (!property) {
        return reply.code(404).send({
          success: false,
          error: 'Property not found',
        });
      }

      const composedMessage = [
        input.name ? `Nombre: ${input.name}` : null,
        input.phone ? `Teléfono: ${input.phone}` : null,
        input.message ? `Mensaje: ${input.message}` : null,
      ]
        .filter(Boolean)
        .join('\n');

      const created = await fastify.prisma.propertyRequest.create({
        data: {
          propertyId: input.propertyId,
          buyerId: user.id,
          message: composedMessage || null,
          status: 'pending',
        },
      });

      return reply.code(201).send({
        success: true,
        data: created,
        message: 'Request submitted successfully',
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          success: false,
          error: 'Validation error',
          details: error.errors,
        });
      }

      if (error?.code === 'P2002') {
        return reply.code(409).send({
          success: false,
          error: 'You have already requested information for this property',
        });
      }

      fastify.log.error(error);
      return reply.code(500).send({
        success: false,
        error: 'Failed to submit request',
      });
    }
  });

  fastify.get('/requests', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      const user = (request as any).user;

      const requests = await fastify.prisma.propertyRequest.findMany({
        where: { buyerId: user.id },
        include: {
          property: {
            select: {
              id: true,
              title: true,
              colonia: true,
              listingType: true,
              price: true,
              monthlyRent: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return reply.code(200).send({
        success: true,
        data: requests,
      });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({
        success: false,
        error: 'Failed to fetch requests',
      });
    }
  });
};

export default requestsRoutes;

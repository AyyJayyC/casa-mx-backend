import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { verifyJWT } from "../utils/guards.js";

const createRequestSchema = z.object({
  propertyId: z.string().min(1),
  name: z.string().min(2, "El nombre es requerido"),
  phone: z.string().min(7, "El teléfono es requerido"),
  message: z.string().optional(),
});

const requestsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/requests",
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const user = (request as any).user;
        const input = createRequestSchema.parse(request.body);

        const property = await fastify.prisma.property.findUnique({
          where: { id: input.propertyId },
          select: { id: true, sellerId: true },
        });

        if (!property) {
          return reply.code(404).send({
            success: false,
            error: "Property not found",
          });
        }

        const created = await fastify.prisma.propertyRequest.create({
          data: {
            propertyId: input.propertyId,
            buyerId: user.id,
            name: input.name,
            phone: input.phone,
            message: input.message || null,
            status: "pending",
          },
        });

        return reply.code(201).send({
          success: true,
          data: created,
          message: "Request submitted successfully",
        });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            success: false,
            error: "Validation error",
            details: error.errors,
          });
        }

        if (error?.code === "P2002") {
          return reply.code(409).send({
            success: false,
            error: "You have already requested information for this property",
          });
        }

        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: "Failed to submit request",
        });
      }
    },
  );

  fastify.get(
    "/requests",
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const user = (request as any).user;

        const requests = await fastify.prisma.propertyRequest.findMany({
          where: { buyerId: user.id },
          include: {
            property: {
              select: {
                id: true,
                title: true,
                address: true,
                colonia: true,
                listingType: true,
                price: true,
                monthlyRent: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
        });

        return reply.code(200).send({
          success: true,
          data: requests,
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: "Failed to fetch requests",
        });
      }
    },
  );

  fastify.get(
    "/requests/seller",
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const user = (request as any).user;

        const requests = await fastify.prisma.propertyRequest.findMany({
          where: { property: { sellerId: user.id } },
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
          orderBy: { createdAt: "desc" },
        });

        return reply.code(200).send({
          success: true,
          data: requests,
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: "Failed to fetch seller requests",
        });
      }
    },
  );

  fastify.post(
    "/requests/:id/approve",
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const user = (request as any).user;
        const { id } = request.params as { id: string };

        const req = await fastify.prisma.propertyRequest.findUnique({
          where: { id },
          include: {
            property: {
              select: { sellerId: true, address: true, mapsUrl: true },
            },
          },
        });

        if (!req) {
          return reply
            .code(404)
            .send({ success: false, error: "Solicitud no encontrada" });
        }

        if (req.property.sellerId !== user.id) {
          return reply
            .code(403)
            .send({ success: false, error: "No autorizado" });
        }

        if (req.status === "contacted") {
          return reply
            .code(409)
            .send({ success: false, error: "La solicitud ya fue aprobada" });
        }

        await fastify.prisma.propertyRequest.update({
          where: { id },
          data: { status: "contacted" },
        });

        return reply.code(200).send({
          success: true,
          message: "Dirección revelada al comprador",
          address: req.property.address,
          mapsUrl: req.property.mapsUrl,
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: "Failed to approve request",
        });
      }
    },
  );
};

export default requestsRoutes;

import { FastifyPluginAsync } from "fastify";
import { verifyJWT } from "../utils/guards.js";
import { createBuyerSchema, updateBuyerSchema } from "../schemas/buyers.js";
import {
  isZodError,
  createValidationErrorResponse,
} from "../utils/errorHandling.js";

const buyersRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /buyers — list buyers for the authenticated user
  fastify.get("/buyers", { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      const user = (request as any).user;
      const buyers = await fastify.prisma.buyer.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
      });
      return reply.send({ success: true, data: buyers });
    } catch (error: any) {
      fastify.log.error(error);
      return reply
        .code(500)
        .send({ success: false, error: "Failed to fetch buyers" });
    }
  });

  // POST /buyers — create a new buyer
  fastify.post(
    "/buyers",
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const user = (request as any).user;
        const body = createBuyerSchema.parse(request.body);
        const buyer = await fastify.prisma.buyer.create({
          data: {
            name: body.name,
            phone: body.phone ?? null,
            email: body.email ?? null,
            budgetMin: body.budgetMin ?? null,
            budgetMax: body.budgetMax ?? null,
            preferredZones: body.preferredZones ?? [],
            propertyType: body.propertyType ?? null,
            notes: body.notes ?? null,
            userId: user.id,
          },
        });
        return reply.code(201).send({ success: true, data: buyer });
      } catch (error: any) {
        if (isZodError(error)) {
          return reply.code(400).send(createValidationErrorResponse(error));
        }
        fastify.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Failed to create buyer" });
      }
    },
  );

  // PATCH /buyers/:id — update a buyer
  fastify.patch(
    "/buyers/:id",
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const user = (request as any).user;
        const { id } = request.params as { id: string };
        const existing = await fastify.prisma.buyer.findUnique({
          where: { id },
        });
        if (!existing || existing.userId !== user.id) {
          return reply
            .code(404)
            .send({ success: false, error: "Buyer not found" });
        }
        const body = updateBuyerSchema.parse(request.body);
        const buyer = await fastify.prisma.buyer.update({
          where: { id },
          data: {
            name: body.name ?? existing.name,
            phone: body.phone !== undefined ? body.phone : existing.phone,
            email: body.email !== undefined ? body.email : existing.email,
            budgetMin:
              body.budgetMin !== undefined
                ? body.budgetMin
                : existing.budgetMin,
            budgetMax:
              body.budgetMax !== undefined
                ? body.budgetMax
                : existing.budgetMax,
            preferredZones: body.preferredZones ?? existing.preferredZones,
            propertyType:
              body.propertyType !== undefined
                ? body.propertyType
                : existing.propertyType,
            notes: body.notes !== undefined ? body.notes : existing.notes,
          },
        });
        return reply.send({ success: true, data: buyer });
      } catch (error: any) {
        if (isZodError(error)) {
          return reply.code(400).send(createValidationErrorResponse(error));
        }
        fastify.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Failed to update buyer" });
      }
    },
  );

  // DELETE /buyers/:id — delete a buyer
  fastify.delete(
    "/buyers/:id",
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const user = (request as any).user;
        const { id } = request.params as { id: string };
        const existing = await fastify.prisma.buyer.findUnique({
          where: { id },
        });
        if (!existing || existing.userId !== user.id) {
          return reply
            .code(404)
            .send({ success: false, error: "Buyer not found" });
        }
        await fastify.prisma.buyer.delete({ where: { id } });
        return reply.send({ success: true });
      } catch (error: any) {
        fastify.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Failed to delete buyer" });
      }
    },
  );
};

export default buyersRoutes;

import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { verifyJWT } from "../utils/guards.js";
import { createNotification } from "../services/notification.service.js";
import { sendReferredLeadEmail } from "../services/email.service.js";
import {
  resolveRefCode,
  resolveLeadRouting,
  recordAttribution,
  canSeeBuyerContact,
} from "../services/attribution.service.js";

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

        // Lead attribution. A valid ref makes this a referred lead.
        const refCode = (request.cookies as any)?.cmx_ref ?? null;
        const refAgentId = await resolveRefCode(
          fastify.prisma,
          refCode,
          input.propertyId,
        );
        const routing = resolveLeadRouting({
          sellerId: property.sellerId!,
          buyerId: user.id,
          refAgentId,
        });

        if (refAgentId) {
          await recordAttribution(fastify.prisma, {
            leadType: "request",
            leadId: created.id,
            propertyId: input.propertyId,
            buyerId: user.id,
            refAgentId,
            code: refCode,
          });
        }

        const propertyTitle =
          (
            await fastify.prisma.property.findUnique({
              where: { id: input.propertyId },
              select: { title: true },
            })
          )?.title ?? "tu propiedad";

        if (routing.captureHeadsUp && refAgentId) {
          const agent = await fastify.prisma.user.findUnique({
            where: { id: refAgentId },
            select: { email: true, name: true },
          });
          const buyerEmail = (await fastify.prisma.user.findUnique({
            where: { id: user.id },
            select: { email: true },
          }))?.email;

          await createNotification(
            fastify.prisma,
            refAgentId,
            "lead_referred",
            "Nuevo lead referido",
            `${input.name} solicitó información de "${propertyTitle}". Contacto: ${input.phone}${buyerEmail ? ` · ${buyerEmail}` : ""}`,
            "request",
            created.id,
          );
          try {
            if (agent) {
              await sendReferredLeadEmail({
                agentEmail: agent.email,
                agentName: agent.name,
                leadKind: "request",
                propertyTitle,
                buyerName: input.name,
                buyerEmail,
                buyerPhone: input.phone,
              });
            }
          } catch (emailErr) {
            fastify.log.error(
              { err: emailErr },
              "Failed to send referred lead email",
            );
          }
          await createNotification(
            fastify.prisma,
            property.sellerId!,
            "lead_referred_received",
            "Un agente contactará a un interesado de tu propiedad",
            "Un agente hará una oferta por tu propiedad; el agente te contactará.",
            "request",
            created.id,
          );
        } else {
          // Direct request: notify the capturing agent (previously missing).
          await createNotification(
            fastify.prisma,
            property.sellerId!,
            "request_received",
            "Nueva solicitud de contacto",
            `${input.name} solicitó información de "${propertyTitle}". Tel: ${input.phone}`,
            "request",
            created.id,
          );
        }

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

        const unlocked = requests.length
          ? await fastify.prisma.creditTransaction.findMany({
              where: {
                userId: user.id,
                type: "spend",
                referenceId: { in: requests.map((r) => r.id) },
              },
              select: { referenceId: true },
            })
          : [];
        const unlockedIds = new Set(
          unlocked
            .map((t) => t.referenceId)
            .filter((id): id is string => Boolean(id)),
        );

        const data = requests.map((req) => {
          if (
            canSeeBuyerContact({
              lead: req,
              viewerId: user.id,
              sellerId: user.id,
              unlockedIds,
            })
          ) {
            return req;
          }
          if (req.referringAgentId) {
            return { ...req, name: null, phone: null };
          }
          return { ...req, phone: null };
        });

        return reply.code(200).send({
          success: true,
          data,
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

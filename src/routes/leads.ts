import { FastifyPluginAsync } from "fastify";
import { verifyJWT } from "../utils/guards.js";

const SELLER_SELECT = {
  id: true,
  name: true,
  whatsapp: true,
  phone: true,
  email: true,
} as const;

const PROPERTY_SELECT = {
  id: true,
  title: true,
  colonia: true,
  estado: true,
  sellerId: true,
  seller: { select: SELLER_SELECT },
} as const;

/** Shape a referred lead: buyer contact (kept) + capturing agent contact. */
function shapeReferredLead(lead: any) {
  const { property, ...rest } = lead;
  return {
    ...rest,
    property: property
      ? {
          id: property.id,
          title: property.title,
          colonia: property.colonia,
          estado: property.estado,
        }
      : null,
    capturingAgent: property?.seller
      ? {
          id: property.seller.id,
          name: property.seller.name,
          whatsapp: property.seller.whatsapp,
          phone: property.seller.phone,
          email: property.seller.email,
        }
      : null,
  };
}

const leadsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /leads/referred
   * The referring agent's inbox: their referred offers + requests, with the
   * buyer's contact and the capturing agent's contact (WhatsApp deep link).
   */
  fastify.get(
    "/leads/referred",
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const agentId = request.user.id;
        const [offers, requests] = await Promise.all([
          fastify.prisma.propertyOffer.findMany({
            where: { referringAgentId: agentId },
            include: { property: { select: PROPERTY_SELECT } },
            orderBy: { createdAt: "desc" },
          }),
          fastify.prisma.propertyRequest.findMany({
            where: { referringAgentId: agentId },
            include: { property: { select: PROPERTY_SELECT } },
            orderBy: { createdAt: "desc" },
          }),
        ]);

        return reply.send({
          success: true,
          data: {
            offers: offers.map(shapeReferredLead),
            requests: requests.map(shapeReferredLead),
          },
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Failed to fetch referred leads" });
      }
    },
  );

  /**
   * GET /leads/:type/:id/counterparty
   * For the referring agent only: the capturing agent's contact (one-way).
   */
  fastify.get(
    "/leads/:type/:id/counterparty",
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const { type, id } = request.params as { type: string; id: string };
        const agentId = request.user.id;

        if (type !== "offer" && type !== "request") {
          return reply
            .code(400)
            .send({ success: false, error: "Invalid lead type" });
        }

        const include = { property: { select: { seller: { select: SELLER_SELECT } } } };
        const lead: any =
          type === "offer"
            ? await fastify.prisma.propertyOffer.findUnique({
                where: { id },
                include,
              })
            : await fastify.prisma.propertyRequest.findUnique({
                where: { id },
                include,
              });

        if (!lead) {
          return reply
            .code(404)
            .send({ success: false, error: "Lead not found" });
        }
        if (lead.referringAgentId !== agentId) {
          return reply.code(403).send({ success: false, error: "No autorizado" });
        }

        const seller = lead.property?.seller;
        if (!seller) {
          return reply
            .code(404)
            .send({ success: false, error: "Capturing agent not found" });
        }

        return reply.send({ success: true, data: seller });
      } catch (error: any) {
        fastify.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Failed to fetch counterparty" });
      }
    },
  );
};

export default leadsRoutes;

import { FastifyPluginAsync } from "fastify";
import { verifyJWT, requireAdmin } from "../utils/guards.js";
import { z } from "zod";
import { generateReferralCode } from "../utils/errorHandling.js";

const agencyCreateSchema = z.object({
  name: z.string().min(1).max(200),
  legalName: z.string().max(300).optional(),
  rfc: z.string().max(20).optional(),
  ownerId: z.string().uuid().optional(),
  ownerEmail: z.string().email().optional(),
  plan: z
    .enum(["inactive", "basico", "pro", "empresarial", "custom"])
    .optional(),
  agentLimit: z.number().int().min(0).optional(),
  billingActive: z.boolean().optional(),
  referredById: z.string().uuid().optional(),
});

const PRICING: Record<string, number> = {
  inactive: 0,
  basico: 2499,
  pro: 5999,
  empresarial: 9999,
  custom: 0,
};
const AGENT_BASE: Record<string, number> = {
  inactive: 0,
  basico: 3,
  pro: 10,
  empresarial: 25,
  custom: 0,
};
const EXTRA_AGENT_COST = 500;

async function autoInactivateExpiredAgencies(prisma: any) {
  await prisma.agency.updateMany({
    where: { billingActive: true, subscriptionEnds: { lt: new Date() } },
    data: { billingActive: false },
  });
}

const agenciesRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /agencies/pricing — public pricing info
  fastify.get("/agencies/pricing", async (_request, reply) => {
    return reply.send({
      success: true,
      data: {
        plans: [
          {
            name: "basico",
            label: "Básico",
            agents: 3,
            price: 2499,
            leads: "Ilimitados",
          },
          {
            name: "pro",
            label: "Pro",
            agents: 10,
            price: 5999,
            leads: "Ilimitados",
          },
          {
            name: "empresarial",
            label: "Empresarial",
            agents: 25,
            price: 9999,
            leads: "Ilimitados",
          },
        ],
        extraAgentCost: 500,
        contact: { whatsapp: "+526624475213", phone: "+526624475213" },
      },
    });
  });

  // POST /agencies — create agency (admin only)
  fastify.post<{ Body: Record<string, any> }>(
    "/agencies",
    { onRequest: [requireAdmin] },
    async (request, reply) => {
      try {
        const input = agencyCreateSchema.parse(request.body);

        // Resolve owner: by email or by id
        let ownerId = input.ownerId;
        if (!ownerId && input.ownerEmail) {
          const user = await fastify.prisma.user.findUnique({
            where: { email: input.ownerEmail },
            select: { id: true },
          });
          if (!user)
            return reply
              .code(400)
              .send({
                success: false,
                error:
                  "No se encontró un usuario con ese email. Debe registrarse primero.",
              });
          ownerId = user.id;
        }
        if (!ownerId)
          return reply
            .code(400)
            .send({
              success: false,
              error: "Se requiere ownerId o ownerEmail",
            });

        const owner = await fastify.prisma.user.findUnique({
          where: { id: ownerId },
        });
        if (!owner)
          return reply
            .code(400)
            .send({ success: false, error: "Usuario no encontrado" });

        const existing = await fastify.prisma.agency.findUnique({
          where: { ownerId },
        });
        if (existing)
          return reply
            .code(409)
            .send({
              success: false,
              error: "Ya existe una agencia para este usuario",
            });

        // Generate unique referral code
        const referralCode = generateReferralCode();

        const data: any = {
          name: input.name,
          legalName: input.legalName || null,
          rfc: input.rfc || null,
          owner: { connect: { id: ownerId } },
          referralCode,
          plan: input.plan || "inactive",
          agentLimit:
            input.agentLimit ?? (AGENT_BASE[input.plan || "inactive"] || 0),
          billingActive: input.billingActive ?? false,
          subscriptionEnds: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        };
        if (input.referredById)
          data.referredBy = { connect: { id: input.referredById } };

        const agency = await fastify.prisma.agency.create({
          data,
          include: { owner: { select: { id: true, name: true, email: true } } },
        });

        return reply.code(201).send({ success: true, data: agency });
      } catch (error: any) {
        if (error.constructor?.name === "ZodError")
          return reply
            .code(400)
            .send({
              success: false,
              error: "Datos inválidos",
              details: error.errors,
            });
        fastify.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Error al crear la agencia" });
      }
    },
  );

  // GET /agencies/public?code= — public agency info for invite flow
  fastify.get<{ Querystring: { code?: string } }>(
    "/agencies/public",
    async (request, reply) => {
      const { code } = request.query;
      if (!code)
        return reply
          .code(400)
          .send({ success: false, error: "Código requerido" });
      const agency = await fastify.prisma.agency.findUnique({
        where: { referralCode: code },
        select: {
          name: true,
          referralCode: true,
          _count: { select: { members: true } },
        },
      });
      if (!agency)
        return reply
          .code(404)
          .send({ success: false, error: "Agencia no encontrada" });
      return reply.send({ success: true, data: agency });
    },
  );

  // GET /agencies/me — owned agency with plan data
  fastify.get(
    "/agencies/me",
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        await autoInactivateExpiredAgencies(fastify.prisma);
        const agency = await fastify.prisma.agency.findUnique({
          where: { ownerId: request.user.id },
          include: {
            owner: {
              select: { id: true, name: true, email: true, avatarUrl: true },
            },
            _count: { select: { members: true } },
          },
        });
        if (!agency)
          return reply
            .code(404)
            .send({ success: false, error: "No tienes una agencia" });
        return reply.send({
          success: true,
          data: {
            ...agency,
            pricing: {
              planPrice: PRICING[agency.plan] || 0,
              extraAgentCost: EXTRA_AGENT_COST,
            },
          },
        });
      } catch (error) {
        fastify.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Error al obtener la agencia" });
      }
    },
  );

  // POST /agencies/me/agents — owner adds agent directly
  fastify.post<{ Body: Record<string, any> }>(
    "/agencies/me/agents",
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const { email, name, password } = request.body || {};
        if (!email || !name || !password || password.length < 8) {
          return reply
            .code(400)
            .send({
              success: false,
              error: "Email, nombre y contraseña (mín 8) requeridos",
            });
        }

        const agency = await fastify.prisma.agency.findUnique({
          where: { ownerId: request.user.id },
          select: {
            id: true,
            billingActive: true,
            agentLimit: true,
            _count: { select: { members: true } },
          },
        });
        if (!agency)
          return reply
            .code(404)
            .send({ success: false, error: "No tienes una agencia" });
        if (!agency.billingActive)
          return reply
            .code(403)
            .send({ success: false, error: "Tu plan está inactivo" });

        if (agency.agentLimit > 0 && agency.agentLimit !== 999) {
          if (agency._count.members >= agency.agentLimit) {
            return reply
              .code(409)
              .send({
                success: false,
                error: "Has alcanzado el límite de agentes de tu plan",
              });
          }
        }

        const existing = await fastify.prisma.user.findUnique({
          where: { email },
        });
        if (existing)
          return reply
            .code(409)
            .send({
              success: false,
              error: "Ya existe un usuario con ese email",
            });

        const bcrypt = (await import("bcrypt")).default;
        const hashedPassword = await bcrypt.hash(password, 10);
        const referralCode = generateReferralCode();

        const user = await fastify.prisma.user.create({
          data: {
            email,
            name,
            password: hashedPassword,
            referralCode,
            agencyId: agency.id,
            emailVerified: true,
          },
          select: { id: true, name: true, email: true, createdAt: true },
        });

        // Add approved seller role
        const role = await fastify.prisma.role.upsert({
          where: { name: "seller" },
          update: {},
          create: { name: "seller" },
        });
        await fastify.prisma.userRole.create({
          data: { userId: user.id, roleId: role.id, status: "approved" },
        });

        return reply.code(201).send({ success: true, data: user });
      } catch (error: any) {
        fastify.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Error al crear el agente" });
      }
    },
  );

  // GET /agencies/my-membership — agency user belongs to
  fastify.get(
    "/agencies/my-membership",
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      const user = await fastify.prisma.user.findUnique({
        where: { id: request.user.id },
        select: {
          agencyId: true,
          agency: { select: { id: true, name: true, referralCode: true } },
        },
      });
      if (!user?.agency)
        return reply
          .code(404)
          .send({ success: false, error: "No perteneces a ninguna agencia" });
      return reply.send({ success: true, data: { agency: user.agency } });
    },
  );

  // GET /agencies/me/agents — list agents
  fastify.get(
    "/agencies/me/agents",
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      const agency = await fastify.prisma.agency.findUnique({
        where: { ownerId: request.user.id },
        select: { id: true, agentLimit: true },
      });
      if (!agency)
        return reply
          .code(404)
          .send({ success: false, error: "No se encontró la agencia" });
      const agents = await fastify.prisma.user.findMany({
        where: { agencyId: agency.id },
        select: {
          id: true,
          name: true,
          email: true,
          avatarUrl: true,
          createdAt: true,
          roles: { include: { role: true } },
        },
        orderBy: { createdAt: "desc" },
      });
      const formatted = agents.map((a) => ({
        id: a.id,
        name: a.name,
        email: a.email,
        avatarUrl: a.avatarUrl,
        createdAt: a.createdAt,
        roles: a.roles.map((r) => r.role.name),
      }));
      return reply.send({
        success: true,
        data: {
          agents: formatted,
          agentLimit: agency.agentLimit,
          total: formatted.length,
        },
      });
    },
  );

  // ADMIN: GET /admin/agencies — list all agencies
  fastify.get(
    "/admin/agencies",
    { onRequest: [requireAdmin] },
    async (_request, reply) => {
      try {
        await autoInactivateExpiredAgencies(fastify.prisma);
        const agencies = await fastify.prisma.agency.findMany({
          include: {
            owner: { select: { id: true, name: true, email: true } },
            _count: { select: { members: true } },
          },
          orderBy: { createdAt: "desc" },
        });
        return reply.send({
          success: true,
          data: agencies.map((a) => ({
            ...a,
            pricing: {
              planPrice: PRICING[a.plan] || 0,
              extraAgentCost: EXTRA_AGENT_COST,
            },
          })),
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({ success: false, error: "Error" });
      }
    },
  );

  // ADMIN: PATCH /admin/agencies/:id — update plan, agentLimit, billingActive
  fastify.patch<{ Params: { id: string }; Body: Record<string, any> }>(
    "/admin/agencies/:id",
    { onRequest: [requireAdmin] },
    async (request, reply) => {
      try {
        const { plan, agentLimit, billingActive, subscriptionEnds } =
          request.body || {};
        const data: any = {};
        if (plan !== undefined) data.plan = plan;
        if (agentLimit !== undefined) data.agentLimit = Number(agentLimit);
        if (billingActive !== undefined)
          data.billingActive = Boolean(billingActive);
        if (subscriptionEnds)
          data.subscriptionEnds = new Date(subscriptionEnds);

        const agency = await fastify.prisma.agency.update({
          where: { id: request.params.id },
          data,
          include: {
            owner: { select: { id: true, name: true, email: true } },
            _count: { select: { members: true } },
          },
        });

        return reply.send({
          success: true,
          data: {
            ...agency,
            pricing: {
              planPrice: PRICING[agency.plan] || 0,
              extraAgentCost: EXTRA_AGENT_COST,
            },
          },
        });
      } catch (error) {
        fastify.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Error al actualizar la agencia" });
      }
    },
  );
};

export default agenciesRoutes;

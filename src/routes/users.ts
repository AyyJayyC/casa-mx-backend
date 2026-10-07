import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { verifyJWT } from "../utils/guards.js";
import { updateMeSchema, userIdParamSchema } from "../schemas/users.js";
import { isClientError } from "../utils/errorClassification.js";
import { refreshTokenStoreService } from "../services/refreshTokenStore.service.js";

function hasAdminRole(roles: any[]): boolean {
  return roles.includes("admin") || roles.some((r: any) => r?.name === "admin");
}

const usersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/users/me",
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const userId = request.user.id;

        const user = await fastify.prisma.user.findUnique({
          where: { id: userId },
          include: { roles: { include: { role: true } } },
        });

        if (!user) {
          return reply.code(404).send({
            success: false,
            error: "User not found",
          });
        }

        return reply.send({
          success: true,
          data: {
            id: user.id,
            email: user.email,
            name: user.name,
            phone: user.phone,
            whatsapp: user.whatsapp,
            rfc: user.rfc,
            razonSocial: user.razonSocial,
            usoCFDI: user.usoCFDI,
            roles: user.roles.map((ur) => ({
              roleId: ur.roleId,
              roleName: ur.role.name,
              status: ur.status,
            })),
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
          },
        });
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: "Failed to fetch current user",
        });
      }
    },
  );

  fastify.patch(
    "/users/me",
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const input = updateMeSchema.parse(request.body);
        const userId = request.user.id;

        const updated = await fastify.prisma.user.update({
          where: { id: userId },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.phone !== undefined ? { phone: input.phone } : {}),
            ...(input.whatsapp !== undefined
              ? { whatsapp: input.whatsapp }
              : {}),
            ...(input.rfc !== undefined ? { rfc: input.rfc } : {}),
            ...(input.razonSocial !== undefined
              ? { razonSocial: input.razonSocial }
              : {}),
            ...(input.usoCFDI !== undefined ? { usoCFDI: input.usoCFDI } : {}),
          },
          include: { roles: { include: { role: true } } },
        });

        return reply.send({
          success: true,
          data: {
            id: updated.id,
            email: updated.email,
            name: updated.name,
            phone: updated.phone,
            whatsapp: updated.whatsapp,
            rfc: updated.rfc,
            razonSocial: updated.razonSocial,
            usoCFDI: updated.usoCFDI,
            roles: updated.roles.map((ur) => ({
              roleId: ur.roleId,
              roleName: ur.role.name,
              status: ur.status,
            })),
            createdAt: updated.createdAt,
            updatedAt: updated.updatedAt,
          },
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
            error: "Email already exists",
          });
        }

        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: "Failed to update current user",
        });
      }
    },
  );

  // ─── ARCO: data portability (acceso) ──────────────────────────────────────
  // Returns a JSON dump of the requester's own data. Scoped strictly to the
  // authenticated user — target ids in the body are ignored.
  fastify.post(
    "/users/me/export",
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const userId = request.user.id;

        const user = await fastify.prisma.user.findUnique({
          where: { id: userId },
          include: { roles: { include: { role: true } } },
        });
        if (!user) {
          return reply
            .code(404)
            .send({ success: false, error: "User not found" });
        }

        const [
          creditBalance,
          creditTransactions,
          listedProperties,
          offers,
          propertyRequests,
          rentalApplications,
          userDocuments,
        ] = await Promise.all([
          fastify.prisma.creditBalance.findUnique({ where: { userId } }),
          fastify.prisma.creditTransaction.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
          }),
          fastify.prisma.property.findMany({
            where: { sellerId: userId },
            orderBy: { createdAt: "desc" },
          }),
          fastify.prisma.propertyOffer.findMany({
            where: { buyerId: userId },
            orderBy: { createdAt: "desc" },
          }),
          fastify.prisma.propertyRequest.findMany({
            where: { buyerId: userId },
            orderBy: { createdAt: "desc" },
          }),
          fastify.prisma.rentalApplication.findMany({
            where: { applicantId: userId },
            orderBy: { createdAt: "desc" },
          }),
          fastify.prisma.userDocument.findMany({
            where: { userId },
            select: {
              id: true,
              documentType: true,
              fileName: true,
              fileMimeType: true,
              isVerified: true,
              reviewStatus: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
          }),
        ]);

        return reply.send({
          success: true,
          data: {
            exportedAt: new Date().toISOString(),
            profile: {
              id: user.id,
              email: user.email,
              name: user.name,
              phone: user.phone,
              whatsapp: user.whatsapp,
              rfc: user.rfc,
              razonSocial: user.razonSocial,
              usoCFDI: user.usoCFDI,
              emailVerified: user.emailVerified,
              phoneVerified: user.phoneVerified,
              createdAt: user.createdAt,
              roles: user.roles.map((ur) => ({
                roleName: ur.role.name,
                status: ur.status,
              })),
            },
            creditBalance: creditBalance?.balance ?? 0,
            creditTransactions,
            listedProperties,
            offers,
            propertyRequests,
            rentalApplications,
            userDocuments,
          },
        });
      } catch (error) {
        fastify.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Failed to export user data" });
      }
    },
  );

  // ─── ARCO: erasure (cancelación) ──────────────────────────────────────────
  // Self-only soft delete: anonymizes PII, revokes refresh sessions, and blocks
  // future logins. Legally-required transaction rows are retained, linked to
  // the now-anonymized user row (never a hard delete).
  fastify.delete(
    "/users/me",
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const userId = request.user.id;

        const user = await fastify.prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, deletedAt: true },
        });
        if (!user) {
          return reply
            .code(404)
            .send({ success: false, error: "User not found" });
        }

        if (!user.deletedAt) {
          // Revoke the active refresh session so tokens can't be rotated.
          const activeJti =
            await refreshTokenStoreService.getActiveJtiForUser(userId);
          if (activeJti) await refreshTokenStoreService.revokeJti(activeJti);
          await refreshTokenStoreService.clearActiveJtiForUser(userId);

          await fastify.prisma.user.update({
            where: { id: userId },
            data: {
              deletedAt: new Date(),
              email: `deleted+${userId}@deleted.casa-mx.invalid`,
              name: "Usuario eliminado",
              password: null,
              provider: null,
              providerId: null,
              avatarUrl: null,
              phone: null,
              whatsapp: null,
              rfc: null,
              razonSocial: null,
              usoCFDI: null,
              pendingEmail: null,
              verificationToken: null,
              verificationTokenExpiresAt: null,
              passwordResetToken: null,
              passwordResetTokenExpiresAt: null,
              emailVerified: false,
              referralCode: null,
            },
          });
        }

        reply
          .clearCookie("accessToken", { path: "/" })
          .clearCookie("refreshToken", { path: "/" });

        return reply.send({
          success: true,
          message:
            "Tu cuenta fue eliminada. Los comprobantes de transacciones se conservan de forma anonimizada por obligaciones legales.",
        });
      } catch (error) {
        fastify.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Failed to delete account" });
      }
    },
  );

  fastify.get(
    "/users/:id",
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const params = userIdParamSchema.parse(request.params);
        const requesterId = request.user.id;
        const admin = hasAdminRole(request.user?.roles || []);

        if (!admin && requesterId !== params.id) {
          return reply.code(403).send({
            success: false,
            error: "Forbidden - You can only view your own profile",
          });
        }

        const user = await fastify.prisma.user.findUnique({
          where: { id: params.id },
          include: { roles: { include: { role: true } } },
        });

        if (!user) {
          return reply.code(404).send({
            success: false,
            error: "User not found",
          });
        }

        return reply.send({
          success: true,
          data: {
            id: user.id,
            email: user.email,
            name: user.name,
            roles: user.roles.map((ur) => ({
              roleId: ur.roleId,
              roleName: ur.role.name,
              status: ur.status,
            })),
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
          },
        });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            success: false,
            error: "Validation error",
            details: error.errors,
          });
        }

        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: "Failed to fetch user",
        });
      }
    },
  );
};

export default usersRoutes;

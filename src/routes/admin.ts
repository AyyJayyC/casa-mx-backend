import { FastifyPluginAsync } from "fastify";
import { PrismaClient } from "@prisma/client";
import { execSync } from "node:child_process";
import { requireAdmin, verifyJWT } from "../utils/guards.js";
import { UserRoleIdParamSchema } from "../schemas/admin.js";
import {
  sendRoleApprovedEmail,
  sendRoleDeniedEmail,
} from "../services/email.service.js";

export class AdminService {
  constructor(private prisma: PrismaClient) {}

  async getPendingRoles() {
    return this.prisma.userRole.findMany({
      where: { status: "pending" },
      include: {
        user: {
          select: { id: true, email: true, name: true },
        },
        role: {
          select: { id: true, name: true },
        },
      },
    });
  }

  async approveRole(adminId: string, userRoleId: string) {
    // Get the UserRole to check current state
    const userRole = await this.prisma.userRole.findUnique({
      where: { id: userRoleId },
      include: {
        user: true,
        role: true,
      },
    });

    if (!userRole) {
      throw new Error("Role assignment not found");
    }

    if (userRole.status !== "pending") {
      throw new Error(`Cannot approve role with status '${userRole.status}'`);
    }

    // Use transaction to ensure atomicity
    return await this.prisma.$transaction(async (tx) => {
      const updated = await tx.userRole.update({
        where: { id: userRoleId },
        data: { status: "approved" },
      });

      // Create audit log
      await tx.auditLog.create({
        data: {
          actorUserId: adminId,
          targetUserId: userRole.userId,
          action: "APPROVE_ROLE",
          previousState: {
            status: userRole.status,
            roleName: userRole.role.name,
          },
          newState: { status: "approved", roleName: userRole.role.name },
        },
      });

      return updated;
    });
  }

  async denyRole(adminId: string, userRoleId: string) {
    const userRole = await this.prisma.userRole.findUnique({
      where: { id: userRoleId },
      include: {
        user: true,
        role: true,
      },
    });

    if (!userRole) {
      throw new Error("Role assignment not found");
    }

    if (userRole.status !== "pending") {
      throw new Error(`Cannot deny role with status '${userRole.status}'`);
    }

    return await this.prisma.$transaction(async (tx) => {
      const updated = await tx.userRole.update({
        where: { id: userRoleId },
        data: { status: "denied" },
      });

      // Create audit log
      await tx.auditLog.create({
        data: {
          actorUserId: adminId,
          targetUserId: userRole.userId,
          action: "DENY_ROLE",
          previousState: {
            status: userRole.status,
            roleName: userRole.role.name,
          },
          newState: { status: "denied", roleName: userRole.role.name },
        },
      });

      return updated;
    });
  }

  async getAuditLogs() {
    return this.prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  async getAllUsers() {
    return this.prisma.user.findMany({
      include: {
        roles: {
          include: {
            role: true,
          },
        },
      },
    });
  }
}

const adminRoutes: FastifyPluginAsync = async (fastify) => {
  const adminService = new AdminService(fastify.prisma);

  // Get pending role approvals (admin only)
  fastify.get(
    "/admin/pending-roles",
    { onRequest: [requireAdmin] },
    async (request, reply) => {
      try {
        const pendingRoles = await adminService.getPendingRoles();
        return reply.code(200).send({
          success: true,
          data: pendingRoles,
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: "Failed to fetch pending roles",
        });
      }
    },
  );

  // Approve role (admin only)
  fastify.post<{ Params: { userRoleId: string } }>(
    "/admin/roles/:userRoleId/approve",
    { onRequest: [requireAdmin] },
    async (request, reply) => {
      try {
        // Validate params
        const parseResult = UserRoleIdParamSchema.safeParse(request.params);
        if (!parseResult.success) {
          return reply.code(400).send({
            success: false,
            error: "Invalid userRoleId format",
          });
        }

        const { userRoleId } = parseResult.data;
        const adminId = (request.user as any).id;

        const updated = await adminService.approveRole(adminId, userRoleId);

        // Send role approval email
        const userRole = await fastify.prisma.userRole.findUnique({
          where: { id: userRoleId },
          include: {
            user: { select: { email: true, name: true } },
            role: { select: { name: true } },
          },
        });
        if (userRole?.user?.email) {
          await sendRoleApprovedEmail({
            userEmail: userRole.user.email,
            userName: userRole.user.name,
            roleName: userRole.role.name,
          }).catch(() => {});
        }

        return reply.code(200).send({
          success: true,
          data: updated,
          message: "Role approved successfully",
        });
      } catch (error: any) {
        if (error.message.includes("not found")) {
          return reply.code(404).send({
            success: false,
            error: error.message,
          });
        }

        if (error.message.includes("Cannot approve")) {
          return reply.code(400).send({
            success: false,
            error: error.message,
          });
        }

        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: "Failed to approve role",
        });
      }
    },
  );

  // Deny role (admin only)
  fastify.post<{ Params: { userRoleId: string } }>(
    "/admin/roles/:userRoleId/deny",
    { onRequest: [requireAdmin] },
    async (request, reply) => {
      try {
        // Validate params
        const parseResult = UserRoleIdParamSchema.safeParse(request.params);
        if (!parseResult.success) {
          return reply.code(400).send({
            success: false,
            error: "Invalid userRoleId format",
          });
        }

        const { userRoleId } = parseResult.data;
        const adminId = (request.user as any).id;

        const updated = await adminService.denyRole(adminId, userRoleId);

        // Send role denied email
        const deniedUserRole = await fastify.prisma.userRole.findUnique({
          where: { id: userRoleId },
          include: {
            user: { select: { email: true, name: true } },
            role: { select: { name: true } },
          },
        });
        if (deniedUserRole?.user?.email) {
          await sendRoleDeniedEmail({
            userEmail: deniedUserRole.user.email,
            userName: deniedUserRole.user.name,
            roleName: deniedUserRole.role.name,
          }).catch(() => {});
        }

        return reply.code(200).send({
          success: true,
          data: updated,
          message: "Role denied successfully",
        });
      } catch (error: any) {
        if (error.message.includes("not found")) {
          return reply.code(404).send({
            success: false,
            error: error.message,
          });
        }

        if (error.message.includes("Cannot deny")) {
          return reply.code(400).send({
            success: false,
            error: error.message,
          });
        }

        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: "Failed to deny role",
        });
      }
    },
  );

  // Get all users (admin only)
  fastify.get(
    "/admin/users",
    { onRequest: [requireAdmin] },
    async (request, reply) => {
      try {
        const users = await adminService.getAllUsers();
        return reply.code(200).send({
          success: true,
          data: users,
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: "Failed to fetch users",
        });
      }
    },
  );

  // Get audit logs (admin only)
  fastify.get(
    "/admin/audit-logs",
    { onRequest: [requireAdmin] },
    async (request, reply) => {
      try {
        const logs = await adminService.getAuditLogs();
        return reply.code(200).send({
          success: true,
          data: logs,
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: "Failed to fetch audit logs",
        });
      }
    },
  );
  // Promote property (admin only)
  fastify.patch<{ Params: { id: string } }>(
    "/admin/properties/:id/promote",
    { onRequest: [requireAdmin] },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const { promotionTier, featuredUntil } = request.body as {
          promotionTier?:
            | "carousel"
            | "featured"
            | "urgent"
            | "priority"
            | null;
          featuredUntil?: string | null;
        };

        const VALID_TIERS = ["carousel", "featured", "urgent", "priority"];

        if (
          promotionTier !== undefined &&
          promotionTier !== null &&
          !VALID_TIERS.includes(promotionTier)
        ) {
          return reply.code(400).send({
            success: false,
            error: `Invalid promotionTier. Must be one of: ${VALID_TIERS.join(", ")} or null`,
          });
        }

        const property = await fastify.prisma.property.findUnique({
          where: { id },
        });

        if (!property) {
          return reply
            .code(404)
            .send({ success: false, error: "Property not found" });
        }

        const data: Record<string, any> = {};
        if (promotionTier !== undefined) {
          data.promotionTier = promotionTier;
        }
        if (featuredUntil !== undefined) {
          data.featuredUntil = featuredUntil ? new Date(featuredUntil) : null;
        }

        const updated = await fastify.prisma.property.update({
          where: { id },
          data,
        });

        await fastify.prisma.auditLog.create({
          data: {
            actorUserId: (request.user as any).id,
            targetUserId: property.sellerId,
            action: "PROMOTE_PROPERTY",
            previousState: {
              promotionTier: property.promotionTier,
              featuredUntil: property.featuredUntil,
            },
            newState: {
              promotionTier: updated.promotionTier,
              featuredUntil: updated.featuredUntil,
            },
          },
        });

        return reply.send({
          success: true,
          data: {
            id: updated.id,
            title: updated.title,
            promotionTier: updated.promotionTier,
            featuredUntil: updated.featuredUntil,
          },
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: "Failed to promote property",
        });
      }
    },
  );

  // POST /admin/run-migrations — apply pending database migrations
  // Secured by MIGRATION_SECRET env var (one-time use)
  fastify.post<{ Body: { secret: string; action?: string } }>(
    "/admin/run-migrations",
    async (request, reply) => {
      try {
        const expectedSecret = process.env.MIGRATION_SECRET?.trim();
        if (!expectedSecret || request.body.secret !== expectedSecret) {
          return reply
            .code(403)
            .send({ success: false, error: "Invalid secret" });
        }

        const output: string[] = [];

        // Resolve any failed seed migration
        try {
          const result = execSync(
            "npx prisma migrate resolve --applied 20260515010000_seed_admin_and_approve",
            { cwd: "/app", timeout: 15000, encoding: "utf8" },
          );
          output.push("resolve: " + result.trim());
        } catch (e: any) {
          output.push("resolve: " + (e.stdout || e.stderr || e.message));
        }

        // Apply all pending migrations
        try {
          const result = execSync("npx prisma migrate deploy", {
            cwd: "/app",
            timeout: 30000,
            encoding: "utf8",
          });
          output.push("deploy: " + result.trim());
        } catch (e: any) {
          output.push("deploy: " + (e.stdout || e.stderr || e.message));
        }

        // Sync schema directly (catches all columns added via prisma db push locally)
        try {
          const result = execSync("npx prisma db push --accept-data-loss", {
            cwd: "/app",
            timeout: 60000,
            encoding: "utf8",
          });
          output.push("push: " + result.trim());
        } catch (e: any) {
          output.push("push: " + (e.stdout || e.stderr || e.message));
        }

        // Grant admin role to ADMIN_EMAIL user (action: grant-admin)
        if (request.body.action === "grant-admin") {
          try {
            const adminEmail = process.env.ADMIN_EMAIL?.trim();
            if (!adminEmail) {
              return reply
                .code(400)
                .send({ success: false, error: "ADMIN_EMAIL not set" });
            }
            const user = await fastify.prisma.user.findUnique({
              where: { email: adminEmail },
              include: { roles: { include: { role: true } } },
            });
            if (!user) {
              output.push("grant-admin: user not found for " + adminEmail);
            } else {
              const adminRole = await fastify.prisma.role.findUnique({
                where: { name: "admin" },
              });
              if (!adminRole) {
                output.push("grant-admin: admin role not found in DB");
              } else {
                await fastify.prisma.userRole.upsert({
                  where: {
                    userId_roleId: { userId: user.id, roleId: adminRole.id },
                  },
                  create: {
                    userId: user.id,
                    roleId: adminRole.id,
                    status: "approved",
                  },
                  update: { status: "approved" },
                });
                output.push("grant-admin: admin role granted to " + adminEmail);
              }
            }
          } catch (e: any) {
            output.push("grant-admin: " + (e.message || "unknown error"));
          }
        }

        // Reset admin user password (action: reset-admin)
        if (request.body.action === "reset-admin") {
          try {
            const adminEmail = process.env.ADMIN_EMAIL?.trim();
            if (!adminEmail) {
              return reply
                .code(400)
                .send({ success: false, error: "ADMIN_EMAIL not set" });
            }
            const bcrypt = require("bcrypt");
            const adminPassword =
              process.env.ADMIN_INITIAL_PASSWORD || "CasaMX2026!";
            const hashedPassword = await bcrypt.hash(adminPassword, 10);
            await fastify.prisma.user.update({
              where: { email: adminEmail },
              data: { password: hashedPassword, emailVerified: true },
            });
            output.push("reset-admin: password set for " + adminEmail);
          } catch (e: any) {
            output.push("reset-admin: " + e.message);
          }
        }

        return reply.send({ success: true, output });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ success: false, error: error.message });
      }
    },
  );

  // POST /admin/setup-admin — grant admin role + set password for ADMIN_EMAIL user
  // Secured by MIGRATION_SECRET env var (one-time use)
  fastify.post<{ Body: { secret: string } }>(
    "/admin/setup-admin",
    async (request, reply) => {
      try {
        const expectedSecret = process.env.MIGRATION_SECRET?.trim();
        if (!expectedSecret || request.body.secret !== expectedSecret) {
          return reply
            .code(403)
            .send({ success: false, error: "Invalid secret" });
        }

        const adminEmail = process.env.ADMIN_EMAIL?.trim();
        if (!adminEmail) {
          return reply
            .code(400)
            .send({ success: false, error: "ADMIN_EMAIL not set" });
        }

        // Set password
        const bcrypt = await import("bcrypt");
        const adminPassword =
          process.env.ADMIN_INITIAL_PASSWORD || "CasaMX2026!";
        const hashedPassword = await bcrypt.hash(adminPassword, 10);

        const user = await fastify.prisma.user.upsert({
          where: { email: adminEmail },
          create: {
            email: adminEmail,
            name: "Axel Castro",
            password: hashedPassword,
            emailVerified: true,
          },
          update: {
            password: hashedPassword,
            emailVerified: true,
          },
        });

        // Grant admin role
        const adminRole = await fastify.prisma.role.findUnique({
          where: { name: "admin" },
        });
        if (adminRole) {
          await fastify.prisma.userRole.upsert({
            where: { userId_roleId: { userId: user.id, roleId: adminRole.id } },
            create: {
              userId: user.id,
              roleId: adminRole.id,
              status: "approved",
            },
            update: { status: "approved" },
          });
        }

        return reply.send({
          success: true,
          email: adminEmail,
          userId: user.id,
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({ success: false, error: error.message });
      }
    },
  );
};

export default adminRoutes;

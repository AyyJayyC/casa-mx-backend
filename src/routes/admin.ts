import { FastifyPluginAsync } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { requireAdmin, verifyJWT } from '../utils/guards.js';
import { UserRoleIdParamSchema } from '../schemas/admin.js';

export class AdminService {
  constructor(private prisma: PrismaClient) {}

  async getPendingRoles() {
    return this.prisma.userRole.findMany({
      where: { status: 'pending' },
      include: {
        user: {
          select: { id: true, email: true, name: true }
        },
        role: {
          select: { id: true, name: true }
        }
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
      }
    });

    if (!userRole) {
      throw new Error('Role assignment not found');
    }

    if (userRole.status !== 'pending') {
      throw new Error(`Cannot approve role with status '${userRole.status}'`);
    }

    // Use transaction to ensure atomicity
    return await this.prisma.$transaction(async (tx) => {
      const updated = await tx.userRole.update({
        where: { id: userRoleId },
        data: { status: 'approved' }
      });

      // Create audit log
      await tx.auditLog.create({
        data: {
          actorUserId: adminId,
          targetUserId: userRole.userId,
          action: 'APPROVE_ROLE',
          previousState: { status: userRole.status, roleName: userRole.role.name },
          newState: { status: 'approved', roleName: userRole.role.name },
        }
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
      }
    });

    if (!userRole) {
      throw new Error('Role assignment not found');
    }

    if (userRole.status !== 'pending') {
      throw new Error(`Cannot deny role with status '${userRole.status}'`);
    }

    return await this.prisma.$transaction(async (tx) => {
      const updated = await tx.userRole.update({
        where: { id: userRoleId },
        data: { status: 'denied' }
      });

      // Create audit log
      await tx.auditLog.create({
        data: {
          actorUserId: adminId,
          targetUserId: userRole.userId,
          action: 'DENY_ROLE',
          previousState: { status: userRole.status, roleName: userRole.role.name },
          newState: { status: 'denied', roleName: userRole.role.name },
        }
      });

      return updated;
    });
  }

  async getAuditLogs() {
    return this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async getAllUsers() {
    return this.prisma.user.findMany({
      include: {
        roles: {
          include: {
            role: true
          }
        }
      },
    });
  }
}

const adminRoutes: FastifyPluginAsync = async (fastify) => {
  const adminService = new AdminService(fastify.prisma);

  // Get pending role approvals (admin only)
  fastify.get(
    '/admin/pending-roles',
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
          error: 'Failed to fetch pending roles',
        });
      }
    }
  );

  // Approve role (admin only)
  fastify.post<{ Params: { userRoleId: string } }>(
    '/admin/roles/:userRoleId/approve',
    { onRequest: [requireAdmin] },
    async (request, reply) => {
      try {
        // Validate params
        const parseResult = UserRoleIdParamSchema.safeParse(request.params);
        if (!parseResult.success) {
          return reply.code(400).send({
            success: false,
            error: 'Invalid userRoleId format',
          });
        }

        const { userRoleId } = parseResult.data;
        const adminId = (request.user as any).id;

        const updated = await adminService.approveRole(adminId, userRoleId);

        return reply.code(200).send({
          success: true,
          data: updated,
          message: 'Role approved successfully',
        });
      } catch (error: any) {
        if (error.message.includes('not found')) {
          return reply.code(404).send({
            success: false,
            error: error.message,
          });
        }

        if (error.message.includes('Cannot approve')) {
          return reply.code(400).send({
            success: false,
            error: error.message,
          });
        }

        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: 'Failed to approve role',
        });
      }
    }
  );

  // Deny role (admin only)
  fastify.post<{ Params: { userRoleId: string } }>(
    '/admin/roles/:userRoleId/deny',
    { onRequest: [requireAdmin] },
    async (request, reply) => {
      try {
        // Validate params
        const parseResult = UserRoleIdParamSchema.safeParse(request.params);
        if (!parseResult.success) {
          return reply.code(400).send({
            success: false,
            error: 'Invalid userRoleId format',
          });
        }

        const { userRoleId } = parseResult.data;
        const adminId = (request.user as any).id;

        const updated = await adminService.denyRole(adminId, userRoleId);

        return reply.code(200).send({
          success: true,
          data: updated,
          message: 'Role denied successfully',
        });
      } catch (error: any) {
        if (error.message.includes('not found')) {
          return reply.code(404).send({
            success: false,
            error: error.message,
          });
        }

        if (error.message.includes('Cannot deny')) {
          return reply.code(400).send({
            success: false,
            error: error.message,
          });
        }

        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: 'Failed to deny role',
        });
      }
    }
  );

  // Get all users (admin only)
  fastify.get(
    '/admin/users',
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
          error: 'Failed to fetch users',
        });
      }
    }
  );

  // Get audit logs (admin only)
  fastify.get(
    '/admin/audit-logs',
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
          error: 'Failed to fetch audit logs',
        });
      }
    }
  );
  // Promote property (admin only)
  fastify.patch<{ Params: { id: string } }>(
    '/admin/properties/:id/promote',
    { onRequest: [requireAdmin] },
    async (request, reply) => {
      try {
        const { id } = request.params;
        const { promotionTier, featuredUntil } = request.body as {
          promotionTier?: 'carousel' | 'featured' | 'urgent' | 'priority' | null;
          featuredUntil?: string | null;
        };

        const VALID_TIERS = ['carousel', 'featured', 'urgent', 'priority'];

        if (promotionTier !== undefined && promotionTier !== null && !VALID_TIERS.includes(promotionTier)) {
          return reply.code(400).send({
            success: false,
            error: `Invalid promotionTier. Must be one of: ${VALID_TIERS.join(', ')} or null`,
          });
        }

        const property = await fastify.prisma.property.findUnique({
          where: { id },
        });

        if (!property) {
          return reply.code(404).send({ success: false, error: 'Property not found' });
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
            action: 'PROMOTE_PROPERTY',
            previousState: { promotionTier: property.promotionTier, featuredUntil: property.featuredUntil },
            newState: { promotionTier: updated.promotionTier, featuredUntil: updated.featuredUntil },
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
          error: 'Failed to promote property',
        });
      }
    }
  );
};

export default adminRoutes;



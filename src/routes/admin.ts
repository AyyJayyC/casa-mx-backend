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
};

export default adminRoutes;



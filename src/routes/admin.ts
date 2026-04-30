import { FastifyPluginAsync } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { requireAdmin, verifyJWT } from '../utils/guards.js';
import { UserRoleIdParamSchema } from '../schemas/admin.js';
import { z } from 'zod';

const userDocumentIdParamSchema = z.object({
  documentId: z.string().uuid(),
});

const reviewUserDocumentSchema = z.object({
  note: z.string().max(1000).optional(),
});

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

  async getPendingUserDocuments() {
    return this.prisma.userDocument.findMany({
      where: {
        documentType: 'official_id',
        reviewStatus: 'pending',
      },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async approveUserDocument(adminId: string, documentId: string, note?: string) {
    const document = await this.prisma.userDocument.findUnique({ where: { id: documentId } });

    if (!document) {
      throw new Error('User document not found');
    }

    return await this.prisma.$transaction(async (tx) => {
      const updated = await tx.userDocument.update({
        where: { id: documentId },
        data: {
          isVerified: true,
          reviewStatus: 'verified',
          reviewNote: note,
          reviewedByUserId: adminId,
          reviewedAt: new Date(),
          verifiedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: adminId,
          targetUserId: document.userId,
          action: 'APPROVE_USER_DOCUMENT',
          previousState: {
            reviewStatus: document.reviewStatus,
            isVerified: document.isVerified,
          },
          newState: {
            reviewStatus: 'verified',
            isVerified: true,
            reviewNote: note ?? null,
          },
        },
      });

      return updated;
    });
  }

  async rejectUserDocument(adminId: string, documentId: string, note?: string) {
    const document = await this.prisma.userDocument.findUnique({ where: { id: documentId } });

    if (!document) {
      throw new Error('User document not found');
    }

    return await this.prisma.$transaction(async (tx) => {
      const updated = await tx.userDocument.update({
        where: { id: documentId },
        data: {
          isVerified: false,
          reviewStatus: 'rejected',
          reviewNote: note,
          reviewedByUserId: adminId,
          reviewedAt: new Date(),
          verifiedAt: null,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: adminId,
          targetUserId: document.userId,
          action: 'REJECT_USER_DOCUMENT',
          previousState: {
            reviewStatus: document.reviewStatus,
            isVerified: document.isVerified,
          },
          newState: {
            reviewStatus: 'rejected',
            isVerified: false,
            reviewNote: note ?? null,
          },
        },
      });

      return updated;
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

  // Get pending account-level official ID documents (admin only)
  fastify.get(
    '/admin/user-documents/pending',
    { onRequest: [requireAdmin] },
    async (_request, reply) => {
      try {
        const documents = await adminService.getPendingUserDocuments();
        return reply.code(200).send({
          success: true,
          data: documents,
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: 'Failed to fetch pending user documents',
        });
      }
    }
  );

  // Approve user identity document (admin only)
  fastify.post<{ Params: { documentId: string }; Body: { note?: string } }>(
    '/admin/user-documents/:documentId/approve',
    { onRequest: [requireAdmin] },
    async (request, reply) => {
      try {
        const { documentId } = userDocumentIdParamSchema.parse(request.params);
        const { note } = reviewUserDocumentSchema.parse(request.body ?? {});
        const adminId = (request.user as any).id;

        const updated = await adminService.approveUserDocument(adminId, documentId, note);
        return reply.code(200).send({
          success: true,
          data: updated,
          message: 'User document approved successfully',
        });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            details: error.errors,
          });
        }
        if (error.message?.includes('not found')) {
          return reply.code(404).send({ success: false, error: error.message });
        }
        fastify.log.error(error);
        return reply.code(500).send({ success: false, error: 'Failed to approve user document' });
      }
    }
  );

  // Reject user identity document (admin only)
  fastify.post<{ Params: { documentId: string }; Body: { note?: string } }>(
    '/admin/user-documents/:documentId/reject',
    { onRequest: [requireAdmin] },
    async (request, reply) => {
      try {
        const { documentId } = userDocumentIdParamSchema.parse(request.params);
        const { note } = reviewUserDocumentSchema.parse(request.body ?? {});
        const adminId = (request.user as any).id;

        const updated = await adminService.rejectUserDocument(adminId, documentId, note);
        return reply.code(200).send({
          success: true,
          data: updated,
          message: 'User document rejected successfully',
        });
      } catch (error: any) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            details: error.errors,
          });
        }
        if (error.message?.includes('not found')) {
          return reply.code(404).send({ success: false, error: error.message });
        }
        fastify.log.error(error);
        return reply.code(500).send({ success: false, error: 'Failed to reject user document' });
      }
    }
  );
};

export default adminRoutes;



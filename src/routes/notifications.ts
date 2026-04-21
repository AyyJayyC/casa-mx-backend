import { FastifyPluginAsync } from 'fastify';
import { verifyJWT } from '../utils/guards.js';
import { z } from 'zod';

const notificationsRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /notifications — fetch current user's notifications
  fastify.get('/notifications', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      const userId = request.user.id;
      const notifications = await fastify.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      const unreadCount = notifications.filter((n) => !n.read).length;
      return reply.send({ success: true, data: { notifications, unreadCount } });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ success: false, error: 'Failed to fetch notifications' });
    }
  });

  // PATCH /notifications/:id/read — mark a single notification as read
  fastify.patch('/notifications/:id/read', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const userId = request.user.id;
      const notification = await fastify.prisma.notification.findUnique({ where: { id } });
      if (!notification || notification.userId !== userId) {
        return reply.code(404).send({ success: false, error: 'Notification not found' });
      }
      await fastify.prisma.notification.update({ where: { id }, data: { read: true } });
      return reply.send({ success: true });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ success: false, error: 'Failed to update notification' });
    }
  });

  // PATCH /notifications/read-all — mark all as read
  fastify.patch('/notifications/read-all', { onRequest: [verifyJWT] }, async (request, reply) => {
    try {
      const userId = request.user.id;
      await fastify.prisma.notification.updateMany({
        where: { userId, read: false },
        data: { read: true },
      });
      return reply.send({ success: true });
    } catch (error) {
      fastify.log.error(error);
      return reply.code(500).send({ success: false, error: 'Failed to update notifications' });
    }
  });
};

export default notificationsRoutes;

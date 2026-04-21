import { FastifyPluginAsync } from 'fastify';
import crypto from 'crypto';
import { sendVerificationEmail } from '../services/email.service.js';

const verificationRoutes: FastifyPluginAsync = async (fastify) => {

  /**
   * GET /auth/verify-email?token=...
   * Called when user clicks the link in their email.
   */
  fastify.get('/auth/verify-email', async (request, reply) => {
    const { token } = request.query as { token?: string };

    if (!token) {
      return reply.code(400).send({ success: false, error: 'Token requerido' });
    }

    const user = await fastify.prisma.user.findUnique({
      where: { verificationToken: token },
      select: { id: true, emailVerified: true, verificationTokenExpiresAt: true },
    });

    if (!user) {
      return reply.code(400).send({ success: false, error: 'Token inválido o ya usado' });
    }

    if (user.emailVerified) {
      return reply.send({ success: true, message: 'Correo ya verificado' });
    }

    if (user.verificationTokenExpiresAt && user.verificationTokenExpiresAt < new Date()) {
      return reply.code(400).send({ success: false, error: 'El enlace ha expirado. Solicita uno nuevo.' });
    }

    await fastify.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        verificationToken: null,
        verificationTokenExpiresAt: null,
      },
    });

    return reply.send({ success: true, message: '¡Correo verificado exitosamente!' });
  });

  /**
   * POST /auth/resend-verification
   * Resends the verification email (rate limited by last send time).
   * Requires user to be logged in.
   */
  fastify.post('/auth/resend-verification', async (request, reply) => {
    let userId: string;
    try {
      await request.jwtVerify({ onlyCookie: true });
      userId = (request.user as any).id;
    } catch {
      try {
        await request.jwtVerify();
        userId = (request.user as any).id;
      } catch {
        return reply.code(401).send({ success: false, error: 'No autorizado' });
      }
    }

    const user = await fastify.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, emailVerified: true, verificationTokenExpiresAt: true },
    });

    if (!user) return reply.code(404).send({ success: false, error: 'Usuario no encontrado' });
    if (user.emailVerified) return reply.send({ success: true, message: 'Tu correo ya está verificado' });

    // Rate limit: don't resend if token was issued in the last 2 minutes
    if (user.verificationTokenExpiresAt) {
      const tokenAge = Date.now() - (user.verificationTokenExpiresAt.getTime() - 24 * 60 * 60 * 1000);
      if (tokenAge < 2 * 60 * 1000) {
        return reply.code(429).send({ success: false, error: 'Espera un momento antes de solicitar otro correo' });
      }
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await fastify.prisma.user.update({
      where: { id: userId },
      data: { verificationToken: token, verificationTokenExpiresAt: expiresAt },
    });

    await sendVerificationEmail({ userEmail: user.email, userName: user.name, token });

    return reply.send({ success: true, message: 'Correo de verificación enviado' });
  });
};

export default verificationRoutes;

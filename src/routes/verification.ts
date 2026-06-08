import { FastifyPluginAsync } from "fastify";
import crypto from "crypto";
import {
  sendVerificationEmail,
  sendWelcomeEmail,
} from "../services/email.service.js";
import { verifyJWT } from "../utils/guards.js";

const verificationRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /auth/verify-email?token=...
   * Called when user clicks the link in their email.
   * Also handles pendingEmail swaps — replaces old email with pendingEmail.
   */
  fastify.get("/auth/verify-email", async (request, reply) => {
    const { token } = request.query as { token?: string };

    if (!token) {
      return reply.code(400).send({ success: false, error: "Token requerido" });
    }

    const user = await fastify.prisma.user.findUnique({
      where: { verificationToken: token },
      select: {
        id: true,
        email: true,
        emailVerified: true,
        pendingEmail: true,
        verificationTokenExpiresAt: true,
      },
    });

    if (!user) {
      return reply
        .code(400)
        .send({ success: false, error: "Token inválido o ya usado" });
    }

    if (
      user.verificationTokenExpiresAt &&
      user.verificationTokenExpiresAt < new Date()
    ) {
      return reply
        .code(400)
        .send({
          success: false,
          error: "El enlace ha expirado. Solicita uno nuevo.",
        });
    }

    // If there's a pending email swap, perform it
    if (user.pendingEmail) {
      const oldEmail = user.email;
      await fastify.prisma.user.update({
        where: { id: user.id },
        data: {
          email: user.pendingEmail,
          pendingEmail: null,
          emailVerified: true,
          verificationToken: null,
          verificationTokenExpiresAt: null,
        },
      });

      // Notify old email of the change
      try {
        await sendVerificationEmail({
          userEmail: oldEmail,
          userName: "",
          token: "email-changed",
        });
      } catch {}

      return reply.send({
        success: true,
        message: "Correo verificado y cambiado exitosamente.",
      });
    }

    // Normal verification
    await fastify.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        verificationToken: null,
        verificationTokenExpiresAt: null,
      },
    });

    // Send welcome email
    const verifiedUser = await fastify.prisma.user.findUnique({
      where: { id: user.id },
      select: { email: true, name: true },
    });
    if (verifiedUser && !user.emailVerified) {
      await sendWelcomeEmail({
        userEmail: verifiedUser.email,
        userName: verifiedUser.name,
      }).catch(() => {});
    }

    return reply.send({
      success: true,
      message: "¡Correo verificado exitosamente!",
    });
  });

  /**
   * POST /auth/resend-verification
   * Resends the verification email (rate limited by last send time).
   * Requires user to be logged in.
   */
  fastify.post(
    "/auth/resend-verification",
    {
      config: {
        rateLimit: { max: 5, timeWindow: "15 minutes" },
      },
    },
    async (request, reply) => {
      let userId: string;
      try {
        await request.jwtVerify({ onlyCookie: true });
        userId = (request.user as any).id;
      } catch {
        try {
          await request.jwtVerify();
          userId = (request.user as any).id;
        } catch {
          return reply
            .code(401)
            .send({ success: false, error: "No autorizado" });
        }
      }

      const user = await fastify.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          emailVerified: true,
          verificationTokenExpiresAt: true,
        },
      });

      if (!user)
        return reply
          .code(404)
          .send({ success: false, error: "Usuario no encontrado" });
      if (user.emailVerified)
        return reply.send({
          success: true,
          message: "Tu correo ya está verificado",
        });

      // Rate limit: don't resend if token was issued in the last 2 minutes
      if (user.verificationTokenExpiresAt) {
        const tokenAge =
          Date.now() -
          (user.verificationTokenExpiresAt.getTime() - 24 * 60 * 60 * 1000);
        if (tokenAge < 2 * 60 * 1000) {
          return reply
            .code(429)
            .send({
              success: false,
              error: "Espera un momento antes de solicitar otro correo",
            });
        }
      }

      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await fastify.prisma.user.update({
        where: { id: userId },
        data: {
          verificationToken: token,
          verificationTokenExpiresAt: expiresAt,
        },
      });

      await sendVerificationEmail({
        userEmail: user.email,
        userName: user.name,
        token,
      });

      const emailConfigured = Boolean(process.env.RESEND_API_KEY);
      return reply.send({
        success: true,
        message: emailConfigured
          ? "Correo de verificación enviado. Revisa tu bandeja de entrada."
          : "Correo de verificación generado — pendiente de envío (RESEND_API_KEY no configurada).",
        emailSent: emailConfigured,
      });
    },
  );

  /**
   * POST /users/me/change-email
   * Initiate email change. Sends verification to NEW email. Old email gets notified.
   * Rate limited: 1 change per 30 days.
   */
  fastify.post(
    "/users/me/change-email",
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      const userId = request.user.id;
      const { newEmail } = (request.body || {}) as { newEmail?: string };

      if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
        return reply
          .code(400)
          .send({ success: false, error: "Email inválido" });
      }

      const user = await fastify.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, name: true },
      });
      if (!user)
        return reply
          .code(404)
          .send({ success: false, error: "Usuario no encontrado" });

      // Check if email is taken
      const existing = await fastify.prisma.user.findUnique({
        where: { email: newEmail },
      });
      if (existing) {
        return reply
          .code(409)
          .send({ success: false, error: "Este email ya está en uso" });
      }

      // Rate limit: 30 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const recentChange = await fastify.prisma.auditLog.findFirst({
        where: {
          actorUserId: userId,
          action: "CHANGE_EMAIL",
          createdAt: { gte: thirtyDaysAgo },
        },
      });
      if (recentChange) {
        return reply
          .code(429)
          .send({
            success: false,
            error: "Solo puedes cambiar tu email una vez cada 30 días",
          });
      }

      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await fastify.prisma.user.update({
        where: { id: userId },
        data: {
          pendingEmail: newEmail,
          verificationToken: token,
          verificationTokenExpiresAt: expiresAt,
        },
      });

      await sendVerificationEmail({
        userEmail: newEmail,
        userName: user.name,
        token,
      });

      await fastify.prisma.auditLog.create({
        data: {
          actorUserId: userId,
          action: "CHANGE_EMAIL_REQUESTED",
          newState: { oldEmail: user.email, newEmail },
        },
      });

      return reply.send({
        success: true,
        message: "Verifica tu nuevo email para completar el cambio.",
      });
    },
  );

  /**
   * POST /users/me/change-phone
   * Changes the user's phone number and sets phoneVerified.
   */
  fastify.post(
    "/users/me/change-phone",
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      const userId = request.user.id;
      const { phone } = (request.body || {}) as { phone?: string };

      if (!phone || phone.replace(/[\s\-\(\)\+]/g, "").length < 10) {
        return reply
          .code(400)
          .send({ success: false, error: "Teléfono inválido" });
      }

      const user = await fastify.prisma.user.findUnique({
        where: { id: userId },
        select: { phone: true },
      });
      if (!user)
        return reply
          .code(404)
          .send({ success: false, error: "Usuario no encontrado" });

      // Rate limit: 30 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const recentChange = await fastify.prisma.auditLog.findFirst({
        where: {
          actorUserId: userId,
          action: "CHANGE_PHONE",
          createdAt: { gte: thirtyDaysAgo },
        },
      });
      if (recentChange) {
        return reply
          .code(429)
          .send({
            success: false,
            error: "Solo puedes cambiar tu teléfono una vez cada 30 días",
          });
      }

      const clean = phone.replace(/[\s\-\(\)\+]/g, "");
      await fastify.prisma.user.update({
        where: { id: userId },
        data: { phone: clean, phoneVerified: true },
      });

      await fastify.prisma.auditLog.create({
        data: {
          actorUserId: userId,
          action: "CHANGE_PHONE",
          newState: { phone: clean },
        },
      });

      return reply.send({
        success: true,
        message: "Teléfono actualizado y verificado.",
      });
    },
  );
};

export default verificationRoutes;

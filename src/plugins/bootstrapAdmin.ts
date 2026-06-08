/**
 * Bootstrap admin user on startup.
 * If ADMIN_EMAIL env var is set, ensures that user has an approved admin role.
 * Useful for initial setup and account recovery.
 */
import type { FastifyInstance } from "fastify";

export async function bootstrapAdmin(fastify: FastifyInstance) {
  const adminEmail = process.env.ADMIN_EMAIL?.trim();
  if (!adminEmail) return;

  try {
    const user = await fastify.prisma.user.findUnique({
      where: { email: adminEmail },
      include: { roles: { include: { role: true } } },
    });

    if (!user) {
      fastify.log.info(
        { adminEmail },
        "ADMIN_EMAIL user not found yet — will bootstrap on next startup",
      );
      return;
    }

    const hasAdmin = user.roles.some(
      (r) => r.role.name === "admin" && r.status === "approved",
    );

    if (hasAdmin) return;

    const role = await fastify.prisma.role.findUnique({
      where: { name: "admin" },
    });
    if (!role) {
      fastify.log.warn("admin role missing in DB");
      return;
    }

    await fastify.prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id, status: "approved" },
      update: { status: "approved" },
    });

    fastify.log.info({ adminEmail }, "Admin role granted to existing user");
  } catch (err: any) {
    fastify.log.warn({ err }, "Failed to bootstrap admin user");
  }
}

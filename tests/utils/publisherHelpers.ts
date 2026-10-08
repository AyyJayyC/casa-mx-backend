import crypto from "node:crypto";
import { FastifyInstance } from "fastify";

/**
 * Test helpers for the Casa MX Publisher API.
 * Keys are stored hashed; these helpers create real DB rows so the auth
 * plugin's lookup/constant-time comparison path is exercised end to end.
 */

export function hashPublisherKey(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export function generateRawKey(): string {
  return "cmx_pub_" + crypto.randomBytes(32).toString("base64url");
}

export async function ensureRole(
  app: FastifyInstance,
  name: string,
): Promise<string> {
  const role = await app.prisma.role.findUnique({ where: { name } });
  if (role) return role.id;
  const created = await app.prisma.role.create({ data: { name } });
  return created.id;
}

export async function createPublisherUser(
  app: FastifyInstance,
  opts: { email: string; roles?: string[]; ineApproved?: boolean },
): Promise<{ id: string }> {
  const user = await app.prisma.user.create({
    data: { email: opts.email, name: "Publisher Test", emailVerified: true },
    select: { id: true },
  });

  for (const roleName of opts.roles ?? ["owner"]) {
    const roleId = await ensureRole(app, roleName);
    await app.prisma.userRole.create({
      data: { userId: user.id, roleId, status: "approved" },
    });
  }

  if (opts.ineApproved) {
    await app.prisma.userDocument.create({
      data: {
        userId: user.id,
        documentType: "official_id",
        fileUrl: "test/ine-key",
        fileName: "ine.pdf",
        fileMimeType: "application/pdf",
        isVerified: true,
        reviewStatus: "approved",
      },
    });
  }

  return user;
}

export async function createPublisherKey(
  app: FastifyInstance,
  userId: string,
  opts: {
    label?: string;
    skipIne?: boolean;
    active?: boolean;
    revokedAt?: Date | null;
    expiresAt?: Date | null;
  } = {},
): Promise<string> {
  const raw = generateRawKey();
  await app.prisma.publisherApiKey.create({
    data: {
      label: opts.label ?? "test-key",
      keyHash: hashPublisherKey(raw),
      keyPrefix: raw.slice(0, 12),
      userId,
      skipIneVerification: opts.skipIne ?? false,
      active: opts.active ?? true,
      revokedAt: opts.revokedAt ?? null,
      expiresAt: opts.expiresAt ?? null,
    },
  });
  return raw;
}

export async function cleanupPublisherUsers(
  app: FastifyInstance,
  emails: string[],
): Promise<void> {
  const users = await app.prisma.user.findMany({
    where: { email: { in: emails } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length === 0) return;

  await app.prisma.publisherApiKey.deleteMany({
    where: { userId: { in: ids } },
  });
  await app.prisma.property.deleteMany({ where: { sellerId: { in: ids } } });
  await app.prisma.userDocument.deleteMany({ where: { userId: { in: ids } } });
  await app.prisma.userRole.deleteMany({ where: { userId: { in: ids } } });
  await app.prisma.auditLog.deleteMany({ where: { actorUserId: { in: ids } } });
  await app.prisma.user.deleteMany({ where: { id: { in: ids } } });
}

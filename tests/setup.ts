import { beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

beforeAll(async () => {
  const requiredRoles = [
    "admin",
    "client",
    "owner",
    "agent",
  ];
  const roleMap: Record<string, string> = {};

  for (const roleName of requiredRoles) {
    const role =
      (await prisma.role.findUnique({ where: { name: roleName } })) ||
      (await prisma.role.create({ data: { name: roleName } }));
    roleMap[roleName] = role.id;
  }

  const ensureUserWithRoles = async (
    email: string,
    name: string,
    password: string,
    roleNames: string[],
  ) => {
    let user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    // Always set the known test password. The seed creates the same accounts
    // with different passwords, so create-if-missing left stale credentials
    // and every seeded login returned 401.
    const hashedPassword = await bcrypt.hash(password, 10);

    if (!user) {
      user = await prisma.user.create({
        data: {
          email,
          name,
          password: hashedPassword,
        },
        select: { id: true },
      });
    } else {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
          // A previous run with stale seed credentials may have locked the
          // account; clear the lockout so the known password works.
          failedLoginAttempts: 0,
          lockedUntil: null,
          lastFailedLoginAt: null,
        },
      });
    }

    for (const roleName of roleNames) {
      const roleId = roleMap[roleName];
      const existing = await prisma.userRole.findFirst({
        where: {
          userId: user.id,
          roleId,
        },
        select: { id: true },
      });

      if (!existing) {
        await prisma.userRole.create({
          data: {
            userId: user.id,
            roleId,
            status: "approved",
          },
        });
      }
    }
  };

  await ensureUserWithRoles(
    "admin@casamx.local",
    "Test Admin",
    process.env.TEST_ADMIN_PASSWORD || "admin123",
    ["admin"],
  );
  await ensureUserWithRoles(
    "seller@casamx.local",
    "Seed Owner",
    process.env.TEST_SELLER_PASSWORD || "seller123",
    ["owner"],
  );
  await ensureUserWithRoles(
    "buyer@casamx.local",
    "Seed Buyer",
    process.env.TEST_CLIENT_PASSWORD || "buyer123",
    ["client"],
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});

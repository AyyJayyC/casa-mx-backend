import { beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

beforeAll(async () => {
  const requiredRoles = ['admin', 'landlord', 'buyer', 'seller', 'tenant', 'wholesaler'];
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

    if (!user) {
      const hashedPassword = await bcrypt.hash(password, 10);
      user = await prisma.user.create({
        data: {
          email,
          name,
          password: hashedPassword,
        },
        select: { id: true },
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
            status: 'approved',
          },
        });
      }
    }
  };

  await ensureUserWithRoles('admin@casamx.local', 'Test Admin', 'admin123', ['admin']);
  await ensureUserWithRoles('seller@casamx.local', 'Seed Seller', 'seller123', ['seller', 'landlord']);
});

afterAll(async () => {
  await prisma.$disconnect();
});
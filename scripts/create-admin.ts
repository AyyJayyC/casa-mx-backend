import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  const email = "5axelj@gmail.com";
  const password = "CasaMX2026!";
  const name = "Axel Castro";

  // Create user with all roles pre-approved
  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      name,
      password: hashedPassword,
      emailVerified: true,
      referralCode: "ADMIN01",
      roles: {
        create: [
          { role: { connect: { name: "admin" } }, status: "approved" },
          { role: { connect: { name: "buyer" } }, status: "approved" },
          { role: { connect: { name: "seller" } }, status: "approved" },
          { role: { connect: { name: "landlord" } }, status: "approved" },
          { role: { connect: { name: "tenant" } }, status: "approved" },
        ],
      },
    },
    update: {
      password: hashedPassword,
      emailVerified: true,
    },
    include: { roles: true },
  });

  console.log("✅ Admin user ready:");
  console.log(`   Email: ${user.email}`);
  console.log(
    `   Roles: ${user.roles.map((r) => `${r.roleName} (${r.status})`).join(", ")}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

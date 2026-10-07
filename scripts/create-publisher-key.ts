import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";

/**
 * Create a Casa MX Publisher API key.
 *
 * Usage:
 *   tsx scripts/create-publisher-key.ts --user <email|id> --label <name> [--skip-ine]
 *
 * The raw key is printed once and never stored — only its sha256 hash and a
 * short prefix are persisted.
 */

const prisma = new PrismaClient();

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--skip-ine") {
      args.skipIne = true;
    } else if (arg.startsWith("--")) {
      args[arg.slice(2)] = argv[++i] ?? "";
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const userRef = typeof args.user === "string" ? args.user : "";
  const label = typeof args.label === "string" && args.label ? args.label : "publisher";

  if (!userRef) {
    console.error(
      "Usage: tsx scripts/create-publisher-key.ts --user <email|id> --label <name> [--skip-ine]",
    );
    process.exit(1);
  }

  const user = await prisma.user.findFirst({
    where: { OR: [{ id: userRef }, { email: userRef }] },
    select: { id: true, email: true },
  });
  if (!user) {
    console.error(`No user found for "${userRef}"`);
    process.exit(1);
  }

  const raw = "cmx_pub_" + randomBytes(32).toString("base64url");
  const keyHash = createHash("sha256").update(raw).digest("hex");
  const keyPrefix = raw.slice(0, 12);

  const key = await prisma.publisherApiKey.create({
    data: {
      label,
      keyHash,
      keyPrefix,
      userId: user.id,
      skipIneVerification: Boolean(args.skipIne),
    },
  });

  console.log("Publisher API key created. It is shown ONCE:\n");
  console.log(`  ${raw}\n`);
  console.log("  id:                 " + key.id);
  console.log("  user:               " + user.email);
  console.log("  prefix:             " + keyPrefix);
  console.log("  skipIneVerification: " + key.skipIneVerification);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

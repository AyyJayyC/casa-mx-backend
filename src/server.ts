import { buildApp } from "./app.js";
import { env } from "./config/env.js";
import { cacheService } from "./services/cache.service.js";
import {
  isConfigured as isEmailConfigured,
  verifyConnection as verifyEmail,
} from "./services/email.service.js";

let appInstance: Awaited<ReturnType<typeof buildApp>> | null = null;

async function gracefulShutdown(signal: string) {
  if (!appInstance) {
    process.exit(0);
    return;
  }

  appInstance.log.info(`${signal} received. Starting graceful shutdown...`);

  try {
    await appInstance.close();
    await cacheService.close();
    appInstance.log.info("Graceful shutdown complete");
    process.exit(0);
  } catch (error) {
    appInstance.log.error({ err: error }, "Error during graceful shutdown");
    process.exit(1);
  }
}

async function runStartupChecks() {
  const checks: string[] = [];
  let critical = false;

  console.log("[startup] Running pre-flight checks...");

  // Email service
  if (isEmailConfigured()) {
    console.log("[startup] Verifying email service (Resend)...");
    const emailResult = await verifyEmail();
    if (!emailResult.ok) {
      console.warn(
        "[startup] Email domain check:",
        emailResult.error,
        "(non-fatal — emails may still send if domain is verified in Resend)",
      );
      checks.push(`Email: degraded — ${emailResult.error}`);
      // NOT critical — domain verification failure doesn't crash the server
    } else {
      console.log("[startup] Email service: OK");
      checks.push("Email: OK");
    }
  } else {
    if (env.NODE_ENV === "production") {
      console.error(
        "[startup] RESEND_API_KEY not configured — emails will NOT be sent",
      );
      checks.push("Email: NOT CONFIGURED (CRITICAL)");
      critical = true;
    } else {
      console.warn(
        "[startup] RESEND_API_KEY not configured (non-production, continuing)",
      );
      checks.push("Email: not configured (dev OK)");
    }
  }

  // Stripe
  if (env.STRIPE_SECRET_KEY) {
    checks.push("Stripe: configured");
  } else {
    if (env.NODE_ENV === "production") {
      console.warn(
        "[startup] STRIPE_SECRET_KEY not configured (payments will fail)",
      );
      checks.push("Stripe: not configured");
    } else {
      checks.push("Stripe: not configured (dev OK)");
    }
  }

  // DB reachability
  try {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    await prisma.$queryRaw`SELECT 1`;
    await prisma.$disconnect();
    checks.push("Database: OK");
  } catch (err: any) {
    console.error("[startup] Database unreachable:", err.message);
    checks.push("Database: UNREACHABLE");
    critical = true;
  }

  console.log("[startup] Pre-flight results:");
  checks.forEach((c) => console.log(`  ${c}`));

  if (critical && env.NODE_ENV === "production") {
    console.error("[startup] Critical service failures — aborting startup");
    process.exit(1);
  }
}

async function start() {
  console.log("[startup] Beginning server initialization...");
  try {
    await runStartupChecks();

    console.log("[startup] Building app...");
    appInstance = await buildApp();
    console.log("[startup] App built, starting to listen...");

    await appInstance.listen({
      port: parseInt(env.PORT),
      host: "0.0.0.0",
    });

    appInstance.log.info(`Server listening on http://localhost:${env.PORT}`);
    appInstance.log.info(`Health check: http://localhost:${env.PORT}/health`);
    console.log(`[startup] Server ready on port ${env.PORT}`);
  } catch (error) {
    console.error("[startup] Failed to start server:", error);
    process.exit(1);
  }
}

process.on("SIGTERM", () => {
  void gracefulShutdown("SIGTERM");
});

process.on("SIGINT", () => {
  void gracefulShutdown("SIGINT");
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  void gracefulShutdown("SIGTERM");
});

start();

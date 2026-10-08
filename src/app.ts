import Fastify from "fastify";
import * as Sentry from "@sentry/node";
import cookie from "@fastify/cookie";
import csrfProtection from "@fastify/csrf-protection";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import bcrypt from "bcrypt";
import { env } from "./config/env.js";
import { deriveCookieDomain } from "./utils/cookies.js";
import prismaPlugin from "./plugins/prisma.js";
import jwtPlugin from "./plugins/jwt.js";
import setupLoggingMiddleware from "./plugins/logging.js";
import mapsMonitor from "./plugins/mapsMonitor.js";
import healthRoutes from "./routes/health.js";
import versionRoutes from "./routes/version.js";
import authRoutes from "./routes/auth.js";
import { bootstrapAdmin } from "./plugins/bootstrapAdmin.js";
import adminRoutes from "./routes/admin.js";
import adminMapsRoutes from "./routes/admin/maps.js";
import mapsRoutes from "./routes/maps.js";
import locationsRoutes from "./routes/locations.js";
import analyticsRoutes from "./routes/analytics.js";
import propertiesRoutes from "./routes/properties.js";
import propertyImagesRoutes from "./routes/propertyImages.js";
import propertyDocumentsRoutes from "./routes/propertyDocuments.js";
import userDocumentsRoutes from "./routes/userDocuments.js";
import applicationsRoutes from "./routes/applications.js";
import requestsRoutes from "./routes/requests.js";
import usersRoutes from "./routes/users.js";
import creditsRoutes from "./routes/credits.js";
import documentsRoutes from "./routes/documents.js";
import negotiationsRoutes from "./routes/negotiations.js";
import offersRoutes from "./routes/offers.js";
import leadsRoutes from "./routes/leads.js";
import notificationsRoutes from "./routes/notifications.js";
import contractsRoutes from "./routes/contracts.js";
import verificationRoutes from "./routes/verification.js";
import referralsRoutes from "./routes/referrals.js";
import agenciesRoutes from "./routes/agencies.js";
import buyersRoutes from "./routes/buyers.js";
import carouselRoutes from "./routes/carousel.js";
import tagsRoutes from "./routes/tags.js";
import setupDebugRoutes from "./routes/debug.js";
import publisherAuth from "./plugins/publisherAuth.js";
import publisherRoutes from "./routes/publisher.js";

import {
  normalizeError,
  type ErrorWithStatusCode,
} from "./utils/errorHandling.js";
import { MapsService } from "./services/maps.service.js";
import { LoggingService } from "./services/logging.service.js";

export async function buildApp(
  options: { forceSecurity?: boolean } = {},
) {
  // `forceSecurity` lets tests exercise the hardened path even though the test
  // env sets DISABLE_SECURITY=true.
  const disableSecurity =
    env.DISABLE_SECURITY === "true" && !options.forceSecurity;

  const isLocalFrontend =
    env.FRONTEND_URL.includes("localhost") ||
    env.FRONTEND_URL.includes("127.0.0.1") ||
    env.FRONTEND_URL.includes("0.0.0.0");

  const app = Fastify({
    // Behind the Railway edge proxy: trust X-Forwarded-For so request.ip (and
    // therefore rate-limit buckets) reflects the real client, not the edge.
    trustProxy: true,
    bodyLimit: 5 * 1024 * 1024, // 5 MB
    maxParamLength: 100,
    connectionTimeout: 5000,
    keepAliveTimeout: 10000,
    logger: {
      level: env.NODE_ENV === "production" ? "info" : "debug",
      // Never log publisher API keys.
      redact: {
        paths: ['req.headers["x-api-key"]', "req.headers.x-api-key", "x-api-key"],
        censor: "[REDACTED]",
      },
      transport:
        env.NODE_ENV !== "production"
          ? {
              target: "pino-pretty",
              options: {
                colorize: true,
                translateTime: "HH:MM:ss",
                ignore: "pid,hostname",
              },
            }
          : undefined,
    },
  });

  const frontendUrl = env.FRONTEND_URL.replace(/\/$/, "");

  // Register CORS — strict allowlist. No wildcard *.vercel.app: preview
  // origins must be listed explicitly via CORS_EXTRA_ORIGINS (comma-separated).
  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      const extra = (process.env.CORS_EXTRA_ORIGINS ?? "")
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean);
      const allowed = new Set<string>([
        frontendUrl,
        "https://casa-mx.com",
        "https://www.casa-mx.com",
        ...extra,
      ]);
      callback(null, allowed.has(origin));
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  // Helmet — enabled by default, disabled when DISABLE_SECURITY=true
  if (!disableSecurity) {
    await app.register(helmet, {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: [
            "'self'",
            "'strict-dynamic'",
            "https://js.stripe.com",
            "https://maps.googleapis.com",
          ],
          styleSrc: [
            "'self'",
            "'strict-dynamic'",
            "https://fonts.googleapis.com",
          ],
          imgSrc: [
            "'self'",
            "data:",
            "blob:",
            "https://*.unsplash.com",
            "https://*.tile.openstreetmap.org",
            "https://maps.googleapis.com",
          ],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          connectSrc: [
            "'self'",
            "https://api.stripe.com",
            "https://*.tile.openstreetmap.org",
          ],
          frameSrc: ["https://js.stripe.com", "https://hooks.stripe.com"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'", "https://hooks.stripe.com"],
          upgradeInsecureRequests: [],
        },
      },
      crossOriginResourcePolicy: { policy: "cross-origin" },
      global: true,
    });
  }

  // Register the Publisher API auth hook BEFORE rate limiting so that
  // request.publisher is set when the per-key rate-limit keyGenerator runs.
  // The hook is inert on non-/publisher paths.
  if (env.ENABLE_PUBLISHER_API === "true") {
    await app.register(publisherAuth);
  }

  // Register rate limiting
  await app.register(rateLimit, {
    max: env.NODE_ENV === "test" ? 500 : isLocalFrontend ? 1000 : 100,
    timeWindow: "15 minutes", // Per 15 minute window
    cache: 10000, // Cache size
    skipOnError: true, // Don't fail if Redis/cache unavailable
  });

  // Register plugins
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } }); // 10 MB max

  // Preserve raw body for Stripe webhook signature verification
  if (!disableSecurity) {
    app.addContentTypeParser(
      "application/json",
      { parseAs: "buffer" },
      (req, body, done) => {
        (req as any).rawBody = body;
        try {
          done(null, body.length ? JSON.parse(body.toString()) : {});
        } catch (e: any) {
          done(e, undefined);
        }
      },
    );
  }
  await app.register(prismaPlugin);

  // Initialize services with the Prisma instance from the plugin
  MapsService.init(app.prisma);
  LoggingService.init(app.prisma);

  await app.register(cookie);
  if (!disableSecurity) {
    // Match the auth cookies' domain so the SPA (served from casa-mx.com) can
    // READ the readable `csrfToken` cookie that the API (api.casa-mx.com) sets.
    // Without a shared domain the cookie is host-only to the API, so
    // `document.cookie` on the SPA can't see it -> no `x-csrf-token` header ->
    // 403 on every cookie-authenticated POST.
    const csrfCookieDomain = deriveCookieDomain(env.FRONTEND_URL);

    await app.register(csrfProtection, {
      // `_csrf` holds the secret and stays httpOnly; the derived token is
      // mirrored into the readable `csrfToken` cookie for the SPA.
      cookieOpts: {
        signed: false,
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        path: "/",
        ...(csrfCookieDomain ? { domain: csrfCookieDomain } : {}),
      },
    });

    // Issue/refresh a double-submit token on every request so the SPA always
    // has one before its first mutation.
    app.addHook("onRequest", (_request, reply, done) => {
      try {
        const token = (reply as any).generateCsrf();
        if (token) {
          reply.setCookie("csrfToken", token, {
            httpOnly: false,
            sameSite: "lax",
            secure: true,
            path: "/",
            ...(csrfCookieDomain ? { domain: csrfCookieDomain } : {}),
          });
        }
      } catch {
        // Ignore — the enforcement hook below decides what to do.
      }
      done();
    });

    // Enforce CSRF on state-changing requests. Exemptions:
    //  - Stripe webhook: authenticated by signature, not cookies.
    //  - Auth bootstrap routes: they run before a token can exist; login CSRF
    //    is mitigated by SameSite=Lax + the strict CORS allowlist.
    const csrfExempt = new Set([
      "POST /credits/webhook",
      "POST /auth/register",
      "POST /auth/login",
      "POST /auth/refresh",
      "POST /auth/forgot-password",
      "POST /auth/reset-password",
    ]);

    // Cast to any: @fastify/csrf-protection's handler uses the callback style,
    // which doesn't line up with Fastify's async preHandler overload here.
    app.addHook(
      "preHandler",
      ((request: any, reply: any, done: any) => {
        const method = request.method.toUpperCase();
        if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
          return done();
        }
        const path = request.url.split("?")[0];
        if (csrfExempt.has(`${method} ${path}`)) {
          return done();
        }
        // Publisher API authenticates with X-API-Key (no cookies) — exempt the
        // exact /publisher/ prefix from cookie-based CSRF enforcement.
        if (path.startsWith("/publisher/")) {
          return done();
        }
        return (app as any).csrfProtection(request, reply, done);
      }) as any,
    );
  }
  await app.register(jwtPlugin);

  if (env.NODE_ENV === "test") {
    const requiredRoles = [
      "admin",
      "client",
      "owner",
      "agent",
    ];
    const roleMap: Record<string, string> = {};

    for (const roleName of requiredRoles) {
      const role =
        (await app.prisma.role.findUnique({ where: { name: roleName } })) ||
        (await app.prisma.role.create({ data: { name: roleName } }));
      roleMap[roleName] = role.id;
    }

    const adminEmail = "admin@casamx.local";
    const existingAdmin = await app.prisma.user.findUnique({
      where: { email: adminEmail },
      select: { id: true },
    });

    let adminId = existingAdmin?.id;

    if (!adminId) {
      const hashedPassword = await bcrypt.hash(env.TEST_ADMIN_PASSWORD, 10);
      const created = await app.prisma.user.create({
        data: {
          email: adminEmail,
          name: "Test Admin",
          password: hashedPassword,
        },
        select: { id: true },
      });
      adminId = created.id;
    }

    const existingAdminRole = await app.prisma.userRole.findFirst({
      where: { userId: adminId, roleId: roleMap.admin },
      select: { id: true },
    });

    if (!existingAdminRole) {
      await app.prisma.userRole.create({
        data: {
          userId: adminId,
          roleId: roleMap.admin,
          status: "approved",
        },
      });
    }

    const seededSellerEmail = "seller@casamx.local";
    const existingSeller = await app.prisma.user.findUnique({
      where: { email: seededSellerEmail },
      select: { id: true },
    });

    let sellerId = existingSeller?.id;

    if (!sellerId) {
      const hashedPassword = await bcrypt.hash(env.TEST_OWNER_PASSWORD, 10);
      const seller = await app.prisma.user.create({
        data: {
          email: seededSellerEmail,
          name: "Seed Seller",
          password: hashedPassword,
          emailVerified: true,
        },
        select: { id: true },
      });
      sellerId = seller.id;
    } else {
      await app.prisma.user.update({
        where: { id: sellerId },
        data: { emailVerified: true },
      });
    }

    const ensureRoleAssignment = async (roleName: string) => {
      const roleId = roleMap[roleName];
      const existing = await app.prisma.userRole.findFirst({
        where: { userId: sellerId, roleId },
        select: { id: true },
      });
      if (!existing) {
        await app.prisma.userRole.create({
          data: {
            userId: sellerId,
            roleId,
            status: "approved",
          },
        });
      }
    };

    await ensureRoleAssignment("owner");
  }

  // Setup logging middleware and debug routes
  await setupLoggingMiddleware(app);
  await setupDebugRoutes(app);
  // Start maps usage monitor (alerts + hard-stop enforcement)
  await app.register(mapsMonitor);

  // Bootstrap admin user if ADMIN_EMAIL is set
  await bootstrapAdmin(app);

  // Register routes
  app.get("/", async (_request, reply) => {
    return reply.send({
      name: "Casa MX API",
      version: "1.0.0",
      docs: "https://github.com/anomalyco/casa-mx",
      health: "/health",
    });
  });

  await app.register(healthRoutes);
  await app.register(versionRoutes);
  await app.register(authRoutes);
  await app.register(adminRoutes);
  await app.register(adminMapsRoutes);
  await app.register(mapsRoutes);
  await app.register(locationsRoutes);
  await app.register(analyticsRoutes);
  await app.register(propertiesRoutes);
  await app.register(propertyImagesRoutes);
  await app.register(propertyDocumentsRoutes);
  await app.register(userDocumentsRoutes);
  await app.register(applicationsRoutes);
  await app.register(requestsRoutes);
  await app.register(usersRoutes);
  await app.register(creditsRoutes);
  await app.register(documentsRoutes);
  await app.register(negotiationsRoutes);
  await app.register(offersRoutes);
  await app.register(leadsRoutes);
  await app.register(notificationsRoutes);
  await app.register(contractsRoutes);
  await app.register(verificationRoutes);
  await app.register(referralsRoutes);
  await app.register(agenciesRoutes);
  await app.register(buyersRoutes);
  await app.register(carouselRoutes);
  await app.register(tagsRoutes);

  // Publisher API is opt-in via env.
  if (env.ENABLE_PUBLISHER_API === "true") {
    await app.register(publisherRoutes, { prefix: "/publisher" });
  }

  // Global error handler for production logging
  app.setErrorHandler(async (error, request, reply) => {
    const { errorObj, statusCode } = normalizeError(error);

    // For 500 errors, log structured + send to Sentry if configured
    if (statusCode === 500) {
      const errorLog = {
        timestamp: new Date().toISOString(),
        level: "error",
        requestId: request.id,
        method: request.method,
        url: request.url,
        statusCode,
        message: errorObj.message,
        stack: errorObj.stack,
        service: "casa-mx-backend",
      };

      app.log.error(errorLog, "Unhandled server error");

      // Forward to Sentry when configured (no-op without a DSN).
      if (env.SENTRY_DSN) {
        Sentry.captureException(errorObj);
      }
    }

    // Send error response
    const isProduction = env.NODE_ENV === "production";
    const isServerError = statusCode >= 500;
    return reply.code(statusCode).send({
      success: false,
      error:
        isProduction && isServerError
          ? "Internal server error"
          : errorObj.message || "Internal server error",
      ...(!isProduction && { stack: errorObj.stack }),
    });
  });

  return app;
}

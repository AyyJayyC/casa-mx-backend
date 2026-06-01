import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import csrfProtection from '@fastify/csrf-protection';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import bcrypt from 'bcrypt';
import { env } from './config/env.js';
import prismaPlugin from './plugins/prisma.js';
import jwtPlugin from './plugins/jwt.js';
import setupLoggingMiddleware from './plugins/logging.js';
import mapsMonitor from './plugins/mapsMonitor.js';
import healthRoutes from './routes/health.js';
import versionRoutes from './routes/version.js';
import authRoutes from './routes/auth.js';
import { bootstrapAdmin } from './plugins/bootstrapAdmin.js';
import adminRoutes from './routes/admin.js';
import adminMapsRoutes from './routes/admin/maps.js';
import mapsRoutes from './routes/maps.js';
import locationsRoutes from './routes/locations.js';
import analyticsRoutes from './routes/analytics.js';
import propertiesRoutes from './routes/properties.js';
import propertyImagesRoutes from './routes/propertyImages.js';
import propertyDocumentsRoutes from './routes/propertyDocuments.js';
import userDocumentsRoutes from './routes/userDocuments.js';
import applicationsRoutes from './routes/applications.js';
import requestsRoutes from './routes/requests.js';
import usersRoutes from './routes/users.js';
import reviewsRoutes from './routes/reviews.js';
import creditsRoutes from './routes/credits.js';
import documentsRoutes from './routes/documents.js';
import negotiationsRoutes from './routes/negotiations.js';
import offersRoutes from './routes/offers.js';
import notificationsRoutes from './routes/notifications.js';
import contractsRoutes from './routes/contracts.js';
import verificationRoutes from './routes/verification.js';
import referralsRoutes from './routes/referrals.js';
import agenciesRoutes from './routes/agencies.js';
import buyersRoutes from './routes/buyers.js';
import setupDebugRoutes from './routes/debug.js';

import { normalizeError, type ErrorWithStatusCode } from './utils/errorHandling.js';
import { MapsService } from './services/maps.service.js';
import { LoggingService } from './services/logging.service.js';

export async function buildApp() {
  const isLocalFrontend =
    env.FRONTEND_URL.includes('localhost') ||
    env.FRONTEND_URL.includes('127.0.0.1') ||
    env.FRONTEND_URL.includes('0.0.0.0');

  const app = Fastify({
    bodyLimit: 5 * 1024 * 1024, // 5 MB
    maxParamLength: 100,
    connectionTimeout: 5000,
    keepAliveTimeout: 10000,
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport: env.NODE_ENV !== 'production'
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
    },
  });

  const frontendUrl = env.FRONTEND_URL.replace(/\/$/, '');

  const allowedOrigins = new Set<string>([
    frontendUrl,
    'https://casa-mx.com',
    'https://www.casa-mx.com',
  ]);
  const isDev = env.NODE_ENV !== 'production';

  if (isDev || process.env.ALLOW_PREVIEW_ORIGINS === 'true') {
    allowedOrigins.add('http://localhost:3000');
    allowedOrigins.add('http://127.0.0.1:3000');
    allowedOrigins.add('http://0.0.0.0:3000');
    for (let port = 3001; port <= 3010; port++) {
      allowedOrigins.add(`http://localhost:${port}`);
      allowedOrigins.add(`http://127.0.0.1:${port}`);
    }
  }

  function isOriginAllowed(origin: string): boolean {
    if (allowedOrigins.has(origin)) return true;
    // Always allow Vercel preview deployments (safe — URLs are unique to each project)
    if (/^https:\/\/.*\.vercel\.app$/.test(origin)) return true;
    return false;
  }

  // Register CORS
  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (isOriginAllowed(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'strict-dynamic'", "https://js.stripe.com", "https://maps.googleapis.com"],
        styleSrc: ["'self'", "'strict-dynamic'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "blob:", "https://*.unsplash.com", "https://*.tile.openstreetmap.org", "https://maps.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        connectSrc: ["'self'", "https://api.stripe.com", "https://*.tile.openstreetmap.org"],
        frameSrc: ["https://js.stripe.com", "https://hooks.stripe.com"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'", "https://hooks.stripe.com"],
        upgradeInsecureRequests: [],
      },
    },
    global: true,
  });

  // Register rate limiting
  await app.register(rateLimit, {
    max: env.NODE_ENV === 'test' ? 500 : isLocalFrontend ? 1000 : 100,
    timeWindow: '15 minutes', // Per 15 minute window
    cache: 10000, // Cache size
    skipOnError: true, // Don't fail if Redis/cache unavailable
  });

  // Register plugins
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } }); // 10 MB max

  // Preserve raw body for Stripe webhook signature verification
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    (req as any).rawBody = body;
    try {
      done(null, body.length ? JSON.parse(body.toString()) : {});
    } catch (e: any) {
      done(e, undefined);
    }
  });
  await app.register(prismaPlugin);

  // Initialize services with the Prisma instance from the plugin
  MapsService.init(app.prisma);
  LoggingService.init(app.prisma);

  await app.register(cookie);
  await app.register(csrfProtection, { cookieOpts: { signed: false } });
  await app.register(jwtPlugin);

  if (env.NODE_ENV === 'test') {
    const requiredRoles = ['admin', 'landlord', 'buyer', 'seller', 'tenant', 'wholesaler'];
    const roleMap: Record<string, string> = {};

    for (const roleName of requiredRoles) {
      const role =
        (await app.prisma.role.findUnique({ where: { name: roleName } })) ||
        (await app.prisma.role.create({ data: { name: roleName } }));
      roleMap[roleName] = role.id;
    }

    const adminEmail = 'admin@casamx.local';
    const existingAdmin = await app.prisma.user.findUnique({
      where: { email: adminEmail },
      select: { id: true },
    });

    let adminId = existingAdmin?.id;

    if (!adminId) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      const created = await app.prisma.user.create({
        data: {
          email: adminEmail,
          name: 'Test Admin',
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
          status: 'approved',
        },
      });
    }

    const seededSellerEmail = 'seller@casamx.local';
    const existingSeller = await app.prisma.user.findUnique({
      where: { email: seededSellerEmail },
      select: { id: true },
    });

    let sellerId = existingSeller?.id;

    if (!sellerId) {
      const hashedPassword = await bcrypt.hash('seller123', 10);
      const seller = await app.prisma.user.create({
        data: {
          email: seededSellerEmail,
          name: 'Seed Seller',
          password: hashedPassword,
        },
        select: { id: true },
      });
      sellerId = seller.id;
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
            status: 'approved',
          },
        });
      }
    };

    await ensureRoleAssignment('seller');
    await ensureRoleAssignment('landlord');
  }

  // Setup logging middleware and debug routes
  await setupLoggingMiddleware(app);
  await setupDebugRoutes(app);
  // Start maps usage monitor (alerts + hard-stop enforcement)
  await app.register(mapsMonitor);

  // Bootstrap admin user if ADMIN_EMAIL is set
  await bootstrapAdmin(app);

  // Register routes
  app.get('/', async (_request, reply) => {
    return reply.send({
      name: 'Casa MX API',
      version: '1.0.0',
      docs: 'https://github.com/anomalyco/casa-mx',
      health: '/health',
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
  await app.register(reviewsRoutes);
  await app.register(creditsRoutes);
  await app.register(documentsRoutes);
  await app.register(negotiationsRoutes);
  await app.register(offersRoutes);
  await app.register(notificationsRoutes);
  await app.register(contractsRoutes);
  await app.register(verificationRoutes);
  await app.register(referralsRoutes);
  await app.register(agenciesRoutes);
  await app.register(buyersRoutes);

  // Global error handler for production logging
  app.setErrorHandler(async (error, request, reply) => {
    const { errorObj, statusCode } = normalizeError(error);
    
    // For 500 errors, log structured + send to Sentry if configured
    if (statusCode === 500) {
      const errorLog = {
        timestamp: new Date().toISOString(),
        level: 'error',
        requestId: request.id,
        method: request.method,
        url: request.url,
        statusCode,
        message: errorObj.message,
        stack: errorObj.stack,
        service: 'casa-mx-backend',
      };
      
      // Sentry capture (non-blocking)
      if (env.SENTRY_DSN) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const Sentry: any = require('@sentry/node');
          if (!Sentry.isInitialized?.()) {
            Sentry.init?.({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV, tracesSampleRate: 0.1 });
          }
          Sentry.captureException?.(error, { extra: errorLog });
        } catch { /* Sentry not installed or unavailable */ }
      }
      
      app.log.error(errorLog, 'Unhandled server error');
    }

      // Send error response
      const isProduction = env.NODE_ENV === 'production';
    return reply.code(statusCode).send({
      success: false,
        error: isProduction ? 'Internal server error' : (errorObj.message || 'Internal server error'),
        ...(!isProduction && { stack: errorObj.stack }),
    });
  });

  return app;
}


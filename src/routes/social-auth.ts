/**
 * Social Authentication Routes
 *
 * Implements OAuth 2.0 flows for Google, Facebook, and Apple.
 * Each provider follows the same pattern:
 *   1. GET /auth/social/:provider  → redirect to provider's OAuth page
 *   2. GET /auth/social/:provider/callback → exchange code for token, create/link account
 *
 * Since we don't pull in a heavy OAuth library, the flows use fetch() to talk to
 * provider token endpoints directly, keeping the footprint small.
 *
 * Apple Sign-In uses a JWT client secret that must be generated separately when
 * the Apple credentials are configured.
 */
import { FastifyPluginAsync } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env.js';
import { AuthService } from '../services/auth.service.js';

// In-memory state store (replace with Redis in production for multi-instance)
const oauthStateStore = new Map<string, { provider: string; expiresAt: number }>();

const providerSchema = z.enum(['google', 'facebook', 'apple']);

const callbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string(),
  error: z.string().optional(),
  id_token: z.string().optional(), // Apple uses id_token in some flows
});

const socialAuthRoutes: FastifyPluginAsync = async (fastify) => {
  const authService = new AuthService(fastify.prisma);

  const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.NODE_ENV === 'production',
    path: '/',
  };

  // GET /auth/social/:provider - Initiate OAuth flow
  fastify.get('/auth/social/:provider', async (request, reply) => {
    try {
      const rawProvider = (request.params as any).provider;
      const parsed = providerSchema.safeParse(rawProvider);

      if (!parsed.success) {
        return reply.code(400).send({ success: false, error: 'Unsupported provider' });
      }

      const provider = parsed.data;
      const state = randomBytes(16).toString('hex');
      oauthStateStore.set(state, { provider, expiresAt: Date.now() + 10 * 60 * 1000 });

      const redirectUri = buildCallbackUri(provider);
      const authUrl = buildAuthUrl(provider, state, redirectUri);

      if (!authUrl) {
        return reply.code(503).send({
          success: false,
          error: `${provider} OAuth is not configured on this server`,
        });
      }

      return reply.redirect(authUrl);
    } catch (error: any) {
      return reply.code(400).send({ success: false, error: 'Unsupported provider' });
    }
  });

  // GET /auth/social/:provider/callback - Handle OAuth callback
  fastify.get('/auth/social/:provider/callback', async (request, reply) => {
    try {
      const providerName = (request.params as any).provider as string;
      const parsed = providerSchema.safeParse(providerName);

      if (!parsed.success) {
        return reply.code(400).send({ success: false, error: 'Unsupported provider' });
      }

      const provider = parsed.data;
      const query = callbackQuerySchema.parse(request.query);

      if (query.error) {
        return reply.redirect(`${env.FRONTEND_URL}/auth/error?reason=${encodeURIComponent(query.error)}`);
      }

      // Validate state
      const stateEntry = oauthStateStore.get(query.state);
      if (!stateEntry || stateEntry.expiresAt < Date.now() || stateEntry.provider !== provider) {
        return reply.code(400).send({ success: false, error: 'Invalid or expired OAuth state' });
      }
      oauthStateStore.delete(query.state);

      // Exchange code for profile
      const profile = await exchangeCodeForProfile(provider, query.code ?? '', query.id_token);
      if (!profile) {
        return reply.code(400).send({ success: false, error: 'Failed to retrieve user profile from provider' });
      }

      // Find or create user
      const { user, isNew } = await findOrCreateSocialUser(fastify.prisma, provider, profile);

      // Issue JWT
      const token = fastify.jwt.sign(
        {
          id: user.id,
          email: user.email,
          roles: user.roles
            .filter((r: any) => r.status === 'approved')
            .map((r: any) => r.role.name),
        },
        { expiresIn: '15m' },
      );

      reply.setCookie('accessToken', token, { ...cookieOptions, maxAge: 60 * 15 });

      return reply.redirect(
        `${env.FRONTEND_URL}/auth/social/success?token=${token}&new=${isNew}`,
      );
    } catch (error: any) {
      fastify.log.error(error);
      return reply.redirect(`${env.FRONTEND_URL}/auth/error?reason=server_error`);
    }
  });
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildCallbackUri(provider: string): string {
  const backendUrl =
    process.env.BACKEND_URL ??
    `http://localhost:${env.PORT ?? 3001}`;
  return `${backendUrl}/auth/social/${provider}/callback`;
}

function buildAuthUrl(provider: string, state: string, redirectUri: string): string | null {
  switch (provider) {
    case 'google': {
      if (!env.GOOGLE_CLIENT_ID) return null;
      const params = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        access_type: 'offline',
        prompt: 'select_account',
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    }
    case 'facebook': {
      if (!env.FACEBOOK_APP_ID) return null;
      const params = new URLSearchParams({
        client_id: env.FACEBOOK_APP_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'email,public_profile',
        state,
      });
      return `https://www.facebook.com/v20.0/dialog/oauth?${params}`;
    }
    case 'apple': {
      // Apple requires a pre-generated client_secret JWT; skip if not configured
      const appleClientId = process.env.APPLE_CLIENT_ID;
      if (!appleClientId) return null;
      const params = new URLSearchParams({
        client_id: appleClientId,
        redirect_uri: redirectUri,
        response_type: 'code id_token',
        response_mode: 'form_post',
        scope: 'name email',
        state,
      });
      return `https://appleid.apple.com/auth/authorize?${params}`;
    }
    default:
      return null;
  }
}

interface SocialProfile {
  providerAccountId: string;
  email: string;
  name: string;
}

async function exchangeCodeForProfile(
  provider: string,
  code: string,
  idToken?: string,
): Promise<SocialProfile | null> {
  try {
    switch (provider) {
      case 'google': {
        if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            redirect_uri: buildCallbackUri('google'),
            grant_type: 'authorization_code',
          }),
        });
        const tokens = (await tokenRes.json()) as any;
        if (!tokens.access_token) return null;

        const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        const userInfo = (await userRes.json()) as any;
        return {
          providerAccountId: userInfo.id,
          email: userInfo.email,
          name: userInfo.name ?? userInfo.email,
        };
      }
      case 'facebook': {
        if (!env.FACEBOOK_APP_ID || !env.FACEBOOK_APP_SECRET) return null;
        const tokenRes = await fetch(
          `https://graph.facebook.com/v20.0/oauth/access_token?` +
            new URLSearchParams({
              client_id: env.FACEBOOK_APP_ID,
              client_secret: env.FACEBOOK_APP_SECRET,
              redirect_uri: buildCallbackUri('facebook'),
              code,
            }),
        );
        const tokens = (await tokenRes.json()) as any;
        if (!tokens.access_token) return null;

        const userRes = await fetch(
          `https://graph.facebook.com/me?fields=id,name,email&access_token=${tokens.access_token}`,
        );
        const userInfo = (await userRes.json()) as any;
        return {
          providerAccountId: userInfo.id,
          email: userInfo.email ?? `${userInfo.id}@facebook.com`,
          name: userInfo.name ?? userInfo.id,
        };
      }
      case 'apple': {
        // Apple provides an id_token (JWT) that we decode without verification here.
        // In production you should verify the JWT against Apple's public keys.
        const token = idToken ?? code;
        if (!token) return null;
        const payload = JSON.parse(
          Buffer.from(token.split('.')[1], 'base64url').toString('utf-8'),
        );
        return {
          providerAccountId: payload.sub,
          email: payload.email ?? `${payload.sub}@privaterelay.appleid.com`,
          name: payload.email ?? payload.sub,
        };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

async function findOrCreateSocialUser(
  prisma: any,
  provider: string,
  profile: SocialProfile,
): Promise<{ user: any; isNew: boolean }> {
  // Check if social account already exists
  const existing = await prisma.socialAccount.findUnique({
    where: {
      provider_providerAccountId: {
        provider,
        providerAccountId: profile.providerAccountId,
      },
    },
    include: {
      user: {
        include: { roles: { include: { role: true } } },
      },
    },
  });

  if (existing) {
    return { user: existing.user, isNew: false };
  }

  // Check if a user with this email already exists
  let user = await prisma.user.findUnique({
    where: { email: profile.email },
    include: { roles: { include: { role: true } } },
  });

  if (user) {
    // Link social account to existing user
    await prisma.socialAccount.create({
      data: {
        userId: user.id,
        provider,
        providerAccountId: profile.providerAccountId,
        email: profile.email,
      },
    });
    return { user, isNew: false };
  }

  // Create a brand-new user with the 'buyer' role by default
  const buyerRole = await prisma.role.findUnique({ where: { name: 'buyer' } });

  user = await prisma.user.create({
    data: {
      email: profile.email,
      name: profile.name,
      // password is null for social-only accounts
      socialAccounts: {
        create: {
          provider,
          providerAccountId: profile.providerAccountId,
          email: profile.email,
        },
      },
      ...(buyerRole
        ? {
            roles: {
              create: { roleId: buyerRole.id, status: 'approved' },
            },
          }
        : {}),
    },
    include: { roles: { include: { role: true } } },
  });

  return { user, isNew: true };
}

export default socialAuthRoutes;

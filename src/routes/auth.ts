import { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import crypto from "crypto";
import {
  RegisterSchema,
  LoginSchema,
  RefreshSchema,
  OAuthGoogleSchema,
  OAuthFacebookSchema,
  OAuthAppleSchema,
  ForgotPasswordSchema,
  ResetPasswordSchema,
} from "../schemas/auth.js";
import { AuthService } from "../services/auth.service.js";
import { refreshTokenStoreService } from "../services/refreshTokenStore.service.js";
import { env } from "../config/env.js";
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendNewLoginAlert,
  sendPasswordChangedEmail,
} from "../services/email.service.js";
import { generateAppleClientSecret } from "../services/apple.service.js";
import {
  isZodError,
  createValidationErrorResponse,
  createServerErrorResponse,
} from "../utils/errorHandling.js";

const authRoutes: FastifyPluginAsync = async (fastify) => {
  const authService = new AuthService(fastify.prisma);
  const isProduction = env.NODE_ENV === "production";
  const cookieOptions = {
    httpOnly: true,
    sameSite: (isProduction ? "lax" : "none") as "lax" | "none",
    secure: true,
    path: "/",
  };
  const isLocalFrontend =
    env.FRONTEND_URL.includes("localhost") ||
    env.FRONTEND_URL.includes("127.0.0.1") ||
    env.FRONTEND_URL.includes("0.0.0.0");

  fastify.post<{ Body: Record<string, any> }>(
    "/auth/register",
    {
      config: {
        rateLimit: {
          max: env.NODE_ENV === "test" ? 50 : isLocalFrontend ? 500 : 5,
          timeWindow: "15 minutes",
        },
      },
    },
    async (request, reply) => {
      try {
        const input = RegisterSchema.parse(request.body);
        const user = await authService.register(input);

        // Send verification email
        try {
          const token = crypto.randomBytes(32).toString("hex");
          const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
          await fastify.prisma.user.update({
            where: { id: user.id },
            data: {
              verificationToken: token,
              verificationTokenExpiresAt: expiresAt,
            },
          });
          await sendVerificationEmail({
            userEmail: user.email,
            userName: user.name,
            token,
          });
        } catch (emailErr) {
          fastify.log.error(
            { err: emailErr },
            "Failed to send verification email",
          );
        }

        return reply.code(201).send({
          success: true,
          user,
          message: "User registered successfully",
        });
      } catch (error: any) {
        if (isZodError(error)) {
          return reply.code(400).send(createValidationErrorResponse(error));
        }

        if (error.code === "P2002") {
          return reply.code(409).send({
            success: false,
            error:
              "Registration failed. Please check your details or try logging in.",
          });
        }

        fastify.log.error(error);
        return reply
          .code(500)
          .send(createServerErrorResponse("Registration failed"));
      }
    },
  );

  fastify.post<{ Body: Record<string, any> }>(
    "/auth/login",
    {
      config: {
        rateLimit: {
          max: env.NODE_ENV === "test" ? 100 : isLocalFrontend ? 1000 : 10,
          timeWindow: "15 minutes",
        },
      },
    },
    async (request, reply) => {
      try {
        const input = LoginSchema.parse(request.body);
        const user = await authService.login(input);

        // ─── Self-healing: ensure ADMIN_EMAIL has all roles approved ──────────
        const adminEmail = process.env.ADMIN_EMAIL?.trim();
        fastify.log.info(
          { email: input.email, adminEmail },
          "[login] ADMIN_EMAIL check",
        );
        if (
          adminEmail &&
          input.email.toLowerCase() === adminEmail.toLowerCase()
        ) {
          const allRoles = await fastify.prisma.role.findMany();
          const adminRole = allRoles.find((r) => r.name === "admin");
          fastify.log.info(
            {
              userId: user.id,
              currentRoles: user.roles.map((r) => `${r.roleName}:${r.status}`),
            },
            "[login] ADMIN_EMAIL user — running self-healing",
          );

          // 1. Create missing admin role if it doesn't exist
          if (adminRole) {
            const hasAdmin = user.roles.find((r) => r.roleName === "admin");
            if (hasAdmin && hasAdmin.status === "pending") {
              await fastify.prisma.userRole.update({
                where: {
                  userId_roleId: { userId: user.id, roleId: hasAdmin.roleId },
                },
                data: { status: "approved" },
              });
              hasAdmin.status = "approved";
              fastify.log.info(
                "[login] Self-heal: approved pending admin role",
              );
            } else if (!hasAdmin) {
              const newRole = await fastify.prisma.userRole.create({
                data: {
                  userId: user.id,
                  roleId: adminRole.id,
                  status: "approved",
                },
              });
              user.roles.push({
                roleId: adminRole.id,
                roleName: "admin",
                status: "approved",
              });
              fastify.log.info(
                { roleId: newRole.id },
                "[login] Self-heal: created missing admin role",
              );
            }
          }

          // 2. Approve ALL other pending roles
          for (const role of user.roles) {
            if (role.status === "pending") {
              await fastify.prisma.userRole.update({
                where: {
                  userId_roleId: { userId: user.id, roleId: role.roleId },
                },
                data: { status: "approved" },
              });
              role.status = "approved";
              fastify.log.info(
                { roleName: role.roleName },
                "[login] Self-heal: approved pending role",
              );
            }
          }

          fastify.log.info(
            { finalRoles: user.roles.map((r) => `${r.roleName}:${r.status}`) },
            "[login] Self-healing complete",
          );
        } else {
          fastify.log.info(
            "[login] Not ADMIN_EMAIL user — skipping self-healing",
          );
        }

        // Generate JWT token
        const token = fastify.jwt.sign(
          {
            id: user.id,
            email: user.email,
            roles: user.roles
              .filter((r) => r.status === "approved")
              .map((r) => r.roleName),
          },
          { expiresIn: env.JWT_ACCESS_EXPIRY },
        );

        // Generate refresh token
        const refreshToken = fastify.jwt.sign(
          {
            id: user.id,
            type: "refresh",
            jti: randomUUID(),
          },
          { expiresIn: env.JWT_REFRESH_EXPIRY },
        );

        const decodedRefreshToken = fastify.jwt.decode(refreshToken) as any;
        if (decodedRefreshToken?.jti) {
          await refreshTokenStoreService.setActiveJtiForUser(
            user.id,
            decodedRefreshToken.jti,
          );
        }

        reply
          .setCookie("accessToken", token, {
            ...cookieOptions,
            maxAge: 60 * 15,
          })
          .setCookie("refreshToken", refreshToken, {
            ...cookieOptions,
            maxAge: 60 * 60 * 24 * 7,
          });

        try {
          reply.generateCsrf();
        } catch {}

        // Notify user of new login
        const ip =
          (request.headers["x-forwarded-for"] as string) ||
          request.ip ||
          "unknown";
        const ua = (request.headers["user-agent"] as string) || "unknown";
        await sendNewLoginAlert({
          userEmail: user.email,
          userName: user.name,
          ip,
          userAgent: ua,
          timestamp: new Date().toISOString(),
        }).catch(() => {});

        // Check official ID status for login response
        const officialIdDoc = await fastify.prisma.userDocument.findFirst({
          where: { userId: user.id, documentType: "official_id" },
          orderBy: { createdAt: "desc" },
          select: { id: true, isVerified: true, reviewStatus: true },
        });

        // NOTE: tokens are set via httpOnly cookies above. The response body
        // contains only the user object to prevent token exfiltration via XSS.
        return reply.code(200).send({
          success: true,
          user: {
            ...user,
            officialIdUploaded: !!officialIdDoc,
            officialIdVerified: officialIdDoc?.isVerified ?? false,
            officialIdReviewStatus: officialIdDoc?.reviewStatus ?? null,
          },
        });
      } catch (error: any) {
        if (error.message === "Invalid email or password") {
          return reply.code(401).send({
            success: false,
            error: "Invalid email or password",
          });
        }

        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: "Login failed",
        });
      }
    },
  );

  fastify.post<{ Body: Record<string, any> }>(
    "/auth/refresh",
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: "15 minutes",
        },
      },
    },
    async (request, reply) => {
      try {
        // Only accept refresh token from httpOnly cookie (not request body)
        // to prevent XSS token exfiltration
        const refreshToken = (request as any).cookies?.refreshToken;

        if (!refreshToken) {
          return reply.code(400).send({
            success: false,
            error: "Refresh token is required",
          });
        }

        // Verify refresh token
        try {
          const decoded = fastify.jwt.verify(refreshToken) as any;

          if (decoded.type !== "refresh") {
            throw new Error("Invalid token type");
          }

          if (
            !decoded.jti ||
            (await refreshTokenStoreService.isJtiRevoked(decoded.jti))
          ) {
            throw new Error("Revoked refresh token");
          }

          const activeJti = await refreshTokenStoreService.getActiveJtiForUser(
            decoded.id,
          );
          if (!activeJti || activeJti !== decoded.jti) {
            throw new Error("Stale refresh token");
          }

          const user = await authService.getUserById(decoded.id);

          if (!user) {
            return reply.code(401).send({
              success: false,
              error: "User not found",
            });
          }

          // Generate new access token
          const newToken = fastify.jwt.sign(
            {
              id: user.id,
              email: user.email,
              roles: user.roles
                .filter((r) => r.status === "approved")
                .map((r) => r.role.name),
            },
            { expiresIn: env.JWT_ACCESS_EXPIRY },
          );

          await refreshTokenStoreService.revokeJti(decoded.jti);

          const newRefreshToken = fastify.jwt.sign(
            {
              id: user.id,
              type: "refresh",
              jti: randomUUID(),
            },
            { expiresIn: env.JWT_REFRESH_EXPIRY },
          );

          const decodedNewRefreshToken = fastify.jwt.decode(
            newRefreshToken,
          ) as any;
          if (decodedNewRefreshToken?.jti) {
            await refreshTokenStoreService.setActiveJtiForUser(
              user.id,
              decodedNewRefreshToken.jti,
            );
          }

          reply
            .setCookie("accessToken", newToken, {
              ...cookieOptions,
              maxAge: 60 * 15,
            })
            .setCookie("refreshToken", newRefreshToken, {
              ...cookieOptions,
              maxAge: 60 * 60 * 24 * 7,
            });

          try {
            reply.generateCsrf();
          } catch {}

          return reply.code(200).send({
            success: true,
          });
        } catch (verifyError) {
          return reply.code(401).send({
            success: false,
            error: "Invalid refresh token",
          });
        }
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: "Refresh failed",
        });
      }
    },
  );

  fastify.post<{ Body: Record<string, any> }>(
    "/auth/logout",
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: "15 minutes",
        },
      },
    },
    async (request, reply) => {
      const maybeRefreshToken =
        request.body?.refreshToken || (request as any).cookies?.refreshToken;

      if (
        typeof maybeRefreshToken === "string" &&
        maybeRefreshToken.length > 0
      ) {
        try {
          const decoded = fastify.jwt.verify(maybeRefreshToken) as any;
          if (decoded?.id) {
            await refreshTokenStoreService.clearActiveJtiForUser(decoded.id);
          }
          if (decoded?.jti) {
            await refreshTokenStoreService.revokeJti(decoded.jti);
          }
        } catch (err: any) {
          fastify.log.warn(
            { err },
            "Failed to decode refresh token during logout",
          );
        }
      }

      reply
        .clearCookie("accessToken", {
          path: "/",
          secure: cookieOptions.secure,
          sameSite: cookieOptions.sameSite,
        })
        .clearCookie("refreshToken", {
          path: "/",
          secure: cookieOptions.secure,
          sameSite: cookieOptions.sameSite,
        });

      return reply.code(200).send({
        success: true,
        message: "Logged out successfully",
      });
    },
  );

  fastify.get(
    "/auth/me",
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "15 minutes",
        },
      },
    },
    async (request, reply) => {
      try {
        const hasAuthorizationHeader = Boolean(request.headers?.authorization);
        const hasAccessCookie = Boolean((request as any).cookies?.accessToken);
        if (hasAccessCookie && !hasAuthorizationHeader) {
          await request.jwtVerify({ onlyCookie: true });
        } else {
          await request.jwtVerify();
        }

        const user = await authService.getUserById(request.user?.id || "");

        if (!user) {
          return reply.code(404).send({
            success: false,
            error: "User not found",
          });
        }

        const agency = await fastify.prisma.agency.findUnique({
          where: { ownerId: user.id },
          select: { id: true, name: true, referralCode: true },
        });

        // Check if user has uploaded an official ID
        const officialIdDoc = await fastify.prisma.userDocument.findFirst({
          where: { userId: user.id, documentType: "official_id" },
          orderBy: { createdAt: "desc" },
          select: { id: true, isVerified: true, reviewStatus: true },
        });

        return reply.code(200).send({
          success: true,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            referralCode: (user as any).referralCode ?? null,
            emailVerified: (user as any).emailVerified ?? false,
            phoneVerified: (user as any).phoneVerified ?? false,
            officialIdUploaded: !!officialIdDoc,
            officialIdVerified: officialIdDoc?.isVerified ?? false,
            officialIdReviewStatus: officialIdDoc?.reviewStatus ?? null,
            roles: user.roles.map((ur) => ({
              roleId: ur.roleId,
              roleName: ur.role.name,
              status: ur.status,
            })),
            agency: (user as any).agency
              ? { id: (user as any).agency.id, name: (user as any).agency.name }
              : null,
            ownedAgency: agency || null,
          },
        });
      } catch (error: any) {
        if (error.message?.includes("No Authorization")) {
          return reply.code(401).send({
            success: false,
            error: "Unauthorized",
          });
        }

        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: "Failed to fetch user",
        });
      }
    },
  );

  // ─── Google OAuth ─────────────────────────────────────────────────────────
  fastify.post<{ Body: Record<string, any> }>(
    "/auth/oauth/google",
    {
      config: {
        rateLimit: {
          max: env.NODE_ENV === "test" ? 100 : isLocalFrontend ? 500 : 20,
          timeWindow: "15 minutes",
        },
      },
    },
    async (request, reply) => {
      try {
        const { idToken } = OAuthGoogleSchema.parse(request.body);

        // Verify Google ID token via Google tokeninfo endpoint (POST for privacy)
        const res = await fetch("https://oauth2.googleapis.com/tokeninfo", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ id_token: idToken }).toString(),
        });

        if (!res.ok) {
          return reply
            .code(401)
            .send({ success: false, error: "Invalid Google token" });
        }

        const payload = (await res.json()) as {
          sub: string;
          email: string;
          name: string;
          picture?: string;
          aud: string;
          email_verified?: string;
        };

        // Verify audience matches our client ID (if configured)
        if (env.GOOGLE_CLIENT_ID && payload.aud !== env.GOOGLE_CLIENT_ID) {
          return reply
            .code(401)
            .send({ success: false, error: "Token audience mismatch" });
        }

        if (payload.email_verified !== "true") {
          return reply
            .code(401)
            .send({ success: false, error: "Email not verified with Google" });
        }

        const user = await authService.loginOrCreateOAuthUser({
          provider: "google",
          providerId: payload.sub,
          email: payload.email,
          name: payload.name,
          avatarUrl: payload.picture,
        });

        const token = fastify.jwt.sign(
          {
            id: user.id,
            email: user.email,
            roles: user.roles
              .filter((r) => r.status === "approved")
              .map((r) => r.roleName),
          },
          { expiresIn: env.JWT_ACCESS_EXPIRY },
        );

        const refreshToken = fastify.jwt.sign(
          { id: user.id, type: "refresh", jti: randomUUID() },
          { expiresIn: env.JWT_REFRESH_EXPIRY },
        );

        reply
          .setCookie("accessToken", token, {
            ...cookieOptions,
            maxAge: 15 * 60,
          })
          .setCookie("refreshToken", refreshToken, {
            ...cookieOptions,
            maxAge: 7 * 24 * 60 * 60,
          });

        try {
          reply.generateCsrf();
        } catch {}

        return reply.code(200).send({
          success: true,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            avatarUrl: user.avatarUrl,
            provider: user.provider,
            roles: user.roles,
          },
        });
      } catch (error: any) {
        if (error.constructor?.name === "ZodError") {
          return reply
            .code(400)
            .send({
              success: false,
              error: "Validation error",
              details: error.errors,
            });
        }
        fastify.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "OAuth login failed" });
      }
    },
  );

  // ─── Facebook OAuth ────────────────────────────────────────────────────────
  fastify.post<{ Body: Record<string, any> }>(
    "/auth/oauth/facebook",
    {
      config: {
        rateLimit: {
          max: env.NODE_ENV === "test" ? 100 : isLocalFrontend ? 500 : 20,
          timeWindow: "15 minutes",
        },
      },
    },
    async (request, reply) => {
      try {
        const { accessToken } = OAuthFacebookSchema.parse(request.body);

        // Verify token by calling Facebook Graph API
        const verifyRes = await fetch(
          `https://graph.facebook.com/v19.0/me?fields=id,email,name,picture.type(large)&access_token=${encodeURIComponent(accessToken)}`,
        );

        if (!verifyRes.ok) {
          return reply
            .code(401)
            .send({ success: false, error: "Invalid Facebook token" });
        }

        const payload = (await verifyRes.json()) as {
          id: string;
          email?: string;
          name: string;
          picture?: { data: { url: string } };
        };

        // Verify app_id if configured
        if (env.FACEBOOK_APP_ID && env.FACEBOOK_APP_SECRET) {
          const debugRes = await fetch(
            `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${env.FACEBOOK_APP_ID}|${env.FACEBOOK_APP_SECRET}`,
          );
          const debugData = (await debugRes.json()) as {
            data?: { app_id?: string; is_valid?: boolean };
          };
          if (
            !debugData.data?.is_valid ||
            (env.FACEBOOK_APP_ID &&
              debugData.data.app_id !== env.FACEBOOK_APP_ID)
          ) {
            return reply
              .code(401)
              .send({
                success: false,
                error: "Token not issued for this application",
              });
          }
        }

        if (!payload.email) {
          return reply
            .code(400)
            .send({
              success: false,
              error: "Email permission not granted. Please allow email access.",
            });
        }

        const user = await authService.loginOrCreateOAuthUser({
          provider: "facebook",
          providerId: payload.id,
          email: payload.email,
          name: payload.name,
          avatarUrl: payload.picture?.data?.url,
        });

        const token = fastify.jwt.sign(
          {
            id: user.id,
            email: user.email,
            roles: user.roles
              .filter((r) => r.status === "approved")
              .map((r) => r.roleName),
          },
          { expiresIn: env.JWT_ACCESS_EXPIRY },
        );
        const refreshToken = fastify.jwt.sign(
          { id: user.id, type: "refresh", jti: randomUUID() },
          { expiresIn: env.JWT_REFRESH_EXPIRY },
        );

        reply
          .setCookie("accessToken", token, {
            ...cookieOptions,
            maxAge: 15 * 60,
          })
          .setCookie("refreshToken", refreshToken, {
            ...cookieOptions,
            maxAge: 7 * 24 * 60 * 60,
          });

        try {
          reply.generateCsrf();
        } catch {}

        return reply.code(200).send({
          success: true,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            avatarUrl: user.avatarUrl,
            provider: user.provider,
            roles: user.roles,
          },
        });
      } catch (error: any) {
        if (error.constructor?.name === "ZodError") {
          return reply
            .code(400)
            .send({
              success: false,
              error: "Validation error",
              details: error.errors,
            });
        }
        fastify.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Facebook login failed" });
      }
    },
  );

  // ─── Apple OAuth ───────────────────────────────────────────────────────────
  fastify.post<{ Body: Record<string, any> }>(
    "/auth/oauth/apple",
    {
      config: {
        rateLimit: {
          max: env.NODE_ENV === "test" ? 100 : isLocalFrontend ? 500 : 20,
          timeWindow: "15 minutes",
        },
      },
    },
    async (request, reply) => {
      try {
        const { identityToken, authorizationCode, name } =
          OAuthAppleSchema.parse(request.body);

        // Generate Apple client secret (JWT signed with ES256)
        const clientSecret = generateAppleClientSecret();

        // Exchange authorization code for tokens
        const tokenRes = await fetch("https://appleid.apple.com/auth/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: env.APPLE_CLIENT_ID!,
            client_secret: clientSecret,
            code: authorizationCode,
            grant_type: "authorization_code",
          }).toString(),
        });

        if (!tokenRes.ok) {
          return reply
            .code(401)
            .send({
              success: false,
              error: "Invalid Apple authorization code",
            });
        }

        const tokenData = (await tokenRes.json()) as { id_token: string };

        // Decode the identity token (Apple returns a JWT)
        const decoded = fastify.jwt.decode(tokenData.id_token) as any;
        if (!decoded?.sub) {
          return reply
            .code(401)
            .send({ success: false, error: "Invalid Apple identity token" });
        }

        // Verify audience matches our client ID
        if (env.APPLE_CLIENT_ID && decoded.aud !== env.APPLE_CLIENT_ID) {
          return reply
            .code(401)
            .send({ success: false, error: "Token audience mismatch" });
        }

        const email = decoded.email || "";
        if (!email) {
          return reply
            .code(400)
            .send({
              success: false,
              error:
                "Email not available. Apple only shares email on first sign-in.",
            });
        }

        const user = await authService.loginOrCreateOAuthUser({
          provider: "apple",
          providerId: decoded.sub,
          email,
          name: name || decoded.name || email.split("@")[0],
          avatarUrl: undefined,
        });

        const token = fastify.jwt.sign(
          {
            id: user.id,
            email: user.email,
            roles: user.roles
              .filter((r) => r.status === "approved")
              .map((r) => r.roleName),
          },
          { expiresIn: env.JWT_ACCESS_EXPIRY },
        );
        const refreshToken = fastify.jwt.sign(
          { id: user.id, type: "refresh", jti: randomUUID() },
          { expiresIn: env.JWT_REFRESH_EXPIRY },
        );

        reply
          .setCookie("accessToken", token, {
            ...cookieOptions,
            maxAge: 15 * 60,
          })
          .setCookie("refreshToken", refreshToken, {
            ...cookieOptions,
            maxAge: 7 * 24 * 60 * 60,
          });

        try {
          reply.generateCsrf();
        } catch {}

        return reply.code(200).send({
          success: true,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            avatarUrl: user.avatarUrl,
            provider: user.provider,
            roles: user.roles,
          },
        });
      } catch (error: any) {
        if (error.constructor?.name === "ZodError") {
          return reply
            .code(400)
            .send({
              success: false,
              error: "Validation error",
              details: error.errors,
            });
        }
        fastify.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Apple login failed" });
      }
    },
  );

  // POST /auth/forgot-password — sends reset link
  fastify.post<{ Body: Record<string, any> }>(
    "/auth/forgot-password",
    {
      config: {
        rateLimit: {
          max: 3,
          timeWindow: "15 minutes",
        },
      },
    },
    async (request, reply) => {
      try {
        const { email } = ForgotPasswordSchema.parse(request.body);

        const user = await authService.getUserByEmail(email);
        if (!user) {
          return reply
            .code(200)
            .send({
              success: true,
              message: "If the email exists, a reset link has been sent.",
            });
        }

        const token = crypto.randomBytes(32).toString("hex");
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

        await fastify.prisma.user.update({
          where: { id: user.id },
          data: {
            passwordResetToken: token,
            passwordResetTokenExpiresAt: expiresAt,
          },
        });

        await sendPasswordResetEmail({
          userEmail: user.email,
          userName: user.name,
          token,
        });

        return reply
          .code(200)
          .send({
            success: true,
            message: "If the email exists, a reset link has been sent.",
          });
      } catch (error: any) {
        if (isZodError(error)) {
          return reply.code(400).send(createValidationErrorResponse(error));
        }
        fastify.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Failed to process request" });
      }
    },
  );

  // POST /auth/reset-password — resets password with token
  fastify.post<{ Body: Record<string, any> }>(
    "/auth/reset-password",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "15 minutes",
        },
      },
    },
    async (request, reply) => {
      try {
        const { token, password } = ResetPasswordSchema.parse(request.body);

        const result = await fastify.prisma.$transaction(async (tx) => {
          const user = await tx.user.findUnique({
            where: { passwordResetToken: token },
          });

          if (
            !user ||
            !user.passwordResetTokenExpiresAt ||
            user.passwordResetTokenExpiresAt < new Date()
          ) {
            return { success: false, error: "Invalid or expired reset token" };
          }

          const hashedPassword = await authService.hashPassword(password);

          await tx.user.update({
            where: { id: user.id },
            data: {
              password: hashedPassword,
              passwordResetToken: null,
              passwordResetTokenExpiresAt: null,
              failedLoginAttempts: 0,
              lockedUntil: null,
            },
          });

          return { success: true, message: "Password reset successfully" };
        });

        if (result.success) {
          const user = await fastify.prisma.user.findUnique({
            where: { passwordResetToken: token },
            select: { email: true, name: true },
          });
          if (user) {
            await sendPasswordChangedEmail({
              userEmail: user.email,
              userName: user.name,
            }).catch(() => {});
          }
          return reply.code(200).send(result);
        }
        return reply.code(400).send(result);
      } catch (error: any) {
        if (isZodError(error)) {
          return reply.code(400).send(createValidationErrorResponse(error));
        }
        fastify.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Failed to reset password" });
      }
    },
  );
};

export default authRoutes;

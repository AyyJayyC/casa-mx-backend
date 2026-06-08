import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import crypto from "node:crypto";
import { RegisterInput, LoginInput } from "../schemas/auth.js";
import { generateReferralCode as genRefCode } from "../utils/errorHandling.js";

const AUTO_APPROVED_ROLES = new Set(["buyer", "tenant"]);

export class AuthService {
  constructor(private prisma: PrismaClient) {}

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  async getUserByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  private generateReferralCode(): string {
    return genRefCode();
  }

  private async ensureUniqueReferralCode(): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const code = this.generateReferralCode();
      const existing = await this.prisma.user.findUnique({
        where: { referralCode: code },
      });
      if (!existing) return code;
    }
    return this.generateReferralCode() + Date.now().toString(36).toUpperCase();
  }

  async register(data: RegisterInput) {
    const hashedPassword = await bcrypt.hash(data.password, 10);
    const requestedRoles = [...new Set(data.roles ?? ["buyer"])];

    // Auto-grant admin if registering with ADMIN_EMAIL
    const adminEmail = process.env.ADMIN_EMAIL?.trim();
    if (
      adminEmail &&
      data.email === adminEmail &&
      !requestedRoles.includes("admin")
    ) {
      requestedRoles.push("admin");
    }

    const referralCode = await this.ensureUniqueReferralCode();

    const ref = data.ref?.trim();

    // Check if ref is a user referral code or an agency code
    let referredById: string | undefined;
    let agencyId: string | undefined;

    if (ref) {
      const referrerUser = await this.prisma.user.findUnique({
        where: { referralCode: ref },
      });
      if (referrerUser) {
        referredById = referrerUser.id;
      } else {
        const agency = await this.prisma.agency.findUnique({
          where: { referralCode: ref },
        });
        if (agency) {
          agencyId = agency.id;
        }
      }
    }

    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        name: data.name,
        password: hashedPassword,
        referralCode,
        referredById,
        agencyId,
        roles: {
          create: await Promise.all(
            requestedRoles.map(async (roleName) => ({
              roleId: await this.getRoleId(roleName),
              status: this.getInitialRoleStatus(roleName, data.email),
            })),
          ),
        },
      },
      include: { roles: { include: { role: true } } },
    });

    // Log referral events
    if (ref && (referredById || agencyId)) {
      await this.prisma.referralEvent.create({
        data: {
          referrerId: referredById,
          referralCode: ref,
          eventType: "signup",
          linkedUserId: user.id,
        },
      });
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      referralCode: user.referralCode,
      roles: user.roles.map((ur) => ({
        roleId: ur.roleId,
        roleName: ur.role.name,
        status: ur.status,
      })),
    };
  }

  async login(data: LoginInput) {
    const user = await this.prisma.user.findUnique({
      where: { email: data.email },
      include: { roles: { include: { role: true } } },
    });

    // Constant-time: always run bcrypt compare even if user doesn't exist
    const dummyHash = "$2b$10$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const isMatch = user
      ? await bcrypt.compare(data.password, user.password ?? dummyHash)
      : await bcrypt.compare(data.password, dummyHash);

    if (!user) {
      throw new Error("Invalid email or password");
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new Error("Invalid email or password");
    }

    if (!user.password || !isMatch) {
      const attempts = (user.failedLoginAttempts || 0) + 1;
      const lockedUntil =
        attempts >= 5
          ? new Date(Date.now() + 15 * 60 * 1000)
          : user.lockedUntil;

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: attempts,
          lockedUntil,
          lastFailedLoginAt: new Date(),
        },
      });

      throw new Error("Invalid email or password");
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastFailedLoginAt: null,
      },
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      roles: user.roles.map((ur) => ({
        roleId: ur.roleId,
        roleName: ur.role.name,
        status: ur.status,
      })),
    };
  }

  async getUserById(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        roles: { include: { role: true } },
        agency: { select: { id: true, name: true } },
      },
    });
  }

  async loginOrCreateOAuthUser(data: {
    provider: string;
    providerId: string;
    email: string;
    name: string;
    avatarUrl?: string;
  }) {
    // Try find by provider + providerId first (most reliable)
    let user = await this.prisma.user.findUnique({
      where: {
        provider_providerId: {
          provider: data.provider,
          providerId: data.providerId,
        },
      },
      include: { roles: { include: { role: true } } },
    });

    if (!user) {
      // Try find by email (link accounts)
      user = await this.prisma.user.findUnique({
        where: { email: data.email },
        include: { roles: { include: { role: true } } },
      });

      if (user) {
        // Link OAuth to existing account
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: {
            provider: data.provider,
            providerId: data.providerId,
            avatarUrl: data.avatarUrl,
          },
          include: { roles: { include: { role: true } } },
        });
      } else {
        // Create new user via OAuth
        const defaultRoles = ["buyer", "tenant"];
        // Auto-grant admin if registering with ADMIN_EMAIL
        const adminEmail = process.env.ADMIN_EMAIL?.trim();
        if (
          adminEmail &&
          data.email === adminEmail &&
          !defaultRoles.includes("admin")
        ) {
          defaultRoles.push("admin");
        }
        const referralCode = await this.ensureUniqueReferralCode();
        user = await this.prisma.user.create({
          data: {
            email: data.email,
            name: data.name,
            provider: data.provider,
            providerId: data.providerId,
            avatarUrl: data.avatarUrl,
            referralCode,
            roles: {
              create: await Promise.all(
                defaultRoles.map(async (roleName) => ({
                  roleId: await this.getRoleId(roleName),
                  status: this.getInitialRoleStatus(roleName, data.email),
                })),
              ),
            },
          },
          include: { roles: { include: { role: true } } },
        });
      }
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      provider: user.provider,
      roles: user.roles.map((ur) => ({
        roleId: ur.roleId,
        roleName: ur.role.name,
        status: ur.status,
      })),
    };
  }

  private async getRoleId(roleName: string): Promise<string> {
    let role = await this.prisma.role.findUnique({
      where: { name: roleName },
    });

    if (!role) {
      role = await this.prisma.role.create({
        data: { name: roleName },
      });
    }

    return role.id;
  }

  private getInitialRoleStatus(roleName: string, email?: string): string {
    // ADMIN_EMAIL user gets all roles auto-approved, including admin
    const adminEmail = process.env.ADMIN_EMAIL?.trim();
    if (adminEmail && email === adminEmail) return "approved";

    // Admin role requires manual approval by existing admin for non-ADMIN_EMAIL users
    if (roleName === "admin") return "pending";

    return AUTO_APPROVED_ROLES.has(roleName) ? "approved" : "pending";
  }
}

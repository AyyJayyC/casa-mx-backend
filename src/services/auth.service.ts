import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { RegisterInput, LoginInput } from '../schemas/auth.js';

const MANUAL_APPROVAL_ROLES = new Set(['admin']);

export class AuthService {
  constructor(private prisma: PrismaClient) {}

  async register(data: RegisterInput) {
    // Hash password
    const hashedPassword = await bcrypt.hash(data.password, 10);
    const requestedRoles = [...new Set(data.roles ?? ['buyer'])];

    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        name: data.name,
        password: hashedPassword,
        roles: {
          create: await Promise.all(
            requestedRoles.map(async (roleName) => ({
              roleId: await this.getRoleId(roleName),
              status: this.getInitialRoleStatus(roleName),
            }))
          ),
        },
      },
      include: {
        roles: { include: { role: true } },
        userDocuments: {
          where: { documentType: 'official_id' },
          select: { documentType: true, isVerified: true },
        },
        subscription: { select: { status: true, currentPeriodEnd: true } },
      },
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      emailVerified: user.emailVerified,
      officialIdUploaded: user.userDocuments.length > 0,
      officialIdVerified: user.userDocuments.some((d) => d.isVerified),
      paidSubscriber:
        ['active', 'trialing'].includes(user.subscription?.status || '') &&
        (!user.subscription?.currentPeriodEnd || user.subscription.currentPeriodEnd > new Date()),
      subscriptionStatus: user.subscription?.status || 'inactive',
      subscriptionCurrentPeriodEnd: user.subscription?.currentPeriodEnd || null,
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
      include: {
        roles: { include: { role: true } },
        userDocuments: {
          where: { documentType: 'official_id' },
          select: { documentType: true, isVerified: true },
        },
        subscription: { select: { status: true, currentPeriodEnd: true } },
      },
    });

    if (!user) {
      throw new Error('Invalid email or password');
    }

    const passwordMatch = await bcrypt.compare(data.password, user.password ?? '');
    if (!user.password || !passwordMatch) {
      throw new Error('Invalid email or password');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      emailVerified: user.emailVerified,
      officialIdUploaded: user.userDocuments.length > 0,
      officialIdVerified: user.userDocuments.some((d) => d.isVerified),
      paidSubscriber:
        ['active', 'trialing'].includes(user.subscription?.status || '') &&
        (!user.subscription?.currentPeriodEnd || user.subscription.currentPeriodEnd > new Date()),
      subscriptionStatus: user.subscription?.status || 'inactive',
      subscriptionCurrentPeriodEnd: user.subscription?.currentPeriodEnd || null,
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
        userDocuments: {
          where: { documentType: 'official_id' },
          select: { documentType: true, isVerified: true },
        },
        subscription: { select: { status: true, currentPeriodEnd: true } },
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
      where: { provider_providerId: { provider: data.provider, providerId: data.providerId } },
      include: {
        roles: { include: { role: true } },
        userDocuments: {
          where: { documentType: 'official_id' },
          select: { documentType: true, isVerified: true },
        },
        subscription: { select: { status: true, currentPeriodEnd: true } },
      },
    });

    if (!user) {
      // Try find by email (link accounts)
      user = await this.prisma.user.findUnique({
        where: { email: data.email },
        include: {
          roles: { include: { role: true } },
          userDocuments: {
            where: { documentType: 'official_id' },
            select: { documentType: true, isVerified: true },
          },
          subscription: { select: { status: true, currentPeriodEnd: true } },
        },
      });

      if (user) {
        // Link OAuth to existing account
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { provider: data.provider, providerId: data.providerId, avatarUrl: data.avatarUrl },
          include: {
            roles: { include: { role: true } },
            userDocuments: {
              where: { documentType: 'official_id' },
              select: { documentType: true, isVerified: true },
            },
            subscription: { select: { status: true, currentPeriodEnd: true } },
          },
        });
      } else {
        // Create new user via OAuth
        const defaultRoles = ['buyer', 'tenant'];
        user = await this.prisma.user.create({
          data: {
            email: data.email,
            name: data.name,
            provider: data.provider,
            providerId: data.providerId,
            avatarUrl: data.avatarUrl,
            roles: {
              create: await Promise.all(
                defaultRoles.map(async (roleName) => ({
                  roleId: await this.getRoleId(roleName),
                  status: this.getInitialRoleStatus(roleName),
                }))
              ),
            },
          },
          include: {
            roles: { include: { role: true } },
            userDocuments: {
              where: { documentType: 'official_id' },
              select: { documentType: true, isVerified: true },
            },
            subscription: { select: { status: true, currentPeriodEnd: true } },
          },
        });
      }
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      provider: user.provider,
      emailVerified: user.emailVerified,
      officialIdUploaded: user.userDocuments.length > 0,
      officialIdVerified: user.userDocuments.some((d) => d.isVerified),
      paidSubscriber:
        ['active', 'trialing'].includes(user.subscription?.status || '') &&
        (!user.subscription?.currentPeriodEnd || user.subscription.currentPeriodEnd > new Date()),
      subscriptionStatus: user.subscription?.status || 'inactive',
      subscriptionCurrentPeriodEnd: user.subscription?.currentPeriodEnd || null,
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

  private getInitialRoleStatus(roleName: string): string {
    return MANUAL_APPROVAL_ROLES.has(roleName) ? 'pending' : 'approved';
  }
}

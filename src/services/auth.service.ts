import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { RegisterInput, LoginInput } from '../schemas/auth.js';

const AUTO_APPROVED_ROLES = new Set(['buyer', 'tenant']);

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
      include: { roles: { include: { role: true } } },
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

  async login(data: LoginInput) {
    const user = await this.prisma.user.findUnique({
      where: { email: data.email },
      include: { roles: { include: { role: true } } },
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
      include: { roles: { include: { role: true } } },
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
          data: { provider: data.provider, providerId: data.providerId, avatarUrl: data.avatarUrl },
          include: { roles: { include: { role: true } } },
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

  private getInitialRoleStatus(roleName: string): string {
    return AUTO_APPROVED_ROLES.has(roleName) ? 'approved' : 'pending';
  }
}

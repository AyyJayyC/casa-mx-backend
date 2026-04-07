import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
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
        phone: data.phone ?? null,
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
      phone: user.phone,
      profilePictureUrl: user.profilePictureUrl,
      bio: user.bio,
      isEmailVerified: user.isEmailVerified,
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

    const passwordMatch = await bcrypt.compare(data.password, user.password);
    if (!passwordMatch) {
      throw new Error('Invalid email or password');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      profilePictureUrl: user.profilePictureUrl,
      bio: user.bio,
      isEmailVerified: user.isEmailVerified,
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

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }

    const passwordMatch = await bcrypt.compare(currentPassword, user.password);
    if (!passwordMatch) {
      throw new Error('Current password is incorrect');
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: newHash },
    });
  }

  async createEmailVerificationToken(userId: string): Promise<string> {
    // Invalidate previous tokens for this user
    await this.prisma.emailVerificationToken.deleteMany({ where: { userId } });

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await this.prisma.emailVerificationToken.create({
      data: { userId, token, expiresAt },
    });

    return token;
  }

  async verifyEmail(token: string): Promise<string> {
    const record = await this.prisma.emailVerificationToken.findUnique({ where: { token } });

    if (!record) {
      throw new Error('Invalid verification token');
    }

    if (record.usedAt) {
      throw new Error('Verification token already used');
    }

    if (record.expiresAt < new Date()) {
      throw new Error('Verification token has expired');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { isEmailVerified: true, emailVerifiedAt: new Date() },
      }),
      this.prisma.emailVerificationToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return record.userId;
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

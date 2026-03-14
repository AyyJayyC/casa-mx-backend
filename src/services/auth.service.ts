import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { RegisterInput, LoginInput } from '../schemas/auth.js';

export class AuthService {
  constructor(private prisma: PrismaClient) {}

  async register(data: RegisterInput) {
    // Hash password
    const hashedPassword = await bcrypt.hash(data.password, 10);

    // Create user with default roles (buyer, seller)
    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        name: data.name,
        password: hashedPassword,
        roles: {
          create: [
            { roleId: await this.getRoleId('buyer') },
            { roleId: await this.getRoleId('seller') },
          ],
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

    const passwordMatch = await bcrypt.compare(data.password, user.password);
    if (!passwordMatch) {
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
}

import { FastifyInstance } from 'fastify';

export async function registerUser(
  app: FastifyInstance,
  payload: { name: string; email: string; password: string }
) {
  const registerRes = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload,
  });

  if (registerRes.statusCode !== 201) {
    throw new Error(`Register failed for ${payload.email}: ${registerRes.statusCode}`);
  }

  const body = registerRes.json();
  return body.user as { id: string; email: string; name: string };
}

export async function approveUserRole(
  app: FastifyInstance,
  userId: string,
  roleName: string,
  status: 'approved' | 'pending' | 'denied' = 'approved'
) {
  const role = await app.prisma.role.findUnique({ where: { name: roleName } });
  if (!role) {
    throw new Error(`Role '${roleName}' not found`);
  }

  await app.prisma.userRole.updateMany({
    where: { userId, roleId: role.id },
    data: { status },
  });
}

export async function loginAndGetToken(
  app: FastifyInstance,
  email: string,
  password: string
): Promise<string> {
  const loginRes = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password },
  });

  if (loginRes.statusCode !== 200) {
    throw new Error(`Login failed for ${email}: ${loginRes.statusCode}`);
  }

  return loginRes.json().token;
}

export function signRoleToken(
  app: FastifyInstance,
  payload: { id: string; email: string; roles: string[] },
  expiresIn = '1h'
): string {
  return app.jwt.sign(payload, { expiresIn });
}

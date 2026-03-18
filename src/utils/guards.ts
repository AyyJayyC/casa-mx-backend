import { FastifyRequest, FastifyReply } from 'fastify';

async function verifyJwtFromHeaderOrCookie(request: FastifyRequest) {
  const hasAuthorizationHeader = Boolean(request.headers?.authorization);
  const hasAccessCookie = Boolean((request as any).cookies?.accessToken);

  if (hasAuthorizationHeader) {
    await request.jwtVerify();
    return;
  }

  if (hasAccessCookie) {
    await request.jwtVerify({ onlyCookie: true });
    return;
  }

  await request.jwtVerify();
}

export const verifyJWT = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    await verifyJwtFromHeaderOrCookie(request);
  } catch (error) {
    reply.code(401).send({
      success: false,
      error: 'Unauthorized - Invalid or missing token',
    });
  }
};

export const requireRole = (roleName: string) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await verifyJwtFromHeaderOrCookie(request);

      const userRoles = (request.user as any)?.roles || [];

      if (!userRoles.includes(roleName)) {
        return reply.code(403).send({
          success: false,
          error: `Forbidden - Requires '${roleName}' role`,
        });
      }
    } catch (error) {
      return reply.code(401).send({
        success: false,
        error: 'Unauthorized - Invalid or missing token',
      });
    }
  };
};

export const requireAdmin = requireRole('admin');

export const requireAnyRole = (roleNames: string[]) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await verifyJwtFromHeaderOrCookie(request);

      const userRoles = ((request.user as any)?.roles || []) as string[];
      const hasRequiredRole = roleNames.some((roleName) => userRoles.includes(roleName));

      if (!hasRequiredRole) {
        return reply.code(403).send({
          success: false,
          error: `Forbidden - Requires one of roles: ${roleNames.join(', ')}`,
        });
      }
    } catch (error) {
      return reply.code(401).send({
        success: false,
        error: 'Unauthorized - Invalid or missing token',
      });
    }
  };
};

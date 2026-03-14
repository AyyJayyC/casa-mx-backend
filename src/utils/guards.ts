import { FastifyRequest, FastifyReply } from 'fastify';

export const verifyJWT = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    await request.jwtVerify();
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
      await request.jwtVerify();

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

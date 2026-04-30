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

export const getUserEligibility = async (request: FastifyRequest) => {
  const prisma = (request.server as any).prisma;
  const userId = (request.user as any)?.id;

  if (!prisma || !userId) {
    return {
      emailVerified: false,
      hasVerifiedINE: false,
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { emailVerified: true },
  });

  const verifiedIne = await prisma.userDocument.findFirst({
    where: {
      userId,
      documentType: 'official_id',
      isVerified: true,
    },
    select: { id: true },
  });

  return {
    emailVerified: Boolean(user?.emailVerified),
    hasVerifiedINE: Boolean(verifiedIne),
  };
};

export const requireVerifiedEmail = async (request: FastifyRequest, reply: FastifyReply) => {
  const { emailVerified } = await getUserEligibility(request);

  if (!emailVerified) {
    return reply.code(403).send({
      success: false,
      error: 'Debes verificar tu correo electronico antes de realizar esta accion.',
      code: 'EMAIL_NOT_VERIFIED',
    });
  }
};

export const requireOfficialIdVerified = async (request: FastifyRequest, reply: FastifyReply) => {
  const { hasVerifiedINE } = await getUserEligibility(request);

  if (!hasVerifiedINE) {
    return reply.code(403).send({
      success: false,
      error: 'Debes subir y verificar tu INE (identificacion oficial) antes de realizar esta accion.',
      code: 'INE_NOT_VERIFIED',
    });
  }
};

export const requireVerifiedEmailAndINE = async (request: FastifyRequest, reply: FastifyReply) => {
  const eligibility = await getUserEligibility(request);

  if (!eligibility.emailVerified) {
    return reply.code(403).send({
      success: false,
      error: 'Debes verificar tu correo electronico antes de realizar esta accion.',
      code: 'EMAIL_NOT_VERIFIED',
    });
  }

  if (!eligibility.hasVerifiedINE) {
    return reply.code(403).send({
      success: false,
      error: 'Debes subir y verificar tu INE (identificacion oficial) antes de realizar esta accion.',
      code: 'INE_NOT_VERIFIED',
    });
  }
};

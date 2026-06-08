import { FastifyPluginAsync } from "fastify";
import { verifyJWT } from "../utils/guards.js";
import { z } from "zod";
import { generateReferralCode } from "../utils/errorHandling.js";

const referralsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/referrals/my-code",
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const userId = request.user.id;
        let user = await fastify.prisma.user.findUnique({
          where: { id: userId },
          select: { referralCode: true },
        });

        if (!user) {
          return reply
            .code(404)
            .send({ success: false, error: "User not found" });
        }

        // Generate a code if missing (legacy users)
        if (!user.referralCode) {
          const code = generateReferralCode();
          await fastify.prisma.user.update({
            where: { id: userId },
            data: { referralCode: code },
          });
          user = { referralCode: code };
        }

        return reply.send({
          success: true,
          data: { referralCode: user.referralCode },
        });
      } catch (error) {
        fastify.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Failed to get referral code" });
      }
    },
  );

  // POST /referrals/click — log a click on a shared link (no auth needed)
  fastify.post<{ Body: Record<string, any> }>(
    "/referrals/click",
    async (request, reply) => {
      try {
        const schema = z.object({
          referralCode: z.string().max(20),
          propertyId: z.string().optional(),
        });
        const input = schema.parse(request.body);
        const ip =
          (request.headers["x-forwarded-for"] as string)
            ?.split(",")[0]
            ?.trim() || request.ip;
        const ua = request.headers["user-agent"] || null;

        // Find the referrer
        const referrer = await fastify.prisma.user.findUnique({
          where: { referralCode: input.referralCode },
          select: { id: true },
        });

        await fastify.prisma.referralEvent.create({
          data: {
            referrerId: referrer?.id || null,
            referralCode: input.referralCode,
            eventType: "click",
            propertyId: input.propertyId || null,
            visitorIp: ip,
            userAgent: ua,
          },
        });

        return reply.code(201).send({ success: true });
      } catch (error: any) {
        if (error.constructor?.name === "ZodError") {
          return reply
            .code(400)
            .send({ success: false, error: "Validation error" });
        }
        fastify.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Failed to log click" });
      }
    },
  );

  // GET /referrals/stats — current user's referral stats
  fastify.get(
    "/referrals/stats",
    { onRequest: [verifyJWT] },
    async (request, reply) => {
      try {
        const userId = request.user.id;
        const user = await fastify.prisma.user.findUnique({
          where: { id: userId },
          select: { referralCode: true, id: true },
        });

        if (!user?.referralCode) {
          return reply.send({
            success: true,
            data: {
              clicks: 0,
              signups: 0,
              conversionRate: 0,
              recentEvents: [],
            },
          });
        }

        const events = await fastify.prisma.referralEvent.findMany({
          where: { referralCode: user.referralCode },
          orderBy: { createdAt: "desc" },
          take: 50,
        });

        const clicks = events.filter((e) => e.eventType === "click").length;
        const signups = events.filter((e) => e.eventType === "signup").length;

        return reply.send({
          success: true,
          data: {
            referralCode: user.referralCode,
            clicks,
            signups,
            conversionRate:
              clicks > 0 ? Math.round((signups / clicks) * 100) : 0,
            recentEvents: events.slice(0, 20).map((e) => ({
              type: e.eventType,
              propertyId: e.propertyId,
              createdAt: e.createdAt,
            })),
          },
        });
      } catch (error) {
        fastify.log.error(error);
        return reply
          .code(500)
          .send({ success: false, error: "Failed to get referral stats" });
      }
    },
  );
};

export default referralsRoutes;

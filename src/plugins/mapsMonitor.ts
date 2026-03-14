import { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

const mapsMonitor: FastifyPluginAsync = async (fastify) => {
  const intervalMs = parseInt(process.env.MAPS_MONITOR_INTERVAL_MS || '300000', 10); // default 5 minutes
  let timer: NodeJS.Timeout | null = null;

  async function checkUsage() {
    try {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const limits = await fastify.prisma.usageLimit.findMany();

      for (const limit of limits) {
        const used = await fastify.prisma.apiUsageLog.count({ where: { serviceType: limit.serviceType, requestTimestamp: { gte: monthStart } } });
        const percentage = limit.limitValue > 0 ? Math.round((used / limit.limitValue) * 100) : 0;

        // Threshold alert
        if (percentage >= limit.alertThreshold && percentage < 100) {
          // Check if a recent threshold alert exists in last 24h
          const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
          const recent = await fastify.prisma.limitAlert.findFirst({ where: { serviceType: limit.serviceType, alertType: 'threshold', alertTimestamp: { gte: since }, resolved: false } });
          if (!recent) {
            await fastify.prisma.limitAlert.create({ data: {
              serviceType: limit.serviceType,
              alertType: 'threshold',
              thresholdPercent: limit.alertThreshold,
              usageAtAlert: used,
              limitValue: limit.limitValue,
              adminNotified: false,
            }});
            fastify.log.warn({ service: limit.serviceType, used, limit: limit.limitValue }, 'Maps usage threshold reached');
          }
        }

        // Limit exceeded -> hard stop if configured
        if (used >= limit.limitValue) {
          if (limit.hardStop && limit.status !== 'exceeded') {
            await fastify.prisma.usageLimit.update({ where: { serviceType: limit.serviceType }, data: { status: 'exceeded' } });
            await fastify.prisma.limitAlert.create({ data: {
              serviceType: limit.serviceType,
              alertType: 'limit_exceeded',
              thresholdPercent: 100,
              usageAtAlert: used,
              limitValue: limit.limitValue,
              adminNotified: false,
            }});
            fastify.log.error({ service: limit.serviceType, used, limit: limit.limitValue }, 'Maps usage limit exceeded - service hard-stopped');
          }
        }
      }
    } catch (err) {
      fastify.log.error({ err }, 'mapsMonitor check failed');
    }
  }

  // Start periodic check
  timer = setInterval(checkUsage, intervalMs);

  // Run once immediately
  void checkUsage();

  fastify.addHook('onClose', async () => {
    if (timer) clearInterval(timer);
  });
};

export default fp(mapsMonitor, { name: 'maps-monitor' });

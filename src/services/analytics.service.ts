import { PrismaClient } from '@prisma/client';
import { AnalyticsEventInput } from '../schemas/analytics.js';

export class AnalyticsService {
  constructor(private prisma: PrismaClient) {}

  async trackEvent(userId: string, event: AnalyticsEventInput) {
    return this.prisma.analyticsEvent.create({
      data: {
        eventName: event.eventName,
        userId,
        entityId: event.entityId,
        metadata: event.metadata,
      },
    });
  }

  async getEventsSummary() {
    // Get event counts by name
    const events = await this.prisma.analyticsEvent.findMany();

    const summary = events.reduce(
      (acc, event) => {
        if (!acc[event.eventName]) {
          acc[event.eventName] = 0;
        }
        acc[event.eventName]++;
        return acc;
      },
      {} as Record<string, number>
    );

    return {
      totalEvents: events.length,
      eventTypes: Object.keys(summary),
      eventCounts: summary,
      uniqueUsers: new Set(events.map(e => e.userId)).size,
    };
  }

  async getAllEvents(limit: number = 100) {
    return this.prisma.analyticsEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getEventsByName(eventName: string, limit: number = 50) {
    return this.prisma.analyticsEvent.findMany({
      where: { eventName },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getEventsByUser(userId: string, limit: number = 50) {
    return this.prisma.analyticsEvent.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}

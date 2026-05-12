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
    const events = await this.prisma.analyticsEvent.findMany();
    const summary = events.reduce(
      (acc, event) => {
        if (!acc[event.eventName]) acc[event.eventName] = 0;
        acc[event.eventName]++;
        return acc;
      },
      {} as Record<string, number>
    );

    return {
      totalEvents: events.length,
      eventTypes: Object.keys(summary),
      eventCounts: summary,
      uniqueUsers: new Set(events.map((e) => e.userId)).size,
    };
  }

  async getDashboard() {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      newUsersWeek,
      totalProperties,
      newPropertiesWeek,
      totalRequests,
      totalOffers,
      totalRevenue,
      referralClicks,
      referralSignups,
      usersWithRoles,
      propertyStatuses,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
      this.prisma.property.count(),
      this.prisma.property.count({ where: { createdAt: { gte: weekAgo } } }),
      this.prisma.propertyRequest.count(),
      this.prisma.propertyOffer.count(),
      this.prisma.creditTransaction.aggregate({
        _sum: { amount: true },
        where: { type: 'purchase' },
      }),
      this.prisma.referralEvent.count({ where: { eventType: 'click' } }),
      this.prisma.referralEvent.count({ where: { eventType: 'signup' } }),
      this.prisma.userRole.findMany({
        where: { status: 'approved' },
        include: { role: { select: { name: true } } },
      }),
      this.prisma.property.groupBy({
        by: ['status'],
        _count: true,
      }),
    ]);

    const usersByRole: Record<string, number> = {};
    usersWithRoles.forEach((ur) => {
      const name = ur.role.name;
      usersByRole[name] = (usersByRole[name] || 0) + 1;
    });

    const propertiesByStatus: Record<string, number> = {};
    propertyStatuses.forEach((ps) => {
      propertiesByStatus[ps.status] = ps._count;
    });

    return {
      users: { total: totalUsers, newThisWeek: newUsersWeek },
      properties: { total: totalProperties, newThisWeek: newPropertiesWeek, byStatus: propertiesByStatus },
      transactions: { totalRequests, totalOffers },
      revenue: { totalCreditsPurchased: totalRevenue._sum.amount || 0 },
      referrals: { clicks: referralClicks, signups: referralSignups },
      usersByRole,
    };
  }

  async getTimeline(days: number = 30) {
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [dailyUsers, dailyProperties, dailyRequests, dailyReferralEvents, dailyCreditPurchases] =
      await Promise.all([
        this.prisma.user.findMany({
          where: { createdAt: { gte: start } },
          select: { createdAt: true },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.property.findMany({
          where: { createdAt: { gte: start } },
          select: { createdAt: true },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.propertyRequest.findMany({
          where: { createdAt: { gte: start } },
          select: { createdAt: true },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.referralEvent.findMany({
          where: { createdAt: { gte: start } },
          select: { createdAt: true, eventType: true },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.creditTransaction.findMany({
          where: { createdAt: { gte: start }, type: 'purchase' },
          select: { createdAt: true, amount: true },
          orderBy: { createdAt: 'asc' },
        }),
      ]);

    const bucket = (date: Date) => date.toISOString().slice(0, 10);

    const dates: string[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      dates.push(d.toISOString().slice(0, 10));
    }
    dates.reverse();

    const countByDate = (items: { createdAt: Date }[]) => {
      const map: Record<string, number> = {};
      items.forEach((item) => {
        const key = bucket(item.createdAt);
        map[key] = (map[key] || 0) + 1;
      });
      return dates.map((d) => map[d] || 0);
    };

    const referralClickByDate = () => {
      const map: Record<string, number> = {};
      dailyReferralEvents
        .filter((e) => e.eventType === 'click')
        .forEach((e) => {
          const key = bucket(e.createdAt);
          map[key] = (map[key] || 0) + 1;
        });
      return dates.map((d) => map[d] || 0);
    };

    const referralSignupByDate = () => {
      const map: Record<string, number> = {};
      dailyReferralEvents
        .filter((e) => e.eventType === 'signup')
        .forEach((e) => {
          const key = bucket(e.createdAt);
          map[key] = (map[key] || 0) + 1;
        });
      return dates.map((d) => map[d] || 0);
    };

    return {
      dates,
      users: countByDate(dailyUsers),
      properties: countByDate(dailyProperties),
      contactRequests: countByDate(dailyRequests),
      referralClicks: referralClickByDate(),
      referralSignups: referralSignupByDate(),
      creditRevenue: dates.map((d) => {
        const total = dailyCreditPurchases
          .filter((t) => bucket(t.createdAt) === d)
          .reduce((sum, t) => sum + t.amount, 0);
        return total;
      }),
    };
  }

  async getTopProperties(limit: number = 10) {
    const properties = await this.prisma.property.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        price: true,
        monthlyRent: true,
        listingType: true,
        status: true,
        createdAt: true,
        _count: {
          select: {
            propertyRequests: true,
            propertyOffers: true,
            reviews: true,
          },
        },
      },
    });

    const propertyIds = properties.map((p) => p.id);
    const viewEvents = await this.prisma.analyticsEvent.groupBy({
      by: ['entityId'],
      where: { eventName: 'PropertyViewed', entityId: { in: propertyIds } },
      _count: true,
    });

    const viewCountMap: Record<string, number> = {};
    viewEvents.forEach((ve) => {
      viewCountMap[ve.entityId!] = ve._count;
    });

    return properties.map((p) => ({
      id: p.id,
      title: p.title,
      price: p.price,
      monthlyRent: p.monthlyRent,
      listingType: p.listingType,
      status: p.status,
      createdAt: p.createdAt,
      views: viewCountMap[p.id] || 0,
      contactRequests: p._count.propertyRequests,
      offers: p._count.propertyOffers,
      reviews: p._count.reviews,
    }));
  }

  async getReferralSummary() {
    const events = await this.prisma.referralEvent.findMany({
      select: { referralCode: true, eventType: true, referrerId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    const totalClicks = events.filter((e) => e.eventType === 'click').length;
    const totalSignups = events.filter((e) => e.eventType === 'signup').length;

    const referrerMap: Record<string, { clicks: number; signups: number }> = {};
    events.forEach((e) => {
      const key = e.referralCode;
      if (!referrerMap[key]) referrerMap[key] = { clicks: 0, signups: 0 };
      if (e.eventType === 'click') referrerMap[key].clicks++;
      if (e.eventType === 'signup') referrerMap[key].signups++;
    });

    const topReferrers = Object.entries(referrerMap)
      .map(([code, stats]) => ({ referralCode: code, ...stats }))
      .sort((a, b) => b.signups - a.signups)
      .slice(0, 10);

    return {
      totalClicks,
      totalSignups,
      conversionRate: totalClicks > 0 ? Math.round((totalSignups / totalClicks) * 100) : 0,
      topReferrers,
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

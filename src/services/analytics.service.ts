import { PrismaClient } from "@prisma/client";
import { AnalyticsEventInput } from "../schemas/analytics.js";

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
      {} as Record<string, number>,
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
        where: { type: "purchase" },
      }),
      this.prisma.referralEvent.count({ where: { eventType: "click" } }),
      this.prisma.referralEvent.count({ where: { eventType: "signup" } }),
      this.prisma.userRole.findMany({
        where: { status: "approved" },
        include: { role: { select: { name: true } } },
      }),
      this.prisma.property.groupBy({
        by: ["status"],
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
      properties: {
        total: totalProperties,
        newThisWeek: newPropertiesWeek,
        byStatus: propertiesByStatus,
      },
      transactions: { totalRequests, totalOffers },
      revenue: { totalCreditsPurchased: totalRevenue._sum.amount || 0 },
      referrals: { clicks: referralClicks, signups: referralSignups },
      usersByRole,
    };
  }

  async getTimeline(days: number = 30) {
    const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [
      dailyUsers,
      dailyProperties,
      dailyRequests,
      dailyReferralEvents,
      dailyCreditPurchases,
    ] = await Promise.all([
      this.prisma.user.findMany({
        where: { createdAt: { gte: start } },
        select: { createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.property.findMany({
        where: { createdAt: { gte: start } },
        select: { createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.propertyRequest.findMany({
        where: { createdAt: { gte: start } },
        select: { createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.referralEvent.findMany({
        where: { createdAt: { gte: start } },
        select: { createdAt: true, eventType: true },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.creditTransaction.findMany({
        where: { createdAt: { gte: start }, type: "purchase" },
        select: { createdAt: true, amount: true },
        orderBy: { createdAt: "asc" },
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
        .filter((e) => e.eventType === "click")
        .forEach((e) => {
          const key = bucket(e.createdAt);
          map[key] = (map[key] || 0) + 1;
        });
      return dates.map((d) => map[d] || 0);
    };

    const referralSignupByDate = () => {
      const map: Record<string, number> = {};
      dailyReferralEvents
        .filter((e) => e.eventType === "signup")
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
      orderBy: { createdAt: "desc" },
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
      by: ["entityId"],
      where: { eventName: "PropertyViewed", entityId: { in: propertyIds } },
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
      select: {
        referralCode: true,
        eventType: true,
        referrerId: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    const totalClicks = events.filter((e) => e.eventType === "click").length;
    const totalSignups = events.filter((e) => e.eventType === "signup").length;

    const referrerMap: Record<string, { clicks: number; signups: number }> = {};
    events.forEach((e) => {
      const key = e.referralCode;
      if (!referrerMap[key]) referrerMap[key] = { clicks: 0, signups: 0 };
      if (e.eventType === "click") referrerMap[key].clicks++;
      if (e.eventType === "signup") referrerMap[key].signups++;
    });

    const topReferrers = Object.entries(referrerMap)
      .map(([code, stats]) => ({ referralCode: code, ...stats }))
      .sort((a, b) => b.signups - a.signups)
      .slice(0, 10);

    return {
      totalClicks,
      totalSignups,
      conversionRate:
        totalClicks > 0 ? Math.round((totalSignups / totalClicks) * 100) : 0,
      topReferrers,
    };
  }

  async getAllEvents(limit: number = 100) {
    return this.prisma.analyticsEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  async getEventsByName(eventName: string, limit: number = 50) {
    return this.prisma.analyticsEvent.findMany({
      where: { eventName },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  async getEventsByUser(userId: string, limit: number = 50) {
    return this.prisma.analyticsEvent.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  // ─── Market Analytics ───────────────────────────────────────────────

  async getMarketSummary(listingType?: string) {
    const where = listingType ? { listingType } : {};
    const now = new Date();
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const lastMonthStart = new Date(
      monthAgo.getTime() - 30 * 24 * 60 * 60 * 1000,
    );

    const [
      activeListings,
      offers,
      offersLastMonth,
      staleCount,
      staleLastMonth,
      acceptedOffers,
      counteredOffers,
    ] = await Promise.all([
      this.prisma.property.count({ where: { ...where, status: "disponible" } }),
      this.prisma.propertyOffer.findMany({
        where: { property: where, createdAt: { gte: monthAgo } },
        select: { offerAmount: true, status: true, propertyId: true },
      }),
      this.prisma.propertyOffer.findMany({
        where: {
          property: where,
          createdAt: { gte: lastMonthStart, lt: monthAgo },
        },
        select: { offerAmount: true },
      }),
      this.prisma.property.count({
        where: {
          ...where,
          status: "disponible",
          createdAt: {
            lte: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000),
          },
          propertyOffers: { none: {} },
        },
      }),
      this.prisma.property.count({
        where: {
          ...where,
          status: "disponible",
          createdAt: {
            lte: new Date(monthAgo.getTime() - 60 * 24 * 60 * 60 * 1000),
            gte: new Date(monthAgo.getTime() - 120 * 24 * 60 * 60 * 1000),
          },
          propertyOffers: { none: {} },
        },
      }),
      this.prisma.propertyOffer.count({
        where: {
          property: where,
          status: "accepted",
          updatedAt: { gte: monthAgo },
        },
      }),
      this.prisma.propertyOffer.count({
        where: {
          property: where,
          status: "countered",
          updatedAt: { gte: monthAgo },
        },
      }),
    ]);

    const amounts = offers
      .filter((o) => o.offerAmount > 0)
      .map((o) => o.offerAmount);
    const sorted = amounts.sort((a, b) => a - b);
    const median =
      sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0;
    const avg =
      amounts.length > 0
        ? amounts.reduce((s, v) => s + v, 0) / amounts.length
        : 0;

    const uniqueProps = new Set(offers.map((o) => o.propertyId)).size;
    const avgOffersPerProperty =
      activeListings > 0 ? offers.length / activeListings : 0;
    const acceptanceRate =
      offers.length > 0 ? (acceptedOffers / offers.length) * 100 : 0;
    const counterRate =
      offers.length > 0 ? (counteredOffers / offers.length) * 100 : 0;
    const offerToAskRatio =
      acceptedOffers > 0
        ? offers
            .filter((o) => o.status === "accepted")
            .reduce((s, o) => s + o.offerAmount, 0) /
          acceptedOffers /
          (amounts.length > 0 ? avg : 1)
        : 0;

    const lastMonthAmounts = offersLastMonth
      .filter((o) => o.offerAmount > 0)
      .map((o) => o.offerAmount);
    const lastMonthAvg =
      lastMonthAmounts.length > 0
        ? lastMonthAmounts.reduce((s, v) => s + v, 0) / lastMonthAmounts.length
        : 0;
    const momChange =
      lastMonthAvg > 0 ? ((avg - lastMonthAvg) / lastMonthAvg) * 100 : 0;
    const daysMoM =
      staleLastMonth > 0
        ? ((staleCount - staleLastMonth) / staleLastMonth) * 100
        : 0;

    return {
      activeListings,
      medianOfferPerSqm:
        median > 0 && activeListings > 0 ? Math.round(median) : 0,
      momChange: Math.round(momChange * 10) / 10,
      medianDaysToOffer: 0,
      avgOffersPerProperty: Math.round(avgOffersPerProperty * 10) / 10,
      acceptanceRate: Math.round(acceptanceRate * 10) / 10,
      counterRate: Math.round(counterRate * 10) / 10,
      offerToAskRatio: Math.round(offerToAskRatio * 100) / 100,
      staleCount,
      activeListingsMoM: 0,
      daysMoM: Math.round(daysMoM * 10) / 10,
      offersMoM: 0,
      acceptanceMoM: 0,
      staleMoM: Math.round(daysMoM * 10) / 10,
    };
  }

  async getMarketByCity(estado?: string, listingType?: string) {
    const where: any = {};
    if (estado) where.estado = estado;
    if (listingType) where.listingType = listingType;

    const cities = await this.prisma.property.groupBy({
      by: ["ciudad", "estado"],
      where,
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    });

    const results = await Promise.all(
      cities.slice(0, 50).map(async (c) => {
        const cityWhere = { ...where, ciudad: c.ciudad, estado: c.estado };
        const now = new Date();
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        const [offers, acceptedOffers, staleCount, totalOffers] =
          await Promise.all([
            this.prisma.propertyOffer.findMany({
              where: { property: cityWhere, createdAt: { gte: monthAgo } },
              select: { offerAmount: true, status: true },
            }),
            this.prisma.propertyOffer.count({
              where: {
                property: cityWhere,
                status: "accepted",
                updatedAt: { gte: monthAgo },
              },
            }),
            this.prisma.property.count({
              where: {
                ...cityWhere,
                status: "disponible",
                createdAt: {
                  lte: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000),
                },
                propertyOffers: { none: {} },
              },
            }),
            this.prisma.propertyOffer.count({ where: { property: cityWhere } }),
          ]);

        const amounts = offers
          .filter((o) => o.offerAmount > 0)
          .map((o) => o.offerAmount);
        const sorted = amounts.sort((a, b) => a - b);
        const median =
          sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0;

        const activeListings = c._count.id;
        const acceptanceRate =
          offers.length > 0 ? (acceptedOffers / offers.length) * 100 : 0;
        const avgOffersPerProperty =
          activeListings > 0 ? offers.length / activeListings : 0;

        const activityScore =
          avgOffersPerProperty * 2 +
          acceptanceRate / 10 +
          (activeListings > 5 ? 1 : 0) -
          staleCount * 0.1;

        return {
          ciudad: c.ciudad || "Sin nombre",
          estado: c.estado,
          activeListings,
          medianOfferPerSqm: Math.round(median),
          momChange: 0,
          medianDaysToOffer: 0,
          avgOffersPerProperty: Math.round(avgOffersPerProperty * 10) / 10,
          acceptanceRate: Math.round(acceptanceRate * 10) / 10,
          staleCount,
          activityScore: Math.round(activityScore * 10) / 10,
        };
      }),
    );

    return results;
  }

  async getMarketByColonia(
    estado: string,
    ciudad: string,
    listingType?: string,
  ) {
    const where: any = { estado, ciudad };
    if (listingType) where.listingType = listingType;

    const colonias = await this.prisma.property.groupBy({
      by: ["colonia"],
      where,
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
    });

    const results = await Promise.all(
      colonias.slice(0, 30).map(async (c) => {
        const colWhere = { ...where, colonia: c.colonia };
        const now = new Date();
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

        const [offers, acceptedOffers, staleCount] = await Promise.all([
          this.prisma.propertyOffer.findMany({
            where: { property: colWhere },
            select: { offerAmount: true, status: true },
          }),
          this.prisma.propertyOffer.count({
            where: {
              property: colWhere,
              status: "accepted",
              updatedAt: { gte: monthAgo },
            },
          }),
          this.prisma.property.count({
            where: {
              ...colWhere,
              status: "disponible",
              createdAt: {
                lte: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000),
              },
              propertyOffers: { none: {} },
            },
          }),
        ]);

        const amounts = offers
          .filter((o) => o.offerAmount > 0)
          .map((o) => o.offerAmount);
        const sorted = amounts.sort((a, b) => a - b);
        const median =
          sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0;
        const acceptanceRate =
          offers.length > 0 ? (acceptedOffers / offers.length) * 100 : 0;

        return {
          colonia: c.colonia || "Sin nombre",
          activeListings: c._count.id,
          medianOfferPerSqm: Math.round(median),
          medianDaysToOffer: 0,
          avgOffersPerProperty:
            c._count.id > 0
              ? Math.round((offers.length / c._count.id) * 10) / 10
              : 0,
          totalOffers: offers.length,
          acceptanceRate: Math.round(acceptanceRate * 10) / 10,
          staleCount,
          momChange: 0,
          compCount: acceptedOffers,
        };
      }),
    );

    return results;
  }

  async getOfferTrends(
    estado?: string,
    ciudad?: string,
    colonia?: string,
    listingType?: string,
    months: number = 12,
  ) {
    const where: any = {};
    if (estado) where.estado = estado;
    if (ciudad) where.ciudad = ciudad;
    if (colonia) where.colonia = colonia;
    if (listingType) where.listingType = listingType;

    const now = new Date();
    const startDate = new Date(
      now.getTime() - months * 30 * 24 * 60 * 60 * 1000,
    );

    const offers = await this.prisma.propertyOffer.findMany({
      where: { property: where, createdAt: { gte: startDate } },
      select: { offerAmount: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    const monthlyBuckets: Record<string, number[]> = {};
    for (let i = 0; i < months; i++) {
      const d = new Date(
        startDate.getTime() + (i + 1) * 30 * 24 * 60 * 60 * 1000,
      );
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      monthlyBuckets[key] = [];
    }

    offers.forEach((o) => {
      const key = `${o.createdAt.getFullYear()}-${String(o.createdAt.getMonth() + 1).padStart(2, "0")}`;
      if (monthlyBuckets[key]) {
        monthlyBuckets[key].push(o.offerAmount);
      }
    });

    const dates = Object.keys(monthlyBuckets).sort();
    const values = dates.map((d) => {
      const amounts = monthlyBuckets[d].filter((a) => a > 0);
      if (amounts.length === 0) return 0;
      const sorted = amounts.sort((a, b) => a - b);
      return Math.round(sorted[Math.floor(sorted.length / 2)]);
    });

    const label = colonia || ciudad || estado || "México";

    return { label, dates, values };
  }

  async getOfferAnalysis(estado?: string, ciudad?: string) {
    const where: any = {};
    if (estado) where.estado = estado;
    if (ciudad) where.ciudad = ciudad;

    const now = new Date();
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [totalOffers, acceptedOffers, counteredOffers, activeListings] =
      await Promise.all([
        this.prisma.propertyOffer.count({
          where: { property: where, createdAt: { gte: monthAgo } },
        }),
        this.prisma.propertyOffer.count({
          where: {
            property: where,
            status: "accepted",
            updatedAt: { gte: monthAgo },
          },
        }),
        this.prisma.propertyOffer.count({
          where: { property: where, status: "countered" },
        }),
        this.prisma.property.count({
          where: { ...where, status: "disponible" },
        }),
      ]);

    return {
      avgOffersPerProperty:
        activeListings > 0
          ? Math.round((totalOffers / activeListings) * 10) / 10
          : 0,
      acceptanceRate:
        totalOffers > 0
          ? Math.round((acceptedOffers / totalOffers) * 1000) / 10
          : 0,
      counterRate:
        totalOffers > 0
          ? Math.round((counteredOffers / totalOffers) * 1000) / 10
          : 0,
      offerToAskRatio: 0,
    };
  }

  async getOpportunities(listingType?: string) {
    const where: any = {};
    if (listingType) where.listingType = listingType;

    const now = new Date();
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const cities = await this.prisma.property.groupBy({
      by: ["ciudad", "estado"],
      where,
      _count: { id: true },
    });

    const opportunities = await Promise.all(
      cities.slice(0, 30).map(async (c) => {
        const cityWhere = { ...where, ciudad: c.ciudad, estado: c.estado };
        const [offers, totalOffers, staleCount] = await Promise.all([
          this.prisma.propertyOffer.findMany({
            where: { property: cityWhere, createdAt: { gte: monthAgo } },
            select: { offerAmount: true, status: true },
          }),
          this.prisma.propertyOffer.count({ where: { property: cityWhere } }),
          this.prisma.property.count({
            where: {
              ...cityWhere,
              status: "disponible",
              createdAt: {
                lte: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000),
              },
              propertyOffers: { none: {} },
            },
          }),
        ]);

        const accepted = offers.filter((o) => o.status === "accepted");
        const amounts = accepted
          .filter((o) => o.offerAmount > 0)
          .map((o) => o.offerAmount);
        const avg =
          amounts.length > 0
            ? amounts.reduce((s, v) => s + v, 0) / amounts.length
            : 0;

        return {
          ciudad: c.ciudad || "Sin nombre",
          estado: c.estado,
          activeListings: c._count.id,
          totalOffers,
          acceptedOffers: accepted.length,
          staleCount,
          avgOfferAmount: Math.round(avg),
          score: c._count.id > 0 ? (totalOffers / c._count.id) * 5 : 0,
        };
      }),
    );

    const highDemandLowSupply = opportunities
      .filter(
        (o) => o.activeListings > 0 && o.totalOffers / o.activeListings >= 2,
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((o) => ({ colonia: o.ciudad, ciudad: o.estado, score: o.score }));

    const trendingUp = opportunities
      .filter((o) => o.acceptedOffers >= 1 && o.activeListings > 0)
      .sort((a, b) => b.acceptedOffers - a.acceptedOffers)
      .slice(0, 5)
      .map((o) => ({
        colonia: o.ciudad,
        ciudad: o.estado,
        momChange: o.score,
      }));

    const trendingDown = opportunities
      .filter((o) => o.totalOffers === 0 && o.activeListings >= 3)
      .sort((a, b) => b.activeListings - a.activeListings)
      .slice(0, 5)
      .map((o) => ({ colonia: o.ciudad, ciudad: o.estado, momChange: 0 }));

    const staleProperties = await this.prisma.property.findMany({
      where: {
        ...where,
        status: "disponible",
        createdAt: { lte: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000) },
        propertyOffers: { none: {} },
      },
      select: { id: true, title: true, colonia: true },
      take: 10,
      orderBy: { createdAt: "asc" },
    });

    return {
      highDemandLowSupply,
      underpricedOffers: [],
      staleProperties: staleProperties.map((p) => ({
        propertyId: p.id,
        title: p.title,
        colonia: p.colonia || "Sin colonia",
        daysSinceListed: Math.floor(
          (now.getTime() -
            new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).getTime()) /
            (24 * 60 * 60 * 1000),
        ),
      })),
      trendingUp,
      trendingDown,
    };
  }

  async getComps(
    estado?: string,
    ciudad?: string,
    colonia?: string,
    listingType?: string,
    limit: number = 20,
  ) {
    const where: any = {};
    if (estado) where.estado = estado;
    if (ciudad) where.ciudad = ciudad;
    if (colonia) where.colonia = colonia;
    if (listingType) where.listingType = listingType;

    const offers = await this.prisma.propertyOffer.findMany({
      where: {
        property: where,
        status: { in: ["accepted", "rejected", "countered"] },
      },
      select: {
        offerAmount: true,
        status: true,
        createdAt: true,
        property: {
          select: {
            title: true,
            propertyType: true,
            colonia: true,
            squareMeters: true,
            price: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return offers.map((o) => ({
      propertyTitle: o.property.title,
      propertyType: o.property.propertyType,
      colonia: o.property.colonia,
      offerAmount: o.offerAmount,
      status: o.status,
      offeredAt: o.createdAt.toISOString(),
      m2: o.property.squareMeters,
      pricePerSqm:
        o.property.squareMeters && o.property.squareMeters > 0
          ? Math.round(o.offerAmount / o.property.squareMeters)
          : 0,
    }));
  }
}

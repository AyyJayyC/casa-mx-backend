import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export type ServiceType = 'geocoding' | 'places_autocomplete' | 'place_details' | 'tile_requests' | 'directions';

export class MapsService {
  apiKey: string | undefined;
  // Simple in-memory cache: key -> { value, expires }
  cache: Map<string, { value: any; expiresAt: number }> = new Map();

  getFromCache(key: string) {
    const rec = this.cache.get(key);
    if (!rec) return null;
    if (Date.now() > rec.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return rec.value;
  }

  setCache(key: string, value: any, ttlMs: number) {
    this.cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.MAPS_API_KEY || process.env.MAPS_API_KEY;
  }

  async checkLimit(serviceType: ServiceType) {
    const limit = await prisma.usageLimit.findUnique({ where: { serviceType } });
    if (!limit) return { allowed: true };
    if (limit.hardStop && limit.status === 'exceeded') return { allowed: false, reason: 'hard_stop' };
    // Simple remaining calc
    const remaining = limit.limitValue - limit.currentUsage;
    return { allowed: remaining > 0, remaining, limit };
  }

  async incrementUsage(serviceType: ServiceType, delta = 1) {
    await prisma.usageLimit.updateMany({
      where: { serviceType },
      data: { currentUsage: { increment: delta } }
    });
  }

  async logRequest(params: {
    provider: string;
    serviceType: ServiceType;
    userId?: string | null;
    requestDetails?: any;
    responseStatus: string;
    responseTimeMs?: number;
    cost?: number;
    errorMessage?: string | null;
  }) {
    try {
      const data: any = {
        provider: params.provider,
        serviceType: params.serviceType,
        responseStatus: params.responseStatus,
      };
      if (params.userId) data.userId = params.userId;
      if (params.requestDetails) data.requestDetails = params.requestDetails;
      if (params.responseTimeMs !== undefined) data.responseTimeMs = params.responseTimeMs;
      if (params.cost !== undefined) data.cost = params.cost;
      if (params.errorMessage) data.errorMessage = params.errorMessage;
      
      await prisma.apiUsageLog.create({ data });
    } catch (err) {
      console.error('Failed to log API usage:', err);
      // Don't throw - just log silently
    }
  }

  // Example wrapper for geocoding (server-side)
  async geocodeAddress(address: string, opts?: { userId?: string }) {
    const start = Date.now();
    try {
      const limitCheck = await this.checkLimit('geocoding');
      if (!limitCheck.allowed) {
        await this.logRequest({ provider: 'google_maps', serviceType: 'geocoding', userId: opts?.userId, requestDetails: { address }, responseStatus: 'rate_limited', responseTimeMs: 0, errorMessage: 'limit_reached' });
        throw new Error('Geocoding service disabled due to usage limits');
      }

      const cacheKey = `geocode:${address}`;
      const cached = this.getFromCache(cacheKey);
      if (cached) return cached;
      const key = this.apiKey || process.env.MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
      // Prefer Google if key present, else use Nominatim
      if (key) {
        const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}`;
        const res = await fetch(url);
        const data = (await res.json()) as any;
        const took = Date.now() - start;
        const status = data.status || (res.ok ? 'OK' : 'ERROR');
        await this.logRequest({ provider: 'google_maps', serviceType: 'geocoding', userId: opts?.userId, requestDetails: { address, url }, responseStatus: status.toLowerCase(), responseTimeMs: took });
        if (status === 'OK' && Array.isArray(data.results) && data.results.length > 0) {
          await this.incrementUsage('geocoding', 1);
          const out = data.results[0];
          this.setCache(cacheKey, out, 1000 * 60 * 60 * 24 * 30); // 30 days
          return out;
        }
        throw new Error(data.error_message || data.status || 'Geocode failed');
      } else {
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
        const res = await fetch(url, { headers: { 'User-Agent': 'casa-mx/1.0' } });
        const data = await res.json();
        const took = Date.now() - start;
        await this.logRequest({ provider: 'nominatim', serviceType: 'geocoding', userId: opts?.userId, requestDetails: { address, url }, responseStatus: res.ok ? 'success' : 'error', responseTimeMs: took });
        if (Array.isArray(data) && data.length > 0) {
          await this.incrementUsage('geocoding', 1);
          const out = data[0];
          this.setCache(cacheKey, out, 1000 * 60 * 60 * 24 * 30); // 30 days
          return out;
        }
        throw new Error('Nominatim geocode failed');
      }
    } catch (err: any) {
      const took = Date.now() - start;
      console.error('Geocode error:', err);
      await this.logRequest({ provider: this.apiKey ? 'google_maps' : 'nominatim', serviceType: 'geocoding', userId: opts?.userId, requestDetails: { address }, responseStatus: 'error', responseTimeMs: took, errorMessage: err.message });
      throw err;
    }
  }

  // Simple admin helpers
  async getUsage(serviceType: ServiceType, period: 'daily' | 'monthly' = 'monthly') {
    // For simplicity, query ApiUsageLog counts
    const now = new Date();
    let from = new Date();
    if (period === 'daily') {
      from.setHours(0,0,0,0);
    } else {
      from.setDate(1);
      from.setHours(0,0,0,0);
    }
    const used = await prisma.apiUsageLog.count({ where: { serviceType, requestTimestamp: { gte: from } } });
    const limit = await prisma.usageLimit.findUnique({ where: { serviceType } });
    return { serviceType, used, limit: limit?.limitValue ?? null, remaining: limit ? Math.max(limit.limitValue - used, 0) : null };
  }

  // Autocomplete wrapper: prefer Google Places Autocomplete, fallback to Nominatim search
  async autocomplete(input: string, opts?: { userId?: string }) {
    if (!input || input.length < 3) return [];
    const cacheKey = `autocomplete:${input}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const start = Date.now();
    try {
      const key = this.apiKey || process.env.MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
      if (key) {
        const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&types=address&components=country:mx&key=${key}`;
        const res = await fetch(url);
        const data = (await res.json()) as any;
        const took = Date.now() - start;
        await this.logRequest({ provider: 'google_maps', serviceType: 'places_autocomplete', userId: opts?.userId, requestDetails: { input, url }, responseStatus: (data.status || (res.ok ? 'OK' : 'ERROR')).toLowerCase(), responseTimeMs: took });
        if (data.predictions) {
          await this.incrementUsage('places_autocomplete', 1);
          this.setCache(cacheKey, data.predictions, 1000 * 60 * 60 * 24 * 7); // 7 days
          return data.predictions;
        }
        return [];
      } else {
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=10&countrycodes=mx&q=${encodeURIComponent(input)}`;
        const res = await fetch(url, { headers: { 'User-Agent': 'casa-mx/1.0' } });
        const data = (await res.json()) as any[];
        const took = Date.now() - start;
        await this.logRequest({ provider: 'nominatim', serviceType: 'places_autocomplete', userId: opts?.userId, requestDetails: { input, url }, responseStatus: res.ok ? 'success' : 'error', responseTimeMs: took });
        const mapped = (data || []).map((d: any) => {
          // Extract address components from Nominatim response
          const parts = (d.display_name || '').split(',').map((p: string) => p.trim());
          return {
            description: d.display_name,
            place_id: d.osm_id,
            _nominatim: true,
            lat: d.lat,
            lon: d.lon,
            address_components: {
              address: parts[0] || '',
              colonia: d.address?.neighbourhood || parts[1] || '',
              ciudad: d.address?.city || d.address?.town || parts[2] || '',
              estado: d.address?.state || d.address?.province || parts[parts.length - 2] || ''
            }
          };
        });
        if (mapped.length > 0) {
          await this.incrementUsage('places_autocomplete', 1);
          this.setCache(cacheKey, mapped, 1000 * 60 * 60 * 24 * 7);
        }
        return mapped;
      }
    } catch (err: any) {
      const took = Date.now() - start;
      await this.logRequest({ provider: this.apiKey ? 'google_maps' : 'nominatim', serviceType: 'places_autocomplete', userId: opts?.userId, requestDetails: { input }, responseStatus: 'error', responseTimeMs: took, errorMessage: err.message });
      return [];
    }
  }

  async listLimits() {
    return prisma.usageLimit.findMany();
  }

  async updateLimit(serviceType: string, data: Partial<{ limitValue: number; alertThreshold: number; hardStop: boolean }>) {
    return prisma.usageLimit.update({ where: { serviceType }, data });
  }

  async pauseService(serviceType: string) {
    return prisma.usageLimit.update({ where: { serviceType }, data: { status: 'paused' } });
  }

  async resumeService(serviceType: string) {
    return prisma.usageLimit.update({ where: { serviceType }, data: { status: 'active' } });
  }
}

export const mapsService = new MapsService(process.env.MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY);

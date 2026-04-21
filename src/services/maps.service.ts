import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isConfiguredMapsKey } from '../config/env.js';

const prisma = new PrismaClient();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const locationsCatalogPath = join(__dirname, '..', 'data', 'mexican-locations.json');
const locationsCatalog = JSON.parse(readFileSync(locationsCatalogPath, 'utf8')) as {
  estados: Array<{
    id: string;
    nombre: string;
    ciudades: Array<{
      id: string;
      nombre: string;
      colonias: string[];
    }>;
  }>;
  postalCodeRanges?: Record<string, { min: string; max: string }>;
};

const LOCAL_CITY_COORDINATES = new Map<string, { lat: number; lng: number }>([
  ['sonora::hermosillo', { lat: 29.0892, lng: -110.9613 }],
  ['sonora::ciudad obregon', { lat: 27.4828, lng: -109.9304 }],
  ['sonora::nogales', { lat: 31.3086, lng: -110.9449 }],
  ['ciudad de mexico::benito juarez', { lat: 19.3806, lng: -99.1632 }],
  ['ciudad de mexico::cuauhtemoc', { lat: 19.4333, lng: -99.1461 }],
  ['jalisco::guadalajara', { lat: 20.6736, lng: -103.344 }],
  ['jalisco::zapopan', { lat: 20.7236, lng: -103.3848 }],
  ['nuevo leon::monterrey', { lat: 25.6866, lng: -100.3161 }],
  ['yucatan::merida', { lat: 20.9674, lng: -89.5926 }],
  ['puebla::puebla', { lat: 19.0414, lng: -98.2063 }],
  ['queretaro::queretaro', { lat: 20.5888, lng: -100.3899 }],
  ['baja california::tijuana', { lat: 32.5149, lng: -117.0382 }],
]);

const LOCAL_FALLBACK_DEFAULTS = [
  { estado: 'Sonora', ciudad: 'Hermosillo', colonia: 'Pitic' },
  { estado: 'Jalisco', ciudad: 'Guadalajara', colonia: 'Centro' },
  { estado: 'Ciudad de México', ciudad: 'Cuauhtémoc', colonia: 'Roma' },
  { estado: 'Nuevo León', ciudad: 'Monterrey', colonia: 'Centro' },
  { estado: 'Yucatán', ciudad: 'Mérida', colonia: 'Centro' },
];

const MEXICO_COUNTRY_TOKENS = ['mexico', 'méxico', 'mx'];
const FOREIGN_COUNTRY_TOKENS = [' usa', ' united states', ' estados unidos', ' canada', ' can', ' us '];
const MEXICO_STATE_TOKENS = new Set(
  locationsCatalog.estados.map((estado) => normalizeText(estado.nombre)).filter(Boolean)
);
const MEXICO_CITY_TOKENS = new Set(
  locationsCatalog.estados.flatMap((estado) => estado.ciudades.map((ciudad) => normalizeText(ciudad.nombre))).filter(Boolean)
);

type LocalAddressComponents = {
  estado: string;
  ciudad: string;
  colonia?: string;
  codigoPostal?: string;
};

type LocalPrediction = {
  place_id: string;
  description: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
  address_components: LocalAddressComponents;
  geometry?: {
    location: {
      lat: number;
      lng: number;
    };
  };
  source: 'local_property' | 'local_catalog';
};

function normalizeText(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function compactWhitespace(value: string) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getPredictionSearchText(prediction: any) {
  const parts = [
    prediction?.description,
    prediction?.structured_formatting?.main_text,
    prediction?.structured_formatting?.secondary_text,
    ...(Array.isArray(prediction?.terms) ? prediction.terms.map((term: any) => term?.value) : []),
  ]
    .filter(Boolean)
    .map((value) => String(value).trim());

  return ` ${normalizeText(parts.join(' | '))} `;
}

function scoreMexicoPrediction(prediction: any) {
  const haystack = getPredictionSearchText(prediction);
  let score = 0;

  if (MEXICO_COUNTRY_TOKENS.some((token) => haystack.includes(` ${normalizeText(token)} `))) {
    score += 6;
  }

  for (const token of MEXICO_STATE_TOKENS) {
    if (haystack.includes(` ${token} `)) {
      score += 4;
      break;
    }
  }

  if (String(prediction?.source || '').startsWith('local_')) {
    score += 3;
  }

  if (FOREIGN_COUNTRY_TOKENS.some((token) => haystack.includes(token))) {
    score -= 8;
  }

  return score;
}

function rankMexicoPredictions<T>(predictions: T[]) {
  const ranked = predictions.map((prediction, index) => ({
    prediction,
    index,
    score: scoreMexicoPrediction(prediction),
  }));

  const prioritized = ranked.filter((entry) => entry.score > 0);
  const candidates = prioritized.length > 0 ? prioritized : ranked.filter((entry) => entry.score >= 0);
  const pool = candidates.length > 0 ? candidates : ranked;

  return pool
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.prediction);
}

function hasMexicoLocationContext(input: string) {
  const haystack = ` ${normalizeText(input)} `;

  for (const token of MEXICO_STATE_TOKENS) {
    if (haystack.includes(` ${token} `)) {
      return true;
    }
  }

  for (const token of MEXICO_CITY_TOKENS) {
    if (haystack.includes(` ${token} `)) {
      return true;
    }
  }

  return false;
}

function buildLocationKey(estado: string, ciudad: string) {
  return `${normalizeText(estado)}::${normalizeText(ciudad)}`;
}

function makeAddressComponents(components: LocalAddressComponents) {
  const out = [] as Array<{ long_name: string; short_name: string; types: string[] }>;

  if (components.colonia) {
    out.push({ long_name: components.colonia, short_name: components.colonia, types: ['neighborhood', 'sublocality', 'sublocality_level_1'] });
  }

  if (components.ciudad) {
    out.push({ long_name: components.ciudad, short_name: components.ciudad, types: ['locality'] });
  }

  if (components.estado) {
    out.push({ long_name: components.estado, short_name: components.estado, types: ['administrative_area_level_1'] });
  }

  if (components.codigoPostal) {
    out.push({ long_name: components.codigoPostal, short_name: components.codigoPostal, types: ['postal_code'] });
  }

  out.push({ long_name: 'México', short_name: 'MX', types: ['country'] });
  return out;
}

export type ServiceType = 'geocoding' | 'places_autocomplete' | 'place_details' | 'tile_requests' | 'directions';

export class MapsService {
  apiKey: string | undefined;
  billableProvidersEnabled: boolean;
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
    this.apiKey = apiKey || process.env.MAPS_API_KEY;
    this.billableProvidersEnabled = String(process.env.ENABLE_BILLABLE_MAPS || 'false').toLowerCase() === 'true';
  }

  canUseGoogleMapsProvider() {
    return isConfiguredMapsKey(this.apiKey) && this.billableProvidersEnabled;
  }

  isLocalFallbackEnabled() {
    return String(process.env.NODE_ENV || 'development').toLowerCase() !== 'production';
  }

  getLocationPostalCodeHint(estadoId?: string) {
    if (!estadoId || !locationsCatalog.postalCodeRanges) return '';
    return locationsCatalog.postalCodeRanges[estadoId]?.min || '';
  }

  getLocationCoordinates(estado: string, ciudad: string) {
    const coordinates = LOCAL_CITY_COORDINATES.get(buildLocationKey(estado, ciudad));
    return coordinates ? { location: coordinates } : null;
  }

  buildLocalPrediction(description: string, components: LocalAddressComponents, geometry: { location: { lat: number; lng: number } } | null, source: LocalPrediction['source']): LocalPrediction {
    const [mainText, ...rest] = description.split(',').map((part) => part.trim()).filter(Boolean);
    return {
      place_id: `local:${normalizeText(description).replace(/[^a-z0-9]+/g, '-')}`,
      description,
      structured_formatting: {
        main_text: mainText || description,
        secondary_text: rest.join(', '),
      },
      address_components: components,
      ...(geometry ? { geometry } : {}),
      source,
    };
  }

  async getPropertyFallbackPredictions(input: string) {
    const properties = await prisma.property.findMany({
      where: {
        OR: [
          { address: { contains: input, mode: 'insensitive' } },
          { colonia: { contains: input, mode: 'insensitive' } },
          { ciudad: { contains: input, mode: 'insensitive' } },
          { estado: { contains: input, mode: 'insensitive' } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: {
        address: true,
        estado: true,
        ciudad: true,
        colonia: true,
        codigoPostal: true,
        lat: true,
        lng: true,
      },
    });

    return properties
      .filter((property) => property.address && property.estado && property.ciudad)
      .map((property) =>
        this.buildLocalPrediction(
          compactWhitespace(property.address || [property.colonia, property.ciudad, property.estado].filter(Boolean).join(', ')),
          {
            estado: property.estado || '',
            ciudad: property.ciudad || '',
            colonia: property.colonia || '',
            codigoPostal: property.codigoPostal || '',
          },
          typeof property.lat === 'number' && typeof property.lng === 'number'
            ? { location: { lat: property.lat, lng: property.lng } }
            : this.getLocationCoordinates(property.estado || '', property.ciudad || ''),
          'local_property'
        )
      );
  }

  getCatalogCandidates(input: string) {
    const normalizedInput = normalizeText(input);
    const hasStreetNumber = /\d/.test(input);
    const flattened = locationsCatalog.estados.flatMap((estado) =>
      estado.ciudades.map((ciudad) => ({
        estadoId: estado.id,
        estado: estado.nombre,
        ciudad: ciudad.nombre,
        colonias: ciudad.colonias,
      }))
    );

    const explicitMatches = flattened.filter((entry) => {
      const cityMatch = normalizedInput.includes(normalizeText(entry.ciudad));
      const stateMatch = normalizedInput.includes(normalizeText(entry.estado));
      const coloniaMatch = entry.colonias.some((colonia) => normalizedInput.includes(normalizeText(colonia)));
      return cityMatch || stateMatch || coloniaMatch;
    });

    const fallbackEntries = explicitMatches.length > 0
      ? explicitMatches.slice(0, 5)
      : LOCAL_FALLBACK_DEFAULTS.map((entry) => {
          const estadoRecord = locationsCatalog.estados.find((estado) => normalizeText(estado.nombre) === normalizeText(entry.estado));
          const ciudadRecord = estadoRecord?.ciudades.find((ciudad) => normalizeText(ciudad.nombre) === normalizeText(entry.ciudad));
          return {
            estadoId: estadoRecord?.id || '',
            estado: entry.estado,
            ciudad: entry.ciudad,
            colonias: ciudadRecord?.colonias || (entry.colonia ? [entry.colonia] : []),
          };
        });

    return fallbackEntries.map((entry) => {
      const matchedColonia = entry.colonias.find((colonia) => normalizedInput.includes(normalizeText(colonia))) || entry.colonias[0] || '';
      const postalCode = this.getLocationPostalCodeHint(entry.estadoId);
      const streetValue = compactWhitespace(input);
      const locationParts = [matchedColonia, entry.ciudad, entry.estado, postalCode].filter(Boolean).join(', ');
      const description = hasStreetNumber ? `${streetValue}, ${locationParts}` : [streetValue, locationParts].filter(Boolean).join(', ');
      const geometry = this.getLocationCoordinates(entry.estado, entry.ciudad);

      return this.buildLocalPrediction(
        description,
        {
          estado: entry.estado,
          ciudad: entry.ciudad,
          colonia: matchedColonia,
          codigoPostal: postalCode,
        },
        geometry,
        'local_catalog'
      );
    });
  }

  async localAutocomplete(input: string) {
    const propertyPredictions = await this.getPropertyFallbackPredictions(input);
    const catalogPredictions = this.getCatalogCandidates(input);
    const combinedPredictions = hasMexicoLocationContext(input)
      ? rankMexicoPredictions([...catalogPredictions, ...propertyPredictions])
      : [...catalogPredictions, ...propertyPredictions];
    const deduped = new Map<string, LocalPrediction>();

    for (const prediction of combinedPredictions) {
      const key = normalizeText(prediction.description);
      if (!deduped.has(key)) {
        deduped.set(key, prediction);
      }
    }

    return Array.from(deduped.values()).slice(0, 5);
  }

  async localGeocodeAddress(address: string) {
    const propertyPredictions = await this.getPropertyFallbackPredictions(address);
    const bestProperty = propertyPredictions[0];

    if (bestProperty) {
      return {
        formatted_address: bestProperty.description,
        geometry: bestProperty.geometry || { location: { lat: 29.0892, lng: -110.9613 } },
        address_components: makeAddressComponents(bestProperty.address_components),
      };
    }

    const catalogPredictions = this.getCatalogCandidates(address);
    const bestCatalog = catalogPredictions[0];
    if (bestCatalog) {
      return {
        formatted_address: bestCatalog.description,
        geometry: bestCatalog.geometry || { location: { lat: 29.0892, lng: -110.9613 } },
        address_components: makeAddressComponents(bestCatalog.address_components),
      };
    }

    throw new Error('Google Geocoding returned no Mexico results for the requested address.');
  }

  sanitizeUrlForLogs(url: string) {
    try {
      const parsed = new URL(url);
      if (parsed.searchParams.has('key')) {
        parsed.searchParams.set('key', 'REDACTED');
      }
      return parsed.toString();
    } catch {
      return url.replace(/([?&]key=)[^&]+/i, '$1REDACTED');
    }
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
      if (!this.canUseGoogleMapsProvider() && this.isLocalFallbackEnabled()) {
        const result = await this.localGeocodeAddress(address);
        await this.logRequest({ provider: 'local_fallback', serviceType: 'geocoding', userId: opts?.userId, requestDetails: { address }, responseStatus: 'ok', responseTimeMs: Date.now() - start });
        return result;
      }

      const limitCheck = await this.checkLimit('geocoding');
      if (!limitCheck.allowed) {
        await this.logRequest({ provider: 'google_maps', serviceType: 'geocoding', userId: opts?.userId, requestDetails: { address }, responseStatus: 'rate_limited', responseTimeMs: 0, errorMessage: 'limit_reached' });
        throw new Error('Geocoding service disabled due to usage limits');
      }

      const cacheKey = `geocode:${address}`;
      const cached = this.getFromCache(cacheKey);
      if (cached) return cached;
      const key = this.apiKey || process.env.MAPS_API_KEY;
      if (!isConfiguredMapsKey(key) || !this.canUseGoogleMapsProvider()) {
        throw new Error('Google Maps provider unavailable. Set MAPS_API_KEY and ENABLE_BILLABLE_MAPS=true.');
      }

      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&components=country:MX&region=mx&language=es&key=${key}`;
      const res = await fetch(url);
      const data = (await res.json()) as any;
      const took = Date.now() - start;
      const status = data.status || (res.ok ? 'OK' : 'ERROR');
      await this.logRequest({ provider: 'google_maps', serviceType: 'geocoding', userId: opts?.userId, requestDetails: { address, url: this.sanitizeUrlForLogs(url) }, responseStatus: status.toLowerCase(), responseTimeMs: took });

      if (status === 'OK' && Array.isArray(data.results) && data.results.length > 0) {
        const mxResult = data.results.find((r: any) =>
          Array.isArray(r?.address_components) &&
          r.address_components.some((c: any) =>
            c?.types?.includes('country') &&
            (String(c?.short_name || '').toUpperCase() === 'MX' ||
              String(c?.long_name || '').toLowerCase().includes('méxico') ||
              String(c?.long_name || '').toLowerCase().includes('mexico'))
          )
        );
        if (mxResult) {
          await this.incrementUsage('geocoding', 1);
          const out = mxResult;
          this.setCache(cacheKey, out, 1000 * 60 * 60 * 24 * 30); // 30 days
          return out;
        }
        throw new Error('Google Geocoding returned no Mexico results for the requested address.');
      }

      throw new Error(data.error_message || data.status || 'Google Geocoding failed');
    } catch (err: any) {
      if (this.isLocalFallbackEnabled()) {
        const recoverableMessage = String(err?.message || '');
        if (recoverableMessage.includes('API key is invalid') || recoverableMessage.includes('provider unavailable')) {
          const result = await this.localGeocodeAddress(address);
          await this.logRequest({ provider: 'local_fallback', serviceType: 'geocoding', userId: opts?.userId, requestDetails: { address }, responseStatus: 'ok', responseTimeMs: Date.now() - start });
          return result;
        }
      }

      const took = Date.now() - start;
      console.error('Geocode error:', err);
      await this.logRequest({ provider: 'google_maps', serviceType: 'geocoding', userId: opts?.userId, requestDetails: { address }, responseStatus: 'error', responseTimeMs: took, errorMessage: err.message });
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

  // Autocomplete wrapper: Google Places Autocomplete only
  async autocomplete(input: string, opts?: { userId?: string; sessionToken?: string }) {
    if (!input || input.length < 3) return [];
    const cacheKey = `autocomplete:${input}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const start = Date.now();
    try {
      if (!this.canUseGoogleMapsProvider() && this.isLocalFallbackEnabled()) {
        const predictions = await this.localAutocomplete(input);
        await this.logRequest({ provider: 'local_fallback', serviceType: 'places_autocomplete', userId: opts?.userId, requestDetails: { input }, responseStatus: 'ok', responseTimeMs: Date.now() - start });
        this.setCache(cacheKey, predictions, 1000 * 60 * 15);
        return predictions;
      }

      const key = this.apiKey || process.env.MAPS_API_KEY;
      if (!isConfiguredMapsKey(key) || !this.canUseGoogleMapsProvider()) {
        throw new Error('Google Maps provider unavailable. Set MAPS_API_KEY and ENABLE_BILLABLE_MAPS=true.');
      }

      const sessionParam = opts?.sessionToken ? `&sessiontoken=${encodeURIComponent(opts.sessionToken)}` : '';
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&types=address&components=country:mx&language=es&region=mx${sessionParam}&key=${key}`;
      const res = await fetch(url);
      const data = (await res.json()) as any;
      const took = Date.now() - start;
      await this.logRequest({ provider: 'google_maps', serviceType: 'places_autocomplete', userId: opts?.userId, requestDetails: { input, url: this.sanitizeUrlForLogs(url) }, responseStatus: (data.status || (res.ok ? 'OK' : 'ERROR')).toLowerCase(), responseTimeMs: took });

      if (Array.isArray(data.predictions) && data.predictions.length > 0) {
        await this.incrementUsage('places_autocomplete', 1);
        const rankedPredictions = rankMexicoPredictions(data.predictions).slice(0, 5);
        this.setCache(cacheKey, rankedPredictions, 1000 * 60 * 60 * 24 * 7); // 7 days
        return rankedPredictions;
      }

      throw new Error(data.error_message || data.status || 'Google Places Autocomplete failed');
    } catch (err: any) {
      if (this.isLocalFallbackEnabled()) {
        const recoverableMessage = String(err?.message || '');
        if (
          recoverableMessage.includes('API key is invalid') ||
          recoverableMessage.includes('provider unavailable') ||
          recoverableMessage.includes('ZERO_RESULTS')
        ) {
          const predictions = await this.localAutocomplete(input);
          await this.logRequest({ provider: 'local_fallback', serviceType: 'places_autocomplete', userId: opts?.userId, requestDetails: { input }, responseStatus: 'ok', responseTimeMs: Date.now() - start });
          this.setCache(cacheKey, predictions, 1000 * 60 * 15);
          return predictions;
        }
      }

      const took = Date.now() - start;
      await this.logRequest({ provider: 'google_maps', serviceType: 'places_autocomplete', userId: opts?.userId, requestDetails: { input }, responseStatus: 'error', responseTimeMs: took, errorMessage: err.message });
      throw err;
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

export const mapsService = new MapsService(process.env.MAPS_API_KEY);

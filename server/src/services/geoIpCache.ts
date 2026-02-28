import { prisma } from '../db/client';
import { GeoIpData, lookupGeoIp } from '../utils/geoIp';
import { normalizeIp } from '../utils/normalizeIp';

const GEO_IP_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const GEO_IP_RETRY_BASE_MS = 5 * 60 * 1000; // 5m
const GEO_IP_RETRY_MAX_MS = 60 * 60 * 1000; // 1h

const inFlightByIp = new Map<string, Promise<GeoIpData | undefined>>();

type GeoIpCacheRow = {
  ip: string;
  country?: string | null;
  state?: string | null;
  city?: string | null;
  lat?: number | null;
  lng?: number | null;
  source?: string | null;
  lastLookupAt?: Date | null;
  expiresAt?: Date | null;
  failedCount?: number | null;
  lastError?: string | null;
  nextRetryAt?: Date | null;
};

const getGeoIpCacheClient = () => (prisma as any).geoIpCache;

const toGeo = (row: GeoIpCacheRow | null | undefined): GeoIpData | undefined => {
  if (!row) return undefined;
  const hasAnyField =
    !!row.country || !!row.state || !!row.city || typeof row.lat === 'number' || typeof row.lng === 'number';
  if (!hasAnyField) return undefined;
  return {
    source: row.source === 'ipwhois' ? 'ipwhois' : 'ipwhois',
    ...(row.country ? { country: row.country } : {}),
    ...(row.state ? { state: row.state } : {}),
    ...(row.city ? { city: row.city } : {}),
    ...(typeof row.lat === 'number' ? { lat: row.lat } : {}),
    ...(typeof row.lng === 'number' ? { lng: row.lng } : {}),
  };
};

const isFresh = (row: GeoIpCacheRow, now: Date): boolean => {
  if (!row.expiresAt) return false;
  if (row.expiresAt.getTime() <= now.getTime()) return false;
  return !!toGeo(row);
};

const retryBlocked = (row: GeoIpCacheRow, now: Date): boolean =>
  !!row.nextRetryAt && row.nextRetryAt.getTime() > now.getTime();

const computeRetryMs = (failedCount: number): number => {
  const exponent = Math.max(0, Math.min(6, failedCount - 1));
  return Math.min(GEO_IP_RETRY_BASE_MS * Math.pow(2, exponent), GEO_IP_RETRY_MAX_MS);
};

const readCache = async (ip: string): Promise<GeoIpCacheRow | null> => {
  const client = getGeoIpCacheClient();
  if (!client) return null;
  try {
    return (await client.findUnique({
      where: { ip },
    })) as GeoIpCacheRow | null;
  } catch (err: any) {
    console.error('GeoIpCache read failed', err?.message || String(err));
    return null;
  }
};

const saveSuccess = async (ip: string, geo: GeoIpData, now: Date) => {
  const client = getGeoIpCacheClient();
  if (!client) return;
  try {
    await client.upsert({
      where: { ip },
      create: {
        ip,
        country: geo.country || null,
        state: geo.state || null,
        city: geo.city || null,
        lat: typeof geo.lat === 'number' ? geo.lat : null,
        lng: typeof geo.lng === 'number' ? geo.lng : null,
        source: geo.source || 'ipwhois',
        lastLookupAt: now,
        expiresAt: new Date(now.getTime() + GEO_IP_CACHE_TTL_MS),
        failedCount: 0,
        lastError: null,
        nextRetryAt: null,
      },
      update: {
        country: geo.country || null,
        state: geo.state || null,
        city: geo.city || null,
        lat: typeof geo.lat === 'number' ? geo.lat : null,
        lng: typeof geo.lng === 'number' ? geo.lng : null,
        source: geo.source || 'ipwhois',
        lastLookupAt: now,
        expiresAt: new Date(now.getTime() + GEO_IP_CACHE_TTL_MS),
        failedCount: 0,
        lastError: null,
        nextRetryAt: null,
      },
    });
  } catch (err: any) {
    console.error('GeoIpCache save success failed', err?.message || String(err));
  }
};

const saveFailure = async (
  ip: string,
  now: Date,
  existing: GeoIpCacheRow | null,
  errorMessage: string,
) => {
  const client = getGeoIpCacheClient();
  if (!client) return;

  const failedCount = Math.max(1, Number(existing?.failedCount || 0) + 1);
  const nextRetryAt = new Date(now.getTime() + computeRetryMs(failedCount));

  try {
    await client.upsert({
      where: { ip },
      create: {
        ip,
        failedCount,
        lastError: errorMessage,
        nextRetryAt,
        lastLookupAt: now,
        expiresAt: existing?.expiresAt || null,
        country: existing?.country || null,
        state: existing?.state || null,
        city: existing?.city || null,
        lat: typeof existing?.lat === 'number' ? existing.lat : null,
        lng: typeof existing?.lng === 'number' ? existing.lng : null,
        source: existing?.source || null,
      },
      update: {
        failedCount,
        lastError: errorMessage,
        nextRetryAt,
        lastLookupAt: now,
      },
    });
  } catch (err: any) {
    console.error('GeoIpCache save failure failed', err?.message || String(err));
  }
};

export const resolveGeoIpWithPersistentCache = async (
  ipInput: unknown,
): Promise<GeoIpData | undefined> => {
  const ip = normalizeIp(ipInput);
  if (!ip) return undefined;

  const now = new Date();
  const cached = await readCache(ip);
  const cachedGeo = toGeo(cached);

  if (cached && isFresh(cached, now)) {
    return cachedGeo;
  }

  if (cached && retryBlocked(cached, now)) {
    return cachedGeo;
  }

  const inFlight = inFlightByIp.get(ip);
  if (inFlight) {
    const sharedGeo = await inFlight;
    return sharedGeo || cachedGeo;
  }

  const lookupPromise = (async () => {
    try {
      const geo = await lookupGeoIp(ip);
      if (!geo) {
        await saveFailure(ip, now, cached, 'geo_lookup_empty');
        return undefined;
      }

      await saveSuccess(ip, geo, now);
      return geo;
    } catch (err: any) {
      await saveFailure(ip, now, cached, err?.message || 'geo_lookup_failed');
      return undefined;
    } finally {
      inFlightByIp.delete(ip);
    }
  })();

  inFlightByIp.set(ip, lookupPromise);
  const resolvedGeo = await lookupPromise;
  return resolvedGeo || cachedGeo;
};

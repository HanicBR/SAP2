import { createHash } from 'crypto';

export interface GeoIpData {
  country?: string;
  state?: string;
  city?: string;
  lat?: number;
  lng?: number;
  source: 'ipwhois' | 'ipapiis';
}

const GEO_TTL_MS = 6 * 60 * 60 * 1000;
const GEO_FAILURE_TTL_MS = 5 * 60 * 1000;
const GEO_LOOKUP_TIMEOUT_MS = 3200;
const geoCache = new Map<string, { expiresAt: number; value: GeoIpData | undefined }>();

const isValidIpv4 = (ip: string): boolean => {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    if (!/^\d+$/.test(p)) return false;
    const n = Number(p);
    return Number.isFinite(n) && n >= 0 && n <= 255;
  });
};

const isPrivateIpv4 = (ip: string): boolean => {
  const parts = ip.split('.');
  const a = Number(parts[0] || NaN);
  const b = Number(parts[1] || NaN);
  if ([a, b].some((n) => Number.isNaN(n))) return true;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
};

export const normalizeIPv4 = (raw?: string | null): string | undefined => {
  if (!raw) return undefined;
  const trimmed = String(raw).trim();
  if (!trimmed) return undefined;

  // Accept "ip:port" and keep only ip
  const ip = trimmed.split(':')[0];
  if (!ip || !isValidIpv4(ip)) return undefined;
  return ip;
};

export const hashIp = (ip: string): string => {
  const salt = process.env.IP_HASH_SALT || '';
  return createHash('sha256').update(`${salt}|${ip}`).digest('hex');
};

const parseFiniteNumber = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const fetchJson = async (
  url: string,
  timeoutMs = GEO_LOOKUP_TIMEOUT_MS,
): Promise<any | undefined> => {
  let timer: NodeJS.Timeout | undefined;
  const controller = new AbortController();
  try {
    timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });
    if (!response.ok) return undefined;
    return await response.json();
  } catch {
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const lookupViaIpWhoIs = async (ip: string): Promise<GeoIpData | undefined> => {
  const payload = await fetchJson(`https://ipwho.is/${encodeURIComponent(ip)}`);
  if (!payload || payload.success === false) return undefined;
  const lat = parseFiniteNumber(payload.latitude ?? payload.lat);
  const lng = parseFiniteNumber(payload.longitude ?? payload.lng);
  const value: GeoIpData = {
    source: 'ipwhois',
    ...(payload.country ? { country: payload.country } : {}),
    ...(payload.region || payload.region_name ? { state: payload.region || payload.region_name } : {}),
    ...(payload.city ? { city: payload.city } : {}),
    ...(typeof lat === 'number' ? { lat } : {}),
    ...(typeof lng === 'number' ? { lng } : {}),
  };
  if (!value.country && !value.state && !value.city && value.lat === undefined && value.lng === undefined) {
    return undefined;
  }
  return value;
};

const lookupViaIpApiIs = async (ip: string): Promise<GeoIpData | undefined> => {
  const payload = await fetchJson(`https://api.ipapi.is?q=${encodeURIComponent(ip)}`);
  if (!payload || payload.error) return undefined;
  const location = payload.location && typeof payload.location === 'object' ? payload.location : {};
  const lat = parseFiniteNumber(location.latitude ?? payload.latitude ?? payload.lat);
  const lng = parseFiniteNumber(location.longitude ?? payload.longitude ?? payload.lng);
  const value: GeoIpData = {
    source: 'ipapiis',
    ...(location.country || payload.country ? { country: location.country || payload.country } : {}),
    ...(location.state || payload.region ? { state: location.state || payload.region } : {}),
    ...(location.city || payload.city ? { city: location.city || payload.city } : {}),
    ...(typeof lat === 'number' ? { lat } : {}),
    ...(typeof lng === 'number' ? { lng } : {}),
  };
  if (!value.country && !value.state && !value.city && value.lat === undefined && value.lng === undefined) {
    return undefined;
  }
  return value;
};

export const lookupGeoIp = async (ip: string): Promise<GeoIpData | undefined> => {
  const normalized = normalizeIPv4(ip);
  if (!normalized || isPrivateIpv4(normalized)) {
    return undefined;
  }

  const now = Date.now();
  const cached = geoCache.get(normalized);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  try {
    const primary = await lookupViaIpWhoIs(normalized);
    if (primary) {
      geoCache.set(normalized, { expiresAt: now + GEO_TTL_MS, value: primary });
      return primary;
    }

    const fallback = await lookupViaIpApiIs(normalized);
    if (fallback) {
      geoCache.set(normalized, { expiresAt: now + GEO_TTL_MS, value: fallback });
      return fallback;
    }

    geoCache.set(normalized, { expiresAt: now + GEO_FAILURE_TTL_MS, value: undefined });
    return undefined;
  } catch {
    geoCache.set(normalized, { expiresAt: now + GEO_FAILURE_TTL_MS, value: undefined });
    return undefined;
  }
};

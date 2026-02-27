import { createHash } from 'crypto';

export interface GeoIpData {
  country?: string;
  state?: string;
  city?: string;
  lat?: number;
  lng?: number;
  source: 'ipwhois';
}

const GEO_TTL_MS = 6 * 60 * 60 * 1000;
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

  let timer: NodeJS.Timeout | undefined;
  const controller = new AbortController();
  try {
    timer = setTimeout(() => controller.abort(), 1500);
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(normalized)}`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      geoCache.set(normalized, { expiresAt: now + GEO_TTL_MS, value: undefined });
      return undefined;
    }

    const payload: any = await response.json();
    if (!payload || payload.success === false) {
      geoCache.set(normalized, { expiresAt: now + GEO_TTL_MS, value: undefined });
      return undefined;
    }

    const value: GeoIpData = {
      source: 'ipwhois',
      country: payload.country || undefined,
      state: payload.region || payload.region_name || undefined,
      city: payload.city || undefined,
      lat: typeof payload.latitude === 'number' ? payload.latitude : undefined,
      lng: typeof payload.longitude === 'number' ? payload.longitude : undefined,
    };

    geoCache.set(normalized, { expiresAt: now + GEO_TTL_MS, value });
    return value;
  } catch {
    geoCache.set(normalized, { expiresAt: now + 60 * 1000, value: undefined });
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

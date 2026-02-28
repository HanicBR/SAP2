import { createHash } from 'crypto';

export type GeoIpSource = 'ipwhois' | 'ipapiis' | 'ipinfo' | 'consensus';

export interface GeoIpData {
  country?: string;
  state?: string;
  city?: string;
  lat?: number;
  lng?: number;
  source: GeoIpSource;
}

const GEO_TTL_MS = 6 * 60 * 60 * 1000;
const GEO_FAILURE_TTL_MS = 5 * 60 * 1000;
const GEO_LOOKUP_TIMEOUT_MS = 3200;
const GEO_CONSENSUS_RADIUS_KM = 35;
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

const sanitizeText = (value: unknown): string | undefined => {
  const parsed = String(value || '').trim();
  return parsed || undefined;
};

const hasCoordinates = (geo: GeoIpData): boolean =>
  typeof geo.lat === 'number' &&
  Number.isFinite(geo.lat) &&
  typeof geo.lng === 'number' &&
  Number.isFinite(geo.lng);

const buildGeoCandidate = (
  source: GeoIpSource,
  input: {
    country?: unknown;
    state?: unknown;
    city?: unknown;
    lat?: unknown;
    lng?: unknown;
  },
): GeoIpData | undefined => {
  const country = sanitizeText(input.country);
  const state = sanitizeText(input.state);
  const city = sanitizeText(input.city);
  const lat = parseFiniteNumber(input.lat);
  const lng = parseFiniteNumber(input.lng);

  const candidate: GeoIpData = {
    source,
    ...(country ? { country } : {}),
    ...(state ? { state } : {}),
    ...(city ? { city } : {}),
    ...(typeof lat === 'number' ? { lat } : {}),
    ...(typeof lng === 'number' ? { lng } : {}),
  };

  if (!candidate.country && !candidate.state && !candidate.city && !hasCoordinates(candidate)) {
    return undefined;
  }
  return candidate;
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
  return buildGeoCandidate('ipwhois', {
    country: payload.country,
    state: payload.region || payload.region_name,
    city: payload.city,
    lat: payload.latitude ?? payload.lat,
    lng: payload.longitude ?? payload.lng,
  });
};

const lookupViaIpApiIs = async (ip: string): Promise<GeoIpData | undefined> => {
  const payload = await fetchJson(`https://api.ipapi.is?q=${encodeURIComponent(ip)}`);
  if (!payload || payload.error) return undefined;
  const location = payload.location && typeof payload.location === 'object' ? payload.location : {};
  return buildGeoCandidate('ipapiis', {
    country: location.country || payload.country,
    state: location.state || payload.region,
    city: location.city || payload.city,
    lat: location.latitude ?? payload.latitude ?? payload.lat,
    lng: location.longitude ?? payload.longitude ?? payload.lng,
  });
};

const lookupViaIpInfo = async (ip: string): Promise<GeoIpData | undefined> => {
  const token = String(process.env.IPINFO_TOKEN || '').trim();
  if (!token) return undefined;

  const payload = await fetchJson(
    `https://ipinfo.io/${encodeURIComponent(ip)}/json?token=${encodeURIComponent(token)}`,
  );
  if (!payload || payload.bogon || payload.error) return undefined;

  const locRaw = String(payload.loc || '').trim();
  const [locLatRaw, locLngRaw] = locRaw.includes(',') ? locRaw.split(',', 2) : [undefined, undefined];
  return buildGeoCandidate('ipinfo', {
    country: payload.country,
    state: payload.region,
    city: payload.city,
    lat: locLatRaw,
    lng: locLngRaw,
  });
};

const haversineDistanceKm = (a: GeoIpData, b: GeoIpData): number => {
  if (!hasCoordinates(a) || !hasCoordinates(b)) return Number.POSITIVE_INFINITY;

  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const lat1 = toRad(a.lat as number);
  const lat2 = toRad(b.lat as number);
  const dLat = lat2 - lat1;
  const dLng = toRad((b.lng as number) - (a.lng as number));

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return 6371 * c;
};

const average = (values: number[]): number | undefined => {
  if (!values.length) return undefined;
  const sum = values.reduce((acc, current) => acc + current, 0);
  return sum / values.length;
};

const pickMostFrequent = (values: Array<string | undefined>): string | undefined => {
  const counter = new Map<string, number>();
  values
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    .forEach((value) => {
      counter.set(value, (counter.get(value) || 0) + 1);
    });

  if (!counter.size) return undefined;
  const ordered = Array.from(counter.entries()).sort((a, b) => b[1] - a[1]);
  return ordered[0]?.[0];
};

const pickConsensusCandidate = (candidates: GeoIpData[]): GeoIpData | undefined => {
  const withCoords = candidates.filter(hasCoordinates);
  if (withCoords.length < 2) return undefined;

  let bestPair: [GeoIpData, GeoIpData] | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let i = 0; i < withCoords.length; i += 1) {
    for (let j = i + 1; j < withCoords.length; j += 1) {
      const a = withCoords[i];
      const b = withCoords[j];
      if (!a || !b) continue;

      const distance = haversineDistanceKm(a, b);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestPair = [a, b];
      }
    }
  }

  if (!bestPair || !Number.isFinite(bestDistance) || bestDistance > GEO_CONSENSUS_RADIUS_KM) {
    return undefined;
  }

  const [seedA, seedB] = bestPair;
  const cluster = withCoords.filter((candidate) => {
    const distanceToA = haversineDistanceKm(seedA, candidate);
    const distanceToB = haversineDistanceKm(seedB, candidate);
    return distanceToA <= GEO_CONSENSUS_RADIUS_KM || distanceToB <= GEO_CONSENSUS_RADIUS_KM;
  });

  if (cluster.length < 2) return undefined;

  const avgLat = average(cluster.map((item) => item.lat as number));
  const avgLng = average(cluster.map((item) => item.lng as number));
  if (typeof avgLat !== 'number' || typeof avgLng !== 'number') return undefined;

  return buildGeoCandidate('consensus', {
    country: pickMostFrequent(cluster.map((item) => item.country)),
    state: pickMostFrequent(cluster.map((item) => item.state)),
    city: pickMostFrequent(cluster.map((item) => item.city)),
    lat: avgLat,
    lng: avgLng,
  });
};

const scoreCandidate = (candidate: GeoIpData): number => {
  const providerWeight = (() => {
    if (candidate.source === 'consensus') return 6;
    if (candidate.source === 'ipapiis') return 5;
    if (candidate.source === 'ipinfo') return 4;
    return 3;
  })();

  const detailWeight =
    (hasCoordinates(candidate) ? 4 : 0) +
    (candidate.city ? 3 : 0) +
    (candidate.state ? 2 : 0) +
    (candidate.country ? 1 : 0);

  return providerWeight + detailWeight;
};

const pickBestCandidate = (candidates: GeoIpData[]): GeoIpData | undefined => {
  if (!candidates.length) return undefined;
  const sorted = [...candidates].sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
  return sorted[0];
};

const lookupGeoCandidates = async (ip: string): Promise<GeoIpData[]> => {
  const [ipWhoIs, ipApiIs, ipInfo] = await Promise.all([
    lookupViaIpWhoIs(ip),
    lookupViaIpApiIs(ip),
    lookupViaIpInfo(ip),
  ]);

  return [ipWhoIs, ipApiIs, ipInfo].filter((item): item is GeoIpData => Boolean(item));
};

const resolveBestGeoCandidate = async (ip: string): Promise<GeoIpData | undefined> => {
  const candidates = await lookupGeoCandidates(ip);
  if (!candidates.length) return undefined;

  const consensus = pickConsensusCandidate(candidates);
  if (consensus) return consensus;

  return pickBestCandidate(candidates);
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
    const bestCandidate = await resolveBestGeoCandidate(normalized);
    if (bestCandidate) {
      geoCache.set(normalized, { expiresAt: now + GEO_TTL_MS, value: bestCandidate });
      return bestCandidate;
    }

    geoCache.set(normalized, { expiresAt: now + GEO_FAILURE_TTL_MS, value: undefined });
    return undefined;
  } catch {
    geoCache.set(normalized, { expiresAt: now + GEO_FAILURE_TTL_MS, value: undefined });
    return undefined;
  }
};

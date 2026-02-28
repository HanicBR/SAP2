import { prisma } from '../db/client';
import { normalizeIp } from '../utils/normalizeIp';

type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';
type ReasonCode = 'SAME_IP' | 'SAME_SUBNET' | 'SAME_LOCATION';

type PlayerSummary = {
  steamId: string;
  name: string;
  avatarUrl?: string;
  lastSeen: string;
  firstSeen: string;
  totalConnections: number;
  playTimeHours: number;
  isVip: boolean;
  vipPlan?: string;
  vipExpiry?: string;
  ip?: string;
  geo?: Record<string, unknown>;
};

type LocationParts = {
  country: string | undefined;
  state: string | undefined;
  city: string | undefined;
};

export type PlayerIpHistoryItemV2 = {
  ip: string;
  firstSeen: string;
  lastSeen: string;
  connections: number;
  lastServerId?: string;
  geo?: Record<string, unknown>;
  location: string;
};

export type PlayerIpHistoryResponseV2 = {
  steamId: string;
  total: number;
  items: PlayerIpHistoryItemV2[];
};

export type RelatedAccountReasonV2 = {
  code: ReasonCode;
  confidence: Confidence;
  label: string;
  evidence: string[];
};

export type RelatedAccountItemV2 = {
  player: PlayerSummary;
  confidence: Confidence;
  reasons: RelatedAccountReasonV2[];
};

export type RelatedAccountsResponseV2 = {
  steamId: string;
  analyzedAt: string;
  total: number;
  items: RelatedAccountItemV2[];
};

export type SuspiciousGroupV2 = {
  id: string;
  level: 'HIGH' | 'MODERATE';
  confidence: Confidence;
  reasonCode: ReasonCode;
  reasonLabel: string;
  commonIpOrSubnet: string;
  location: string;
  lastActivity: string;
  players: PlayerSummary[];
};

const parseBoolEnv = (value: string | undefined, fallback: boolean): boolean => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!normalized) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
};

const DUPLICATE_ANALYSIS_V2_ENABLED = parseBoolEnv(
  process.env.DUPLICATE_ANALYSIS_V2_ENABLED,
  true,
);

const getPlayerIpHistoryClient = () => (prisma as any).playerIpHistory;

const isValidIpv4 = (ip?: string | null): ip is string => {
  if (!ip) return false;
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    const n = Number(part);
    return !Number.isNaN(n) && n >= 0 && n <= 255;
  });
};

const toSubnet24Prefix = (ip: string): string => {
  const parts = ip.split('.');
  return `${parts[0]}.${parts[1]}.${parts[2]}.`;
};

const toSubnet24Cidr = (ip: string): string => `${toSubnet24Prefix(ip)}0/24`;

const normalizeLocationPart = (value: unknown): string | undefined => {
  const parsed = String(value || '').trim();
  return parsed || undefined;
};

const parseGeoRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
};

const toLocationParts = (geoRaw: unknown): LocationParts => {
  const geo = parseGeoRecord(geoRaw);
  if (!geo) {
    return {
      country: undefined,
      state: undefined,
      city: undefined,
    };
  }

  const country = normalizeLocationPart(geo.country);
  const state = normalizeLocationPart(geo.state);
  const city = normalizeLocationPart(geo.city);
  return {
    country,
    state,
    city,
  };
};

const locationPartsToLabel = (parts: LocationParts): string => {
  const city = parts.city || '';
  const state = parts.state || '';
  const country = parts.country || '';
  const label = [city, state, country].filter(Boolean).join(', ');
  return label || 'Localizacao desconhecida';
};

const toLocationKey = (parts: LocationParts): string | null => {
  const country = String(parts.country || '')
    .trim()
    .toLowerCase();
  if (!country) return null;
  const state = String(parts.state || '')
    .trim()
    .toLowerCase();
  const city = String(parts.city || '')
    .trim()
    .toLowerCase();
  return `${country}|${state}|${city}`;
};

const confidenceWeight: Record<Confidence, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

const reasonWeight: Record<ReasonCode, number> = {
  SAME_IP: 3,
  SAME_SUBNET: 2,
  SAME_LOCATION: 1,
};

const reasonConfidence: Record<ReasonCode, Confidence> = {
  SAME_IP: 'HIGH',
  SAME_SUBNET: 'MEDIUM',
  SAME_LOCATION: 'LOW',
};

const reasonLabel: Record<ReasonCode, string> = {
  SAME_IP: 'Mesmo IP exato',
  SAME_SUBNET: 'Mesma sub-rede /24',
  SAME_LOCATION: 'Mesma localizacao aproximada',
};

const mapPlayerProfile = (player: any): PlayerSummary => {
  const mapped: PlayerSummary = {
    steamId: player.steamId,
    name: player.name,
    lastSeen:
      player.lastSeen instanceof Date
        ? player.lastSeen.toISOString()
        : new Date(player.lastSeen).toISOString(),
    firstSeen:
      player.firstSeen instanceof Date
        ? player.firstSeen.toISOString()
        : new Date(player.firstSeen).toISOString(),
    totalConnections: Number(player.totalConnections || 0),
    playTimeHours: Number(player.playTimeHours || 0),
    isVip: Boolean(player.isVip),
  };

  if (player.avatarUrl) mapped.avatarUrl = String(player.avatarUrl);
  if (player.vipPlan) mapped.vipPlan = String(player.vipPlan);
  if (player.vipExpiry) mapped.vipExpiry = new Date(player.vipExpiry).toISOString();
  if (player.ip) mapped.ip = String(player.ip);
  const geo = parseGeoRecord(player.geo);
  if (geo) mapped.geo = geo;

  return mapped;
};

const buildPlayerMap = async (steamIds: string[]): Promise<Map<string, PlayerSummary>> => {
  const ids = Array.from(new Set(steamIds.filter((id) => String(id || '').trim() !== '')));
  if (!ids.length) return new Map<string, PlayerSummary>();
  const players = await prisma.playerProfile.findMany({
    where: {
      steamId: {
        in: ids,
      },
    },
  });
  const map = new Map<string, PlayerSummary>();
  players.forEach((player) => {
    map.set(player.steamId, mapPlayerProfile(player));
  });
  return map;
};

const listPlayerHistoryRows = async (steamId: string, limit: number) => {
  const client = getPlayerIpHistoryClient();
  if (!client) return [] as any[];
  return client.findMany({
    where: { steamId },
    orderBy: [{ lastSeen: 'desc' }, { ip: 'asc' }],
    take: Math.max(1, Math.min(500, Math.floor(limit || 100))),
    select: {
      steamId: true,
      ip: true,
      firstSeen: true,
      lastSeen: true,
      connections: true,
      lastServerId: true,
      geoSnapshot: true,
    },
  });
};

const listHistoryRowsByIps = async (steamId: string, ips: string[]) => {
  const client = getPlayerIpHistoryClient();
  if (!client || !ips.length) return [] as any[];
  return client.findMany({
    where: {
      steamId: { not: steamId },
      ip: {
        in: ips,
      },
    },
    select: {
      steamId: true,
      ip: true,
      firstSeen: true,
      lastSeen: true,
      connections: true,
      lastServerId: true,
      geoSnapshot: true,
    },
    orderBy: [{ lastSeen: 'desc' }],
  });
};

const listHistoryRowsBySubnets = async (steamId: string, prefixes: string[]) => {
  const client = getPlayerIpHistoryClient();
  if (!client || !prefixes.length) return [] as any[];
  return client.findMany({
    where: {
      steamId: { not: steamId },
      OR: prefixes.map((prefix) => ({
        ip: {
          startsWith: prefix,
        },
      })),
    },
    select: {
      steamId: true,
      ip: true,
      firstSeen: true,
      lastSeen: true,
      connections: true,
      lastServerId: true,
      geoSnapshot: true,
    },
    orderBy: [{ lastSeen: 'desc' }],
  });
};

const listHistoryRowsByLocations = async (
  steamId: string,
  locationTargets: Array<{ country: string; state?: string; city?: string }>,
) => {
  const client = getPlayerIpHistoryClient();
  if (!client || !locationTargets.length) return [] as any[];

  const OR = locationTargets
    .map((location) => {
      const andParts: any[] = [
        {
          geoSnapshot: {
            path: ['country'],
            equals: location.country,
          } as any,
        },
      ];
      if (location.state) {
        andParts.push({
          geoSnapshot: {
            path: ['state'],
            equals: location.state,
          } as any,
        });
      }
      if (location.city) {
        andParts.push({
          geoSnapshot: {
            path: ['city'],
            equals: location.city,
          } as any,
        });
      }
      return {
        AND: andParts,
      };
    })
    .filter((clause) => Array.isArray((clause as any).AND) && (clause as any).AND.length > 0);

  if (!OR.length) return [] as any[];

  return client.findMany({
    where: {
      steamId: { not: steamId },
      OR,
    },
    select: {
      steamId: true,
      ip: true,
      firstSeen: true,
      lastSeen: true,
      connections: true,
      lastServerId: true,
      geoSnapshot: true,
    },
    orderBy: [{ lastSeen: 'desc' }],
    take: 5000,
  });
};

export const isDuplicateAnalysisV2Enabled = () => DUPLICATE_ANALYSIS_V2_ENABLED;

export const getPlayerIpHistoryV2 = async (
  steamId: string,
  limit: number,
): Promise<PlayerIpHistoryResponseV2> => {
  const rows = await listPlayerHistoryRows(steamId, limit);
  const items: PlayerIpHistoryItemV2[] = rows.map((row: any) => {
    const geo = parseGeoRecord(row.geoSnapshot);
    const parts = toLocationParts(geo);
    return {
      ip: row.ip,
      firstSeen: new Date(row.firstSeen).toISOString(),
      lastSeen: new Date(row.lastSeen).toISOString(),
      connections: Number(row.connections || 0),
      lastServerId: row.lastServerId || undefined,
      geo: geo || undefined,
      location: locationPartsToLabel(parts),
    };
  });

  return {
    steamId,
    total: items.length,
    items,
  };
};

const ensureTargetPlayerExists = async (steamId: string) => {
  const player = await prisma.playerProfile.findUnique({
    where: { steamId },
  });
  return player;
};

const evaluateCandidateReasons = (
  targetIps: Set<string>,
  targetSubnets: Set<string>,
  targetLocationKeys: Set<string>,
  row: any,
) => {
  const reasons = new Map<ReasonCode, Set<string>>();

  const ip = normalizeIp(row.ip);
  if (ip && targetIps.has(ip)) {
    const current = reasons.get('SAME_IP') || new Set<string>();
    current.add(ip);
    reasons.set('SAME_IP', current);
  }

  if (ip) {
    const subnet = toSubnet24Cidr(ip);
    if (targetSubnets.has(subnet)) {
      const current = reasons.get('SAME_SUBNET') || new Set<string>();
      current.add(subnet);
      reasons.set('SAME_SUBNET', current);
    }
  }

  const locationParts = toLocationParts(row.geoSnapshot);
  const key = toLocationKey(locationParts);
  if (key && targetLocationKeys.has(key)) {
    const current = reasons.get('SAME_LOCATION') || new Set<string>();
    current.add(locationPartsToLabel(locationParts));
    reasons.set('SAME_LOCATION', current);
  }

  return reasons;
};

export const getRelatedAccountsV2 = async (
  steamId: string,
  limit: number,
): Promise<RelatedAccountsResponseV2 | null> => {
  const target = await ensureTargetPlayerExists(steamId);
  if (!target) return null;

  const targetRows = await listPlayerHistoryRows(steamId, 500);
  const targetIps = new Set<string>();
  const targetSubnets = new Set<string>();
  const targetLocationKeys = new Set<string>();
  const targetLocationTargets = new Map<string, { country: string; state?: string; city?: string }>();

  targetRows.forEach((row: any) => {
    const ip = normalizeIp(row.ip);
    if (ip) {
      targetIps.add(ip);
      targetSubnets.add(toSubnet24Cidr(ip));
    }
    const parts = toLocationParts(row.geoSnapshot);
    const key = toLocationKey(parts);
    if (key && parts.country) {
      targetLocationKeys.add(key);
      targetLocationTargets.set(key, {
        country: parts.country,
        ...(parts.state ? { state: parts.state } : {}),
        ...(parts.city ? { city: parts.city } : {}),
      });
    }
  });

  if (isValidIpv4(target.ip)) {
    targetIps.add(target.ip);
    targetSubnets.add(toSubnet24Cidr(target.ip));
  }
  const targetGeoParts = toLocationParts(target.geo);
  const targetGeoKey = toLocationKey(targetGeoParts);
  if (targetGeoKey && targetGeoParts.country) {
    targetLocationKeys.add(targetGeoKey);
    targetLocationTargets.set(targetGeoKey, {
      country: targetGeoParts.country,
      ...(targetGeoParts.state ? { state: targetGeoParts.state } : {}),
      ...(targetGeoParts.city ? { city: targetGeoParts.city } : {}),
    });
  }

  const [sameIpRows, sameSubnetRows, sameLocationRows] = await Promise.all([
    listHistoryRowsByIps(steamId, Array.from(targetIps)),
    listHistoryRowsBySubnets(
      steamId,
      Array.from(targetSubnets)
        .map((subnet) => subnet.replace(/0\/24$/, ''))
        .filter(Boolean),
    ),
    listHistoryRowsByLocations(steamId, Array.from(targetLocationTargets.values())),
  ]);

  const candidateRows = [...sameIpRows, ...sameSubnetRows, ...sameLocationRows];
  const candidateSteamIds = Array.from(
    new Set(candidateRows.map((row: any) => String(row.steamId || '').trim()).filter(Boolean)),
  );
  if (!candidateSteamIds.length) {
    return {
      steamId,
      analyzedAt: new Date().toISOString(),
      total: 0,
      items: [],
    };
  }

  const bySteam = new Map<
    string,
    {
      latestSeen: number;
      reasons: Map<ReasonCode, Set<string>>;
    }
  >();

  candidateRows.forEach((row: any) => {
    const candidateSteamId = String(row.steamId || '').trim();
    if (!candidateSteamId || candidateSteamId === steamId) return;

    const rowReasons = evaluateCandidateReasons(targetIps, targetSubnets, targetLocationKeys, row);
    if (!rowReasons.size) return;

    const current = bySteam.get(candidateSteamId) || {
      latestSeen: 0,
      reasons: new Map<ReasonCode, Set<string>>(),
    };

    const rowLastSeen = new Date(row.lastSeen).getTime();
    if (rowLastSeen > current.latestSeen) {
      current.latestSeen = rowLastSeen;
    }

    rowReasons.forEach((evidenceSet, code) => {
      const existing = current.reasons.get(code) || new Set<string>();
      evidenceSet.forEach((evidence) => existing.add(evidence));
      current.reasons.set(code, existing);
    });

    bySteam.set(candidateSteamId, current);
  });

  const playersBySteam = await buildPlayerMap(Array.from(bySteam.keys()));
  const mappedItems: Array<RelatedAccountItemV2 & { _score: number; _lastSeen: number }> = [];

  bySteam.forEach((entry, candidateSteamId) => {
    const profile = playersBySteam.get(candidateSteamId);
    if (!profile) return;

    const reasons = Array.from(entry.reasons.entries())
      .sort((a, b) => reasonWeight[b[0]] - reasonWeight[a[0]])
      .map(([code, evidenceSet]) => ({
        code,
        confidence: reasonConfidence[code],
        label: reasonLabel[code],
        evidence: Array.from(evidenceSet),
      }));

    if (!reasons.length) return;

    const confidence =
      reasons.find((reason) => reason.code === 'SAME_IP')?.confidence ||
      reasons.find((reason) => reason.code === 'SAME_SUBNET')?.confidence ||
      'LOW';

    mappedItems.push({
      player: profile,
      confidence,
      reasons,
      _score: confidenceWeight[confidence],
      _lastSeen: entry.latestSeen || new Date(profile.lastSeen).getTime(),
    });
  });

  mappedItems.sort((a, b) => {
    if (b._score !== a._score) return b._score - a._score;
    return b._lastSeen - a._lastSeen;
  });

  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit || 50)));
  const items = mappedItems.slice(0, safeLimit).map((item) => ({
    player: item.player,
    confidence: item.confidence,
    reasons: item.reasons,
  }));

  return {
    steamId,
    analyzedAt: new Date().toISOString(),
    total: items.length,
    items,
  };
};

const buildGroupLocation = (players: PlayerSummary[]) => {
  const withGeo = players.find((player) => player.geo && typeof player.geo === 'object');
  if (!withGeo) return 'Localizacao desconhecida';
  const parts = toLocationParts(withGeo.geo);
  return locationPartsToLabel(parts);
};

const buildSuspiciousGroupObject = (
  type: ReasonCode,
  key: string,
  players: PlayerSummary[],
): SuspiciousGroupV2 => {
  const sortedPlayers = [...players].sort(
    (a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime(),
  );
  const lastActivity = sortedPlayers[0]?.lastSeen || new Date().toISOString();

  if (type === 'SAME_IP') {
    return {
      id: `ip_${key}`,
      level: 'HIGH',
      confidence: 'HIGH',
      reasonCode: type,
      reasonLabel: reasonLabel[type],
      commonIpOrSubnet: key,
      location: buildGroupLocation(sortedPlayers),
      lastActivity,
      players: sortedPlayers,
    };
  }

  if (type === 'SAME_SUBNET') {
    return {
      id: `subnet_${key}`,
      level: 'MODERATE',
      confidence: 'MEDIUM',
      reasonCode: type,
      reasonLabel: reasonLabel[type],
      commonIpOrSubnet: key,
      location: buildGroupLocation(sortedPlayers),
      lastActivity,
      players: sortedPlayers,
    };
  }

  return {
    id: `location_${key}`,
    level: 'MODERATE',
    confidence: 'LOW',
    reasonCode: type,
    reasonLabel: reasonLabel[type],
    commonIpOrSubnet: key,
    location: key,
    lastActivity,
    players: sortedPlayers,
  };
};

export const listSuspiciousGroupsV2 = async (
  limit = 100,
  maxRows = 5000,
): Promise<SuspiciousGroupV2[]> => {
  const client = getPlayerIpHistoryClient();
  if (!client) return [];

  const safeMaxRows = Math.max(200, Math.min(20000, Math.floor(maxRows || 5000)));
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit || 100)));

  const rows = await client.findMany({
    orderBy: [{ lastSeen: 'desc' }],
    take: safeMaxRows,
    select: {
      steamId: true,
      ip: true,
      lastSeen: true,
      geoSnapshot: true,
    },
  });

  if (!rows.length) return [];

  const ipToSteam = new Map<string, Set<string>>();
  const subnetToSteam = new Map<string, Set<string>>();
  const locationToSteam = new Map<string, Set<string>>();

  rows.forEach((row: any) => {
    const steamId = String(row.steamId || '').trim();
    const ip = normalizeIp(row.ip);
    if (!steamId || !ip) return;

    const ipSet = ipToSteam.get(ip) || new Set<string>();
    ipSet.add(steamId);
    ipToSteam.set(ip, ipSet);

    const subnet = toSubnet24Cidr(ip);
    const subnetSet = subnetToSteam.get(subnet) || new Set<string>();
    subnetSet.add(steamId);
    subnetToSteam.set(subnet, subnetSet);

    const locationParts = toLocationParts(row.geoSnapshot);
    const locationKey = toLocationKey(locationParts);
    if (locationKey) {
      const label = locationPartsToLabel(locationParts);
      const locationSet = locationToSteam.get(label) || new Set<string>();
      locationSet.add(steamId);
      locationToSteam.set(label, locationSet);
    }
  });

  const allSteamIds = new Set<string>();
  [ipToSteam, subnetToSteam, locationToSteam].forEach((map) => {
    map.forEach((set) => set.forEach((steamId) => allSteamIds.add(steamId)));
  });
  const playersBySteam = await buildPlayerMap(Array.from(allSteamIds));

  const groups: SuspiciousGroupV2[] = [];
  const usedSteamIds = new Set<string>();

  const buildPlayers = (steamSet: Set<string>): PlayerSummary[] =>
    Array.from(steamSet)
      .map((steamId) => playersBySteam.get(steamId))
      .filter((player): player is PlayerSummary => Boolean(player));

  Array.from(ipToSteam.entries())
    .sort((a, b) => b[1].size - a[1].size)
    .forEach(([ip, steamSet]) => {
      if (groups.length >= safeLimit) return;
      if (steamSet.size < 2) return;
      const players = buildPlayers(steamSet);
      if (players.length < 2) return;
      players.forEach((player) => usedSteamIds.add(player.steamId));
      groups.push(buildSuspiciousGroupObject('SAME_IP', ip, players));
    });

  Array.from(subnetToSteam.entries())
    .sort((a, b) => b[1].size - a[1].size)
    .forEach(([subnet, steamSet]) => {
      if (groups.length >= safeLimit) return;
      const filtered = new Set<string>(Array.from(steamSet).filter((steamId) => !usedSteamIds.has(steamId)));
      if (filtered.size < 2) return;
      const players = buildPlayers(filtered);
      if (players.length < 2) return;
      players.forEach((player) => usedSteamIds.add(player.steamId));
      groups.push(buildSuspiciousGroupObject('SAME_SUBNET', subnet, players));
    });

  Array.from(locationToSteam.entries())
    .sort((a, b) => b[1].size - a[1].size)
    .forEach(([locationLabel, steamSet]) => {
      if (groups.length >= safeLimit) return;
      const filtered = new Set<string>(Array.from(steamSet).filter((steamId) => !usedSteamIds.has(steamId)));
      if (filtered.size < 2) return;
      const players = buildPlayers(filtered);
      if (players.length < 2) return;
      players.forEach((player) => usedSteamIds.add(player.steamId));
      groups.push(buildSuspiciousGroupObject('SAME_LOCATION', locationLabel, players));
    });

  groups.sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime());
  return groups.slice(0, safeLimit);
};

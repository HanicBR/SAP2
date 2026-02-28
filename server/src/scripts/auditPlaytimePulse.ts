import dotenv from 'dotenv';
import { prisma } from '../db/client';
import { getPlayerPulseSettings } from '../services/playtimePulse';

dotenv.config();

const MAX_ORPHAN_SESSION_MS = 6 * 60 * 60 * 1000;

type CliOptions = {
  hours: number;
  serverId?: string;
  json: boolean;
  bucketSec: number;
};

type LegacyServerState = {
  totalMs: number;
  connects: number;
  activeBuckets: Set<number>;
  openBySessionId: Map<string, { steamId: string; startMs: number }>;
  openBySteamId: Map<string, number>;
  openSessionIdsBySteam: Map<string, Set<string>>;
};

type AuditRow = {
  serverId: string;
  serverName: string;
  legacyHours: number;
  pulseHours: number;
  diffHours: number;
  diffPct: number;
  pulseCoveragePct: number;
  legacyConnections: number;
  recommendation: 'READY' | 'PARTIAL' | 'NO_PULSE';
};

const parsePositiveInt = (value: string | undefined, fallback: number, max: number): number => {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
};

const parseArgs = (): CliOptions => {
  const args = process.argv.slice(2);
  const map = new Map<string, string>();
  const flags = new Set<string>();

  args.forEach((arg) => {
    const raw = String(arg || '').trim();
    if (!raw) return;
    if (raw.startsWith('--') && raw.includes('=')) {
      const idx = raw.indexOf('=');
      map.set(raw.slice(0, idx), raw.slice(idx + 1));
      return;
    }
    flags.add(raw);
  });

  const pulseSettings = getPlayerPulseSettings();
  const bucketSec = parsePositiveInt(map.get('--bucket-sec'), pulseSettings.bucketSec || 60, 300);
  const hours = parsePositiveInt(map.get('--hours'), 24, 24 * 60);
  const serverId = String(map.get('--server-id') || '').trim() || undefined;

  return {
    hours,
    bucketSec,
    ...(serverId ? { serverId } : {}),
    json: flags.has('--json'),
  };
};

const isTrackableSteamId = (value: unknown): value is string => {
  const raw = String(value || '').trim();
  if (!raw) return false;
  const upper = raw.toUpperCase();
  if (upper === 'BOT' || upper === 'CONSOLE' || upper === 'UNKNOWN' || upper === 'NULL') return false;
  return /^STEAM_[0-5]:[01]:\d+$/.test(raw);
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

const ensureLegacyState = (map: Map<string, LegacyServerState>, serverId: string): LegacyServerState => {
  const current = map.get(serverId);
  if (current) return current;
  const next: LegacyServerState = {
    totalMs: 0,
    connects: 0,
    activeBuckets: new Set<number>(),
    openBySessionId: new Map<string, { steamId: string; startMs: number }>(),
    openBySteamId: new Map<string, number>(),
    openSessionIdsBySteam: new Map<string, Set<string>>(),
  };
  map.set(serverId, next);
  return next;
};

const closeLegacyInterval = (
  state: LegacyServerState,
  startMs: number,
  endMs: number,
  sinceMs: number,
  nowMs: number,
  bucketMs: number,
) => {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return;
  const clampedStart = Math.max(startMs, sinceMs);
  const clampedEnd = Math.min(endMs, nowMs);
  if (clampedEnd <= clampedStart) return;

  state.totalMs += clampedEnd - clampedStart;
  const startBucket = Math.max(0, Math.floor((clampedStart - sinceMs) / bucketMs));
  const endBucket = Math.max(0, Math.floor((clampedEnd - 1 - sinceMs) / bucketMs));
  for (let idx = startBucket; idx <= endBucket; idx++) {
    state.activeBuckets.add(idx);
  }
};

const closeOpenSessionsForSteam = (
  state: LegacyServerState,
  steamId: string,
  endMs: number,
  sinceMs: number,
  nowMs: number,
  bucketMs: number,
  excludeSessionId?: string,
) => {
  const current = state.openSessionIdsBySteam.get(steamId);
  if (!current || current.size === 0) return;

  Array.from(current).forEach((sid) => {
    if (excludeSessionId && sid === excludeSessionId) return;
    const opened = state.openBySessionId.get(sid);
    if (opened) {
      closeLegacyInterval(state, opened.startMs, endMs, sinceMs, nowMs, bucketMs);
      state.openBySessionId.delete(sid);
    }
    current.delete(sid);
  });

  if (current.size === 0) {
    state.openSessionIdsBySteam.delete(steamId);
  } else {
    state.openSessionIdsBySteam.set(steamId, current);
  }
};

const applyLegacyLog = (
  state: LegacyServerState,
  log: {
    type: string;
    timestamp: Date;
    steamId: string | null;
    metadata: unknown;
  },
  sinceMs: number,
  nowMs: number,
  bucketMs: number,
) => {
  const type = String(log.type || '').toUpperCase();
  const ts = log.timestamp.getTime();
  if (!isTrackableSteamId(log.steamId)) return;
  const steamId = log.steamId;
  const metadata = (log.metadata || {}) as any;
  const sessionId = String(metadata?.sessionId || metadata?.serverSessionId || '').trim() || undefined;

  if (type === 'CONNECT') {
    state.connects += 1;
    if (sessionId) {
      closeOpenSessionsForSteam(state, steamId, ts, sinceMs, nowMs, bucketMs, sessionId);

      const openedFallback = state.openBySteamId.get(steamId);
      if (openedFallback !== undefined) {
        closeLegacyInterval(state, openedFallback, ts, sinceMs, nowMs, bucketMs);
        state.openBySteamId.delete(steamId);
      }

      const existing = state.openBySessionId.get(sessionId);
      if (existing && existing.steamId === steamId) {
        existing.startMs = Math.min(existing.startMs, ts);
      } else {
        state.openBySessionId.set(sessionId, { steamId, startMs: ts });
        const openSet = state.openSessionIdsBySteam.get(steamId) || new Set<string>();
        openSet.add(sessionId);
        state.openSessionIdsBySteam.set(steamId, openSet);
      }
    } else {
      closeOpenSessionsForSteam(state, steamId, ts, sinceMs, nowMs, bucketMs);

      const openedFallback = state.openBySteamId.get(steamId);
      if (openedFallback !== undefined) {
        closeLegacyInterval(state, openedFallback, ts, sinceMs, nowMs, bucketMs);
      }
      state.openBySteamId.set(steamId, ts);
    }
    return;
  }

  if (type !== 'DISCONNECT') return;
  if (sessionId) {
    const opened = state.openBySessionId.get(sessionId);
    if (opened && opened.steamId === steamId) {
      closeLegacyInterval(state, opened.startMs, ts, sinceMs, nowMs, bucketMs);
      state.openBySessionId.delete(sessionId);
      const openSet = state.openSessionIdsBySteam.get(steamId);
      if (openSet) {
        openSet.delete(sessionId);
        if (openSet.size === 0) state.openSessionIdsBySteam.delete(steamId);
      }
    }
  }

  const fallbackStart = state.openBySteamId.get(steamId);
  if (fallbackStart !== undefined) {
    closeLegacyInterval(state, fallbackStart, ts, sinceMs, nowMs, bucketMs);
    state.openBySteamId.delete(steamId);
  }
  closeOpenSessionsForSteam(state, steamId, ts, sinceMs, nowMs, bucketMs);
};

const flushLegacyOpenSessions = (
  state: LegacyServerState,
  sinceMs: number,
  nowMs: number,
  bucketMs: number,
) => {
  state.openBySessionId.forEach((opened, sid) => {
    const safeEnd = Math.min(nowMs, opened.startMs + MAX_ORPHAN_SESSION_MS);
    closeLegacyInterval(state, opened.startMs, safeEnd, sinceMs, nowMs, bucketMs);
    state.openBySessionId.delete(sid);
  });

  state.openBySteamId.forEach((startMs, steamId) => {
    const safeEnd = Math.min(nowMs, startMs + MAX_ORPHAN_SESSION_MS);
    closeLegacyInterval(state, startMs, safeEnd, sinceMs, nowMs, bucketMs);
    state.openBySteamId.delete(steamId);
  });
};

const run = async () => {
  const options = parseArgs();
  const now = new Date();
  const nowMs = now.getTime();
  const since = new Date(nowMs - options.hours * 60 * 60 * 1000);
  const sinceMs = since.getTime();
  const bucketMs = options.bucketSec * 1000;
  const expectedBuckets = Math.max(1, Math.ceil((nowMs - sinceMs) / bucketMs));

  const serverWhere = options.serverId ? { id: options.serverId } : null;
  const servers = await prisma.gameServer.findMany({
    ...(serverWhere ? { where: serverWhere } : {}),
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!servers.length) {
    throw new Error('server_not_found_for_audit');
  }
  const serverIds = servers.map((server) => server.id);

  const legacyLogs = await prisma.log.findMany({
    where: {
      serverId: { in: serverIds },
      timestamp: { gte: since },
      type: { in: ['CONNECT', 'DISCONNECT'] },
    },
    orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
    select: {
      serverId: true,
      type: true,
      timestamp: true,
      steamId: true,
      metadata: true,
    },
    take: 500_000,
  });

  const legacyByServer = new Map<string, LegacyServerState>();
  legacyLogs.forEach((log) => {
    const serverId = String(log.serverId || '').trim();
    if (!serverId) return;
    const state = ensureLegacyState(legacyByServer, serverId);
    applyLegacyLog(
      state,
      {
        type: log.type,
        timestamp: log.timestamp,
        steamId: log.steamId,
        metadata: log.metadata,
      },
      sinceMs,
      nowMs,
      bucketMs,
    );
  });
  legacyByServer.forEach((state) => {
    flushLegacyOpenSessions(state, sinceMs, nowMs, bucketMs);
  });

  const pulseClient = (prisma as any).playerPlaytimePulse as
    | {
        groupBy: (args: any) => Promise<any[]>;
      }
    | undefined;
  if (!pulseClient) {
    throw new Error('player_playtime_pulse_model_not_available');
  }

  const [pulseByServer, pulseByServerBucket] = await Promise.all([
    pulseClient.groupBy({
      by: ['serverId'],
      where: {
        serverId: { in: serverIds },
        bucketStart: { gte: since, lte: now },
      },
      _sum: { grantedSeconds: true },
    }),
    pulseClient.groupBy({
      by: ['serverId', 'bucketStart'],
      where: {
        serverId: { in: serverIds },
        bucketStart: { gte: since, lte: now },
      },
      _sum: { grantedSeconds: true },
    }),
  ]);

  const pulseSecondsByServer = new Map<string, number>();
  pulseByServer.forEach((row) => {
    const serverId = String(row?.serverId || '').trim();
    if (!serverId) return;
    pulseSecondsByServer.set(serverId, Math.max(0, Number(row?._sum?.grantedSeconds) || 0));
  });

  const pulseBucketCountByServer = new Map<string, number>();
  pulseByServerBucket.forEach((row) => {
    const serverId = String(row?.serverId || '').trim();
    if (!serverId) return;
    const granted = Math.max(0, Number(row?._sum?.grantedSeconds) || 0);
    if (granted <= 0) return;
    pulseBucketCountByServer.set(serverId, (pulseBucketCountByServer.get(serverId) || 0) + 1);
  });

  const rows: AuditRow[] = servers.map((server) => {
    const legacyState = legacyByServer.get(server.id);
    const legacyHours = round2((legacyState?.totalMs || 0) / (1000 * 60 * 60));
    const pulseHours = round2((pulseSecondsByServer.get(server.id) || 0) / (60 * 60));
    const diffHours = round2(pulseHours - legacyHours);
    const diffPct = legacyHours > 0 ? round2((diffHours * 100) / legacyHours) : 0;

    const legacyBucketBase = Math.max(legacyState?.activeBuckets.size || 0, 1);
    const pulseBucketCount = pulseBucketCountByServer.get(server.id) || 0;
    const pulseCoveragePct =
      legacyState && legacyState.activeBuckets.size > 0
        ? round2((pulseBucketCount * 100) / legacyBucketBase)
        : round2((pulseBucketCount * 100) / expectedBuckets);

    let recommendation: AuditRow['recommendation'] = 'PARTIAL';
    if (pulseHours <= 0 && legacyHours > 0) {
      recommendation = 'NO_PULSE';
    } else if (pulseCoveragePct >= 60 && Math.abs(diffPct) <= 35) {
      recommendation = 'READY';
    }

    return {
      serverId: server.id,
      serverName: server.name,
      legacyHours,
      pulseHours,
      diffHours,
      diffPct,
      pulseCoveragePct,
      legacyConnections: legacyState?.connects || 0,
      recommendation,
    };
  });

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          generatedAt: now.toISOString(),
          rangeHours: options.hours,
          bucketSec: options.bucketSec,
          rows,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`Playtime pulse audit (${options.hours}h)`);
  console.log('serverId | legacyHours | pulseHours | diffPct | pulseCoveragePct | recommendation');
  rows.forEach((row) => {
    console.log(
      `${row.serverId} | ${row.legacyHours.toFixed(2)} | ${row.pulseHours.toFixed(2)} | ${row.diffPct.toFixed(2)}% | ${row.pulseCoveragePct.toFixed(2)}% | ${row.recommendation}`,
    );
  });
};

run()
  .catch((err) => {
    console.error('playtime_pulse_audit_failed', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

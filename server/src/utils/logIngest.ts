import { prisma } from '../db/client';
import { GameMode } from '../domain';
import { hashIp } from './geoIp';
import { normalizeIp } from './normalizeIp';
import { resolveGeoIpWithPersistentCache } from '../services/geoIpCache';

export interface IngestServerInfo {
  id: string;
  mode: GameMode | string;
  name: string;
}

export interface NormalizedLogEvent {
  serverId: string;
  eventId: string | null;
  gameMode: GameMode;
  type: string;
  timestamp: Date;
  steamId: string | null;
  playerName: string | null;
  rawText: string;
  metadata: any;
}

const ALLOWED_TYPES = new Set([
  'CONNECT',
  'DISCONNECT',
  'CHAT',
  'COMMAND',
  'PUNISH',
  'ULX',
  'KILL',
  'DAMAGE',
  'PROP_SPAWN',
  'TOOL_USE',
  'ROUND_START',
  'ROUND_END',
  'GAME_EVENT',
]);

const normalizeType = (raw: unknown): string => String(raw || 'UNKNOWN').toUpperCase();
const RAW_TEXT_IP_RE = /(?:^|\s)ip=([0-9]{1,3}(?:\.[0-9]{1,3}){3}(?::\d{1,5})?)(?:\s|$)/i;

const parseBoolEnv = (value: string | undefined, fallback: boolean): boolean => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!normalized) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
};

const PLAYER_IP_HISTORY_ENABLED = parseBoolEnv(process.env.PLAYER_IP_HISTORY_ENABLED, true);

const extractIpFromRawText = (rawText: unknown): string | null => {
  const raw = String(rawText || '');
  if (!raw) return null;
  const match = RAW_TEXT_IP_RE.exec(raw);
  if (!match || !match[1]) return null;
  return normalizeIp(match[1]);
};

const pickEventId = (event: any): string | undefined => {
  const raw =
    event?.eventId ||
    event?.EventId ||
    (event?.metadata && (event.metadata.eventId || event.metadata.EventId));

  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
};

export const normalizeEventsForServer = (
  events: any[],
  server: IngestServerInfo,
): NormalizedLogEvent[] => {
  if (!Array.isArray(events) || !events.length) {
    return [];
  }

  const cleanEvents = events
    .map((e, idx) => {
      const rawText = e.rawText || e.text || e.message || '';
      const type = normalizeType(e.type || e.eventType || e.EventType || 'UNKNOWN');
      if (!ALLOWED_TYPES.has(type)) {
        return null;
      }

      const ts = e.timestamp ? new Date(e.timestamp) : new Date();
      if (Number.isNaN(ts.getTime())) {
        return null;
      }

      const serverSessionId =
        e.serverSessionId || (e.metadata && (e.metadata as any).serverSessionId);

      const sessionId =
        e.sessionId ||
        e.SessionId ||
        e.session_id ||
        (e.metadata && (e.metadata as any).sessionId) ||
        serverSessionId;

      const sessionStart =
        e.sessionStart ||
        e.session_start ||
        (e.metadata && (e.metadata.sessionStart || e.metadata.session_start));

      const roundId = e.roundId || e.RoundId || (e.metadata && e.metadata.roundId);

      const roundNumberRaw = e.roundNumber ?? (e.metadata && (e.metadata.roundNumber as any));
      const roundNumber =
        typeof roundNumberRaw === 'number'
          ? roundNumberRaw
          : typeof roundNumberRaw === 'string'
          ? parseInt(roundNumberRaw, 10)
          : undefined;

      const playerCountRaw =
        e.playerCount || e.PlayerCount || e.count || (e.metadata && (e.metadata.playerCount as any));
      const playerCount =
        typeof playerCountRaw === 'number'
          ? playerCountRaw
          : typeof playerCountRaw === 'string'
          ? parseInt(playerCountRaw, 10)
          : undefined;

      const metadata = e.metadata && typeof e.metadata === 'object' ? e.metadata : {};
      const eventId = pickEventId(e);

      const meta = {
        ...metadata,
        eventId,
        sessionId,
        serverSessionId,
        sessionStart,
        map: e.map || e.mapName || e.Map || e.level,
        serverName: e.serverName || e.ServerName || server.name,
        roundId,
        roundNumber,
        playerCount:
          playerCount === undefined || Number.isNaN(playerCount) ? undefined : playerCount,
        index: idx,
      };

      if (type === 'CONNECT') {
        const metadataIpRaw = (meta as any).ip ?? e.ip;
        const hasMetadataIp = String(metadataIpRaw ?? '').trim().length > 0;
        const eventIp = hasMetadataIp
          ? normalizeIp(metadataIpRaw)
          : extractIpFromRawText(rawText);
        if (eventIp) {
          (meta as any).ip = eventIp;
        } else {
          delete (meta as any).ip;
        }
      } else {
        // Para MVP, IP não é aceito fora de CONNECT
        delete (meta as any).ip;
        delete (meta as any).port;
      }

      const rawMode = (e.gameMode || e.mode || e.game_mode || '').toString().toUpperCase();
      const resolvedMode =
        rawMode === GameMode.MURDER
          ? GameMode.MURDER
          : rawMode === GameMode.SANDBOX
          ? GameMode.SANDBOX
          : rawMode === GameMode.TTT
          ? GameMode.TTT
          : (server.mode as GameMode) || GameMode.TTT;

      return {
        serverId: server.id,
        eventId: eventId || null,
        gameMode: resolvedMode,
        type,
        timestamp: ts,
        steamId: e.steamId || e.SteamID || null,
        playerName: e.playerName || e.PlayerName || null,
        rawText: rawText || type,
        metadata: meta,
      } as NormalizedLogEvent;
    })
    .filter((event): event is NormalizedLogEvent => event !== null);

  return cleanEvents;
};

const prepareConnectMetadata = (events: NormalizedLogEvent[]): NormalizedLogEvent[] =>
  events.map((event) => {
    const metadata = (event.metadata || {}) as any;
    if (event.type !== 'CONNECT') {
      delete metadata.ip;
      delete metadata.port;
      delete metadata.geo;
      delete metadata.ipHash;
      return {
        ...event,
        metadata,
      };
    }

    const ip = normalizeIp(metadata.ip);
    if (!ip) {
      delete metadata.ip;
      delete metadata.port;
      delete metadata.geo;
      delete metadata.ipHash;
      return {
        ...event,
        metadata,
      };
    }

    metadata.ip = ip;
    metadata.ipHash = hashIp(ip);
    delete metadata.geo;

    return {
      ...event,
      metadata,
    };
  });

type PlayerIpHistoryAggregate = {
  steamId: string;
  ip: string;
  firstSeen: Date;
  lastSeen: Date;
  connections: number;
  lastServerId?: string;
};

const getPlayerIpHistoryClient = () => (prisma as any).playerIpHistory;
const getPlayerAliasHistoryClient = () => (prisma as any).playerAliasHistory;

const collectPlayerIpHistoryAggregates = (
  events: NormalizedLogEvent[],
): Map<string, PlayerIpHistoryAggregate> => {
  const map = new Map<string, PlayerIpHistoryAggregate>();

  events.forEach((event) => {
    if (event.type !== 'CONNECT') return;
    if (!event.steamId) return;
    const ip = normalizeIp((event.metadata as any)?.ip);
    if (!ip) return;

    const key = `${event.steamId}::${ip}`;
    const current = map.get(key);
    if (!current) {
      map.set(key, {
        steamId: event.steamId,
        ip,
        firstSeen: event.timestamp,
        lastSeen: event.timestamp,
        connections: 1,
        ...(event.serverId ? { lastServerId: event.serverId } : {}),
      });
      return;
    }

    if (event.timestamp.getTime() < current.firstSeen.getTime()) {
      current.firstSeen = event.timestamp;
    }
    if (event.timestamp.getTime() > current.lastSeen.getTime()) {
      current.lastSeen = event.timestamp;
      current.lastServerId = event.serverId;
    }
    current.connections += 1;
  });

  return map;
};

const persistPlayerIpHistory = async (aggregates: Map<string, PlayerIpHistoryAggregate>) => {
  if (!PLAYER_IP_HISTORY_ENABLED) return;
  const client = getPlayerIpHistoryClient();
  if (!client || !aggregates.size) return;

  for (const aggregate of aggregates.values()) {
    try {
      const existing = await client.findUnique({
        where: {
          steamId_ip: {
            steamId: aggregate.steamId,
            ip: aggregate.ip,
          },
        },
        select: {
          firstSeen: true,
          lastSeen: true,
          connections: true,
        },
      });

      if (!existing) {
        await client.create({
          data: {
            steamId: aggregate.steamId,
            ip: aggregate.ip,
            firstSeen: aggregate.firstSeen,
            lastSeen: aggregate.lastSeen,
            connections: aggregate.connections,
            lastServerId: aggregate.lastServerId || null,
          },
        });
        continue;
      }

      await client.update({
        where: {
          steamId_ip: {
            steamId: aggregate.steamId,
            ip: aggregate.ip,
          },
        },
        data: {
          firstSeen:
            aggregate.firstSeen.getTime() < existing.firstSeen.getTime()
              ? aggregate.firstSeen
              : existing.firstSeen,
          lastSeen:
            aggregate.lastSeen.getTime() > existing.lastSeen.getTime()
              ? aggregate.lastSeen
              : existing.lastSeen,
          connections: existing.connections + aggregate.connections,
          lastServerId: aggregate.lastServerId || null,
        },
      });
    } catch (err: any) {
      console.error('PlayerIpHistory persist failed', {
        steamId: aggregate.steamId,
        ip: aggregate.ip,
        error: err?.message || String(err),
      });
    }
  }
};

type PlayerAliasAggregate = {
  steamId: string;
  name: string;
  firstSeen: Date;
  lastSeen: Date;
  seenCount: number;
};

const collectPlayerAliasAggregates = (
  events: NormalizedLogEvent[],
): Map<string, PlayerAliasAggregate> => {
  const aliases = new Map<string, PlayerAliasAggregate>();

  events.forEach((event) => {
    const steamId = String(event.steamId || '').trim();
    const name = String(event.playerName || '').trim();
    if (!steamId || !name) return;

    const key = `${steamId}::${name.toLowerCase()}`;
    const existing = aliases.get(key);
    if (!existing) {
      aliases.set(key, {
        steamId,
        name,
        firstSeen: event.timestamp,
        lastSeen: event.timestamp,
        seenCount: 1,
      });
      return;
    }

    if (event.timestamp.getTime() < existing.firstSeen.getTime()) {
      existing.firstSeen = event.timestamp;
    }
    if (event.timestamp.getTime() > existing.lastSeen.getTime()) {
      existing.lastSeen = event.timestamp;
    }
    existing.seenCount += 1;
  });

  return aliases;
};

const persistPlayerAliasHistory = async (aggregates: Map<string, PlayerAliasAggregate>) => {
  const client = getPlayerAliasHistoryClient();
  if (!client || !aggregates.size) return;

  for (const aggregate of aggregates.values()) {
    const existing = await client.findUnique({
      where: {
        steamId_name: {
          steamId: aggregate.steamId,
          name: aggregate.name,
        },
      },
      select: {
        firstSeen: true,
        lastSeen: true,
        seenCount: true,
      },
    });

    if (!existing) {
      await client.create({
        data: {
          steamId: aggregate.steamId,
          name: aggregate.name,
          firstSeen: aggregate.firstSeen,
          lastSeen: aggregate.lastSeen,
          seenCount: aggregate.seenCount,
        },
      });
      continue;
    }

    await client.update({
      where: {
        steamId_name: {
          steamId: aggregate.steamId,
          name: aggregate.name,
        },
      },
      data: {
        firstSeen:
          aggregate.firstSeen.getTime() < existing.firstSeen.getTime()
            ? aggregate.firstSeen
            : existing.firstSeen,
        lastSeen:
          aggregate.lastSeen.getTime() > existing.lastSeen.getTime()
            ? aggregate.lastSeen
            : existing.lastSeen,
        seenCount: Number(existing.seenCount || 0) + aggregate.seenCount,
      },
    });
  }
};

const enrichPlayerGeoInBackground = (events: NormalizedLogEvent[]) => {
  const targets = new Map<string, { steamId: string; ip: string }>();

  events.forEach((event) => {
    if (event.type !== 'CONNECT' || !event.steamId) return;
    const ip = normalizeIp((event.metadata as any)?.ip);
    if (!ip) return;
    targets.set(`${event.steamId}::${ip}`, { steamId: event.steamId, ip });
  });

  if (!targets.size) return;

  void Promise.all(
    Array.from(targets.values()).map(async ({ steamId, ip }) => {
      try {
        const geo = await resolveGeoIpWithPersistentCache(ip);
        if (!geo) return;
        // Guard to avoid writing stale geo when player already switched to another IP.
        await prisma.playerProfile.updateMany({
          where: { steamId, ip },
          data: { geo: geo as any },
        });
        if (PLAYER_IP_HISTORY_ENABLED) {
          const historyClient = getPlayerIpHistoryClient();
          if (historyClient) {
            await historyClient.updateMany({
              where: { steamId, ip },
              data: {
                geoSnapshot: {
                  ...(geo.country ? { country: geo.country } : {}),
                  ...(geo.state ? { state: geo.state } : {}),
                  ...(geo.city ? { city: geo.city } : {}),
                  ...(typeof geo.lat === 'number' ? { lat: geo.lat } : {}),
                  ...(typeof geo.lng === 'number' ? { lng: geo.lng } : {}),
                  source: geo.source || 'ipwhois',
                },
              },
            });
          }
        }
      } catch (err: any) {
        console.error('Geo background enrichment failed', {
          steamId,
          ip,
          error: err?.message || String(err),
        });
      }
    }),
  ).catch((err: any) => {
    console.error('Geo background enrichment batch failed', err?.message || String(err));
  });
};

export const storeLogsAndUpdateProfiles = async (cleanEvents: NormalizedLogEvent[]) => {
  if (!cleanEvents.length) {
    return { ingested: 0, snapshotsInserted: 0, playersTouched: 0 };
  }

  const preparedEvents = prepareConnectMetadata(cleanEvents);

  // Deduplicação no próprio lote por (serverId, eventId)
  const seenInBatch = new Set<string>();
  const dedupedBatch = preparedEvents.filter((event) => {
    if (!event.eventId) return true;
    const key = `${event.serverId}::${event.eventId}`;
    if (seenInBatch.has(key)) return false;
    seenInBatch.add(key);
    return true;
  });

  // Deduplicação contra banco (idempotência entre requisições)
  const eventIdsByServer = new Map<string, Set<string>>();
  dedupedBatch.forEach((event) => {
    if (!event.eventId) return;
    const current = eventIdsByServer.get(event.serverId) || new Set<string>();
    current.add(event.eventId);
    eventIdsByServer.set(event.serverId, current);
  });

  const existingEventKeys = new Set<string>();
  for (const [serverId, ids] of eventIdsByServer.entries()) {
    if (!ids.size) continue;
    const existing = await prisma.log.findMany({
      where: {
        serverId,
        eventId: { in: Array.from(ids) },
      },
      select: { eventId: true },
    });
    existing.forEach((row) => {
      if (row.eventId) {
        existingEventKeys.add(`${serverId}::${row.eventId}`);
      }
    });
  }

  const eventsToInsert = dedupedBatch.filter((event) => {
    if (!event.eventId) return true;
    const key = `${event.serverId}::${event.eventId}`;
    return !existingEventKeys.has(key);
  });

  if (!eventsToInsert.length) {
    return { ingested: 0, snapshotsInserted: 0, playersTouched: 0 };
  }

  const playerIpHistoryAggregates = collectPlayerIpHistoryAggregates(eventsToInsert);
  const playerAliasAggregates = collectPlayerAliasAggregates(eventsToInsert);

  const insertResult = await prisma.log.createMany({
    data: eventsToInsert as any,
    skipDuplicates: true,
  });

  const snapshots = eventsToInsert
    .filter((e) => e.metadata && e.metadata.playerCount !== undefined)
    .map((e) => ({
      serverId: e.serverId,
      timestamp: e.timestamp,
      count: Number(e.metadata.playerCount) || 0,
    }))
    .filter((s) => !isNaN(s.count));

  let snapshotsInserted = 0;
  if (snapshots.length) {
    if ((prisma as any).playerSnapshot) {
      const snapshotResult = await (prisma as any).playerSnapshot.createMany({
        data: snapshots,
      });
      snapshotsInserted = snapshotResult?.count ?? snapshots.length;
    }
  }

  const updates = eventsToInsert.filter((e) => e.steamId);
  const seenPlayers = new Set<string>();

  for (const ev of updates) {
    const steamId = ev.steamId!;
    seenPlayers.add(steamId);
    const isConnect = ev.type === 'CONNECT';
    const ip = isConnect ? normalizeIp((ev.metadata as any)?.ip) || undefined : undefined;
    const existingProfile = await prisma.playerProfile.findUnique({
      where: { steamId },
      select: { serverStats: true },
    });

    const existingServerStats =
      existingProfile &&
      existingProfile.serverStats &&
      typeof existingProfile.serverStats === 'object' &&
      !Array.isArray(existingProfile.serverStats)
        ? (existingProfile.serverStats as Record<string, any>)
        : {};

    const currentServerStats =
      ev.serverId &&
      existingServerStats[ev.serverId] &&
      typeof existingServerStats[ev.serverId] === 'object'
        ? (existingServerStats[ev.serverId] as Record<string, any>)
        : { playTimeHours: 0, connections: 0 };

    const nextServerStats = ev.serverId
      ? ({
          ...existingServerStats,
          [ev.serverId]: {
            playTimeHours: Number(currentServerStats.playTimeHours) || 0,
            connections:
              (Number(currentServerStats.connections) || 0) + (ev.type === 'CONNECT' ? 1 : 0),
          },
        } as Record<string, any>)
      : existingServerStats;

    await prisma.playerProfile.upsert({
      where: { steamId },
      create: {
        steamId,
        name: ev.playerName || steamId,
        avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(
          steamId,
        )}`,
        lastSeen: ev.timestamp,
        firstSeen: ev.timestamp,
        totalConnections: ev.type === 'CONNECT' ? 1 : 0,
        playTimeHours: 0,
        isVip: false,
        ip: ip || null,
        serverStats: nextServerStats,
      },
      update: {
        name: ev.playerName || undefined,
        lastSeen: ev.timestamp,
        totalConnections: {
          increment: ev.type === 'CONNECT' ? 1 : 0,
        },
        ip: isConnect ? ip || undefined : undefined,
        serverStats: ev.serverId ? (nextServerStats as any) : undefined,
      } as any,
    });
  }

  await persistPlayerIpHistory(playerIpHistoryAggregates);
  await persistPlayerAliasHistory(playerAliasAggregates);
  enrichPlayerGeoInBackground(eventsToInsert);

  return {
    ingested: insertResult.count,
    snapshotsInserted,
    playersTouched: seenPlayers.size,
  };
};

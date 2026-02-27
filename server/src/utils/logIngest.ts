import { prisma } from '../db/client';
import { GameMode } from '../domain';
import { hashIp, lookupGeoIp, normalizeIPv4 } from './geoIp';

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
        const eventIp = normalizeIPv4(e.ip || (meta as any).ip);
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

const enrichConnectMetadata = async (events: NormalizedLogEvent[]): Promise<NormalizedLogEvent[]> => {
  const connectIps = new Set<string>();

  events.forEach((event) => {
    if (event.type !== 'CONNECT') return;
    const ip = normalizeIPv4((event.metadata as any)?.ip);
    if (ip) connectIps.add(ip);
  });

  const geoByIp = new Map<string, any>();
  await Promise.all(
    Array.from(connectIps).map(async (ip) => {
      const geo = await lookupGeoIp(ip);
      if (geo) {
        geoByIp.set(ip, geo);
      }
    }),
  );

  return events.map((event) => {
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

    const ip = normalizeIPv4(metadata.ip);
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

    const geo = geoByIp.get(ip);
    if (geo) {
      metadata.geo = geo;
    } else {
      delete metadata.geo;
    }

    return {
      ...event,
      metadata,
    };
  });
};

export const storeLogsAndUpdateProfiles = async (cleanEvents: NormalizedLogEvent[]) => {
  if (!cleanEvents.length) {
    return { ingested: 0, snapshotsInserted: 0, playersTouched: 0 };
  }

  const enriched = await enrichConnectMetadata(cleanEvents);

  // Deduplicação no próprio lote por (serverId, eventId)
  const seenInBatch = new Set<string>();
  const dedupedBatch = enriched.filter((event) => {
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
    const ip = isConnect ? normalizeIPv4((ev.metadata as any)?.ip) : undefined;
    const geo = isConnect ? (ev.metadata as any)?.geo || undefined : undefined;

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
        geo,
        serverStats: ev.serverId
          ? {
              [ev.serverId]: {
                playTimeHours: 0,
                connections: ev.type === 'CONNECT' ? 1 : 0,
              },
            }
          : {},
      },
      update: {
        name: ev.playerName || undefined,
        lastSeen: ev.timestamp,
        totalConnections: {
          increment: ev.type === 'CONNECT' ? 1 : 0,
        },
        ip: isConnect ? ip || undefined : undefined,
        geo: isConnect ? geo : undefined,
        serverStats: ev.serverId
          ? ({
              ...(ev.serverId
                ? {
                    [ev.serverId]: {
                      playTimeHours: 0,
                      connections: ev.type === 'CONNECT' ? 1 : 0,
                    },
                  }
                : {}),
            } as any)
          : undefined,
      } as any,
    });
  }

  return {
    ingested: insertResult.count,
    snapshotsInserted,
    playersTouched: seenPlayers.size,
  };
};

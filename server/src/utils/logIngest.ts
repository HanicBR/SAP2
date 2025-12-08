import { prisma } from '../db/client';
import { GameMode } from '../domain';

export interface IngestServerInfo {
  id: string;
  mode: GameMode | string;
  name: string;
}

export interface NormalizedLogEvent {
  serverId: string;
  gameMode: GameMode;
  type: string;
  timestamp: Date;
  steamId: string | null;
  playerName: string | null;
  rawText: string;
  metadata: any;
}

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
      const type = e.type || e.eventType || e.EventType || 'UNKNOWN';
      const ts = e.timestamp ? new Date(e.timestamp) : new Date();

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

      const meta = {
        ...(e.metadata || {}),
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
        gameMode: resolvedMode,
        type,
        timestamp: ts,
        steamId: e.steamId || null,
        playerName: e.playerName || null,
        rawText: rawText || type,
        metadata: meta,
      } as NormalizedLogEvent;
    })
    .filter(Boolean) as NormalizedLogEvent[];

  return cleanEvents;
};

export const storeLogsAndUpdateProfiles = async (cleanEvents: NormalizedLogEvent[]) => {
  if (!cleanEvents.length) {
    return { ingested: 0, snapshotsInserted: 0, playersTouched: 0 };
  }

  await prisma.log.createMany({
    data: cleanEvents as any,
  });

  const snapshots = cleanEvents
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
      await (prisma as any).playerSnapshot.createMany({
        data: snapshots,
      });
      snapshotsInserted = snapshots.length;
    }
  }

  const updates = cleanEvents.filter((e) => e.steamId);
  const seenPlayers = new Set<string>();

  for (const ev of updates) {
    const steamId = ev.steamId!;
    seenPlayers.add(steamId);

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
        ip: (ev.metadata as any)?.ip || null,
        geo: (ev.metadata as any)?.geo || undefined,
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
        ip: (ev.metadata as any)?.ip || undefined,
        geo: (ev.metadata as any)?.geo || undefined,
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
    ingested: cleanEvents.length,
    snapshotsInserted,
    playersTouched: seenPlayers.size,
  };
};

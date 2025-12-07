import { Router } from 'express';
import { prisma } from '../db/client';
import { GameMode, SiteConfig } from '../domain';
import { compareApiKey } from '../utils/apiKey';

const router = Router();

// In-memory stats for ignored logs (reset on server restart)
const ignoreStats = {
  tools: {} as Record<string, number>,
  commands: {} as Record<string, number>,
  rawText: {} as Record<string, number>,
};

const bumpStat = (bucket: Record<string, number>, key: string) => {
  const k = String(key);
  bucket[k] = (bucket[k] || 0) + 1;
};

// Simple ingestion endpoint for server-side log forwarding
// Expects header: X-Server-Key: <apiKey>
// Body: { events: [{ serverId?, gameMode, type, timestamp, steamId?, playerName?, rawText, metadata, sessionId?, map?, serverName?, roundId? }] }

const parseJsonBody = (raw: any): any => {
  if (raw == null) return undefined;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return raw;
};

router.post('/logs', async (req, res) => {
  const apiKey = req.header('x-server-key') || req.header('X-Server-Key');
  const parsedBody = parseJsonBody((req as any).body);
  const events = (parsedBody as any)?.events as any[];

  if (!apiKey) {
    return res.status(401).json({ error: 'Missing server API key' });
  }

  if (!Array.isArray(events) || events.length === 0) {
    return res.status(400).json({
      error: 'No events to ingest',
      received: Array.isArray(events) ? events.length : 0,
      bodyType: typeof parsedBody,
    });
  }

  // Find server by apiKey hash
  const allServers = await prisma.gameServer.findMany({ select: { id: true, apiKeyHash: true, mode: true, name: true } });
  const server = allServers.find((s) => s.apiKeyHash && compareApiKey(apiKey, s.apiKeyHash));
  if (!server) {
    return res.status(403).json({ error: 'Invalid server key' });
  }

  // Load site config for ignore rules
  const siteConfig = await prisma.siteConfig.findUnique({ where: { id: 1 } });
  const logsConfig = (siteConfig?.data as unknown as SiteConfig | undefined)?.logs;
  const ignoredTools = logsConfig?.ignoredTools || [];
  const ignoredCommands = logsConfig?.ignoredCommands || [];
  const rawTextFilters = logsConfig?.rawTextFilters || [];

  const cleanEvents = events
    .map((e, idx) => {
      const rawText = e.rawText || e.text || e.message || '';
      const type = e.type || e.eventType || e.EventType || 'UNKNOWN';
      const ts = e.timestamp ? new Date(e.timestamp) : new Date();
      const meta = {
        ...(e.metadata || {}),
        sessionId: e.sessionId || e.SessionId || e.session_id,
        map: e.map || e.mapName || e.Map || e.level,
        serverName: e.serverName || e.ServerName || server.name,
        roundId: e.roundId || e.RoundId,
        playerCount: e.playerCount || e.PlayerCount || e.count || undefined,
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
          : server.mode || GameMode.TTT;
      return {
        serverId: server.id,
        gameMode: resolvedMode,
        type,
        timestamp: ts,
        steamId: e.steamId || null,
        playerName: e.playerName || null,
        rawText: rawText || type, // garante texto mínimo para não ser descartado
        metadata: meta,
      } as any;
    })
    .filter(Boolean) as any[];

  if (!cleanEvents.length) {
    return res.status(400).json({ error: 'No valid events', received: events.length });
  }

  await prisma.log.createMany({
    data: cleanEvents,
  });

  // Store heartbeats/player counts if provided
  const snapshots = cleanEvents
    .filter((e) => e.metadata && e.metadata.playerCount !== undefined)
    .map((e) => ({
      serverId: e.serverId,
      timestamp: e.timestamp,
      count: Number(e.metadata.playerCount) || 0,
    }))
    .filter((s) => !isNaN(s.count));

  if (snapshots.length) {
    // PlayerSnapshot model might not exist if migration not applied
    if ((prisma as any).playerSnapshot) {
      await (prisma as any).playerSnapshot.createMany({
        data: snapshots,
      });
    }
  }

  // Update player profiles (basic upsert)
  const updates = cleanEvents.filter((e) => e.steamId);
  for (const ev of updates) {
    await prisma.playerProfile.upsert({
      where: { steamId: ev.steamId },
      create: {
        steamId: ev.steamId,
        name: ev.playerName || ev.steamId,
        avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(
          ev.steamId,
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
      },
    });
  }

  return res.json({ ingested: cleanEvents.length });
});

// Simple stats endpoint to inspect ignored logs (for admin UI)
router.get('/stats', async (_req, res) => {
  return res.json(ignoreStats);
});

export default router;

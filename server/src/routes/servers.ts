import { Router } from 'express';
import { prisma } from '../db/client';
import { GameMode, ServerStatus, UserRole } from '../domain';
import { authMiddleware, requireRole } from '../middleware/auth';
import { hashApiKey, compareApiKey } from '../utils/apiKey';

const router = Router();

const toDomainServer = (s: any) => {
  const mode =
    s.mode === 'SANDBOX' ? GameMode.SANDBOX : s.mode === 'MURDER' ? GameMode.MURDER : GameMode.TTT;
  const lastHeartbeat: Date | null = s.lastHeartbeat ?? null;
  const isMaintenance = s.status === 'MAINTENANCE';
  let status: ServerStatus = ServerStatus.OFFLINE;
  let currentPlayers = s.currentPlayers as number;

  if (isMaintenance) {
    status = ServerStatus.MAINTENANCE;
  } else if (lastHeartbeat) {
    const delta = Date.now() - lastHeartbeat.getTime();
    if (delta <= 2 * 60 * 1000) {
      status = ServerStatus.ONLINE;
    } else {
      status = ServerStatus.OFFLINE;
      currentPlayers = 0;
    }
  } else {
    status =
      s.status === 'ONLINE'
        ? ServerStatus.ONLINE
        : s.status === 'OFFLINE'
        ? ServerStatus.OFFLINE
        : ServerStatus.MAINTENANCE;
  }

  return {
    id: s.id,
    name: s.name,
    ip: s.ip,
    port: s.port,
    mode,
    status,
    currentPlayers,
    maxPlayers: s.maxPlayers,
    currentMap: s.currentMap || undefined,
    lastHeartbeat: lastHeartbeat ? lastHeartbeat.toISOString() : undefined,
    apiKey: undefined, // nunca exponha a chave; apenas em respostas específicas de criação/regeneração
  };
};

router.get('/', async (_req, res) => {
  const servers = await prisma.gameServer.findMany({
    orderBy: { createdAt: 'asc' },
  });
  return res.json(servers.map(toDomainServer));
});

router.get('/:id', async (req, res) => {
  const { id } = req.params as { id: string };
  const server = await prisma.gameServer.findUnique({ where: { id } });
  if (!server) {
    return res.status(404).json({ error: 'Server not found' });
  }
  return res.json(toDomainServer(server));
});

router.post('/', authMiddleware, requireRole(UserRole.SUPERADMIN), async (req, res) => {
  const { name, ip, port, mode, maxPlayers } = req.body as {
    name?: string;
    ip?: string;
    port?: number;
    mode?: GameMode;
    maxPlayers?: number;
  };

  if (!name || !ip || !port || !mode || !maxPlayers) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  if (!Object.values(GameMode).includes(mode)) {
    return res.status(400).json({ error: 'Invalid game mode' });
  }

  const apiKey = `sk_live_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

  const server = await prisma.gameServer.create({
    data: {
      name,
      ip,
      port,
      mode: (mode === GameMode.SANDBOX ? 'SANDBOX' : mode === GameMode.MURDER ? 'MURDER' : 'TTT') as any,
      status: 'OFFLINE',
      currentPlayers: 0,
      maxPlayers,
      apiKeyHash: hashApiKey(apiKey),
    },
  });

  return res.status(201).json({ ...toDomainServer(server), apiKey });
});

router.post('/:id/regenerate-key', authMiddleware, requireRole(UserRole.SUPERADMIN), async (req, res) => {
  const { id } = req.params as { id: string };
  const apiKey = `sk_live_${id}_${Math.random().toString(36).substring(2, 8)}`;

  try {
    await prisma.gameServer.update({
      where: { id },
      data: { apiKeyHash: hashApiKey(apiKey) },
    });
  } catch {
    return res.status(404).json({ error: 'Server not found' });
  }

  return res.json({ apiKey });
});

// Heartbeat endpoint for game servers (auth via X-Server-Key)
router.post('/heartbeat', async (req, res) => {
  try {
    const apiKey = (req.header('x-server-key') || req.header('X-Server-Key')) as string | undefined;
    if (!apiKey) {
      return res.status(401).json({ error: 'Missing server API key' });
    }

    const allServers = await prisma.gameServer.findMany({ select: { id: true, apiKeyHash: true } });
    const server = allServers.find((s) => s.apiKeyHash && compareApiKey(apiKey, s.apiKeyHash));
    if (!server) {
      return res.status(403).json({ error: 'Invalid server key' });
    }

    const { map, playerCount } = req.body as {
      map?: string;
      playerCount?: number;
    };

    const now = new Date();

    // Update core status fields
    const updateData: any = {
      lastHeartbeat: now,
      status: 'ONLINE',
    };
    if (typeof playerCount === 'number' && playerCount >= 0) {
      updateData.currentPlayers = Math.floor(playerCount);
    }
    if (map) {
      updateData.currentMap = map;
    }

    await prisma.gameServer.update({
      where: { id: server.id },
      data: updateData,
    });

    // Optional: also store snapshot for analytics if playerCount provided
    if (typeof playerCount === 'number' && !isNaN(playerCount) && playerCount >= 0) {
      const client = (prisma as any).playerSnapshot as
        | { create: (args: any) => Promise<any> }
        | undefined;
      if (client) {
        await client.create({
          data: {
            serverId: server.id,
            timestamp: now,
            count: Math.floor(playerCount),
          },
        });
      }
    }

    return res.json({ ok: true });
  } catch (err: any) {
    console.error('Heartbeat error', err);
    return res.status(500).json({ error: 'Heartbeat failed', detail: err?.message });
  }
});

router.get('/:id/analytics', async (req, res) => {
  const { id } = req.params as { id: string };
  const rangeParam = (req.query.range as string) || '7d';
  const range = (['24h', '7d', '30d'].includes(rangeParam) ? rangeParam : '7d') as '24h' | '7d' | '30d';

  const server = await prisma.gameServer.findUnique({ where: { id } });
  if (!server) {
    return res.status(404).json({ error: 'Server not found' });
  }

  // Range window
  const hours = range === '24h' ? 24 : range === '7d' ? 24 * 7 : 24 * 30;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  // Logs in range
  const logs = await prisma.log.findMany({
    where: { serverId: id, timestamp: { gte: since } },
    orderBy: { timestamp: 'asc' },
  });

  // Total sessions = CONNECT logs
  const totalSessions = logs.filter((l) => l.type === 'CONNECT').length;

  // New players = first CONNECT within window
  const connectsByPlayer: Record<string, Date> = {};
  logs.forEach((l) => {
    if (l.type === 'CONNECT' && l.steamId) {
      if (!connectsByPlayer[l.steamId]) connectsByPlayer[l.steamId] = l.timestamp;
    }
  });
  const newPlayers = Object.values(connectsByPlayer).filter((d) => d >= since).length;

  // Playtime real: preferir sessionId, senão parear CONNECT/DISCONNECT por steamId
  const playtimeByPlayer: Record<string, number> = {}; // ms
  const sessionsById: Record<string, { steamId: string | null; start?: number; end?: number }> = {};
  const lastConnectByPlayer: Record<string, number> = {};

  logs.forEach((l) => {
    const ts = l.timestamp.getTime();
    const sessionId = (l.metadata as any)?.sessionId;
    const steamId = l.steamId || undefined;

    if (sessionId) {
      if (!sessionsById[sessionId]) sessionsById[sessionId] = { steamId: null };
      const sess = sessionsById[sessionId];
      if (l.type === 'CONNECT') {
        sess.start = ts;
        sess.steamId = steamId || sess.steamId;
      } else if (l.type === 'DISCONNECT') {
        sess.end = ts;
        sess.steamId = steamId || sess.steamId;
      }
    } else if (steamId) {
      // fallback por steamId
      if (l.type === 'CONNECT') {
        lastConnectByPlayer[steamId] = ts;
      } else if (l.type === 'DISCONNECT') {
        const start = lastConnectByPlayer[steamId];
        if (start !== undefined) {
          const duration = ts - start;
          playtimeByPlayer[steamId] = (playtimeByPlayer[steamId] || 0) + Math.max(duration, 0);
          delete lastConnectByPlayer[steamId];
        }
      }
    }
  });

  // Consolidar sessões com sessionId
  const rangeEnd = Date.now();
  Object.values(sessionsById).forEach((s) => {
    const sid: string = s.steamId ?? 'unknown';
    const start = s.start;
    const end = s.end ?? rangeEnd;
    if (start !== undefined) {
      const duration = end - start;
      playtimeByPlayer[sid] = (playtimeByPlayer[sid] || 0) + Math.max(duration, 0);
    }
  });

  // Fechar sessões abertas (fallback) na borda final do range
  Object.entries(lastConnectByPlayer).forEach(([steamId, start]) => {
    const duration = rangeEnd - start;
    playtimeByPlayer[steamId] = (playtimeByPlayer[steamId] || 0) + Math.max(duration, 0);
  });

  const totalPlayTimeHours = Math.round(
    Object.values(playtimeByPlayer).reduce((acc, ms) => acc + ms, 0) / (1000 * 60 * 60),
  );

  // Peak players: prefer snapshots (playerCount), fallback para CONNECT window
  let peakPlayers = 0;
  const snapshotClient = (prisma as any).playerSnapshot as
    | { findMany: (args: any) => Promise<any[]> }
    | undefined;
  if (snapshotClient) {
    const snapshots = await snapshotClient.findMany({
      where: { serverId: id, timestamp: { gte: since } },
      orderBy: { timestamp: 'desc' },
      take: 5000,
    });
    if (snapshots.length) {
      peakPlayers = Math.max(...snapshots.map((s: any) => s.count));
    }
  } else if (logs.length) {
    const timestamps = logs
      .filter((l) => l.type === 'CONNECT')
      .map((l) => l.timestamp.getTime())
      .sort((a, b) => a - b);
    let left = 0;
    for (let right = 0; right < timestamps.length; right++) {
      const current = timestamps[right];
      if (current === undefined) continue;
      while (left < timestamps.length) {
        const leftVal = timestamps[left];
        if (leftVal === undefined) break;
        if (current - leftVal > 5 * 60 * 1000) {
          left++;
          continue;
        }
        break;
      }
      peakPlayers = Math.max(peakPlayers, right - left + 1);
    }
  }

  // Trends (daily buckets)
  const bucketCount = range === '24h' ? 24 : range === '7d' ? 7 : 30;
  const playTimeTrend = Array.from({ length: bucketCount }).map((_, idx) => {
    const bucketStart = new Date(since.getTime() + (idx * hours * 60 * 60 * 1000) / bucketCount);
    const bucketEnd = new Date(since.getTime() + ((idx + 1) * hours * 60 * 60 * 1000) / bucketCount);

    const bucketLogs = logs.filter((l) => l.timestamp >= bucketStart && l.timestamp < bucketEnd);
    const localSessions: Record<string, { steamId: string | null; start?: number; end?: number }> = {};
    const localLastByPlayer: Record<string, number> = {};
    const localPlaytime: Record<string, number> = {};

    bucketLogs.forEach((l) => {
      const ts = l.timestamp.getTime();
      const sessionId = (l.metadata as any)?.sessionId;
      const steamId = l.steamId || undefined;
      if (sessionId) {
        if (!localSessions[sessionId]) localSessions[sessionId] = { steamId: null };
        const sess = localSessions[sessionId];
        if (l.type === 'CONNECT') {
          sess.start = ts;
          sess.steamId = steamId || sess.steamId;
        } else if (l.type === 'DISCONNECT') {
          sess.end = ts;
          sess.steamId = steamId || sess.steamId;
        }
      } else if (steamId) {
        if (l.type === 'CONNECT') {
          localLastByPlayer[steamId] = ts;
        } else if (l.type === 'DISCONNECT') {
          const start = localLastByPlayer[steamId];
          if (start !== undefined) {
            const duration = ts - start;
            localPlaytime[steamId] = (localPlaytime[steamId] || 0) + Math.max(duration, 0);
            delete localLastByPlayer[steamId];
          }
        }
      }
    });

    Object.values(localSessions).forEach((s) => {
      const sid: string = s.steamId ?? 'unknown';
      const start = s.start;
      const end = s.end ?? bucketEnd.getTime();
      if (start !== undefined) {
        const duration = end - start;
        localPlaytime[sid] = (localPlaytime[sid] || 0) + Math.max(duration, 0);
      }
    });

    Object.entries(localLastByPlayer).forEach(([steamId, start]) => {
      const duration = bucketEnd.getTime() - start;
      localPlaytime[steamId] = (localPlaytime[steamId] || 0) + Math.max(duration, 0);
    });

    const bucketHours = Math.round(
      Object.values(localPlaytime).reduce((acc, ms) => acc + ms, 0) / (1000 * 60 * 60),
    );

    return { date: `P${idx + 1}`, hours: bucketHours };
  });

  const playerCountTrend = playTimeTrend.map((p) => ({
    date: p.date,
    count: p.hours > 0 ? Math.max(1, Math.round(p.hours / (20 / 60))) : 0,
  }));

  // Top players by number of events in range
  const playerEventCount: Record<string, { name: string; count: number }> = {};
  logs.forEach((l) => {
    if (!l.steamId) return;
    const key = l.steamId;
    if (!playerEventCount[key]) playerEventCount[key] = { name: l.playerName || key, count: 0 };
    playerEventCount[key].count += 1;
  });
  const topPlayers = Object.entries(playerEventCount)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([steamId, info]) => ({
      steamId,
      name: info.name,
      avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(steamId)}`,
      hours: Math.max(1, Math.round((info.count * 20) / 60)),
    }));

  return res.json({
    totalPlayTimeHours,
    totalSessions,
    newPlayers,
    peakPlayers,
    playTimeTrend,
    playerCountTrend,
    topPlayers,
  });
});

export default router;

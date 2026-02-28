import { Request, Router } from 'express';
import { prisma } from '../db/client';
import { GameMode, ServerStatus, UserRole } from '../domain';
import { authMiddleware, requireRole } from '../middleware/auth';
import { hashApiKey, compareApiKey } from '../utils/apiKey';
import { drainServerActions } from '../services/serverActions';
import { getVipAutomationMetrics, previewVipAutomationBuild, VipAutomationActionType } from '../services/vipAutomation';
import { normalizeIp } from '../utils/normalizeIp';

const router = Router();

const IPV4_IN_TEXT_RE = /(\d{1,3}(?:\.\d{1,3}){3})/;
const HOSTNAME_RE = /^[a-z0-9.-]+$/i;

const parseInteger = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value);
  }
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const extractIpv4 = (value: unknown): string | undefined => {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  const direct = normalizeIp(raw);
  if (direct) return direct;

  const firstPart = raw.split(',')[0]?.trim() || '';
  const firstDirect = normalizeIp(firstPart);
  if (firstDirect) return firstDirect;

  const match = IPV4_IN_TEXT_RE.exec(firstPart) || IPV4_IN_TEXT_RE.exec(raw);
  if (!match || !match[1]) return undefined;
  const normalized = normalizeIp(match[1]);
  return normalized || undefined;
};

const isPrivateIpv4 = (ip: string): boolean => {
  const [aRaw = '', bRaw = ''] = ip.split('.');
  const a = Number.parseInt(aRaw, 10);
  const b = Number.parseInt(bRaw, 10);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
};

const isPlaceholderHost = (value: unknown): boolean => {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!raw) return true;
  if (raw === 'localhost' || raw === '0.0.0.0') return true;
  const ipv4 = extractIpv4(raw);
  if (!ipv4) return false;
  return isPrivateIpv4(ipv4);
};

const sanitizeHost = (value: unknown): string | undefined => {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;

  const noScheme = raw.replace(/^https?:\/\//i, '');
  const firstPath = noScheme.split('/')[0]?.trim() || '';
  if (!firstPath) return undefined;

  const ipv4 = extractIpv4(firstPath);
  if (ipv4) return ipv4;

  const hostOnly = firstPath.split(':')[0]?.trim().toLowerCase() || '';
  if (!hostOnly || !HOSTNAME_RE.test(hostOnly)) return undefined;
  return hostOnly;
};

const detectClientIpv4 = (req: Request): string | undefined => {
  const forwarded = extractIpv4(req.header('x-forwarded-for'));
  if (forwarded) return forwarded;
  const realIp = extractIpv4(req.header('x-real-ip'));
  if (realIp) return realIp;
  const reqIp = extractIpv4(req.ip);
  if (reqIp) return reqIp;
  const socketIp = extractIpv4(req.socket?.remoteAddress);
  if (socketIp) return socketIp;
  return undefined;
};

const sanitizeShortText = (value: unknown, maxLength: number): string | undefined => {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  if (raw.length <= maxLength) return raw;
  return raw.slice(0, maxLength);
};

const parseMode = (value: unknown): 'TTT' | 'SANDBOX' | 'MURDER' | undefined => {
  const raw = String(value ?? '')
    .trim()
    .toUpperCase();
  if (!raw) return undefined;
  if (raw === 'SANDBOX') return 'SANDBOX';
  if (raw === 'MURDER') return 'MURDER';
  if (raw === 'TTT') return 'TTT';
  return undefined;
};

const parsePort = (value: unknown): number | undefined => {
  const parsed = parseInteger(value);
  if (parsed === undefined) return undefined;
  if (parsed < 1 || parsed > 65535) return undefined;
  return parsed;
};

const parseMaxPlayers = (value: unknown): number | undefined => {
  const parsed = parseInteger(value);
  if (parsed === undefined) return undefined;
  if (parsed < 1 || parsed > 512) return undefined;
  return parsed;
};

const findServerByApiKey = async (apiKey?: string) => {
  if (!apiKey) return null;
  const allServers = await prisma.gameServer.findMany({
    select: { id: true, apiKeyHash: true, ip: true },
  });
  return allServers.find((s) => s.apiKeyHash && compareApiKey(apiKey, s.apiKeyHash)) || null;
};

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

// Preview VIP automation command (does not enqueue actions)
router.post('/actions/vip/preview', authMiddleware, requireRole(UserRole.ADMIN), async (req, res) => {
  try {
    const {
      action,
      steamId,
      vipPlan,
      vipExpiry,
      serverId,
    } = (req as any).body || {};

    const parsedAction = String(action || '').trim().toUpperCase();
    if (parsedAction !== 'GRANT' && parsedAction !== 'REVOKE') {
      return res.status(400).json({ error: 'Invalid action. Use GRANT or REVOKE.' });
    }

    const payload: Parameters<typeof previewVipAutomationBuild>[0] = {
      action: parsedAction as VipAutomationActionType,
      steamId: String(steamId || '').trim(),
      ...(vipPlan !== undefined ? { vipPlan: String(vipPlan) } : {}),
      ...(vipExpiry !== undefined ? { vipExpiry } : {}),
      ...(serverId !== undefined ? { serverId: String(serverId) } : {}),
    };

    const result = await previewVipAutomationBuild(payload);

    if (!result.ok && !result.skipped) {
      return res.status(400).json(result);
    }

    return res.json(result);
  } catch (err: any) {
    console.error('VIP automation preview error', err);
    return res.status(500).json({ error: 'VIP automation preview failed', detail: err?.message });
  }
});

// VIP automation metrics (build failures)
router.get('/actions/vip/metrics', authMiddleware, requireRole(UserRole.ADMIN), async (_req, res) => {
  return res.json(getVipAutomationMetrics());
});

// Heartbeat endpoint for game servers (auth via X-Server-Key)
router.post('/heartbeat', async (req, res) => {
  try {
    const apiKey = (req.header('x-server-key') || req.header('X-Server-Key')) as string | undefined;
    if (!apiKey) {
      return res.status(401).json({ error: 'Missing server API key' });
    }

    const server = await findServerByApiKey(apiKey);
    if (!server) {
      return res.status(403).json({ error: 'Invalid server key' });
    }

    // Body pode chegar como string
    let body: any = (req as any).body;
    if (body && typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        body = undefined;
      }
    }

    const mapRaw = (body && (body.map || body.Map || body.mapName)) || (req.query as any)?.map;
    const map = sanitizeShortText(mapRaw, 128);

    const playerCountRaw =
      (body && (body.playerCount ?? body.PlayerCount ?? body.count)) || (req.query as any)?.playerCount;
    const playerCount = parseInteger(playerCountRaw);

    const serverNameRaw =
      (body && (body.serverName || body.ServerName || body.hostname || body.name)) ||
      (req.query as any)?.serverName;
    const serverName = sanitizeShortText(serverNameRaw, 120);

    const maxPlayersRaw =
      (body && (body.maxPlayers ?? body.MaxPlayers ?? body.max_slots ?? body.slots)) ||
      (req.query as any)?.maxPlayers;
    const maxPlayers = parseMaxPlayers(maxPlayersRaw);

    const modeRaw =
      (body && (body.mode || body.gameMode || body.serverMode)) || (req.query as any)?.mode;
    const mode = parseMode(modeRaw);

    const ipRaw = (body && (body.ip || body.serverIp || body.host)) || (req.query as any)?.ip;
    const reportedHost = sanitizeHost(ipRaw);

    const portRaw = (body && (body.port || body.serverPort)) || (req.query as any)?.port;
    const port = parsePort(portRaw);
    const detectedClientIp = detectClientIpv4(req);
    const shouldAutofillIp = isPlaceholderHost(server.ip);

    const now = new Date();

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
    if (serverName) {
      updateData.name = serverName;
    }
    if (maxPlayers !== undefined) {
      updateData.maxPlayers = maxPlayers;
    }
    if (mode) {
      updateData.mode = mode;
    }
    if (port !== undefined) {
      updateData.port = port;
    }
    if (reportedHost) {
      updateData.ip = reportedHost;
    } else if (shouldAutofillIp && detectedClientIp && !isPrivateIpv4(detectedClientIp)) {
      updateData.ip = detectedClientIp;
    }

    await prisma.gameServer.update({
      where: { id: server.id },
      data: updateData,
    });

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

// Pull pending actions for this server (auth via X-Server-Key)
router.post('/actions/pull', async (req, res) => {
  try {
    const apiKey = (req.header('x-server-key') || req.header('X-Server-Key')) as string | undefined;
    if (!apiKey) {
      return res.status(401).json({ error: 'Missing server API key' });
    }

    const server = await findServerByApiKey(apiKey);
    if (!server) {
      return res.status(403).json({ error: 'Invalid server key' });
    }

    const body = (req as any).body || {};
    const limitRaw = typeof body?.limit === 'number' ? body.limit : Number.parseInt(String(body?.limit || ''), 10);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 20;
    const actions = drainServerActions(server.id, limit);

    return res.json({
      ok: true,
      actions,
    });
  } catch (err: any) {
    console.error('Actions pull error', err);
    return res.status(500).json({ error: 'Actions pull failed', detail: err?.message });
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

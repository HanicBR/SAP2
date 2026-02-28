import { Request, Router } from 'express';
import { prisma } from '../db/client';
import { GameMode, ServerStatus, UserRole } from '../domain';
import { authMiddleware, requireRole } from '../middleware/auth';
import { hashApiKey } from '../utils/apiKey';
import { drainServerActions } from '../services/serverActions';
import { getVipAutomationMetrics, previewVipAutomationBuild, VipAutomationActionType } from '../services/vipAutomation';
import { normalizeIp } from '../utils/normalizeIp';
import { findServerByApiKey } from '../services/serverAuth';
import { getServerWsHealthSnapshot } from '../services/serverWs';
import {
  getPlayerPulseSettings,
  sanitizePlayerPulsePayload,
  resolvePulseTiming,
} from '../services/playtimePulse';

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

const parsePercentEnv = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseFloat(String(value || '').trim());
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(parsed, 100));
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

const MAX_ANALYTICS_LOGS = 120000;
const MAX_ANALYTICS_SNAPSHOTS = 20000;
const MAX_ORPHAN_SESSION_MS = 6 * 60 * 60 * 1000;
const PULSE_MIN_COVERAGE_PCT = parsePercentEnv(process.env.PLAYTIME_PULSE_MIN_COVERAGE_PCT, 60);

const isTrackableSteamId = (value: unknown): value is string => {
  const raw = String(value || '').trim();
  if (!raw) return false;
  const upper = raw.toUpperCase();
  if (upper === 'BOT' || upper === 'CONSOLE' || upper === 'UNKNOWN' || upper === 'NULL') {
    return false;
  }
  return /^STEAM_[0-5]:[01]:\d+$/.test(raw);
};

const parseSessionId = (metadata: any): string | undefined => {
  const raw = String(metadata?.sessionId || metadata?.serverSessionId || '').trim();
  return raw || undefined;
};

const normalizeMapName = (value: unknown): string | undefined => {
  const raw = String(value || '').trim();
  if (!raw) return undefined;
  return raw.length <= 96 ? raw : raw.slice(0, 96);
};

type AnalyticsBucket = {
  startMs: number;
  endMs: number;
  label: string;
};

const buildAnalyticsBuckets = (range: '24h' | '7d' | '30d', since: Date, now: Date): AnalyticsBucket[] => {
  const bucketCount = range === '24h' ? 24 : range === '7d' ? 7 : 30;
  const sinceMs = since.getTime();
  const nowMs = now.getTime();
  const total = Math.max(1, nowMs - sinceMs);
  const bucketMs = total / bucketCount;

  return Array.from({ length: bucketCount }).map((_, idx) => {
    const startMs = Math.floor(sinceMs + idx * bucketMs);
    const endMs = idx === bucketCount - 1 ? nowMs : Math.floor(sinceMs + (idx + 1) * bucketMs);
    const labelDate = new Date(startMs);
    const label =
      range === '24h'
        ? labelDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        : labelDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    return { startMs, endMs, label };
  });
};

const round1 = (value: number): number => Math.round(value * 10) / 10;

type PlaytimeTrendItem = { date: string; hours: number };

type TopPlayerItem = {
  steamId: string;
  name: string;
  avatarUrl: string;
  hours: number;
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
    apiKey: undefined, // never expose API key outside create/regenerate responses
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

router.patch('/:id', authMiddleware, requireRole(UserRole.SUPERADMIN), async (req, res) => {
  const { id } = req.params as { id: string };
  const { ip } = (req as any).body || {};

  const normalizedIp = sanitizeHost(ip);
  if (!normalizedIp) {
    return res.status(400).json({ error: 'Invalid server host/ip' });
  }

  try {
    const updated = await prisma.gameServer.update({
      where: { id },
      data: { ip: normalizedIp },
    });
    return res.json(toDomainServer(updated));
  } catch {
    return res.status(404).json({ error: 'Server not found' });
  }
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

// WebSocket server connectivity health (PR-01 transport bootstrap)
router.get('/ws/health', authMiddleware, requireRole(UserRole.ADMIN), async (_req, res) => {
  return res.json(getServerWsHealthSnapshot());
});

// Playtime pulse settings (contract bootstrap)
router.get('/playtime/config', authMiddleware, requireRole(UserRole.ADMIN), async (_req, res) => {
  return res.json(getPlayerPulseSettings());
});

// Playtime pulse ingestion (PR-02 persistence with per-minute idempotency)
router.post('/pulse', async (req, res) => {
  try {
    const apiKey = (req.header('x-server-key') || req.header('X-Server-Key')) as string | undefined;
    if (!apiKey) {
      return res.status(401).json({ error: 'Missing server API key' });
    }

    const server = await findServerByApiKey(apiKey);
    if (!server) {
      return res.status(403).json({ error: 'Invalid server key' });
    }

    const settings = getPlayerPulseSettings();
    if (!settings.enabled) {
      return res.status(503).json({
        error: 'player_pulse_disabled',
        source: settings.source,
      });
    }

    const payload = sanitizePlayerPulsePayload((req as any).body);
    if (!payload.players.length) {
      return res.status(400).json({ error: 'players_required' });
    }

    const pulseClient = (prisma as any).playerPlaytimePulse as
      | {
          createMany: (args: any) => Promise<{ count: number }>;
        }
      | undefined;

    if (!pulseClient) {
      return res.status(503).json({ error: 'player_pulse_storage_unavailable' });
    }

    const timing = resolvePulseTiming(payload, settings);
    const rows = payload.players.map((player) => ({
      serverId: server.id,
      steamId: player.steamId,
      bucketStart: timing.bucketStart,
      grantedSeconds: timing.grantedSeconds,
      playerName: player.name || null,
      map: payload.map || null,
      playerCount: payload.playerCount ?? null,
      sentAt: timing.sentAt,
      receivedAt: new Date(),
    }));

    const result = await pulseClient.createMany({
      data: rows,
      skipDuplicates: true,
    });

    const inserted = result?.count ?? 0;
    const deduplicated = Math.max(0, rows.length - inserted);

    return res.json({
      ok: true,
      serverId: server.id,
      source: settings.source,
      acceptedPlayers: rows.length,
      intervalSec: timing.intervalSec,
      bucketSec: settings.bucketSec,
      bucketStart: timing.bucketStart.toISOString(),
      grantedSeconds: timing.grantedSeconds,
      persisted: true,
      inserted,
      deduplicated,
    });
  } catch (err: any) {
    console.error('Pulse ingest error', err);
    return res.status(500).json({ error: 'Pulse ingest failed', detail: err?.message });
  }
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
    } else {
      // Avoid stale count when heartbeat arrives without a valid payload.
      updateData.currentPlayers = 0;
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
  const now = new Date();
  const nowMs = now.getTime();
  const hours = range === '24h' ? 24 : range === '7d' ? 24 * 7 : 24 * 30;
  const since = new Date(nowMs - hours * 60 * 60 * 1000);
  const sinceMs = since.getTime();
  const buckets = buildAnalyticsBuckets(range, since, now);
  const bucketCount = buckets.length;
  const bucketMs = Math.max(1, (nowMs - sinceMs) / bucketCount);
  const logs = await prisma.log.findMany({
    where: { serverId: id, timestamp: { gte: since } },
    orderBy: { timestamp: 'asc' },
    select: {
      type: true,
      timestamp: true,
      steamId: true,
      playerName: true,
      metadata: true,
    },
    take: MAX_ANALYTICS_LOGS,
  });
  const lastKnownNameBySteam = new Map<string, string>();
  const eventBreakdownMap = new Map<string, number>();
  const mapChangeCount = new Map<string, number>();
  const connectedPlayers = new Set<string>();
  let lastMapSeen: string | undefined;
  type SessionInterval = { steamId: string; startMs: number; endMs: number };
  const intervals: SessionInterval[] = [];
  const openBySessionId = new Map<string, { steamId: string; startMs: number }>();
  const openBySteamId = new Map<string, number>();
  const openSessionIdsBySteam = new Map<string, Set<string>>();
  const playtimeByPlayerMs = new Map<string, number>();
  const sessionDurationsMs: number[] = [];
  const closeSession = (steamId: string, startMs: number, endMs: number) => {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return;
    const clampedStart = Math.max(startMs, sinceMs);
    const clampedEnd = Math.min(endMs, nowMs);
    if (clampedEnd <= clampedStart) return;
    const duration = clampedEnd - clampedStart;
    intervals.push({ steamId, startMs: clampedStart, endMs: clampedEnd });
    playtimeByPlayerMs.set(steamId, (playtimeByPlayerMs.get(steamId) || 0) + duration);
    sessionDurationsMs.push(duration);
  };

  const rememberSessionOpen = (steamId: string, sessionId: string) => {
    const current = openSessionIdsBySteam.get(steamId) || new Set<string>();
    current.add(sessionId);
    openSessionIdsBySteam.set(steamId, current);
  };

  const forgetSessionOpen = (steamId: string, sessionId: string) => {
    const current = openSessionIdsBySteam.get(steamId);
    if (!current) return;
    current.delete(sessionId);
    if (current.size === 0) {
      openSessionIdsBySteam.delete(steamId);
    }
  };

  const closeOpenSessionsForSteam = (steamId: string, endMs: number, excludeSessionId?: string) => {
    const current = openSessionIdsBySteam.get(steamId);
    if (!current || current.size === 0) return;

    Array.from(current).forEach((sid) => {
      if (excludeSessionId && sid === excludeSessionId) return;
      const opened = openBySessionId.get(sid);
      if (opened) {
        closeSession(steamId, opened.startMs, endMs);
      }
      openBySessionId.delete(sid);
      current.delete(sid);
    });

    if (current.size === 0) {
      openSessionIdsBySteam.delete(steamId);
    } else {
      openSessionIdsBySteam.set(steamId, current);
    }
  };
  logs.forEach((log) => {
    const type = String(log.type || '').toUpperCase();
    const ts = log.timestamp.getTime();
    const metadata = (log.metadata || {}) as any;
    const sessionId = parseSessionId(metadata);
    const mapFromEvent = normalizeMapName(metadata?.map || metadata?.mapName || metadata?.Map || metadata?.level);
    eventBreakdownMap.set(type, (eventBreakdownMap.get(type) || 0) + 1);
    if (mapFromEvent && mapFromEvent !== lastMapSeen) {
      mapChangeCount.set(mapFromEvent, (mapChangeCount.get(mapFromEvent) || 0) + 1);
      lastMapSeen = mapFromEvent;
    }
    if (!isTrackableSteamId(log.steamId)) return;
    const steamId = log.steamId;
    if (log.playerName) {
      lastKnownNameBySteam.set(steamId, log.playerName);
    }
    if (type === 'CONNECT') {
      connectedPlayers.add(steamId);
      if (sessionId) {
        // Repeated CONNECT for same account means previous unresolved session should close here.
        closeOpenSessionsForSteam(steamId, ts, sessionId);

        const openedFallback = openBySteamId.get(steamId);
        if (openedFallback !== undefined) {
          closeSession(steamId, openedFallback, ts);
          openBySteamId.delete(steamId);
        }

        const existing = openBySessionId.get(sessionId);
        if (existing && existing.steamId === steamId) {
          existing.startMs = Math.min(existing.startMs, ts);
        } else {
          openBySessionId.set(sessionId, { steamId, startMs: ts });
          rememberSessionOpen(steamId, sessionId);
        }
      } else {
        closeOpenSessionsForSteam(steamId, ts);

        const openedFallback = openBySteamId.get(steamId);
        if (openedFallback !== undefined) {
          closeSession(steamId, openedFallback, ts);
        }
        openBySteamId.set(steamId, ts);
      }
      return;
    }
    if (type !== 'DISCONNECT') return;
    if (sessionId) {
      const opened = openBySessionId.get(sessionId);
      if (opened && opened.steamId === steamId) {
        closeSession(steamId, opened.startMs, ts);
        openBySessionId.delete(sessionId);
        forgetSessionOpen(steamId, sessionId);
      }
    }
    const startFallback = openBySteamId.get(steamId);
    if (startFallback !== undefined) {
      closeSession(steamId, startFallback, ts);
      openBySteamId.delete(steamId);
    }
    closeOpenSessionsForSteam(steamId, ts);
  });
  openBySessionId.forEach((opened, sid) => {
    // Prevent runaway totals when old sessions never emitted DISCONNECT.
    const safeEnd = Math.min(nowMs, opened.startMs + MAX_ORPHAN_SESSION_MS);
    closeSession(opened.steamId, opened.startMs, safeEnd);
    forgetSessionOpen(opened.steamId, sid);
  });
  openBySteamId.forEach((startMs, steamId) => {
    const safeEnd = Math.min(nowMs, startMs + MAX_ORPHAN_SESSION_MS);
    closeSession(steamId, startMs, safeEnd);
  });
  const totalPlayTimeMs = Array.from(playtimeByPlayerMs.values()).reduce((acc, ms) => acc + ms, 0);
  const totalPlayTimeHours = round1(totalPlayTimeMs / (1000 * 60 * 60));
  const totalSessions = sessionDurationsMs.length;
  const uniquePlayers = new Set([...connectedPlayers, ...Array.from(playtimeByPlayerMs.keys())]).size;
  const avgSessionMinutes = totalSessions
    ? round1(
        sessionDurationsMs.reduce((acc, ms) => acc + ms, 0) / (sessionDurationsMs.length * 1000 * 60),
      )
    : 0;
  const sortedDurations = [...sessionDurationsMs].sort((a, b) => a - b);
  const medianSessionMinutes =
    sortedDurations.length === 0
      ? 0
      : round1(
          ((sortedDurations[Math.floor((sortedDurations.length - 1) / 2)] || 0) +
            (sortedDurations[Math.ceil((sortedDurations.length - 1) / 2)] || 0)) /
            2 /
            (1000 * 60),
        );
  const playerConnectFirstSeen = await prisma.log.groupBy({
    by: ['steamId'],
    where: { serverId: id, type: 'CONNECT', steamId: { not: null } },
    _min: { timestamp: true },
  });
  const newPlayers = playerConnectFirstSeen.reduce((acc, row) => {
    if (!isTrackableSteamId(row.steamId)) return acc;
    const firstSeen = row._min.timestamp;
    if (!firstSeen) return acc;
    return firstSeen.getTime() >= sinceMs ? acc + 1 : acc;
  }, 0);
  const playtimeByBucketMs = Array.from({ length: bucketCount }).map(() => 0);
  intervals.forEach((interval) => {
    for (let idx = 0; idx < bucketCount; idx++) {
      const bucket = buckets[idx];
      if (!bucket) continue;
      const overlapStart = Math.max(interval.startMs, bucket.startMs);
      const overlapEnd = Math.min(interval.endMs, bucket.endMs);
      if (overlapEnd > overlapStart) {
        playtimeByBucketMs[idx] = (playtimeByBucketMs[idx] || 0) + (overlapEnd - overlapStart);
      }
    }
  });
  const playTimeTrend: PlaytimeTrendItem[] = buckets.map((bucket, idx) => ({
    date: bucket.label,
    hours: round1((playtimeByBucketMs[idx] || 0) / (1000 * 60 * 60)),
  }));
  const legacyActiveBucketIndexes = new Set<number>();
  playtimeByBucketMs.forEach((ms, idx) => {
    if ((ms || 0) > 0) legacyActiveBucketIndexes.add(idx);
  });
  const snapshotClient = (prisma as any).playerSnapshot as
    | { findMany: (args: any) => Promise<any[]> }
    | undefined;
  const bucketPlayerTotal = Array.from({ length: bucketCount }).map(() => 0);
  const bucketPlayerSamples = Array.from({ length: bucketCount }).map(() => 0);
  let snapshots: { timestamp: Date; count: number }[] = [];
  if (snapshotClient) {
    snapshots = await snapshotClient.findMany({
      where: { serverId: id, timestamp: { gte: since } },
      orderBy: { timestamp: 'asc' },
      take: MAX_ANALYTICS_SNAPSHOTS,
      select: { timestamp: true, count: true },
    });
  }
  if (snapshots.length) {
    snapshots.forEach((snap) => {
      const ts = snap.timestamp.getTime();
      const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor((ts - sinceMs) / bucketMs)));
      bucketPlayerTotal[idx] = (bucketPlayerTotal[idx] || 0) + Math.max(0, Number(snap.count) || 0);
      bucketPlayerSamples[idx] = (bucketPlayerSamples[idx] || 0) + 1;
    });
  } else {
    intervals.forEach((interval) => {
      for (let idx = 0; idx < bucketCount; idx++) {
        const bucket = buckets[idx];
        if (!bucket) continue;
        const overlapStart = Math.max(interval.startMs, bucket.startMs);
        const overlapEnd = Math.min(interval.endMs, bucket.endMs);
        if (overlapEnd > overlapStart) {
          bucketPlayerTotal[idx] =
            (bucketPlayerTotal[idx] || 0) + (overlapEnd - overlapStart) / (bucket.endMs - bucket.startMs);
        }
      }
    });
    bucketPlayerSamples.forEach((_, idx) => {
      bucketPlayerSamples[idx] = 1;
    });
  }
  const playerCountTrend = buckets.map((bucket, idx) => ({
    date: bucket.label,
    count:
      (bucketPlayerSamples[idx] || 0) > 0
        ? round1((bucketPlayerTotal[idx] || 0) / (bucketPlayerSamples[idx] || 1))
        : 0,
  }));
  const peakPlayersFromTrend = playerCountTrend.reduce((acc, item) => Math.max(acc, item.count), 0);
  const peakPlayersFromSnapshots = snapshots.length
    ? Math.max(...snapshots.map((snap) => Math.max(0, Number(snap.count) || 0)))
    : 0;
  const peakPlayers = Math.max(peakPlayersFromTrend, peakPlayersFromSnapshots);
  const topPlayerIds = Array.from(playtimeByPlayerMs.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([steamId]) => steamId);
  const profiles = topPlayerIds.length
    ? await prisma.playerProfile.findMany({
        where: { steamId: { in: topPlayerIds } },
        select: { steamId: true, name: true, avatarUrl: true },
      })
    : [];
  const profileBySteam = new Map(profiles.map((profile) => [profile.steamId, profile]));
  const topPlayers: TopPlayerItem[] = topPlayerIds.map((steamId) => {
    const profile = profileBySteam.get(steamId);
    const ms = playtimeByPlayerMs.get(steamId) || 0;
    return {
      steamId,
      name: profile?.name || lastKnownNameBySteam.get(steamId) || steamId,
      avatarUrl:
        profile?.avatarUrl ||
        `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(steamId)}`,
      hours: round1(ms / (1000 * 60 * 60)),
    };
  });
  const pulseSettings = getPlayerPulseSettings();
  const pulseClient = (prisma as any).playerPlaytimePulse as
    | {
        groupBy: (args: any) => Promise<any[]>;
        findMany: (args: any) => Promise<any[]>;
      }
    | undefined;

  let pulseCoveragePct = 0;
  let playtimeSource: 'legacy' | 'pulse' = 'legacy';
  let selectedTotalPlayTimeHours = totalPlayTimeHours;
  let selectedPlayTimeTrend = playTimeTrend;
  let selectedTopPlayers = topPlayers;
  let selectedUniquePlayers = uniquePlayers;
  let pulseTotalPlayTimeHours: number | undefined;
  let pulseUniquePlayers: number | undefined;
  let playtimeDecisionReason = pulseSettings.source === 'legacy' ? 'legacy_forced' : 'pulse_no_data_fallback';

  if (pulseClient && pulseSettings.source !== 'legacy') {
    try {
      const pulseWhere = {
        serverId: id,
        bucketStart: { gte: since, lte: now },
      };

      const [pulseByBucket, pulseBySteam] = await Promise.all([
        pulseClient.groupBy({
          by: ['bucketStart'],
          where: pulseWhere,
          _sum: { grantedSeconds: true },
          orderBy: { bucketStart: 'asc' },
        }),
        pulseClient.groupBy({
          by: ['steamId'],
          where: pulseWhere,
          _sum: { grantedSeconds: true },
        }),
      ]);

      const pulseByBucketSeconds = Array.from({ length: bucketCount }).map(() => 0);
      pulseByBucket.forEach((row) => {
        const tsRaw = row?.bucketStart;
        if (!tsRaw) return;
        const ts = new Date(tsRaw).getTime();
        if (!Number.isFinite(ts)) return;
        const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor((ts - sinceMs) / bucketMs)));
        const granted = Math.max(0, Number(row?._sum?.grantedSeconds) || 0);
        pulseByBucketSeconds[idx] = (pulseByBucketSeconds[idx] || 0) + granted;
      });

      const pulseTotalSeconds = pulseByBucketSeconds.reduce((acc, secs) => acc + secs, 0);
      const hasPulseData = pulseTotalSeconds > 0;

      const pulseActiveBucketIndexes = new Set<number>();
      pulseByBucketSeconds.forEach((secs, idx) => {
        if ((secs || 0) > 0) pulseActiveBucketIndexes.add(idx);
      });

      if (legacyActiveBucketIndexes.size > 0) {
        let overlap = 0;
        legacyActiveBucketIndexes.forEach((idx) => {
          if (pulseActiveBucketIndexes.has(idx)) overlap += 1;
        });
        pulseCoveragePct = round1((overlap * 100) / legacyActiveBucketIndexes.size);
      } else if (hasPulseData) {
        pulseCoveragePct = 100;
      }

      pulseTotalPlayTimeHours = round1(pulseTotalSeconds / (60 * 60));
      const pulsePlayTimeTrend: PlaytimeTrendItem[] = buckets.map((bucket, idx) => {
        const hours = round1((pulseByBucketSeconds[idx] || 0) / (60 * 60));
        return {
          date: bucket.label,
          hours,
        };
      });

      pulseUniquePlayers = pulseBySteam.filter((row) => isTrackableSteamId(row?.steamId)).length;
      const sortedPulseBySteam = pulseBySteam
        .filter((row) => isTrackableSteamId(row?.steamId))
        .map((row) => ({
          steamId: String(row.steamId),
          grantedSeconds: Math.max(0, Number(row?._sum?.grantedSeconds) || 0),
        }))
        .sort((a, b) => b.grantedSeconds - a.grantedSeconds);
      const pulseTopIds = sortedPulseBySteam.slice(0, 5).map((row) => row.steamId);

      const [pulseProfiles, latestPulseNames] = await Promise.all([
        pulseTopIds.length
          ? prisma.playerProfile.findMany({
              where: { steamId: { in: pulseTopIds } },
              select: { steamId: true, name: true, avatarUrl: true },
            })
          : Promise.resolve([] as any[]),
        pulseTopIds.length
          ? pulseClient.findMany({
              where: {
                serverId: id,
                steamId: { in: pulseTopIds },
                playerName: { not: null },
              },
              orderBy: [{ bucketStart: 'desc' }, { updatedAt: 'desc' }],
              take: pulseTopIds.length * 10,
              select: { steamId: true, playerName: true, bucketStart: true },
            })
          : Promise.resolve([] as any[]),
      ]);

      const pulseProfileBySteam = new Map<string, { name?: string | null; avatarUrl?: string | null }>(
        pulseProfiles.map((profile) => [profile.steamId, profile]),
      );
      const pulseNameBySteam = new Map<string, string>();
      latestPulseNames.forEach((entry) => {
        const steamId = String(entry?.steamId || '').trim();
        const playerName = String(entry?.playerName || '').trim();
        if (!steamId || !playerName || pulseNameBySteam.has(steamId)) return;
        pulseNameBySteam.set(steamId, playerName);
      });

      const pulseTopPlayers: TopPlayerItem[] = sortedPulseBySteam.slice(0, 5).map((entry) => {
        const profile = pulseProfileBySteam.get(entry.steamId);
        return {
          steamId: entry.steamId,
          name: profile?.name || pulseNameBySteam.get(entry.steamId) || lastKnownNameBySteam.get(entry.steamId) || entry.steamId,
          avatarUrl:
            profile?.avatarUrl ||
            `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(entry.steamId)}`,
          hours: round1(entry.grantedSeconds / (60 * 60)),
        };
      });

      const canUsePulse = hasPulseData;
      const shouldUsePulse =
        pulseSettings.source === 'pulse'
          ? canUsePulse
          : canUsePulse && pulseCoveragePct >= PULSE_MIN_COVERAGE_PCT;

      if (pulseSettings.source === 'hybrid' && canUsePulse && !shouldUsePulse) {
        playtimeDecisionReason = 'hybrid_coverage_below_threshold';
      } else if (pulseSettings.source === 'hybrid' && !canUsePulse) {
        playtimeDecisionReason = 'hybrid_no_pulse_data';
      } else if (pulseSettings.source === 'pulse' && !canUsePulse) {
        playtimeDecisionReason = 'pulse_no_data_fallback';
      }

      if (shouldUsePulse) {
        playtimeSource = 'pulse';
        selectedTotalPlayTimeHours = pulseTotalPlayTimeHours;
        selectedPlayTimeTrend = pulsePlayTimeTrend;
        selectedTopPlayers = pulseTopPlayers;
        selectedUniquePlayers = pulseUniquePlayers;
        playtimeDecisionReason = pulseSettings.source === 'hybrid' ? 'hybrid_coverage_ok' : 'pulse_forced';
      }
    } catch (err: any) {
      console.error('Pulse analytics fallback to legacy', err?.message || err);
      playtimeDecisionReason = 'pulse_query_error_fallback';
    }
  }
  if (playtimeSource === 'legacy' && pulseSettings.source === 'legacy') {
    playtimeDecisionReason = 'legacy_forced';
  }
  const playtimeDiffHours =
    pulseTotalPlayTimeHours !== undefined
      ? round1(pulseTotalPlayTimeHours - totalPlayTimeHours)
      : undefined;
  const playtimeDiffPct =
    pulseTotalPlayTimeHours !== undefined && totalPlayTimeHours > 0
      ? round1((playtimeDiffHours! * 100) / totalPlayTimeHours)
      : undefined;
  const totalMapCycles = Array.from(mapChangeCount.values()).reduce((acc, count) => acc + count, 0);
  const topMaps = Array.from(mapChangeCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({
      name,
      count,
      percentage: totalMapCycles > 0 ? round1((count * 100) / totalMapCycles) : 0,
    }));
  const eventBreakdown = Array.from(eventBreakdownMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({ type, count }));
  const domainServer = toDomainServer(server as any);
  return res.json({
    totalPlayTimeHours: selectedTotalPlayTimeHours,
    totalSessions,
    newPlayers,
    peakPlayers,
    playTimeTrend: selectedPlayTimeTrend,
    playerCountTrend,
    topPlayers: selectedTopPlayers,
    uniquePlayers: selectedUniquePlayers,
    avgSessionMinutes,
    medianSessionMinutes,
    playtimeSource,
    pulseCoveragePct,
    playtimeDiagnostics: {
      configuredSource: pulseSettings.source,
      decisionReason: playtimeDecisionReason,
      hybridMinCoveragePct: PULSE_MIN_COVERAGE_PCT,
      legacyHours: totalPlayTimeHours,
      pulseHours: pulseTotalPlayTimeHours,
      diffHours: playtimeDiffHours,
      diffPct: playtimeDiffPct,
      legacyUniquePlayers: uniquePlayers,
      pulseUniquePlayers,
    },
    topMaps,
    eventBreakdown,
    currentState: {
      status: domainServer.status,
      currentPlayers: domainServer.currentPlayers,
      maxPlayers: domainServer.maxPlayers,
      currentMap: domainServer.currentMap,
      lastHeartbeat: domainServer.lastHeartbeat,
    },
  });
});
export default router;



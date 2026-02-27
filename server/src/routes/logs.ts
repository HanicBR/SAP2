import { Router } from 'express';
import { GameMode as PrismaGameMode, LogType } from '@prisma/client';
import { prisma } from '../db/client';
import { GameMode } from '../domain';

const router = Router();

const toDomainMode = (mode: PrismaGameMode): GameMode =>
  mode === 'SANDBOX' ? GameMode.SANDBOX : mode === 'MURDER' ? GameMode.MURDER : GameMode.TTT;

const normalizeModeParam = (value: unknown): PrismaGameMode | null => {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'ttt') return 'TTT';
  if (raw === 'sandbox') return 'SANDBOX';
  if (raw === 'murder') return 'MURDER';
  return null;
};

const parsePositiveInt = (value: unknown, fallback: number, max: number): number => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
};

const mapLog = (log: any) => ({
  id: log.id,
  serverId: log.serverId,
  gameMode: toDomainMode(log.gameMode as PrismaGameMode),
  type: log.type,
  timestamp: log.timestamp.toISOString(),
  steamId: log.steamId || undefined,
  playerName: log.playerName || undefined,
  rawText: log.rawText,
  metadata: log.metadata,
});

const matchesAdvancedFilters = (
  log: any,
  actorTypeFilter: string | null,
  targetFilter: string | null,
) => {
  const metadata = (log.metadata || {}) as any;

  if (actorTypeFilter) {
    const actorType = String(metadata.actorType || '').trim().toLowerCase();
    if (actorType !== actorTypeFilter) {
      return false;
    }
  }

  if (targetFilter) {
    const targetName = String(metadata.targetName || '').toLowerCase();
    const targetSteamId = String(metadata.targetSteamId || '').toLowerCase();
    const rawText = String(log.rawText || '').toLowerCase();
    if (
      !targetName.includes(targetFilter) &&
      !targetSteamId.includes(targetFilter) &&
      !rawText.includes(targetFilter)
    ) {
      return false;
    }
  }

  return true;
};

const buildBaseWhere = (query: Record<string, unknown>) => {
  const search = String(query.search || '');
  const serverId = String(query.serverId || '');
  const type = String(query.type || '');
  const from = String(query.from || '');
  const to = String(query.to || '');
  const mode = normalizeModeParam(query.mode);

  const where: any = {};

  if (search) {
    where.OR = [
      { playerName: { contains: search, mode: 'insensitive' } },
      { steamId: { contains: search } },
      { rawText: { contains: search, mode: 'insensitive' } },
    ];
  }

  if (serverId) {
    where.serverId = serverId;
  }

  if (mode) {
    where.gameMode = mode;
  }

  if (type && Object.values(LogType).includes(type as LogType)) {
    where.type = type as LogType;
  }

  if (from || to) {
    where.timestamp = {};
    if (from) where.timestamp.gte = new Date(from);
    if (to) where.timestamp.lte = new Date(to);
  }

  return where;
};

router.get('/', async (req, res) => {
  const where = buildBaseWhere(req.query as Record<string, unknown>);
  const take = parsePositiveInt(req.query.limit, 1000, 5000);

  const logs = await prisma.log.findMany({
    where,
    orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
    take,
  });

  return res.json(logs.map(mapLog));
});

router.get('/query', async (req, res) => {
  const where = buildBaseWhere(req.query as Record<string, unknown>);

  const actorTypeFilterRaw = String(req.query.actorType || '')
    .trim()
    .toLowerCase();
  const actorTypeFilter = actorTypeFilterRaw || null;

  const targetFilterRaw = String(req.query.target || '')
    .trim()
    .toLowerCase();
  const targetFilter = targetFilterRaw || null;

  const hasAdvancedFilters = !!actorTypeFilter || !!targetFilter;
  const limit = parsePositiveInt(req.query.limit, 20, 200);
  const page = parsePositiveInt(req.query.page, 1, 100000);
  const cursor = String(req.query.cursor || '').trim() || null;

  if (cursor) {
    const chunkSize = Math.min(Math.max(limit * 3, 100), 500);
    const collected: any[] = [];
    let scanCursor: string | null = cursor;
    let ended = false;
    let guard = 0;

    while (collected.length < limit + 1 && !ended && guard < 2000) {
      guard += 1;

      const batch: any[] = await prisma.log.findMany({
        where,
        orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
        take: chunkSize,
        ...(scanCursor ? { cursor: { id: scanCursor }, skip: 1 } : {}),
      });

      if (!batch.length) {
        ended = true;
        break;
      }

      for (const log of batch) {
        if (matchesAdvancedFilters(log, actorTypeFilter, targetFilter)) {
          collected.push(log);
        }
      }

      scanCursor = batch[batch.length - 1]?.id ?? null;
      if (batch.length < chunkSize) {
        ended = true;
      }
    }

    const hasMore = collected.length > limit;
    const items = hasMore ? collected.slice(0, limit) : collected;
    const nextCursor = hasMore ? items[items.length - 1]?.id || null : null;

    return res.json({
      mode: 'cursor',
      limit,
      hasMore,
      nextCursor,
      items: items.map(mapLog),
    });
  }

  if (!hasAdvancedFilters) {
    const total = await prisma.log.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);
    const skip = (safePage - 1) * limit;

    const logs = await prisma.log.findMany({
      where,
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      skip,
      take: limit,
    });

    return res.json({
      mode: 'page',
      page: safePage,
      limit,
      total,
      totalPages,
      hasMore: safePage < totalPages,
      nextCursor: logs[logs.length - 1]?.id ?? null,
      items: logs.map(mapLog),
    });
  }

  // Advanced filters fallback (metadata-based) done server-side in batches.
  const chunkSize = 500;
  const scanMaxIterations = 2000;
  const countMatches = async (): Promise<number> => {
    let matchedCount = 0;
    let scanCursor: string | null = null;
    let ended = false;
    let guard = 0;

    while (!ended && guard < scanMaxIterations) {
      guard += 1;
      const batch: any[] = await prisma.log.findMany({
        where,
        orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
        take: chunkSize,
        ...(scanCursor ? { cursor: { id: scanCursor }, skip: 1 } : {}),
      });

      if (!batch.length) {
        ended = true;
        break;
      }

      for (const log of batch) {
        if (matchesAdvancedFilters(log, actorTypeFilter, targetFilter)) {
          matchedCount += 1;
        }
      }

      scanCursor = batch[batch.length - 1]?.id ?? null;
      if (batch.length < chunkSize) {
        ended = true;
      }
    }

    return matchedCount;
  };

  const total = await countMatches();
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const skipMatches = (safePage - 1) * limit;
  const selected: any[] = [];
  let matchedSeen = 0;
  let scanCursor: string | null = null;
  let ended = false;
  let guard = 0;

  while (!ended && guard < scanMaxIterations && selected.length < limit) {
    guard += 1;

    const batch: any[] = await prisma.log.findMany({
      where,
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      take: chunkSize,
      ...(scanCursor ? { cursor: { id: scanCursor }, skip: 1 } : {}),
    });

    if (!batch.length) {
      ended = true;
      break;
    }

    for (const log of batch) {
      if (!matchesAdvancedFilters(log, actorTypeFilter, targetFilter)) continue;
      matchedSeen += 1;
      if (matchedSeen > skipMatches) {
        selected.push(log);
        if (selected.length >= limit) break;
      }
    }

    scanCursor = batch[batch.length - 1]?.id ?? null;
    if (batch.length < chunkSize) {
      ended = true;
    }
  }

  return res.json({
    mode: 'page',
    page: safePage,
    limit,
    total,
    totalPages,
    hasMore: safePage < totalPages,
    nextCursor: selected.length ? selected[selected.length - 1].id : null,
    items: selected.map(mapLog),
  });
});

export default router;

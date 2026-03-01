import { Router } from 'express';
import { prisma } from '../db/client';
import { GameMode } from '../domain';
import { PunishmentType, TransactionType } from '@prisma/client';
import { getServerWsHealthSnapshot } from '../services/serverWs';

const router = Router();

const MAX_ACTIVITY_ITEMS = 12;
const MAX_MAP_LOGS_SCAN = 120_000;
const HEARTBEAT_ONLINE_WINDOW_MS = 2 * 60 * 1000;
const WS_IDLE_ONLINE_WINDOW_SEC = 30;
const TRACKABLE_STEAMID_RE = /^STEAM_[0-5]:[01]:\d+$/;

const toDurationMinutes = (duration?: string | null): number => {
  if (!duration) return 0;
  const raw = String(duration || '').trim().toLowerCase();
  if (!raw) return 0;

  const direct = Number.parseInt(raw, 10);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const match = raw.match(/(\d+)/);
  if (!match || !match[1]) return 0;
  const value = Number.parseInt(match[1], 10);
  if (!Number.isFinite(value) || value <= 0) return 0;

  if (raw.includes('hora')) return value * 60;
  if (raw.includes('dia')) return value * 24 * 60;
  return value;
};

const isPunishmentTimedExpired = (date: Date, duration?: string | null): boolean => {
  const minutes = toDurationMinutes(duration);
  if (!minutes) return false;
  return Date.now() >= date.getTime() + minutes * 60 * 1000;
};

const isTrackableSteamId = (value: unknown): value is string => {
  const raw = String(value || '').trim();
  if (!raw) return false;
  const upper = raw.toUpperCase();
  if (upper === 'BOT' || upper === 'CONSOLE' || upper === 'UNKNOWN' || upper === 'NULL') {
    return false;
  }
  return TRACKABLE_STEAMID_RE.test(raw);
};

const normalizeMapName = (metadata: unknown): string | undefined => {
  const meta = (metadata && typeof metadata === 'object' ? metadata : {}) as any;
  const mapName = String(
    meta.map || meta.mapName || meta.Map || meta.level || '',
  ).trim();
  if (!mapName) return undefined;
  return mapName.slice(0, 96);
};

const mapModeKey = (value: string): GameMode => {
  if (value === 'SANDBOX') return GameMode.SANDBOX;
  if (value === 'MURDER') return GameMode.MURDER;
  return GameMode.TTT;
};

const dayKey = (date: Date): string => date.toISOString().slice(0, 10);

const buildSevenDayRange = (now: Date) => {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 6);

  const days: Date[] = [];
  for (let i = 0; i < 7; i += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    days.push(day);
  }
  return { start, days };
};

const mapFeedTypeFromLog = (
  logType: string,
  rawText: string,
): 'INFO' | 'WARNING' | 'SUCCESS' | 'ERROR' => {
  const parsedType = String(logType || '').toUpperCase();
  const parsedText = String(rawText || '').toLowerCase();

  if (
    parsedType === 'PUNISH' ||
    parsedText.includes('ban') ||
    parsedText.includes('kick') ||
    parsedText.includes('gag') ||
    parsedText.includes('mute')
  ) {
    return 'WARNING';
  }

  if (parsedText.includes('error') || parsedText.includes('erro')) {
    return 'ERROR';
  }

  return 'INFO';
};

const trimText = (value: unknown, maxLength = 180): string => {
  const parsed = String(value || '').trim();
  if (!parsed) return '';
  if (parsed.length <= maxLength) return parsed;
  return `${parsed.slice(0, maxLength - 1)}…`;
};

const toMoney = (value: unknown): string => {
  const parsed = Number(value || 0);
  const safe = Number.isFinite(parsed) ? parsed : 0;
  return safe.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const buildEmptyDashboard = (now: Date) => {
  const { days } = buildSevenDayRange(now);
  return {
    generatedAt: now.toISOString(),
    uniquePlayers24h: 0,
    totalConnections: 0,
    roundsPlayed: 0,
    activeBans: 0,
    chartData: days.map((day) => ({
      date: day.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      players: 0,
      rounds: 0,
    })),
    mapStats: {
      [GameMode.TTT]: [],
      [GameMode.MURDER]: [],
      [GameMode.SANDBOX]: [],
    },
    liveActivity: [],
    financialStats: {
      revenueToday: 0,
      revenueMonth: 0,
      transactionsToday: 0,
    },
    opsHealth: {
      totalServers: 0,
      onlineServers: 0,
      offlineServers: 0,
      maintenanceServers: 0,
      currentPlayers: 0,
      maxPlayers: 0,
      wsConnectedServers: 0,
      wsLiveStateServers: 0,
      wsInvalidMessages: 0,
      wsAckErrors: 0,
      actionQueueSize: 0,
    },
    highlights: {
      logs24h: 0,
      punishments24h: 0,
      deactivations24h: 0,
      activeMutes: 0,
      activeGags: 0,
      topEventTypes24h: [],
    },
  };
};

router.get('/', async (_req, res) => {
  const now = new Date();
  const nowMs = now.getTime();
  const dayAgo = new Date(nowMs - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(nowMs - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(nowMs - 30 * 24 * 60 * 60 * 1000);
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  try {
    const wsHealth = getServerWsHealthSnapshot();

    const [
      servers,
      uniquePlayersRows,
      totalConnections,
      roundsPlayed,
      logs24h,
      topEventTypesRows,
      chartRows,
      mapLogs,
      activePunishments,
      punishments24h,
      deactivations24h,
      recentLogs,
      recentTransactions,
      recentVipActions,
      incomeToday,
      expenseToday,
      incomeMonth,
      expenseMonth,
      transactionsToday,
    ] = await Promise.all([
      prisma.gameServer.findMany({
        select: {
          id: true,
          name: true,
          status: true,
          lastHeartbeat: true,
          currentPlayers: true,
          maxPlayers: true,
          currentMap: true,
        },
      }),
      prisma.log.findMany({
        where: {
          timestamp: { gte: dayAgo },
          steamId: { not: null },
        },
        select: { steamId: true },
        distinct: ['steamId'],
      }),
      prisma.log.count({
        where: {
          type: 'CONNECT',
          timestamp: { gte: thirtyDaysAgo },
        },
      }),
      prisma.log.count({
        where: {
          type: 'ROUND_END',
          timestamp: { gte: thirtyDaysAgo },
        },
      }),
      prisma.log.count({
        where: {
          timestamp: { gte: dayAgo },
        },
      }),
      prisma.log.groupBy({
        by: ['type'],
        where: {
          timestamp: { gte: dayAgo },
        },
        _count: { _all: true },
      }),
      prisma.$queryRaw<Array<{ day: Date; unique_players: number | bigint; rounds: number | bigint }>>`
        SELECT
          date_trunc('day', "timestamp") AS day,
          COUNT(DISTINCT "steamId")
            FILTER (
              WHERE "steamId" IS NOT NULL
                AND "steamId" <> ''
                AND UPPER("steamId") NOT IN ('BOT', 'CONSOLE', 'UNKNOWN', 'NULL')
            )::bigint AS unique_players,
          COUNT(*) FILTER (WHERE "type" = 'ROUND_END')::bigint AS rounds
        FROM "Log"
        WHERE "timestamp" >= ${sevenDaysAgo}
        GROUP BY 1
        ORDER BY 1 ASC
      `,
      prisma.log.findMany({
        where: {
          timestamp: { gte: thirtyDaysAgo },
        },
        orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
        take: MAX_MAP_LOGS_SCAN,
        select: {
          serverId: true,
          gameMode: true,
          metadata: true,
        },
      }),
      prisma.punishment.findMany({
        where: {
          active: true,
          type: { in: [PunishmentType.BAN, PunishmentType.MUTE, PunishmentType.GAG] },
        },
        select: {
          type: true,
          date: true,
          duration: true,
        },
      }),
      prisma.punishment.count({
        where: {
          date: { gte: dayAgo },
          type: { in: [PunishmentType.BAN, PunishmentType.MUTE, PunishmentType.GAG, PunishmentType.KICK] },
        },
      }),
      prisma.log.count({
        where: {
          timestamp: { gte: dayAgo },
          type: 'PUNISH',
          metadata: {
            path: ['sourceTag'],
            equals: 'PUNISHMENT_DEACTIVATE',
          } as any,
        } as any,
      }),
      prisma.log.findMany({
        orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
        take: 10,
        select: {
          id: true,
          serverId: true,
          type: true,
          timestamp: true,
          rawText: true,
        },
      }),
      prisma.transaction.findMany({
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        take: 5,
        select: {
          id: true,
          date: true,
          type: true,
          amount: true,
          category: true,
          relatedPlayerName: true,
        },
      }),
      prisma.vipAutomationAction.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 5,
        select: {
          id: true,
          createdAt: true,
          action: true,
          status: true,
          steamId: true,
          serverId: true,
          reason: true,
        },
      }),
      prisma.transaction.aggregate({
        where: { type: TransactionType.INCOME, date: { gte: startOfDay } },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { type: TransactionType.EXPENSE, date: { gte: startOfDay } },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { type: TransactionType.INCOME, date: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { type: TransactionType.EXPENSE, date: { gte: startOfMonth } },
        _sum: { amount: true },
      }),
      prisma.transaction.count({
        where: { date: { gte: startOfDay } },
      }),
    ]);

    const uniquePlayers24h = uniquePlayersRows.reduce((acc, row) => {
      return acc + (isTrackableSteamId(row.steamId) ? 1 : 0);
    }, 0);

    const activeCounts = {
      [PunishmentType.BAN]: 0,
      [PunishmentType.MUTE]: 0,
      [PunishmentType.GAG]: 0,
    };
    activePunishments.forEach((entry) => {
      const date = entry.date instanceof Date ? entry.date : new Date(entry.date);
      if (isPunishmentTimedExpired(date, entry.duration)) return;
      if (entry.type === PunishmentType.BAN) activeCounts[PunishmentType.BAN] += 1;
      if (entry.type === PunishmentType.MUTE) activeCounts[PunishmentType.MUTE] += 1;
      if (entry.type === PunishmentType.GAG) activeCounts[PunishmentType.GAG] += 1;
    });

    const topEventTypes24h = topEventTypesRows
      .map((row) => ({
        type: String(row.type || ''),
        count: Number((row as any)._count?._all || 0),
      }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 6);

    const { days } = buildSevenDayRange(now);
    const chartByDay = new Map<string, { players: number; rounds: number }>();
    chartRows.forEach((row) => {
      const parsedDay = row.day instanceof Date ? row.day : new Date(row.day);
      const key = dayKey(parsedDay);
      chartByDay.set(key, {
        players: Number(row.unique_players || 0),
        rounds: Number(row.rounds || 0),
      });
    });

    const chartData = days.map((day) => {
      const key = dayKey(day);
      const metrics = chartByDay.get(key);
      return {
        date: day.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
        players: metrics?.players || 0,
        rounds: metrics?.rounds || 0,
      };
    });

    const mapCounters: Record<string, Record<string, number>> = {
      [GameMode.TTT]: {},
      [GameMode.MURDER]: {},
      [GameMode.SANDBOX]: {},
    };
    const ensureMapCounterBucket = (mode: string): Record<string, number> => {
      const existing = mapCounters[mode];
      if (existing) return existing;
      mapCounters[mode] = {};
      return mapCounters[mode] as Record<string, number>;
    };
    const lastMapByServerMode = new Map<string, string>();
    mapLogs.forEach((log) => {
      const mode = mapModeKey(String(log.gameMode || 'TTT'));
      const mapName = normalizeMapName(log.metadata);
      if (!mapName) return;
      const key = `${String(log.serverId || 'unknown')}:${mode}`;
      const previousMap = lastMapByServerMode.get(key);
      if (previousMap === mapName) return;
      const bucket = ensureMapCounterBucket(mode);
      bucket[mapName] = (bucket[mapName] || 0) + 1;
      lastMapByServerMode.set(key, mapName);
    });

    const mapStats: Record<string, { name: string; playCount: number; percentage: number }[]> = {
      [GameMode.TTT]: [],
      [GameMode.MURDER]: [],
      [GameMode.SANDBOX]: [],
    };

    (Object.keys(mapCounters) as Array<keyof typeof mapCounters>).forEach((mode) => {
      const bucket = ensureMapCounterBucket(mode);
      const mapEntries = Object.entries(bucket);
      const total = mapEntries.reduce((acc, [, count]) => acc + count, 0);
      mapStats[mode] = mapEntries
        .sort((left, right) => right[1] - left[1])
        .slice(0, 10)
        .map(([name, playCount]) => ({
          name,
          playCount,
          percentage: total > 0 ? Math.round((playCount / total) * 100) : 0,
        }));
    });

    const serverNameById = new Map<string, string>();
    servers.forEach((server) => {
      serverNameById.set(server.id, String(server.name || server.id));
    });

    const liveActivity = [
      ...recentLogs.map((log) => ({
        id: `log_${log.id}`,
        message: trimText(log.rawText || `${log.type}`),
        type: mapFeedTypeFromLog(log.type, log.rawText || ''),
        timestamp: log.timestamp.toISOString(),
        serverName: serverNameById.get(log.serverId) || log.serverId,
      })),
      ...recentTransactions.map((tx) => {
        const base = `${tx.type === 'INCOME' ? 'Receita' : 'Despesa'} registrada: R$ ${toMoney(tx.amount)} (${tx.category})`;
        const detail = tx.relatedPlayerName ? `${base} - ${tx.relatedPlayerName}` : base;
        return {
          id: `tx_${tx.id}`,
          message: trimText(detail),
          type: tx.type === 'INCOME' ? ('SUCCESS' as const) : ('WARNING' as const),
          timestamp: tx.date.toISOString(),
          serverName: 'Financeiro',
        };
      }),
      ...recentVipActions.map((action) => {
        const serverName =
          (action.serverId && serverNameById.get(action.serverId)) || 'VIP Automation';
        const reason = action.reason ? ` - ${action.reason}` : '';
        return {
          id: `vip_${action.id}`,
          message: trimText(
            `VIP ${action.action} ${action.status} para ${action.steamId}${reason}`,
          ),
          type:
            action.status === 'FAILED'
              ? ('ERROR' as const)
              : action.status === 'QUEUED'
              ? ('SUCCESS' as const)
              : ('INFO' as const),
          timestamp: action.createdAt.toISOString(),
          serverName,
        };
      }),
    ]
      .sort(
        (left, right) =>
          new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime(),
      )
      .slice(0, MAX_ACTIVITY_ITEMS);

    const wsFreshServers = new Set(
      (wsHealth.servers || [])
        .filter((entry: any) => Number(entry?.idleSeconds || 99999) <= WS_IDLE_ONLINE_WINDOW_SEC)
        .map((entry: any) => String(entry?.serverId || ''))
        .filter(Boolean),
    );

    let onlineServers = 0;
    let offlineServers = 0;
    let maintenanceServers = 0;
    let currentPlayers = 0;
    let maxPlayers = 0;

    servers.forEach((server) => {
      const parsedMax = Math.max(0, Number(server.maxPlayers || 0));
      maxPlayers += parsedMax;

      if (server.status === 'MAINTENANCE') {
        maintenanceServers += 1;
        return;
      }

      const hbFresh =
        server.lastHeartbeat instanceof Date
          ? nowMs - server.lastHeartbeat.getTime() <= HEARTBEAT_ONLINE_WINDOW_MS
          : false;
      const wsFresh = wsFreshServers.has(server.id);
      if (hbFresh || wsFresh) {
        onlineServers += 1;
        currentPlayers += Math.max(0, Number(server.currentPlayers || 0));
      } else {
        offlineServers += 1;
      }
    });

    const wsInvalidMessages = (wsHealth.servers || []).reduce(
      (acc: number, server: any) => acc + Math.max(0, Number(server?.invalidMessages || 0)),
      0,
    );
    const wsAckErrors = (wsHealth.servers || []).reduce(
      (acc: number, server: any) => acc + Math.max(0, Number(server?.serverActionAckFailed || 0)),
      0,
    );

    const financialStats = {
      revenueToday: Number((incomeToday._sum.amount || 0) - (expenseToday._sum.amount || 0)),
      revenueMonth: Number((incomeMonth._sum.amount || 0) - (expenseMonth._sum.amount || 0)),
      transactionsToday,
    };

    return res.json({
      generatedAt: now.toISOString(),
      uniquePlayers24h,
      totalConnections,
      roundsPlayed,
      activeBans: activeCounts[PunishmentType.BAN],
      chartData,
      mapStats,
      liveActivity,
      financialStats,
      opsHealth: {
        totalServers: servers.length,
        onlineServers,
        offlineServers,
        maintenanceServers,
        currentPlayers,
        maxPlayers,
        wsConnectedServers: Number(wsHealth.connectedServers || 0),
        wsLiveStateServers: Number(wsHealth.serversWithLiveState || 0),
        wsInvalidMessages,
        wsAckErrors,
        actionQueueSize: Number(wsHealth.serverActions?.totalQueueSize || 0),
      },
      highlights: {
        logs24h,
        punishments24h,
        deactivations24h,
        activeMutes: activeCounts[PunishmentType.MUTE],
        activeGags: activeCounts[PunishmentType.GAG],
        topEventTypes24h,
      },
    });
  } catch (err) {
    console.error('dashboard route error', err);
    return res.json(buildEmptyDashboard(now));
  }
});

export default router;

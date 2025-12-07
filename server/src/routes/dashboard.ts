import { Router } from 'express';
import { prisma } from '../db/client';
import { dashboardData as fallbackDashboard } from '../data/analytics';
import { GameMode } from '../domain';
import { TransactionType } from '@prisma/client';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 30);
    const dayAgo = new Date(now.getTime() - 1000 * 60 * 60 * 24);
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const uniquePlayers24h = await prisma.log.findMany({
      where: { timestamp: { gte: dayAgo } },
      select: { steamId: true },
      distinct: ['steamId'],
    });

    const totalConnections = await prisma.log.count({
      where: { type: 'CONNECT' },
    });

    const roundsPlayed = await prisma.log.count({
      where: { type: 'ROUND_END' },
    });

    const activeBans = 0; // Não temos bans ainda; manter 0.

    const chartRaw = await prisma.log.groupBy({
      by: ['serverId'],
      _count: { _all: true },
    });

    const chartData = chartRaw.map((c, idx) => ({
      date: `S${idx + 1}`,
      players: c._count._all,
      rounds: c._count._all,
    }));

    // Live feed: últimos 5 logs
    const lastLogs = await prisma.log.findMany({
      orderBy: { timestamp: 'desc' },
      take: 5,
    });

    const liveActivity = lastLogs.map((l) => ({
      id: l.id,
      message: l.rawText,
      type: 'INFO' as const,
      timestamp: l.timestamp.toISOString(),
      serverName: l.serverId,
    }));

    // Map stats reais nos últimos 30 dias
    const recentLogs = await prisma.log.findMany({
      where: { timestamp: { gte: thirtyDaysAgo } },
    });

    const mapStatsByMode: Record<string, { [map: string]: number }> = {};
    recentLogs.forEach((log) => {
      const mode =
        log.gameMode === 'MURDER'
          ? GameMode.MURDER
          : log.gameMode === 'SANDBOX'
          ? GameMode.SANDBOX
          : GameMode.TTT;
      const meta = (log as any).metadata || {};
      const mapName = meta.map || meta.mapName || meta.Map || meta.level || 'Desconhecido';
      if (!mapStatsByMode[mode]) mapStatsByMode[mode] = {};
      mapStatsByMode[mode][mapName] = (mapStatsByMode[mode][mapName] || 0) + 1;
    });

    const mapStats: Record<string, any[]> = {};
    Object.entries(mapStatsByMode).forEach(([mode, maps]) => {
      const total = Object.values(maps).reduce((acc: number, n: any) => acc + (n as number), 0) || 1;
      mapStats[mode] = Object.entries(maps)
        .sort((a, b) => (b[1] as number) - (a[1] as number))
        .slice(0, 10)
        .map(([name, count]) => ({
          name,
          playCount: count as number,
          percentage: Math.round(((count as number) / total) * 100),
        }));
    });

    // Financial real (somente INCOME)
    const incomeToday = await prisma.transaction.aggregate({
      where: { type: TransactionType.INCOME, date: { gte: startOfDay } },
      _sum: { amount: true },
    });
    const expenseToday = await prisma.transaction.aggregate({
      where: { type: TransactionType.EXPENSE, date: { gte: startOfDay } },
      _sum: { amount: true },
    });
    const incomeMonth = await prisma.transaction.aggregate({
      where: { type: TransactionType.INCOME, date: { gte: startOfMonth } },
      _sum: { amount: true },
    });
    const expenseMonth = await prisma.transaction.aggregate({
      where: { type: TransactionType.EXPENSE, date: { gte: startOfMonth } },
      _sum: { amount: true },
    });
    const transactionsToday = await prisma.transaction.count({
      where: { date: { gte: startOfDay } },
    });
    const financialStats = {
      revenueToday: (incomeToday._sum.amount || 0) - (expenseToday._sum.amount || 0),
      revenueMonth: (incomeMonth._sum.amount || 0) - (expenseMonth._sum.amount || 0),
      transactionsToday,
    };

    return res.json({
      uniquePlayers24h: uniquePlayers24h.filter((p) => p.steamId).length,
      totalConnections,
      roundsPlayed,
      activeBans,
      chartData: chartData.length ? chartData : fallbackDashboard.chartData,
      mapStats: Object.keys(mapStats).length ? mapStats : fallbackDashboard.mapStats,
      liveActivity,
      financialStats,
    });
  } catch (err) {
    console.error('dashboard route error, falling back to mock', err);
    return res.json(fallbackDashboard);
  }
});

export default router;

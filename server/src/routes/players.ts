import { Router } from 'express';
import { prisma } from '../db/client';
import { authMiddleware, requireRole } from '../middleware/auth';
import { UserRole } from '../domain';

const router = Router();

const toPlayer = (p: any) => ({
  steamId: p.steamId,
  name: p.name,
  avatarUrl: p.avatarUrl || undefined,
  lastSeen: p.lastSeen.toISOString(),
  firstSeen: p.firstSeen.toISOString(),
  totalConnections: p.totalConnections,
  playTimeHours: p.playTimeHours,
  isVip: p.isVip,
  vipPlan: p.vipPlan || undefined,
  vipExpiry: p.vipExpiry ? p.vipExpiry.toISOString() : undefined,
  serverStats: p.serverStats || undefined,
});

const getRankFromPoints = (points: number): string => {
  if (points > 10000) return 'Global Elite';
  if (points > 7000) return 'Lenda';
  if (points > 5000) return 'Mestre';
  if (points > 3000) return 'Diamante';
  if (points > 1500) return 'Platina';
  if (points > 800) return 'Ouro';
  if (points > 300) return 'Prata';
  return 'Bronze';
};

const buildGameModeStats = (steamId: string, logs: any[], roundEndLogs?: any[]) => {
  const stats: any = {};

  const byMode = {
    TTT: logs.filter((l) => l.gameMode === 'TTT'),
    MURDER: logs.filter((l) => l.gameMode === 'MURDER'),
    SANDBOX: logs.filter((l) => l.gameMode === 'SANDBOX'),
  };

  const tttLogs = byMode.TTT;
  if (tttLogs.length) {
    const killLogs = tttLogs.filter((l) => l.type === 'KILL');
    let kills = 0;
    let deaths = 0;
    const roundIds = new Set<string>();

    for (const log of tttLogs) {
      const meta = ((log as any).metadata || {}) as any;

      // Rounds em que o jogador participou (qualquer evento com roundId)
      const rid = meta.roundId;
      if (typeof rid === 'string' && rid) {
        roundIds.add(rid);
      }

      // Contagem básica de kills / deaths (apenas em KILL)
      if (log.type === 'KILL') {
        if (meta.attackerSteamId === steamId) {
          kills++;
        }
        if (log.steamId === steamId || meta.victimSteamId === steamId) {
          deaths++;
        }
      }
    }

    const roundsPlayed = roundIds.size;

    // Mapear role principal do jogador por round
    const roleByRound: Record<string, 'traitor' | 'detective' | 'innocent' | undefined> = {};

    const pickRole = (...roles: (string | undefined)[]) => {
      const norm = roles
        .filter(Boolean)
        .map((r) => r!.toString().toLowerCase());
      if (norm.includes('traitor')) return 'traitor' as const;
      if (norm.includes('detective')) return 'detective' as const;
      if (norm.includes('innocent')) return 'innocent' as const;
      return undefined;
    };

    for (const log of tttLogs) {
      const meta = ((log as any).metadata || {}) as any;
      const rid = meta.roundId;
      if (typeof rid !== 'string' || !rid) continue;

      const existing = roleByRound[rid];
      if (existing) continue;

      const baseRole =
        (log as any).steamId === steamId ? (meta.role as string | undefined) : undefined;

      const attackerRole =
        meta.attackerSteamId === steamId ? (meta.attackerRole as string | undefined) : undefined;

      const victimRole =
        meta.victimSteamId === steamId ? (meta.victimRole as string | undefined) : undefined;

      const resolved = pickRole(baseRole, attackerRole, victimRole);
      if (resolved) {
        roleByRound[rid] = resolved;
      }
    }

    // Mapear vencedor por round a partir de ROUND_END
    const winners: Record<string, 'traitor' | 'innocent' | 'timeout' | undefined> = {};
    (roundEndLogs || [])
      .filter((l) => (l.gameMode || '').toString() === 'TTT' && l.type === 'ROUND_END')
      .forEach((log) => {
        const meta = ((log as any).metadata || {}) as any;
        const rid = meta.roundId;
        if (typeof rid !== 'string' || !rid) return;
        const raw = (meta.winner || meta.result || '').toString().toUpperCase();
        if (!raw) return;
        if (raw.includes('TRAITOR')) winners[rid] = 'traitor';
        else if (raw.includes('INNOCENT')) winners[rid] = 'innocent';
        else if (raw.includes('TIME')) winners[rid] = 'timeout';
      });

    let roundsWon = 0;
    let traitorRounds = 0;
    let traitorWins = 0;
    let detectiveRounds = 0;
    let detectiveWins = 0;
    let innocentRounds = 0;
    let innocentWins = 0;

    roundIds.forEach((rid) => {
      const role = roleByRound[rid];
      const winner = winners[rid];
      if (!role) return;

      const isTraitor = role === 'traitor';
      const isDetective = role === 'detective';
      const isInnocent = role === 'innocent';

      if (isTraitor) traitorRounds++;
      if (isDetective) detectiveRounds++;
      if (isInnocent) innocentRounds++;

      let won = false;
      if (winner === 'traitor' && isTraitor) won = true;
      if (winner === 'innocent' && (isInnocent || isDetective)) won = true;
      if (winner === 'timeout' && (isInnocent || isDetective)) won = true;

      if (won) {
        roundsWon++;
        if (isTraitor) traitorWins++;
        if (isDetective) detectiveWins++;
        if (isInnocent) innocentWins++;
      }
    });

    const points = kills * 100 + Math.max(0, kills - deaths) * 20 + roundsPlayed * 10;

    stats.ttt = {
      roundsPlayed,
      roundsWon,
      traitorRounds,
      traitorWins,
      detectiveRounds,
      detectiveWins,
      innocentRounds,
      innocentWins,
      kills,
      deaths,
      points,
      rank: getRankFromPoints(points),
    };
  }

  const murderLogs = byMode.MURDER;
  if (murderLogs.length) {
    const killLogs = murderLogs.filter((l) => l.type === 'KILL');
    const roundIds = new Set<string>();
    const murdererRoundIds = new Set<string>();

    for (const log of killLogs) {
      const meta = ((log as any).metadata || {}) as any;
      const rid = meta.roundId;
      if (typeof rid === 'string' && rid) {
        roundIds.add(rid);
        if (meta.attackerSteamId === steamId) {
          murdererRoundIds.add(rid);
        }
      }
    }

    const roundsPlayed = roundIds.size;
    const murdererRounds = murdererRoundIds.size;
    const murdererWins = murdererRounds;
    const bystanderWins = 0;

    if (roundsPlayed || murdererRounds || murdererWins || bystanderWins) {
      stats.murder = {
        roundsPlayed,
        murdererRounds,
        murdererWins,
        bystanderWins,
      };
    }
  }

  const sandboxLogs = byMode.SANDBOX;
  if (sandboxLogs.length) {
    const propsSpawned = sandboxLogs.filter((l) => l.type === 'PROP_SPAWN').length;
    const totalSessions = sandboxLogs.filter((l) => l.type === 'CONNECT').length;
    const totalPlayTimeHours = 0;

    if (propsSpawned || totalSessions || totalPlayTimeHours) {
      stats.sandbox = {
        totalPlayTimeHours,
        totalSessions,
        propsSpawned,
      };
    }
  }

  return stats;
};

const computePlaytimeHours = (logs: { type: string; timestamp: Date; metadata: unknown }[]): number => {
  if (!logs.length) return 0;

  const sorted = [...logs].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
  );
  const lastTs = sorted[sorted.length - 1]?.timestamp.getTime();
  if (!lastTs) return 0;

  const sessionsById: Record<string, { start?: number; end?: number }> = {};
  let lastConnectFallback: number | undefined;
  let totalMs = 0;

  sorted.forEach((l) => {
    const ts = l.timestamp.getTime();
    const meta: any = l.metadata || {};
    const sessionId: string | undefined = meta.sessionId;

    if (sessionId) {
      if (!sessionsById[sessionId]) sessionsById[sessionId] = {};
      const sess = sessionsById[sessionId];
      if (l.type === 'CONNECT') {
        sess.start = ts;
      } else if (l.type === 'DISCONNECT') {
        sess.end = ts;
      }
    } else {
      if (l.type === 'CONNECT') {
        lastConnectFallback = ts;
      } else if (l.type === 'DISCONNECT' && lastConnectFallback !== undefined) {
        totalMs += Math.max(0, ts - lastConnectFallback);
        lastConnectFallback = undefined;
      }
    }
  });

  Object.values(sessionsById).forEach((s) => {
    if (s.start !== undefined) {
      const end = s.end ?? lastTs;
      totalMs += Math.max(0, end - s.start);
    }
  });

  if (lastConnectFallback !== undefined) {
    totalMs += Math.max(0, lastTs - lastConnectFallback);
  }

  return Math.round(totalMs / (1000 * 60 * 60));
};

router.get('/', async (req, res) => {
  const search = (req.query.search as string) || '';
  const serverFilter = (req.query.serverId as string) || '';
  const vipFilter =
    typeof req.query.isVip === 'string'
      ? req.query.isVip === 'true'
        ? true
        : req.query.isVip === 'false'
        ? false
        : undefined
      : undefined;

  const where: any = {};

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { steamId: { contains: search } },
    ];
  }

  if (vipFilter !== undefined) {
    where.isVip = vipFilter;
  }

  if (serverFilter) {
    where.serverStats = {
      path: [serverFilter],
      not: { equals: null },
    };
  }

  const players = await prisma.playerProfile.findMany({
    where,
    orderBy: { lastSeen: 'desc' },
  });

  return res.json(players.map(toPlayer));
});

router.get('/:steamId', async (req, res) => {
  const { steamId } = req.params as { steamId: string };
  const player = await prisma.playerProfile.findUnique({
    where: { steamId },
    include: { notes: { orderBy: { createdAt: 'desc' } } },
  });

  if (!player) {
    return res.status(404).json({ error: 'Player not found' });
  }

  // Collect logs involving this player (as actor or attacker)
  const logsByActor = await prisma.log.findMany({
    where: { steamId },
    select: {
      gameMode: true,
      type: true,
      metadata: true,
      steamId: true,
      timestamp: true,
    },
  });

  let logsAsAttacker: any[] = [];
  try {
    logsAsAttacker = await prisma.log.findMany({
      where: {
        type: 'KILL',
        // JSON filter by attackerSteamId
        metadata: {
          path: ['attackerSteamId'],
          equals: steamId,
        } as any,
      } as any,
      select: {
        gameMode: true,
        type: true,
        metadata: true,
        steamId: true,
      },
    });
  } catch {
    logsAsAttacker = [];
  }

  const allLogs = [...logsByActor, ...logsAsAttacker];

  // Load ROUND_END logs for TTT to compute wins/derrotas por rodada
  let roundEndLogs: any[] | undefined;
  if (allLogs.length) {
    roundEndLogs = await prisma.log.findMany({
      where: {
        gameMode: 'TTT',
        type: 'ROUND_END',
      },
      select: {
        gameMode: true,
        type: true,
        metadata: true,
      },
    });
  }

  const gameModeStats = allLogs.length
    ? buildGameModeStats(steamId, allLogs, roundEndLogs)
    : {};

  const playTimeHours = computePlaytimeHours(logsByActor as any);

  // Load punishments via raw query to avoid relying on generated Prisma model
  let punishments: any[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    punishments = (await prisma.$queryRaw<any[]>`
      SELECT id, "steamId", type, reason, "staffName", "date", duration, active
      FROM "Punishment"
      WHERE "steamId" = ${steamId}
      ORDER BY "date" DESC
    `) as any[];
  } catch (e) {
    // If the table does not exist or query fails, just return without punishments
    punishments = [];
  }

  return res.json({
    ...toPlayer(player),
    playTimeHours,
    notes: player.notes.map((n) => ({
      id: n.id,
      content: n.content,
      staffName: n.staffName,
      date: n.createdAt.toISOString(),
    })),
    gameModeStats: Object.keys(gameModeStats).length ? gameModeStats : undefined,
    punishments: punishments.map((p) => ({
      id: p.id,
      type: p.type,
      reason: p.reason,
      staffName: p.staffName,
      date: p.date instanceof Date ? p.date.toISOString() : new Date(p.date).toISOString(),
      duration: p.duration || undefined,
      active: Boolean(p.active),
    })),
  });
});

router.post('/:steamId/notes', authMiddleware, requireRole(UserRole.ADMIN), async (req, res) => {
  const { steamId } = req.params as { steamId: string };
  const { content, staffName } = req.body as { content?: string; staffName?: string };

  if (!content || !staffName) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  const player = await prisma.playerProfile.findUnique({ where: { steamId } });
  if (!player) {
    return res.status(404).json({ error: 'Player not found' });
  }

  const note = await prisma.playerNote.create({
    data: {
      steamId,
      content,
      staffName,
    },
  });

  return res.status(201).json({
    id: note.id,
    content: note.content,
    staffName: note.staffName,
    date: note.createdAt.toISOString(),
  });
});

router.patch(
  '/:steamId/notes/:noteId',
  authMiddleware,
  requireRole(UserRole.ADMIN),
  async (req, res) => {
    const { steamId, noteId } = req.params as { steamId: string; noteId: string };
    const { content } = req.body as { content?: string };

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Missing content' });
    }

    const note = await prisma.playerNote.findUnique({ where: { id: noteId } });
    if (!note || note.steamId !== steamId) {
      return res.status(404).json({ error: 'Note not found' });
    }

    const updated = await prisma.playerNote.update({
      where: { id: noteId },
      data: { content },
    });

    return res.json({
      id: updated.id,
      content: updated.content,
      staffName: updated.staffName,
      date: updated.createdAt.toISOString(),
    });
  },
);

router.delete(
  '/:steamId/notes/:noteId',
  authMiddleware,
  requireRole(UserRole.ADMIN),
  async (req, res) => {
    const { steamId, noteId } = req.params as { steamId: string; noteId: string };

    const note = await prisma.playerNote.findUnique({ where: { id: noteId } });
    if (!note || note.steamId !== steamId) {
      return res.status(404).json({ error: 'Note not found' });
    }

    await prisma.playerNote.delete({ where: { id: noteId } });
    return res.status(204).send();
  },
);

router.post(
  '/:steamId/punishments',
  authMiddleware,
  requireRole(UserRole.ADMIN),
  async (req, res) => {
    const { steamId } = req.params as { steamId: string };
    const { type, reason, duration, active, staffName } = req.body as {
      type?: string;
      reason?: string;
      duration?: string;
      active?: boolean;
      staffName?: string;
    };

    if (!type || !reason || !staffName) {
      return res.status(400).json({ error: 'Missing fields' });
    }

    const player = await prisma.playerProfile.findUnique({ where: { steamId } });
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const created = (await prisma.$queryRaw<any[]>`
        INSERT INTO "Punishment" ("steamId","type","reason","staffName","date","duration","active")
        VALUES (${steamId}, ${type}, ${reason}, ${staffName}, NOW(), ${duration ?? null}, ${active ?? true})
        RETURNING id, "steamId", type, reason, "staffName", "date", duration, active
      `) as any[];

      const p = created[0];
      return res.status(201).json({
        id: p.id,
        type: p.type,
        reason: p.reason,
        staffName: p.staffName,
        date: p.date instanceof Date ? p.date.toISOString() : new Date(p.date).toISOString(),
        duration: p.duration || undefined,
        active: Boolean(p.active),
      });
    } catch (e) {
      console.error('Failed to create punishment', e);
      return res.status(500).json({ error: 'Failed to create punishment' });
    }
  },
);

export default router;

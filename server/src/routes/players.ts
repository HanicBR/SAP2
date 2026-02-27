import { Router } from 'express';
import { prisma } from '../db/client';
import { authMiddleware, requireRole } from '../middleware/auth';
import { UserRole } from '../domain';
import { enqueueServerAction } from '../services/serverActions';

const router = Router();
const VALID_PUNISHMENT_TYPES = new Set(['BAN', 'MUTE', 'GAG', 'KICK']);

const toDomainMode = (mode: string): string =>
  mode === 'SANDBOX' ? 'Sandbox' : mode === 'MURDER' ? 'Murder' : 'TTT';

const parsePositiveInt = (value: unknown, fallback: number, max: number): number => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
};

const parseActivityWindowDays = (value: unknown, fallback: 7 | 14 | 30 | 90 = 30): 7 | 14 | 30 | 90 => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (parsed === 7 || parsed === 14 || parsed === 30 || parsed === 90) return parsed;
  return fallback;
};

const quoteConsoleArg = (value: string) => {
  const raw = String(value || '');
  return `"${raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
};

const toDurationMinutes = (duration?: string): number => {
  if (!duration) return 0;
  const raw = String(duration || '').trim().toLowerCase();
  if (!raw) return 0;
  const direct = Number.parseInt(raw, 10);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const match = raw.match(/(\d+)/);
  if (!match) return 0;
  const matchedValue = match[1];
  if (!matchedValue) return 0;
  const value = Number.parseInt(matchedValue, 10);
  if (!Number.isFinite(value) || value <= 0) return 0;

  if (raw.includes('hora')) return value * 60;
  if (raw.includes('dia')) return value * 24 * 60;
  return value;
};

const buildSamPunishmentCommand = (
  type: string,
  steamId: string,
  reason: string,
  duration?: string,
): string | null => {
  const parsedType = String(type || '').toUpperCase();
  const sid = quoteConsoleArg(steamId);
  const parsedReason = quoteConsoleArg(reason || 'Sem motivo');
  const minutes = toDurationMinutes(duration);

  if (parsedType === 'KICK') {
    return `sam kick ${sid} ${parsedReason}`;
  }
  if (parsedType === 'BAN') {
    return `sam banid ${sid} ${Math.max(0, minutes)} ${parsedReason}`;
  }
  if (parsedType === 'MUTE') {
    return `sam mute ${sid} ${Math.max(0, minutes)} ${parsedReason}`;
  }
  if (parsedType === 'GAG') {
    return `sam gag ${sid} ${Math.max(0, minutes)} ${parsedReason}`;
  }
  return null;
};

const buildSamPunishmentDeactivateCommand = (
  type: string,
  steamId: string,
): string | null => {
  const parsedType = String(type || '').toUpperCase();
  const sid = quoteConsoleArg(steamId);

  if (parsedType === 'BAN') return `sam unban ${sid}`;
  if (parsedType === 'MUTE') return `sam unmute ${sid}`;
  if (parsedType === 'GAG') return `sam ungag ${sid}`;
  return null;
};

const punishmentIsTimedExpired = (date: Date, duration?: string | null): boolean => {
  const minutes = toDurationMinutes(duration || undefined);
  if (!minutes) return false;
  const expiresAtMs = date.getTime() + minutes * 60 * 1000;
  return Date.now() >= expiresAtMs;
};

const isPunishmentCurrentlyActive = (
  type: string,
  active: boolean,
  date: Date,
  duration?: string | null,
): boolean => {
  const parsedType = String(type || '').toUpperCase();
  if (!active) return false;
  if (parsedType === 'KICK' || parsedType === 'WARN') return false;

  const minutes = toDurationMinutes(duration || undefined);
  if (!minutes) return true;
  const expiresAtMs = date.getTime() + minutes * 60 * 1000;
  return Date.now() < expiresAtMs;
};

type PunishmentDeactivation = {
  reason?: string;
  at?: string;
  by?: string;
};

const resolvePunishmentStatus = (
  type: string,
  active: boolean,
  date: Date,
  duration?: string | null,
  deactivation?: PunishmentDeactivation,
): 'ACTIVE' | 'REVOKED' | 'EXPIRED' | 'EXECUTED' => {
  const parsedType = String(type || '').toUpperCase();
  if (parsedType === 'KICK' || parsedType === 'WARN') return 'EXECUTED';
  if (deactivation) return 'REVOKED';
  if (punishmentIsTimedExpired(date, duration)) return 'EXPIRED';
  if (!active) return 'REVOKED';
  return 'ACTIVE';
};

const loadPunishmentDeactivations = async (punishmentIds: string[]) => {
  const ids = punishmentIds.filter((id) => String(id || '').trim() !== '');
  const map = new Map<string, PunishmentDeactivation>();
  if (!ids.length) return map;

  const orClauses = ids.map((id) => ({
    metadata: {
      path: ['punishmentId'],
      equals: id,
    } as any,
  }));

  const logs = await prisma.log.findMany({
    where: {
      type: 'PUNISH',
      metadata: {
        path: ['sourceTag'],
        equals: 'PUNISHMENT_DEACTIVATE',
      } as any,
      OR: orClauses as any,
    } as any,
    orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
    select: {
      timestamp: true,
      playerName: true,
      metadata: true,
    },
  });

  logs.forEach((log) => {
    const meta: any = log.metadata || {};
    const punishmentId = String(meta.punishmentId || '').trim();
    if (!punishmentId || map.has(punishmentId)) return;
    const entry: PunishmentDeactivation = {};
    if (meta.reason) entry.reason = String(meta.reason);
    if (log.timestamp) entry.at = log.timestamp.toISOString();
    if (log.playerName) entry.by = String(log.playerName);
    map.set(punishmentId, entry);
  });

  return map;
};

const mapPunishmentRecord = (p: any, deactivation?: PunishmentDeactivation) => {
  const date = p.date instanceof Date ? p.date : new Date(p.date);
  const active = isPunishmentCurrentlyActive(p.type, Boolean(p.active), date, p.duration);
  const status = resolvePunishmentStatus(p.type, active, date, p.duration, deactivation);
  return {
    id: p.id,
    type: p.type,
    reason: p.reason,
    staffName: p.staffName,
    date: date.toISOString(),
    duration: p.duration || undefined,
    active,
    status,
    deactivationReason: deactivation?.reason,
    deactivatedAt: deactivation?.at,
    deactivatedBy: deactivation?.by,
  };
};

const buildPunishmentLogsTargetWhere = (steamId: string, playerName?: string) => {
  const clauses: any[] = [
    {
      metadata: {
        path: ['targetSteamId'],
        equals: steamId,
      } as any,
    },
  ];

  const normalizedName = String(playerName || '').trim();
  if (normalizedName) {
    clauses.push({
      metadata: {
        path: ['targetName'],
        equals: normalizedName,
      } as any,
    });
    clauses.push({
      metadata: {
        path: ['targetName'],
        string_contains: normalizedName,
      } as any,
    });
  }

  return {
    type: 'PUNISH',
    OR: clauses,
  } as any;
};

const mapPunishmentLogRecord = (log: any) => {
  const meta: any = log.metadata || {};
  const timestamp = log.timestamp instanceof Date ? log.timestamp : new Date(log.timestamp);
  const action = String(meta.action || '').trim().toUpperCase();
  const sourceTag = String(meta.sourceTag || '').trim().toUpperCase();

  let parsedType = String(meta.punishmentType || '').trim().toUpperCase();
  if (!parsedType) {
    if (action === 'UNBAN') parsedType = 'BAN';
    else if (action === 'UNMUTE') parsedType = 'MUTE';
    else if (action === 'UNGAG') parsedType = 'GAG';
    else parsedType = action || 'PUNISH';
  }

  const durationText = meta.durationText ? String(meta.durationText) : undefined;
  let status: 'ACTIVE' | 'REVOKED' | 'EXPIRED' | 'EXECUTED' = 'EXECUTED';
  let active = false;

  const isRevocationAction =
    action === 'UNBAN' || action === 'UNMUTE' || action === 'UNGAG' || action === 'UNPUNISH' || sourceTag === 'PUNISHMENT_DEACTIVATE';

  if (isRevocationAction) {
    status = 'REVOKED';
    active = false;
  } else if (parsedType === 'BAN' || parsedType === 'MUTE' || parsedType === 'GAG') {
    if (punishmentIsTimedExpired(timestamp, durationText)) {
      status = 'EXPIRED';
      active = false;
    } else {
      status = 'ACTIVE';
      active = true;
    }
  } else if (parsedType === 'KICK' || parsedType === 'WARN') {
    status = 'EXECUTED';
    active = false;
  }

  const reason =
    meta.reason && String(meta.reason).trim()
      ? String(meta.reason)
      : meta.command && String(meta.command).trim()
      ? String(meta.command)
      : 'Sem motivo';

  return {
    id: `log_${log.id}`,
    type: parsedType,
    reason,
    staffName: String(log.playerName || 'Console'),
    date: timestamp.toISOString(),
    duration: durationText,
    active,
    status,
    deactivationReason: status === 'REVOKED' && meta.reason ? String(meta.reason) : undefined,
    deactivatedAt: status === 'REVOKED' ? timestamp.toISOString() : undefined,
    deactivatedBy: status === 'REVOKED' && log.playerName ? String(log.playerName) : undefined,
  };
};

const mapLog = (log: any) => ({
  id: log.id,
  serverId: log.serverId,
  gameMode: toDomainMode(String(log.gameMode || 'TTT')),
  type: log.type,
  timestamp: log.timestamp.toISOString(),
  steamId: log.steamId || undefined,
  playerName: log.playerName || undefined,
  rawText: log.rawText,
  metadata: log.metadata,
});

const parsePlayerLogScope = (value: unknown): 'actor' | 'target' | 'all' => {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (raw === 'actor' || raw === 'target' || raw === 'all') return raw;
  return 'all';
};

const buildPlayerLogsWhere = (steamId: string, scope: 'actor' | 'target' | 'all') => {
  const actorClauses: any[] = [
    { steamId },
    {
      metadata: {
        path: ['attackerSteamId'],
        equals: steamId,
      } as any,
    },
  ];

  const targetClauses: any[] = [
    {
      metadata: {
        path: ['targetSteamId'],
        equals: steamId,
      } as any,
    },
    {
      metadata: {
        path: ['victimSteamId'],
        equals: steamId,
      } as any,
    },
  ];

  if (scope === 'actor') return { OR: actorClauses };
  if (scope === 'target') return { OR: targetClauses };
  return { OR: [...actorClauses, ...targetClauses] };
};

const isValidIpv4 = (ip?: string | null) => {
  if (!ip) return false;
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    const n = Number(part);
    return !Number.isNaN(n) && n >= 0 && n <= 255;
  });
};

const toSubnet24Prefix = (ip: string) => {
  const parts = ip.split('.');
  return `${parts[0]}.${parts[1]}.${parts[2]}.`;
};

const formatLocation = (geo: any) => {
  if (!geo || typeof geo !== 'object') return 'Localizacao desconhecida';
  const city = typeof geo.city === 'string' ? geo.city : '';
  const state = typeof geo.state === 'string' ? geo.state : '';
  const country = typeof geo.country === 'string' ? geo.country : '';
  const text = [city, state, country].filter(Boolean).join(', ');
  return text || 'Localizacao desconhecida';
};

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
  const seenLogIds = new Set<string>();
  const dedupedLogs = logs.filter((log) => {
    const id = String((log as any)?.id || '');
    if (!id) return true;
    if (seenLogIds.has(id)) return false;
    seenLogIds.add(id);
    return true;
  });

  const byMode = {
    TTT: dedupedLogs.filter((l) => l.gameMode === 'TTT'),
    MURDER: dedupedLogs.filter((l) => l.gameMode === 'MURDER'),
    SANDBOX: dedupedLogs.filter((l) => l.gameMode === 'SANDBOX'),
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

        const rawVal = (meta.winner ?? meta.result) as unknown;
        if (rawVal === undefined || rawVal === null || rawVal === '') return;

        // TTT usa constantes numéricas: WIN_TRAITOR = 2, WIN_INNOCENT = 3, WIN_TIMELIMIT = 4
        const mapNumeric = (n: number) => {
          if (n === 2) return 'traitor' as const;
          if (n === 3) return 'innocent' as const;
          if (n === 4) return 'timeout' as const;
          return undefined;
        };

        let winner: 'traitor' | 'innocent' | 'timeout' | undefined;

        if (typeof rawVal === 'number') {
          winner = mapNumeric(rawVal);
        } else if (typeof rawVal === 'string' && rawVal.trim() !== '') {
          const trimmed = rawVal.trim();
          const maybeNum = parseInt(trimmed, 10);
          if (!Number.isNaN(maybeNum)) {
            winner = mapNumeric(maybeNum);
          } else {
            const upper = trimmed.toUpperCase();
            if (upper.includes('TRAITOR')) winner = 'traitor';
            else if (upper.includes('INNOCENT')) winner = 'innocent';
            else if (upper.includes('TIME')) winner = 'timeout';
          }
        }

        if (winner) {
          winners[rid] = winner;
        }
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
    const roundIds = new Set<string>();
    const roleByRound: Record<string, 'murderer' | 'bystander' | undefined> = {};

    for (const log of murderLogs) {
      const meta = ((log as any).metadata || {}) as any;
      const rid = meta.roundId;
      if (typeof rid !== 'string' || !rid) continue;
      roundIds.add(rid);

      if (roleByRound[rid]) continue;

      const roles = [
        (log as any).steamId === steamId ? (meta.role as string | undefined) : undefined,
        meta.attackerSteamId === steamId ? (meta.attackerRole as string | undefined) : undefined,
        meta.victimSteamId === steamId ? (meta.victimRole as string | undefined) : undefined,
      ]
        .filter(Boolean)
        .map((r) => String(r).toLowerCase());

      if (roles.includes('murderer')) {
        roleByRound[rid] = 'murderer';
      } else if (roles.includes('bystander') || roles.includes('innocent')) {
        roleByRound[rid] = 'bystander';
      }
    }

    const winnersByRound: Record<string, 'murderer' | 'bystander' | undefined> = {};
    (roundEndLogs || [])
      .filter((l) => (l.gameMode || '').toString() === 'MURDER' && l.type === 'ROUND_END')
      .forEach((log) => {
        const meta = ((log as any).metadata || {}) as any;
        const rid = meta.roundId;
        if (typeof rid !== 'string' || !rid) return;

        const rawWinner = String(meta.winner ?? meta.result ?? '')
          .trim()
          .toUpperCase();
        if (!rawWinner) return;
        if (rawWinner.includes('MURDER')) {
          winnersByRound[rid] = 'murderer';
          return;
        }
        if (rawWinner.includes('BYSTANDER') || rawWinner.includes('INNOCENT')) {
          winnersByRound[rid] = 'bystander';
        }
      });

    let murdererRounds = 0;
    let murdererWins = 0;
    let bystanderWins = 0;
    roundIds.forEach((rid) => {
      const role = roleByRound[rid];
      const winner = winnersByRound[rid];

      if (role === 'murderer') {
        murdererRounds += 1;
        if (winner === 'murderer') murdererWins += 1;
        return;
      }

      if (role === 'bystander' && winner === 'bystander') {
        bystanderWins += 1;
      }
    });

    const roundsPlayed = roundIds.size;
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
    const toSafeInt = (value: unknown): number => {
      const parsed = Number.parseInt(String(value ?? ''), 10);
      if (!Number.isFinite(parsed) || parsed < 0) return 0;
      return parsed;
    };

    const directPropSpawnCount = sandboxLogs.filter((l) => l.type === 'PROP_SPAWN').length;
    const burstDroppedTotal = sandboxLogs.reduce((sum, log) => {
      if (log.type !== 'GAME_EVENT') return sum;
      const meta = ((log as any).metadata || {}) as any;
      const eventKind = String(meta.eventKind || '')
        .trim()
        .toUpperCase();
      if (eventKind !== 'PROP_SPAWN_BURST') return sum;
      return sum + toSafeInt(meta.droppedCount);
    }, 0);
    const propsSpawned = directPropSpawnCount + burstDroppedTotal;
    const totalSessions = sandboxLogs.filter((l) => l.type === 'CONNECT').length;
    const sandboxSessionLogs = sandboxLogs.filter(
      (l) => l.type === 'CONNECT' || l.type === 'DISCONNECT',
    );

    const sessionStartsById: Record<string, number> = {};
    let fallbackStart: number | undefined;
    let totalMs = 0;
    const sortedSandboxSessionLogs = [...sandboxSessionLogs].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    sortedSandboxSessionLogs.forEach((log) => {
      const ts = new Date(log.timestamp).getTime();
      const meta = ((log as any).metadata || {}) as any;
      const sessionId = typeof meta.sessionId === 'string' && meta.sessionId ? meta.sessionId : undefined;

      if (log.type === 'CONNECT') {
        if (sessionId) {
          // Treat repeated CONNECT for same session as implicit map-change boundary.
          if (sessionStartsById[sessionId] !== undefined) {
            totalMs += Math.max(0, ts - sessionStartsById[sessionId]);
          }
          sessionStartsById[sessionId] = ts;
        } else {
          // Fallback without sessionId: CONNECT after CONNECT closes previous open segment.
          if (fallbackStart !== undefined) {
            totalMs += Math.max(0, ts - fallbackStart);
          }
          fallbackStart = ts;
        }
        return;
      }

      if (log.type === 'DISCONNECT') {
        if (sessionId && sessionStartsById[sessionId] !== undefined) {
          totalMs += Math.max(0, ts - sessionStartsById[sessionId]);
          delete sessionStartsById[sessionId];
          return;
        }
        if (fallbackStart !== undefined) {
          totalMs += Math.max(0, ts - fallbackStart);
          fallbackStart = undefined;
        }
      }
    });

    // Do not auto-close dangling sessions at "last log timestamp":
    // this can inflate playtime heavily when DISCONNECT is missing.
    const totalPlayTimeHours = Number((totalMs / (1000 * 60 * 60)).toFixed(2));

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

const buildActivityHistory = (
  logs: { id?: string; serverId?: string; type: string; timestamp: Date; metadata: unknown }[],
  days: number,
) => {
  const now = new Date();
  const buckets: Record<
    string,
    { date: string; hoursPlayed: number; sessions: number; serverHours: Record<string, number> }
  > = {};
  const orderedKeys: string[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    orderedKeys.push(key);
    buckets[key] = {
      date: label,
      hoursPlayed: 0,
      sessions: 0,
      serverHours: {},
    };
  }

  const sessionsById: Record<string, { start?: number; dayKey?: string; serverId?: string }> = {};
  const fallbackByServer: Record<string, { start?: number; dayKey?: string }> = {};

  const addDuration = (dayKey: string | undefined, serverId: string | undefined, ms: number) => {
    if (!dayKey || !buckets[dayKey]) return;
    if (ms <= 0) return;
    const parsedServerId = String(serverId || '').trim() || 'unknown';
    const hours = ms / (1000 * 60 * 60);
    buckets[dayKey].hoursPlayed += hours;
    buckets[dayKey].serverHours[parsedServerId] =
      (buckets[dayKey].serverHours[parsedServerId] || 0) + hours;
  };

  logs.forEach((log) => {
    const ts = log.timestamp.getTime();
    const dayKey = log.timestamp.toISOString().slice(0, 10);
    const serverId = String(log.serverId || '').trim() || 'unknown';
    const meta: any = log.metadata || {};
    const sessionId = typeof meta.sessionId === 'string' && meta.sessionId ? meta.sessionId : undefined;

    if (log.type === 'CONNECT') {
      if (buckets[dayKey]) {
        buckets[dayKey].sessions += 1;
      }
      if (sessionId) {
        if (sessionsById[sessionId]?.start !== undefined) {
          const previous = sessionsById[sessionId];
          addDuration(
            previous.dayKey,
            previous.serverId || serverId,
            Math.max(0, ts - (previous.start as number)),
          );
        }
        sessionsById[sessionId] = {
          start: ts,
          dayKey,
          serverId,
        };
      } else {
        if (fallbackByServer[serverId]?.start !== undefined) {
          const previous = fallbackByServer[serverId];
          addDuration(previous.dayKey, serverId, Math.max(0, ts - (previous.start as number)));
        }
        fallbackByServer[serverId] = { start: ts, dayKey };
      }
      return;
    }

    if (log.type === 'DISCONNECT') {
      if (sessionId && sessionsById[sessionId]?.start !== undefined) {
        const started = sessionsById[sessionId];
        addDuration(
          started.dayKey,
          started.serverId || serverId,
          Math.max(0, ts - (started.start as number)),
        );
        delete sessionsById[sessionId];
        return;
      }

      if (fallbackByServer[serverId]?.start !== undefined) {
        const started = fallbackByServer[serverId];
        addDuration(started.dayKey, serverId, Math.max(0, ts - (started.start as number)));
        fallbackByServer[serverId] = {};
      }
    }
  });

  return orderedKeys.map((key) => {
    const bucket = buckets[key] || { date: key, hoursPlayed: 0, sessions: 0, serverHours: {} };
    const serverHours: Record<string, number> = {};
    Object.keys(bucket.serverHours || {}).forEach((serverId) => {
      serverHours[serverId] = Number((bucket.serverHours[serverId] || 0).toFixed(2));
    });
    return {
      date: bucket.date,
      hoursPlayed: Number(bucket.hoursPlayed.toFixed(2)),
      sessions: bucket.sessions,
      serverHours,
    };
  });
};

const countShortSessions = (
  logs: { type: string; timestamp: Date; metadata: unknown }[],
  maxSessionMs: number,
) => {
  const sessionsById: Record<string, number> = {};
  let fallbackStart: number | undefined;
  let shortCount = 0;

  logs.forEach((log) => {
    const ts = log.timestamp.getTime();
    const meta: any = log.metadata || {};
    const sessionId = typeof meta.sessionId === 'string' && meta.sessionId ? meta.sessionId : undefined;

    if (log.type === 'CONNECT') {
      if (sessionId) {
        if (sessionsById[sessionId] !== undefined) {
          const duration = Math.max(0, ts - sessionsById[sessionId]);
          if (duration <= maxSessionMs) shortCount += 1;
        }
        sessionsById[sessionId] = ts;
      } else {
        if (fallbackStart !== undefined) {
          const duration = Math.max(0, ts - fallbackStart);
          if (duration <= maxSessionMs) shortCount += 1;
        }
        fallbackStart = ts;
      }
      return;
    }

    if (log.type === 'DISCONNECT') {
      if (sessionId && sessionsById[sessionId] !== undefined) {
        const duration = Math.max(0, ts - sessionsById[sessionId]);
        if (duration <= maxSessionMs) shortCount += 1;
        delete sessionsById[sessionId];
        return;
      }

      if (fallbackStart !== undefined) {
        const duration = Math.max(0, ts - fallbackStart);
        if (duration <= maxSessionMs) shortCount += 1;
        fallbackStart = undefined;
      }
    }
  });

  return shortCount;
};

const computePlaytimeHours = (logs: { type: string; timestamp: Date; metadata: unknown }[]): number => {
  if (!logs.length) return 0;

  const sessionLogs = logs.filter((log) => log.type === 'CONNECT' || log.type === 'DISCONNECT');
  if (!sessionLogs.length) return 0;

  const sorted = [...sessionLogs].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
  );

  const sessionsById: Record<string, { start?: number }> = {};
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
        if (sess.start !== undefined) {
          totalMs += Math.max(0, ts - sess.start);
        }
        sess.start = ts;
      } else if (l.type === 'DISCONNECT') {
        if (sess.start !== undefined) {
          totalMs += Math.max(0, ts - sess.start);
          delete sessionsById[sessionId];
        }
      }
    } else {
      if (l.type === 'CONNECT') {
        if (lastConnectFallback !== undefined) {
          totalMs += Math.max(0, ts - lastConnectFallback);
        }
        lastConnectFallback = ts;
      } else if (l.type === 'DISCONNECT' && lastConnectFallback !== undefined) {
        totalMs += Math.max(0, ts - lastConnectFallback);
        lastConnectFallback = undefined;
      }
    }
  });

  return Number((totalMs / (1000 * 60 * 60)).toFixed(2));
};

const computeSessionMetricsByServer = (
  logs: { id?: string; serverId: string; type: string; timestamp: Date; metadata: unknown }[],
) => {
  const sessionsById: Record<string, { start?: number; serverId?: string }> = {};
  const fallbackByServer: Record<string, number | undefined> = {};
  const totalsMsByServer: Record<string, number> = {};
  const connectionsByServer: Record<string, number> = {};

  const ensureServer = (serverId: string) => {
    if (!totalsMsByServer[serverId]) totalsMsByServer[serverId] = 0;
    if (!connectionsByServer[serverId]) connectionsByServer[serverId] = 0;
  };

  logs.forEach((log) => {
    const serverId = String(log.serverId || '');
    if (!serverId) return;
    ensureServer(serverId);

    const ts = log.timestamp.getTime();
    const meta: any = log.metadata || {};
    const sessionId = typeof meta.sessionId === 'string' && meta.sessionId ? meta.sessionId : undefined;

    if (log.type === 'CONNECT') {
      connectionsByServer[serverId] = (connectionsByServer[serverId] || 0) + 1;
      if (sessionId) {
        const previous = sessionsById[sessionId];
        if (previous?.start !== undefined && previous.serverId) {
          ensureServer(previous.serverId);
          totalsMsByServer[previous.serverId] =
            (totalsMsByServer[previous.serverId] || 0) + Math.max(0, ts - previous.start);
        }
        sessionsById[sessionId] = { start: ts, serverId };
      } else {
        if (fallbackByServer[serverId] !== undefined) {
          totalsMsByServer[serverId] =
            (totalsMsByServer[serverId] || 0) + Math.max(0, ts - (fallbackByServer[serverId] as number));
        }
        fallbackByServer[serverId] = ts;
      }
      return;
    }

    if (log.type === 'DISCONNECT') {
      if (sessionId && sessionsById[sessionId]?.start !== undefined) {
        const sess = sessionsById[sessionId];
        if (sess.serverId) {
          ensureServer(sess.serverId);
          totalsMsByServer[sess.serverId] =
            (totalsMsByServer[sess.serverId] || 0) + Math.max(0, ts - (sess.start as number));
        }
        delete sessionsById[sessionId];
        return;
      }

      const fallbackStart = fallbackByServer[serverId];
      if (fallbackStart !== undefined) {
        totalsMsByServer[serverId] = (totalsMsByServer[serverId] || 0) + Math.max(0, ts - fallbackStart);
        fallbackByServer[serverId] = undefined;
      }
    }
  });

  const serverStats: Record<string, { playTimeHours: number; connections: number }> = {};
  let totalHours = 0;
  Object.keys(connectionsByServer).forEach((serverId) => {
    const hours = (totalsMsByServer[serverId] || 0) / (1000 * 60 * 60);
    const roundedHours = Number(hours.toFixed(2));
    totalHours += roundedHours;
    serverStats[serverId] = {
      playTimeHours: roundedHours,
      connections: connectionsByServer[serverId] || 0,
    };
  });

  return {
    playTimeHours: Number(totalHours.toFixed(2)),
    serverStats,
  };
};

const MAX_PUNISHMENT_HISTORY_DB_ROWS = 2000;
const MAX_PUNISHMENT_HISTORY_LOG_ROWS = 5000;

const fetchPaginatedPunishments = async (
  steamId: string,
  playerName: string | undefined,
  page: number,
  limit: number,
) => {
  const dbTotalRaw = await prisma.punishment.count({
    where: { steamId },
  });
  const dbTake = Math.min(dbTotalRaw, MAX_PUNISHMENT_HISTORY_DB_ROWS);
  const dbRows = await prisma.punishment.findMany({
    where: { steamId },
    orderBy: [{ date: 'desc' }, { id: 'desc' }],
    take: dbTake,
  });

  const deactivationMap = await loadPunishmentDeactivations(dbRows.map((p) => p.id));
  const dbItems = dbRows.map((p) => mapPunishmentRecord(p, deactivationMap.get(p.id)));
  const dbIdSet = new Set(dbRows.map((p) => p.id));

  const logWhere = buildPunishmentLogsTargetWhere(steamId, playerName);
  const logTotalRaw = await prisma.log.count({
    where: logWhere,
  });
  const logTake = Math.min(logTotalRaw, MAX_PUNISHMENT_HISTORY_LOG_ROWS);
  const logRows = await prisma.log.findMany({
    where: logWhere,
    orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
    take: logTake,
    select: {
      id: true,
      timestamp: true,
      playerName: true,
      metadata: true,
    },
  });

  const logItems = logRows
    .filter((log) => {
      const meta: any = log.metadata || {};
      const sourceTag = String(meta.sourceTag || '').trim().toUpperCase();
      const punishmentId = String(meta.punishmentId || '').trim();
      if (sourceTag === 'PUNISHMENT_DEACTIVATE' && punishmentId && dbIdSet.has(punishmentId)) {
        return false;
      }
      return true;
    })
    .map((log) => mapPunishmentLogRecord(log));

  const combined = [...dbItems, ...logItems].sort((a, b) => {
    const diff = new Date(b.date).getTime() - new Date(a.date).getTime();
    if (diff !== 0) return diff;
    return String(b.id).localeCompare(String(a.id));
  });

  const total = combined.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const skip = (safePage - 1) * limit;
  const items = combined.slice(skip, skip + limit);

  return {
    page: safePage,
    limit,
    total,
    totalPages,
    hasMore: safePage < totalPages,
    items,
  };
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
      id: true,
      serverId: true,
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
        id: true,
        serverId: true,
        gameMode: true,
        type: true,
        metadata: true,
        steamId: true,
        timestamp: true,
      },
    });
  } catch {
    logsAsAttacker = [];
  }

  const allLogs = [...logsByActor, ...logsAsAttacker];

  // Load ROUND_END logs for TTT to compute wins/derrotas por rodada
  let roundEndLogs: any[] | undefined;
  if (allLogs.length) {
    const statsRoundWindowDays = 90;
    const statsRoundSince = new Date(Date.now() - statsRoundWindowDays * 24 * 60 * 60 * 1000);
    roundEndLogs = await prisma.log.findMany({
      where: {
        gameMode: { in: ['TTT', 'MURDER'] },
        type: 'ROUND_END',
        timestamp: { gte: statsRoundSince },
      },
      select: {
        id: true,
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

  const serverSessionLogs = await prisma.log.findMany({
    where: {
      steamId,
      type: { in: ['CONNECT', 'DISCONNECT'] },
    },
    select: {
      id: true,
      serverId: true,
      type: true,
      timestamp: true,
      metadata: true,
    },
    orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
  });
  const sessionMetrics = computeSessionMetricsByServer(serverSessionLogs as any);

  const punishmentsPreview = await fetchPaginatedPunishments(steamId, player.name, 1, 20);

  const activityWindowDays = parseActivityWindowDays(req.query.activityWindowDays, 30);
  const activitySince = new Date(Date.now() - activityWindowDays * 24 * 60 * 60 * 1000);
  const activityLogs = await prisma.log.findMany({
    where: {
      steamId,
      timestamp: { gte: activitySince },
      type: { in: ['CONNECT', 'DISCONNECT'] },
    },
    select: {
      id: true,
      serverId: true,
      type: true,
      timestamp: true,
      metadata: true,
    },
    orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
  });
  const activityHistory = buildActivityHistory(activityLogs as any, activityWindowDays);

  const moderationWindowDays = 30;
  const moderationSince = new Date(Date.now() - moderationWindowDays * 24 * 60 * 60 * 1000);
  const punishLogsTargetWhere = buildPunishmentLogsTargetWhere(steamId, player.name);
  const [chatCount, commandCount, propBurstCount, punishCount, lastPunishLog] = await Promise.all([
    prisma.log.count({
      where: {
        steamId,
        timestamp: { gte: moderationSince },
        type: 'CHAT',
      },
    }),
    prisma.log.count({
      where: {
        steamId,
        timestamp: { gte: moderationSince },
        type: 'COMMAND',
      },
    }),
    prisma.log.count({
      where: {
        steamId,
        timestamp: { gte: moderationSince },
        type: 'GAME_EVENT',
        metadata: {
          path: ['eventKind'],
          equals: 'PROP_SPAWN_BURST',
        } as any,
      } as any,
    }),
    prisma.log.count({
      where: {
        ...punishLogsTargetWhere,
        timestamp: { gte: moderationSince },
      } as any,
    }),
    prisma.log.findFirst({
      where: {
        ...punishLogsTargetWhere,
        timestamp: { gte: moderationSince },
      } as any,
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      select: { timestamp: true },
    }),
  ]);

  const churnWindowMs = 24 * 60 * 60 * 1000;
  const churnSinceMs = Date.now() - churnWindowMs;
  const activityLogs24h = activityLogs.filter((log) => log.timestamp.getTime() >= churnSinceMs);
  const recentConnections24h = activityLogs24h.filter((log) => log.type === 'CONNECT').length;
  const shortSessions24h = countShortSessions(activityLogs24h as any, 2 * 60 * 1000);

  let riskScore = 0;
  const riskReasons: string[] = [];

  if (punishCount >= 3) {
    riskScore += 2;
    riskReasons.push(`Recebeu ${punishCount} punicoes nos ultimos ${moderationWindowDays} dias.`);
  }
  if (propBurstCount >= 2) {
    riskScore += 2;
    riskReasons.push(`Teve ${propBurstCount} eventos de burst de props nos ultimos ${moderationWindowDays} dias.`);
  }
  if (chatCount >= 80 || commandCount >= 40) {
    riskScore += 1;
    riskReasons.push('Volume elevado de chat/comandos no periodo recente.');
  }
  if (recentConnections24h >= 20 || shortSessions24h >= 8) {
    riskScore += 1;
    riskReasons.push('Padrao de conexao/desconexao curto e repetitivo nas ultimas 24h.');
  }

  const riskLevel = riskScore >= 4 ? 'HIGH' : riskScore >= 2 ? 'MEDIUM' : 'LOW';

  return res.json({
    ...toPlayer(player),
    playTimeHours: sessionMetrics.playTimeHours || playTimeHours,
    serverStats: Object.keys(sessionMetrics.serverStats).length
      ? sessionMetrics.serverStats
      : player.serverStats || undefined,
    notes: player.notes.map((n) => ({
      id: n.id,
      content: n.content,
      staffName: n.staffName,
      date: n.createdAt.toISOString(),
    })),
    gameModeStats: Object.keys(gameModeStats).length ? gameModeStats : undefined,
    punishments: punishmentsPreview.items,
    activityHistory,
    moderationSummary: {
      windowDays: moderationWindowDays,
      chatCount,
      commandCount,
      punishCount,
      propBurstCount,
      lastPunishAt: lastPunishLog?.timestamp ? lastPunishLog.timestamp.toISOString() : undefined,
    },
    riskAssessment: {
      level: riskLevel,
      reasons: riskReasons,
      signals: {
        recentConnections24h,
        shortSessions24h,
        punishCount30d: punishCount,
        propBurstCount30d: propBurstCount,
        chatCount30d: chatCount,
        commandCount30d: commandCount,
      },
    },
  });
});

router.get('/:steamId/logs', async (req, res) => {
  const { steamId } = req.params as { steamId: string };
  const scope = parsePlayerLogScope(req.query.scope);
  const limit = parsePositiveInt(req.query.limit, 50, 200);
  const page = parsePositiveInt(req.query.page, 1, 100000);

  const where = buildPlayerLogsWhere(steamId, scope);
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
    scope,
    page: safePage,
    limit,
    total,
    totalPages,
    hasMore: safePage < totalPages,
    nextCursor: logs[logs.length - 1]?.id ?? null,
    items: logs.map(mapLog),
  });
});

router.get('/:steamId/related-accounts', async (req, res) => {
  const { steamId } = req.params as { steamId: string };
  const player = await prisma.playerProfile.findUnique({
    where: { steamId },
  });
  if (!player) {
    return res.status(404).json({ error: 'Player not found' });
  }
  if (!isValidIpv4(player.ip)) {
    return res.json(null);
  }

  const sameIpPlayers = await prisma.playerProfile.findMany({
    where: { ip: player.ip },
    orderBy: { lastSeen: 'desc' },
  });
  if (sameIpPlayers.length >= 2) {
    return res.json({
      id: `ip_${player.ip}`,
      level: 'HIGH',
      commonIpOrSubnet: player.ip,
      location: formatLocation(player.geo),
      lastActivity: sameIpPlayers[0]?.lastSeen?.toISOString?.() || new Date().toISOString(),
      players: sameIpPlayers.map(toPlayer),
    });
  }

  const subnetPrefix = toSubnet24Prefix(player.ip as string);
  const sameSubnetPlayers = await prisma.playerProfile.findMany({
    where: {
      ip: {
        startsWith: subnetPrefix,
      },
    },
    orderBy: { lastSeen: 'desc' },
  });
  const filteredSubnetPlayers = sameSubnetPlayers.filter((p) => isValidIpv4(p.ip));
  if (filteredSubnetPlayers.length >= 2) {
    return res.json({
      id: `subnet_${subnetPrefix}0/24`,
      level: 'MODERATE',
      commonIpOrSubnet: `${subnetPrefix}0/24`,
      location: formatLocation(player.geo),
      lastActivity: filteredSubnetPlayers[0]?.lastSeen?.toISOString?.() || new Date().toISOString(),
      players: filteredSubnetPlayers.map(toPlayer),
    });
  }

  return res.json(null);
});

router.get('/:steamId/punishments', async (req, res) => {
  const { steamId } = req.params as { steamId: string };
  const limit = parsePositiveInt(req.query.limit, 20, 100);
  const page = parsePositiveInt(req.query.page, 1, 100000);

  const player = await prisma.playerProfile.findUnique({
    where: { steamId },
    select: { steamId: true, name: true },
  });
  if (!player) {
    return res.status(404).json({ error: 'Player not found' });
  }

  const paged = await fetchPaginatedPunishments(steamId, player.name, page, limit);

  return res.json({
    mode: 'page',
    page: paged.page,
    limit: paged.limit,
    total: paged.total,
    totalPages: paged.totalPages,
    hasMore: paged.hasMore,
    items: paged.items,
  });
});

router.post('/:steamId/notes', authMiddleware, requireRole(UserRole.ADMIN), async (req, res) => {
  const { steamId } = req.params as { steamId: string };
  const { content, staffName } = req.body as { content?: string; staffName?: string };

  const parsedContent = String(content || '').trim();
  if (!parsedContent) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  const resolvedStaffName =
    String(req.user?.username || '').trim() || String(staffName || '').trim() || 'Sistema';

  const player = await prisma.playerProfile.findUnique({ where: { steamId } });
  if (!player) {
    return res.status(404).json({ error: 'Player not found' });
  }

  const note = await prisma.playerNote.create({
    data: {
      steamId,
      content: parsedContent,
      staffName: resolvedStaffName,
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

    const parsedType = String(type || '').trim().toUpperCase();
    const parsedReason = String(reason || '').trim();
    const parsedDuration = String(duration || '').trim();
    const resolvedStaffName =
      String(req.user?.username || '').trim() || String(staffName || '').trim() || 'Sistema';

    if (!VALID_PUNISHMENT_TYPES.has(parsedType)) {
      return res.status(400).json({ error: 'Invalid punishment type' });
    }
    if (!parsedReason) {
      return res.status(400).json({ error: 'Missing reason' });
    }

    const player = await prisma.playerProfile.findUnique({ where: { steamId } });
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    try {
      const shouldStartActive =
        typeof active === 'boolean'
          ? active
          : parsedType === 'BAN' || parsedType === 'MUTE' || parsedType === 'GAG';

      const p = await prisma.punishment.create({
        data: {
          steamId,
          type: parsedType as any,
          reason: parsedReason,
          staffName: resolvedStaffName,
          duration: parsedType === 'KICK' ? null : parsedDuration || null,
          active: shouldStartActive,
        },
      });

      const latestPlayerLog = await prisma.log.findFirst({
        where: { steamId },
        orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
        select: { serverId: true },
      });

      const command = buildSamPunishmentCommand(parsedType, steamId, parsedReason, parsedDuration || undefined);
      let dispatch: { queued: boolean; serverId?: string; actionId?: string } = { queued: false };
      if (latestPlayerLog?.serverId && command) {
        const action = enqueueServerAction(latestPlayerLog.serverId, command, {
          steamId,
          punishmentType: parsedType,
        });
        if (action) {
          dispatch = {
            queued: true,
            serverId: latestPlayerLog.serverId,
            actionId: action.id,
          };
        }
      }

      return res.status(201).json({
        id: p.id,
        type: p.type,
        reason: p.reason,
        staffName: p.staffName,
        date: p.date.toISOString(),
        duration: p.duration || undefined,
        active: isPunishmentCurrentlyActive(p.type, Boolean(p.active), p.date, p.duration),
        status: resolvePunishmentStatus(
          p.type,
          Boolean(p.active),
          p.date,
          p.duration,
          undefined,
        ),
        dispatch,
      });
    } catch (e) {
      console.error('Failed to create punishment', e);
      return res.status(500).json({ error: 'Failed to create punishment' });
    }
  },
);

router.patch(
  '/:steamId/punishments/:punishmentId/deactivate',
  authMiddleware,
  requireRole(UserRole.ADMIN),
  async (req, res) => {
    const { steamId, punishmentId } = req.params as { steamId: string; punishmentId: string };
    const { reason } = req.body as { reason?: string };
    const parsedReason = String(reason || '').trim();

    const punishment = await prisma.punishment.findUnique({ where: { id: punishmentId } });
    if (!punishment || punishment.steamId !== steamId) {
      return res.status(404).json({ error: 'Punishment not found' });
    }

    const updated = await prisma.punishment.update({
      where: { id: punishmentId },
      data: { active: false },
    });

    const latestPlayerLog = await prisma.log.findFirst({
      where: { steamId },
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      select: { serverId: true, gameMode: true },
    });

    const command = buildSamPunishmentDeactivateCommand(updated.type, steamId);
    let dispatch: { queued: boolean; serverId?: string; actionId?: string } = { queued: false };
    if (latestPlayerLog?.serverId && command) {
      const action = enqueueServerAction(latestPlayerLog.serverId, command, {
        steamId,
        punishmentType: updated.type,
        reason: parsedReason || undefined,
      });
      if (action) {
        dispatch = {
          queued: true,
          serverId: latestPlayerLog.serverId,
          actionId: action.id,
        };
      }
    }

    try {
      const serverContext =
        latestPlayerLog ||
        (await prisma.log.findFirst({
          orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
          select: { serverId: true, gameMode: true },
        }));
      if (serverContext?.serverId && serverContext?.gameMode) {
        const actionLabel =
          updated.type === 'BAN' ? 'UNBAN' : updated.type === 'MUTE' ? 'UNMUTE' : updated.type === 'GAG' ? 'UNGAG' : 'UNPUNISH';
        const actorName = String(req.user?.username || 'Console');
        await prisma.log.create({
          data: {
            serverId: serverContext.serverId,
            gameMode: serverContext.gameMode as any,
            type: 'PUNISH',
            timestamp: new Date(),
            playerName: actorName,
            rawText: `${actorName} removeu ${actionLabel} de ${steamId}${parsedReason ? ` motivo=${parsedReason}` : ''}`,
            metadata: {
              source: 'admin_panel',
              sourceTag: 'PUNISHMENT_DEACTIVATE',
              action: actionLabel,
              targetSteamId: steamId,
              reason: parsedReason || undefined,
              punishmentId,
            } as any,
          } as any,
        });
      }
    } catch {
      // best effort audit event
    }

    return res.json({
      id: updated.id,
      type: updated.type,
      reason: updated.reason,
      staffName: updated.staffName,
      date: updated.date.toISOString(),
      duration: updated.duration || undefined,
      active: false,
      status: 'REVOKED',
      deactivationReason: parsedReason || undefined,
      deactivatedAt: new Date().toISOString(),
      deactivatedBy: String(req.user?.username || 'Console'),
      dispatch,
    });
  },
);

export default router;

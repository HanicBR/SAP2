import dotenv from 'dotenv';
import { prisma } from '../db/client';
import { normalizeIp } from '../utils/normalizeIp';

dotenv.config();

const RAW_TEXT_IP_RE = /(?:^|\s)ip=([0-9]{1,3}(?:\.[0-9]{1,3}){3}(?::\d{1,5})?)(?:\s|$)/i;

type CliOptions = {
  dryRun: boolean;
  limit: number;
  batchSize: number;
  progressEvery: number;
  from?: Date;
  to?: Date;
};

type AggregateItem = {
  steamId: string;
  ip: string;
  firstSeen: Date;
  lastSeen: Date;
  connections: number;
  lastServerId: string | undefined;
};

const parsePositiveInt = (value: string | undefined, fallback: number, max: number): number => {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
};

const parseDateInput = (value: string | undefined): Date | undefined => {
  const raw = String(value || '').trim();
  if (!raw) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`invalid_date_${raw}`);
  }
  return parsed;
};

const parseArgs = (): CliOptions => {
  const args = process.argv.slice(2);
  const map = new Map<string, string>();
  const flags = new Set<string>();

  args.forEach((arg) => {
    const raw = String(arg || '').trim();
    if (!raw) return;
    if (raw.startsWith('--') && raw.includes('=')) {
      const eqIndex = raw.indexOf('=');
      const key = raw.slice(0, eqIndex);
      const value = raw.slice(eqIndex + 1);
      map.set(key, value);
      return;
    }
    flags.add(raw);
  });

  const dryRun = flags.has('--dry-run') || flags.has('--dryrun') || flags.has('-n');
  const limit = parsePositiveInt(map.get('--limit'), 0, 5_000_000);
  const batchSize = parsePositiveInt(map.get('--batch-size'), 1000, 10_000);
  const progressEvery = parsePositiveInt(map.get('--progress-every'), 5000, 100_000);
  const from = parseDateInput(map.get('--from'));
  const to = parseDateInput(map.get('--to'));

  return {
    dryRun,
    limit,
    batchSize,
    progressEvery,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
};

const getIpFromLog = (metadata: unknown, rawText: unknown): string | null => {
  const metadataIp = normalizeIp((metadata as any)?.ip);
  if (metadataIp) return metadataIp;

  const raw = String(rawText || '');
  if (!raw) return null;
  const match = RAW_TEXT_IP_RE.exec(raw);
  if (!match || !match[1]) return null;
  return normalizeIp(match[1]);
};

const shouldReplaceLastServer = (
  existingLastSeen: Date,
  nextLastSeen: Date,
  aggregateLastSeen: Date,
): boolean => {
  if (nextLastSeen.getTime() <= existingLastSeen.getTime()) return false;
  return nextLastSeen.getTime() === aggregateLastSeen.getTime();
};

const run = async () => {
  const startedAt = Date.now();
  const options = parseArgs();

  const historyClient = (prisma as any).playerIpHistory;
  if (!historyClient) {
    throw new Error('player_ip_history_model_not_available');
  }

  const where: any = {
    type: 'CONNECT',
    steamId: {
      not: null,
    },
  };
  if (options.from || options.to) {
    where.timestamp = {
      ...(options.from ? { gte: options.from } : {}),
      ...(options.to ? { lte: options.to } : {}),
    };
  }

  const aggregates = new Map<string, AggregateItem>();
  let cursorId: string | undefined;
  let scanned = 0;
  let kept = 0;
  let ignoredNoSteamId = 0;
  let ignoredNoIp = 0;

  while (true) {
    const batch = await prisma.log.findMany({
      where,
      orderBy: [{ id: 'asc' }],
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      take: options.batchSize,
      select: {
        id: true,
        steamId: true,
        timestamp: true,
        serverId: true,
        rawText: true,
        metadata: true,
      },
    });

    if (!batch.length) break;

    for (const log of batch) {
      if (options.limit > 0 && scanned >= options.limit) break;

      scanned += 1;

      const steamId = String(log.steamId || '').trim();
      if (!steamId) {
        ignoredNoSteamId += 1;
        continue;
      }

      const ip = getIpFromLog(log.metadata, log.rawText);
      if (!ip) {
        ignoredNoIp += 1;
        continue;
      }

      kept += 1;
      const key = `${steamId}::${ip}`;
      const existing = aggregates.get(key);
      if (!existing) {
        aggregates.set(key, {
          steamId,
          ip,
          firstSeen: log.timestamp,
          lastSeen: log.timestamp,
          connections: 1,
          lastServerId: log.serverId || undefined,
        });
      } else {
        if (log.timestamp.getTime() < existing.firstSeen.getTime()) {
          existing.firstSeen = log.timestamp;
        }
        if (log.timestamp.getTime() > existing.lastSeen.getTime()) {
          existing.lastSeen = log.timestamp;
          existing.lastServerId = log.serverId || existing.lastServerId;
        }
        existing.connections += 1;
      }

      if (options.progressEvery > 0 && scanned % options.progressEvery === 0) {
        console.log(
          JSON.stringify({
            stage: 'scan',
            scanned,
            kept,
            ignoredNoSteamId,
            ignoredNoIp,
            aggregateKeys: aggregates.size,
          }),
        );
      }
    }

    cursorId = batch[batch.length - 1]?.id;
    if (!cursorId) break;
    if (options.limit > 0 && scanned >= options.limit) break;
  }

  const scanSummary = {
    scanned,
    kept,
    ignoredNoSteamId,
    ignoredNoIp,
    aggregateKeys: aggregates.size,
  };

  if (options.dryRun) {
    const finishedAt = Date.now();
    console.log(
      JSON.stringify(
        {
          mode: 'dry-run',
          options: {
            dryRun: options.dryRun,
            limit: options.limit,
            batchSize: options.batchSize,
            progressEvery: options.progressEvery,
            from: options.from?.toISOString(),
            to: options.to?.toISOString(),
          },
          scanSummary,
          writeSummary: {
            attempted: 0,
            inserted: 0,
            updated: 0,
            unchanged: 0,
            errors: 0,
          },
          durationMs: finishedAt - startedAt,
        },
        null,
        2,
      ),
    );
    return;
  }

  let attempted = 0;
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let errors = 0;

  for (const aggregate of aggregates.values()) {
    attempted += 1;
    try {
      const existing = await historyClient.findUnique({
        where: {
          steamId_ip: {
            steamId: aggregate.steamId,
            ip: aggregate.ip,
          },
        },
        select: {
          firstSeen: true,
          lastSeen: true,
          connections: true,
          lastServerId: true,
        },
      });

      if (!existing) {
        await historyClient.create({
          data: {
            steamId: aggregate.steamId,
            ip: aggregate.ip,
            firstSeen: aggregate.firstSeen,
            lastSeen: aggregate.lastSeen,
            connections: aggregate.connections,
            lastServerId: aggregate.lastServerId || null,
          },
        });
        inserted += 1;
      } else {
        const nextFirstSeen =
          aggregate.firstSeen.getTime() < existing.firstSeen.getTime()
            ? aggregate.firstSeen
            : existing.firstSeen;
        const nextLastSeen =
          aggregate.lastSeen.getTime() > existing.lastSeen.getTime()
            ? aggregate.lastSeen
            : existing.lastSeen;
        const nextConnections = Math.max(existing.connections, aggregate.connections);
        const nextLastServerId = shouldReplaceLastServer(existing.lastSeen, nextLastSeen, aggregate.lastSeen)
          ? aggregate.lastServerId || existing.lastServerId
          : existing.lastServerId;

        const sameFirst = nextFirstSeen.getTime() === existing.firstSeen.getTime();
        const sameLast = nextLastSeen.getTime() === existing.lastSeen.getTime();
        const sameConnections = nextConnections === existing.connections;
        const sameServerId =
          String(nextLastServerId || '').trim() === String(existing.lastServerId || '').trim();

        if (sameFirst && sameLast && sameConnections && sameServerId) {
          unchanged += 1;
        } else {
          await historyClient.update({
            where: {
              steamId_ip: {
                steamId: aggregate.steamId,
                ip: aggregate.ip,
              },
            },
            data: {
              firstSeen: nextFirstSeen,
              lastSeen: nextLastSeen,
              connections: nextConnections,
              lastServerId: nextLastServerId || null,
            },
          });
          updated += 1;
        }
      }
    } catch (error: any) {
      errors += 1;
      console.error(
        JSON.stringify({
          stage: 'write_error',
          steamId: aggregate.steamId,
          ip: aggregate.ip,
          message: error?.message || String(error),
        }),
      );
    }

    if (options.progressEvery > 0 && attempted % options.progressEvery === 0) {
      console.log(
        JSON.stringify({
          stage: 'write',
          attempted,
          inserted,
          updated,
          unchanged,
          errors,
        }),
      );
    }
  }

  const finishedAt = Date.now();
  console.log(
    JSON.stringify(
      {
        mode: 'apply',
        options: {
          dryRun: options.dryRun,
          limit: options.limit,
          batchSize: options.batchSize,
          progressEvery: options.progressEvery,
          from: options.from?.toISOString(),
          to: options.to?.toISOString(),
        },
        scanSummary,
        writeSummary: {
          attempted,
          inserted,
          updated,
          unchanged,
          errors,
        },
        durationMs: finishedAt - startedAt,
      },
      null,
      2,
    ),
  );
};

void run()
  .catch((error) => {
    console.error(
      JSON.stringify({
        stage: 'fatal',
        message: error?.message || String(error),
      }),
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await prisma.$disconnect();
    } catch {
      // ignore disconnect errors
    }
  });

import { Router } from 'express';
import { prisma } from '../db/client';
import { LogType } from '@prisma/client';
import { GameMode } from '../domain';

const router = Router();

router.get('/', async (req, res) => {
  const search = (req.query.search as string) || '';
  const serverId = (req.query.serverId as string) || '';
  const type = (req.query.type as string) || '';
  const from = (req.query.from as string) || '';
  const to = (req.query.to as string) || '';

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

  if (type && Object.values(LogType).includes(type as LogType)) {
    where.type = type as LogType;
  }

  if (from || to) {
    where.timestamp = {};
    if (from) where.timestamp.gte = new Date(from);
    if (to) where.timestamp.lte = new Date(to);
  }

  const logs = await prisma.log.findMany({
    where,
    orderBy: { timestamp: 'desc' },
    take: 200,
  });

  const toDomainMode = (m: any): GameMode =>
    m === 'SANDBOX' ? GameMode.SANDBOX : m === 'MURDER' ? GameMode.MURDER : GameMode.TTT;

  return res.json(
    logs.map((l) => ({
      id: l.id,
      serverId: l.serverId,
      gameMode: toDomainMode(l.gameMode),
      type: l.type,
      timestamp: l.timestamp.toISOString(),
      steamId: l.steamId || undefined,
      playerName: l.playerName || undefined,
      rawText: l.rawText,
      metadata: l.metadata,
    })),
  );
});

export default router;

import { Router } from 'express';
import { prisma } from '../db/client';
import { authMiddleware, requireRole } from '../middleware/auth';
import { GameMode, UserRole } from '../domain';
import { normalizeEventsForServer, storeLogsAndUpdateProfiles } from '../utils/logIngest';
import { parseLegacyLog } from '../utils/logLegacyParser';

const router = Router();

router.use(authMiddleware);
router.use(requireRole(UserRole.ADMIN));

interface LegacyImportBody {
  serverId?: string;
  content?: string;
  formatHint?: 'AUTO' | 'ULX' | 'TAGGED';
  defaultGameMode?: GameMode | string;
  timezoneOffsetMinutes?: number;
  baseDate?: string;
  dryRun?: boolean;
}

router.post('/import', async (req, res) => {
  const body = req.body as LegacyImportBody;
  const {
    serverId,
    content,
    formatHint = 'AUTO',
    defaultGameMode,
    timezoneOffsetMinutes,
    baseDate,
    dryRun = false,
  } = body;

  if (!serverId || !content || !content.trim()) {
    return res.status(400).json({ error: 'Missing serverId or content' });
  }

  const server = await prisma.gameServer.findUnique({
    where: { id: serverId },
    select: { id: true, mode: true, name: true },
  });

  if (!server) {
    return res.status(404).json({ error: 'Server not found' });
  }

  const parsed = parseLegacyLog(content, {
    defaultGameMode: defaultGameMode || server.mode,
    timezoneOffsetMinutes,
    baseDate,
    formatHint,
  });

  const rawEvents = parsed.events;

  const cleanEvents = normalizeEventsForServer(rawEvents, {
    id: server.id,
    mode: (defaultGameMode || server.mode) as any,
    name: server.name,
  });

  if (!cleanEvents.length) {
    return res.status(400).json({
      error: 'No valid events after parsing',
      format: parsed.format,
      linesParsed: parsed.linesParsed,
      byType: parsed.byType,
      errors: parsed.errors,
    });
  }

  if (dryRun) {
    return res.json({
      format: parsed.format,
      linesParsed: parsed.linesParsed,
      eventsGenerated: rawEvents.length,
      eventsInserted: 0,
      playersTouched: 0,
      byType: parsed.byType,
      dryRun: true,
      errors: parsed.errors,
    });
  }

  const result = await storeLogsAndUpdateProfiles(cleanEvents as any);

  return res.json({
    format: parsed.format,
    linesParsed: parsed.linesParsed,
    eventsGenerated: rawEvents.length,
    eventsInserted: result.ingested,
    playersTouched: result.playersTouched,
    byType: parsed.byType,
    dryRun: false,
    errors: parsed.errors,
  });
});

export default router;


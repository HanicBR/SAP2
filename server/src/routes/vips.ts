import { Router } from 'express';
import { prisma } from '../db/client';
import { VipAutomationActionStatus } from '@prisma/client';
import { authMiddleware, requireRole } from '../middleware/auth';
import { UserRole } from '../domain';
import {
  dispatchVipAutomationAction,
  getVipAutomationAdminConfig,
  setVipAutomationAdminConfig,
} from '../services/vipAutomation';
import { reconcileExpiredVips } from '../services/vipExpiryReconciler';

const router = Router();

router.use(authMiddleware);
router.use(requireRole(UserRole.ADMIN));

const toIso = (value: Date | null | undefined) => (value ? value.toISOString() : undefined);

const parsePositiveInt = (value: unknown, fallback: number, max: number): number => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
};

const parseOptionalDate = (value: unknown): Date | null => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const parseBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const toDispatchPayload = (dispatch: {
  queued: boolean;
  skipped?: boolean;
  reason?: string;
  serverId?: string;
  actionId?: string;
  vipActionId?: string;
}) => ({
  queued: dispatch.queued,
  ...(dispatch.skipped ? { skipped: true } : {}),
  ...(dispatch.reason ? { reason: dispatch.reason } : {}),
  ...(dispatch.serverId ? { serverId: dispatch.serverId } : {}),
  ...(dispatch.actionId ? { actionId: dispatch.actionId } : {}),
  ...(dispatch.vipActionId ? { vipActionId: dispatch.vipActionId } : {}),
});

const parseVipAutomationStatus = (value: unknown): 'ALL' | VipAutomationActionStatus => {
  const normalized = String(value || '')
    .trim()
    .toUpperCase();
  if (!normalized || normalized === 'ALL') return 'ALL';
  if (normalized === VipAutomationActionStatus.QUEUED) return VipAutomationActionStatus.QUEUED;
  if (normalized === VipAutomationActionStatus.FAILED) return VipAutomationActionStatus.FAILED;
  if (normalized === VipAutomationActionStatus.SKIPPED) return VipAutomationActionStatus.SKIPPED;
  return 'ALL';
};

const toVipActionRow = (row: {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  action: string;
  status: string;
  steamId: string;
  vipPlan: string | null;
  vipExpiry: Date | null;
  serverId: string | null;
  command: string | null;
  reason: string | null;
  queuedActionId: string | null;
  retryOfActionId: string | null;
  retriedAt: Date | null;
  retries: number;
}) => ({
  id: row.id,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  action: row.action,
  status: row.status,
  steamId: row.steamId,
  vipPlan: row.vipPlan || undefined,
  vipExpiry: toIso(row.vipExpiry),
  serverId: row.serverId || undefined,
  command: row.command || undefined,
  reason: row.reason || undefined,
  queuedActionId: row.queuedActionId || undefined,
  retryOfActionId: row.retryOfActionId || undefined,
  retriedAt: toIso(row.retriedAt),
  retries: row.retries,
});

router.get('/', async (req, res) => {
  const search = String(req.query.search || '').trim();
  const status = String(req.query.status || 'ALL')
    .trim()
    .toUpperCase();
  const expiringInDays = parsePositiveInt(req.query.expiringInDays, 0, 365);
  const limit = parsePositiveInt(req.query.limit, 100, 500);
  const now = new Date();
  const expiringCutoff =
    expiringInDays > 0 ? new Date(Date.now() + expiringInDays * 24 * 60 * 60 * 1000) : null;

  const where: any = {
    OR: [{ isVip: true }, { vipExpiry: { not: null } }],
  };

  if (search) {
    where.AND = [
      {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { steamId: { contains: search } },
        ],
      },
    ];
  }

  if (status === 'ACTIVE') {
    where.isVip = true;
    where.OR = [{ vipExpiry: null }, { vipExpiry: { gt: now } }];
  } else if (status === 'EXPIRED') {
    where.isVip = true;
    where.vipExpiry = { lte: now };
  }

  if (expiringCutoff) {
    where.isVip = true;
    where.AND = [...(where.AND || []), { vipExpiry: { gt: now, lte: expiringCutoff } }];
  }

  const rows = await prisma.playerProfile.findMany({
    where,
    orderBy: [{ vipExpiry: 'asc' }, { lastSeen: 'desc' }],
    take: limit,
  });

  const items = rows.map((row) => {
    const isExpired = !!row.vipExpiry && row.vipExpiry.getTime() <= Date.now();
    return {
      steamId: row.steamId,
      name: row.name,
      avatarUrl: row.avatarUrl || undefined,
      isVip: row.isVip,
      vipPlan: row.vipPlan || undefined,
      vipExpiry: toIso(row.vipExpiry),
      lastSeen: row.lastSeen.toISOString(),
      vipStatus: row.isVip ? (isExpired ? 'EXPIRED' : 'ACTIVE') : 'INACTIVE',
    };
  });

  return res.json({
    items,
    total: items.length,
  });
});

router.get('/automation-config', async (_req, res) => {
  const config = await getVipAutomationAdminConfig();
  return res.json(config);
});

router.put('/automation-config', async (req, res) => {
  try {
    const body = (req as any).body || {};
    const enabled = parseBoolean(body.enabled, false);
    const grantTemplate = String(body.grantTemplate || '').trim();
    const revokeTemplate = String(body.revokeTemplate || '').trim();
    const sandboxServerId = String(body.sandboxServerId || '').trim() || undefined;

    const updated = await setVipAutomationAdminConfig({
      enabled,
      grantTemplate,
      revokeTemplate,
      ...(sandboxServerId ? { sandboxServerId } : {}),
    });
    return res.json(updated);
  } catch (err: any) {
    return res.status(400).json({
      error: err?.message ? String(err.message) : 'invalid_vip_automation_config',
    });
  }
});

router.get('/actions', async (req, res) => {
  const status = parseVipAutomationStatus(req.query.status);
  const steamId = String(req.query.steamId || '').trim();
  const limit = parsePositiveInt(req.query.limit, 50, 500);

  const rows = await prisma.vipAutomationAction.findMany({
    where: {
      ...(status !== 'ALL' ? { status } : {}),
      ...(steamId ? { steamId: { contains: steamId } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return res.json({
    items: rows.map(toVipActionRow),
    total: rows.length,
  });
});

router.post('/grant', async (req, res) => {
  const {
    steamId,
    name,
    vipPlan,
    vipDurationDays,
    vipExpiry,
    enqueue,
    serverId,
  } = (req as any).body || {};

  const parsedSteamId = String(steamId || '').trim();
  const parsedName = String(name || '').trim();
  const parsedPlan = String(vipPlan || '').trim();
  const parsedServerId = String(serverId || '').trim();
  const durationDays = parsePositiveInt(vipDurationDays, 30, 3650);
  const explicitExpiry = parseOptionalDate(vipExpiry);

  if (!parsedSteamId || !parsedPlan) {
    return res.status(400).json({ error: 'steamId and vipPlan are required' });
  }

  const expiry = explicitExpiry || new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

  const updated = await prisma.playerProfile.upsert({
    where: { steamId: parsedSteamId },
    create: {
      steamId: parsedSteamId,
      name: parsedName || parsedSteamId,
      avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(parsedSteamId)}`,
      firstSeen: new Date(),
      lastSeen: new Date(),
      totalConnections: 0,
      playTimeHours: 0,
      isVip: true,
      vipPlan: parsedPlan,
      vipExpiry: expiry,
    },
    update: {
      ...(parsedName ? { name: parsedName } : {}),
      isVip: true,
      vipPlan: parsedPlan,
      vipExpiry: expiry,
    },
  });

  let dispatch:
    | {
        queued: boolean;
        skipped?: boolean;
        reason?: string;
        serverId?: string;
        actionId?: string;
        vipActionId?: string;
      }
    | undefined;

  if (enqueue !== false) {
    const result = await dispatchVipAutomationAction({
      action: 'GRANT',
      steamId: parsedSteamId,
      vipPlan: parsedPlan,
      vipExpiry: expiry,
      ...(parsedServerId ? { serverId: parsedServerId } : {}),
      metadata: {
        trigger: 'vip_admin_grant',
        actor: req.user?.username || 'system',
      },
    });

    dispatch = toDispatchPayload(result);
  }

  return res.status(201).json({
    steamId: updated.steamId,
    name: updated.name,
    isVip: updated.isVip,
    vipPlan: updated.vipPlan || undefined,
    vipExpiry: toIso(updated.vipExpiry),
    ...(dispatch ? { dispatch } : {}),
  });
});

router.post('/extend', async (req, res) => {
  const {
    steamId,
    vipPlan,
    vipDurationDays,
    enqueue,
    serverId,
  } = (req as any).body || {};

  const parsedSteamId = String(steamId || '').trim();
  const parsedPlan = String(vipPlan || '').trim();
  const parsedServerId = String(serverId || '').trim();
  const durationDays = parsePositiveInt(vipDurationDays, 30, 3650);

  if (!parsedSteamId) {
    return res.status(400).json({ error: 'steamId is required' });
  }

  const player = await prisma.playerProfile.findUnique({ where: { steamId: parsedSteamId } });
  if (!player) {
    return res.status(404).json({ error: 'Player not found' });
  }

  const now = new Date();
  const base = player.vipExpiry && player.vipExpiry.getTime() > now.getTime() ? player.vipExpiry : now;
  const nextExpiry = new Date(base.getTime() + durationDays * 24 * 60 * 60 * 1000);
  const nextPlan = parsedPlan || player.vipPlan || 'VIP';

  const updated = await prisma.playerProfile.update({
    where: { steamId: parsedSteamId },
    data: {
      isVip: true,
      vipPlan: nextPlan,
      vipExpiry: nextExpiry,
    },
  });

  let dispatch:
    | {
        queued: boolean;
        skipped?: boolean;
        reason?: string;
        serverId?: string;
        actionId?: string;
        vipActionId?: string;
      }
    | undefined;

  if (enqueue !== false) {
    const result = await dispatchVipAutomationAction({
      action: 'GRANT',
      steamId: parsedSteamId,
      vipPlan: nextPlan,
      vipExpiry: nextExpiry,
      ...(parsedServerId ? { serverId: parsedServerId } : {}),
      metadata: {
        trigger: 'vip_admin_extend',
        actor: req.user?.username || 'system',
      },
    });

    dispatch = toDispatchPayload(result);
  }

  return res.json({
    steamId: updated.steamId,
    name: updated.name,
    isVip: updated.isVip,
    vipPlan: updated.vipPlan || undefined,
    vipExpiry: toIso(updated.vipExpiry),
    ...(dispatch ? { dispatch } : {}),
  });
});

router.post('/revoke', async (req, res) => {
  const { steamId, enqueue, serverId, reason } = (req as any).body || {};

  const parsedSteamId = String(steamId || '').trim();
  const parsedServerId = String(serverId || '').trim();
  const parsedReason = String(reason || '').trim();

  if (!parsedSteamId) {
    return res.status(400).json({ error: 'steamId is required' });
  }

  const player = await prisma.playerProfile.findUnique({ where: { steamId: parsedSteamId } });
  if (!player) {
    return res.status(404).json({ error: 'Player not found' });
  }

  const updated = await prisma.playerProfile.update({
    where: { steamId: parsedSteamId },
    data: {
      isVip: false,
      vipPlan: null,
      vipExpiry: null,
    },
  });

  let dispatch:
    | {
        queued: boolean;
        skipped?: boolean;
        reason?: string;
        serverId?: string;
        actionId?: string;
        vipActionId?: string;
      }
    | undefined;

  if (enqueue !== false) {
    const result = await dispatchVipAutomationAction({
      action: 'REVOKE',
      steamId: parsedSteamId,
      ...(parsedServerId ? { serverId: parsedServerId } : {}),
      metadata: {
        trigger: 'vip_admin_revoke',
        actor: req.user?.username || 'system',
        ...(parsedReason ? { reason: parsedReason } : {}),
      },
    });

    dispatch = toDispatchPayload(result);
  }

  return res.json({
    steamId: updated.steamId,
    name: updated.name,
    isVip: updated.isVip,
    vipPlan: updated.vipPlan || undefined,
    vipExpiry: toIso(updated.vipExpiry),
    ...(dispatch ? { dispatch } : {}),
  });
});

router.post('/actions/:id/retry', async (req, res) => {
  const { id } = req.params as { id: string };
  const body = (req as any).body || {};
  const overrideServerId = String(body.serverId || '').trim();

  const action = await prisma.vipAutomationAction.findUnique({
    where: { id },
  });

  if (!action) {
    return res.status(404).json({ error: 'VIP action not found' });
  }

  if (action.status === VipAutomationActionStatus.QUEUED) {
    return res.status(400).json({ error: 'queued_action_cannot_be_retried' });
  }

  const metadataSource =
    action.metadata && typeof action.metadata === 'object' && !Array.isArray(action.metadata)
      ? (action.metadata as Record<string, unknown>)
      : {};

  const dispatch = await dispatchVipAutomationAction({
    action: action.action === 'REVOKE' ? 'REVOKE' : 'GRANT',
    steamId: action.steamId,
    ...(action.vipPlan ? { vipPlan: action.vipPlan } : {}),
    ...(action.vipExpiry ? { vipExpiry: action.vipExpiry } : {}),
    ...((overrideServerId || action.serverId) ? { serverId: overrideServerId || action.serverId } : {}),
    retryOfActionId: action.id,
    metadata: {
      ...metadataSource,
      trigger: 'vip_admin_retry',
      actor: req.user?.username || 'system',
      retryOfActionId: action.id,
    },
  });

  await prisma.vipAutomationAction.update({
    where: { id: action.id },
    data: {
      retries: { increment: 1 },
      retriedAt: new Date(),
    },
  });

  return res.json({
    id: action.id,
    dispatch: toDispatchPayload(dispatch),
  });
});

router.post('/reconcile-expired', async (req, res) => {
  const body = (req as any).body || {};
  const dryRun = parseBoolean(body.dryRun, false);
  const enqueue = parseBoolean(body.enqueue, true);
  const limit = parsePositiveInt(body.limit, 100, 500);
  const serverId = String(body.serverId || '').trim();

  const summary = await reconcileExpiredVips({
    dryRun,
    enqueue,
    limit,
    ...(serverId ? { serverId } : {}),
    actor: req.user?.username || 'system',
    trigger: 'vip_admin_reconcile_expired',
  });

  return res.json(summary);
});

export default router;

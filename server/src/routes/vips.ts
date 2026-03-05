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
router.use(requireRole(UserRole.SUPERADMIN));

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

const parseOptionalPositiveInt = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
};

const parseStringArray = (value: unknown, maxItems: number): string[] | undefined => {
  if (value === undefined) return undefined;
  const source = Array.isArray(value)
    ? value
    : String(value ?? '')
        .split(',')
        .map((item) => item.trim());
  const next: string[] = [];
  const seen = new Set<string>();
  source.forEach((entry) => {
    const normalized = String(entry || '').trim();
    if (!normalized) return;
    if (seen.has(normalized)) return;
    if (next.length >= maxItems) return;
    seen.add(normalized);
    next.push(normalized);
  });
  return next;
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

const parseActionMetadata = (
  value: unknown,
): {
  trigger?: string;
  actor?: string;
  transactionId?: string;
  vipDurationDays?: number;
  vipDurationDaysRequested?: number;
} => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const metadata = value as Record<string, unknown>;
  const trigger = String(metadata.trigger || '').trim();
  const actor = String(metadata.actor || '').trim();
  const transactionId = String(metadata.transactionId || '').trim();
  const vipDurationDays = parseOptionalPositiveInt(metadata.vipDurationDays);
  const vipDurationDaysRequested = parseOptionalPositiveInt(metadata.vipDurationDaysRequested);

  return {
    ...(trigger ? { trigger } : {}),
    ...(actor ? { actor } : {}),
    ...(transactionId ? { transactionId } : {}),
    ...(vipDurationDays ? { vipDurationDays } : {}),
    ...(vipDurationDaysRequested ? { vipDurationDaysRequested } : {}),
  };
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
  metadata: unknown;
  queuedActionId: string | null;
  retryOfActionId: string | null;
  retriedAt: Date | null;
  retries: number;
}) => {
  const metadata = parseActionMetadata(row.metadata);
  return {
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
  ...(metadata.trigger ? { trigger: metadata.trigger } : {}),
  ...(metadata.actor ? { actor: metadata.actor } : {}),
  ...(metadata.transactionId ? { transactionId: metadata.transactionId } : {}),
  ...(metadata.vipDurationDays ? { vipDurationDays: metadata.vipDurationDays } : {}),
  ...(metadata.vipDurationDaysRequested
    ? { vipDurationDaysRequested: metadata.vipDurationDaysRequested }
    : {}),
  queuedActionId: row.queuedActionId || undefined,
  retryOfActionId: row.retryOfActionId || undefined,
  retriedAt: toIso(row.retriedAt),
  retries: row.retries,
  };
};

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

  const serverCatalog = await prisma.gameServer.findMany({
    select: { id: true, name: true },
  });
  const serverNameById = new Map(serverCatalog.map((server) => [server.id, server.name]));

  const items = rows.map((row) => {
    const isExpired = !!row.vipExpiry && row.vipExpiry.getTime() <= Date.now();
    const vipServerIds = Array.isArray((row as any).vipServerIds)
      ? ((row as any).vipServerIds as string[]).filter((entry) => String(entry || '').trim().length > 0)
      : [];
    const vipServerNames = vipServerIds
      .map((id) => serverNameById.get(id))
      .filter((value): value is string => Boolean(value));
    return {
      steamId: row.steamId,
      name: row.name,
      avatarUrl: row.avatarUrl || undefined,
      isVip: row.isVip,
      vipPlan: row.vipPlan || undefined,
      vipExpiry: toIso(row.vipExpiry),
      lastSeen: row.lastSeen.toISOString(),
      vipStatus: row.isVip ? (isExpired ? 'EXPIRED' : 'ACTIVE') : 'INACTIVE',
      vipServerIds,
      vipServerNames,
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
    vipServerIds,
  } = (req as any).body || {};

  const parsedSteamId = String(steamId || '').trim();
  const parsedName = String(name || '').trim();
  const parsedPlan = String(vipPlan || '').trim();
  const parsedServerId = String(serverId || '').trim();
  const parsedVipServerIds = parseStringArray(vipServerIds, 64);
  const durationDays = parsePositiveInt(vipDurationDays, 30, 3650);
  const explicitExpiry = parseOptionalDate(vipExpiry);

  if (!parsedSteamId || !parsedPlan) {
    return res.status(400).json({ error: 'steamId and vipPlan are required' });
  }

  if (parsedVipServerIds && parsedVipServerIds.length > 0) {
    const validServers = await prisma.gameServer.findMany({
      where: { id: { in: parsedVipServerIds } },
      select: { id: true },
    });
    const validIds = new Set(validServers.map((entry) => entry.id));
    const invalidIds = parsedVipServerIds.filter((entry) => !validIds.has(entry));
    if (invalidIds.length > 0) {
      return res.status(400).json({ error: `Invalid vipServerIds: ${invalidIds.join(', ')}` });
    }
  }

  const existingPlayer = await prisma.playerProfile.findUnique({
    where: { steamId: parsedSteamId },
    select: { vipExpiry: true },
  });
  const now = new Date();
  const expiryBase =
    !explicitExpiry &&
    existingPlayer?.vipExpiry &&
    existingPlayer.vipExpiry.getTime() > now.getTime()
      ? existingPlayer.vipExpiry
      : now;
  const expiry = explicitExpiry || new Date(expiryBase.getTime() + durationDays * 24 * 60 * 60 * 1000);

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
      vipServerIds: parsedVipServerIds || [],
    },
    update: {
      ...(parsedName ? { name: parsedName } : {}),
      isVip: true,
      vipPlan: parsedPlan,
      vipExpiry: expiry,
      ...(parsedVipServerIds !== undefined ? { vipServerIds: parsedVipServerIds } : {}),
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
      vipDurationDays: durationDays,
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
    vipServerIds: Array.isArray((updated as any).vipServerIds) ? (updated as any).vipServerIds : [],
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
    vipServerIds,
  } = (req as any).body || {};

  const parsedSteamId = String(steamId || '').trim();
  const parsedPlan = String(vipPlan || '').trim();
  const parsedServerId = String(serverId || '').trim();
  const parsedVipServerIds = parseStringArray(vipServerIds, 64);
  const durationDays = parsePositiveInt(vipDurationDays, 30, 3650);

  if (!parsedSteamId) {
    return res.status(400).json({ error: 'steamId is required' });
  }

  if (parsedVipServerIds && parsedVipServerIds.length > 0) {
    const validServers = await prisma.gameServer.findMany({
      where: { id: { in: parsedVipServerIds } },
      select: { id: true },
    });
    const validIds = new Set(validServers.map((entry) => entry.id));
    const invalidIds = parsedVipServerIds.filter((entry) => !validIds.has(entry));
    if (invalidIds.length > 0) {
      return res.status(400).json({ error: `Invalid vipServerIds: ${invalidIds.join(', ')}` });
    }
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
      ...(parsedVipServerIds !== undefined ? { vipServerIds: parsedVipServerIds } : {}),
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
      vipDurationDays: durationDays,
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
    vipServerIds: Array.isArray((updated as any).vipServerIds) ? (updated as any).vipServerIds : [],
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
    vipServerIds: Array.isArray((updated as any).vipServerIds) ? (updated as any).vipServerIds : [],
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
  const retryDurationDays = parseOptionalPositiveInt(metadataSource.vipDurationDays);

  const dispatch = await dispatchVipAutomationAction({
    action: action.action === 'REVOKE' ? 'REVOKE' : 'GRANT',
    steamId: action.steamId,
    ...(action.vipPlan ? { vipPlan: action.vipPlan } : {}),
    ...(action.vipExpiry ? { vipExpiry: action.vipExpiry } : {}),
    ...(retryDurationDays ? { vipDurationDays: retryDurationDays } : {}),
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

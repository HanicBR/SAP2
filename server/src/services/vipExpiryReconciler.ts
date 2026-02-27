import { prisma } from '../db/client';
import { dispatchVipAutomationAction } from './vipAutomation';

export interface VipExpiryReconcileOptions {
  dryRun?: boolean;
  limit?: number;
  enqueue?: boolean;
  serverId?: string;
  actor?: string;
  trigger?: string;
}

export interface VipExpiryReconcileItem {
  steamId: string;
  name: string;
  vipPlan?: string;
  vipExpiry?: string;
  updated: boolean;
  dispatch?: {
    queued: boolean;
    skipped?: boolean;
    reason?: string;
    serverId?: string;
    actionId?: string;
    vipActionId?: string;
  };
  error?: string;
}

export interface VipExpiryReconcileResult {
  dryRun: boolean;
  limit: number;
  now: string;
  expiredCount: number;
  updatedCount: number;
  updateFailures: number;
  dispatchQueuedCount: number;
  dispatchNotQueuedCount: number;
  items: VipExpiryReconcileItem[];
}

const parseBoolEnv = (value: string | undefined, fallback = false): boolean => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!normalized) return fallback;
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const parsePositiveIntEnv = (value: string | undefined, fallback: number, max: number): number => {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
};

export const reconcileExpiredVips = async (
  options: VipExpiryReconcileOptions = {},
): Promise<VipExpiryReconcileResult> => {
  const now = new Date();
  const dryRun = options.dryRun === true;
  const enqueue = options.enqueue !== false;
  const limit = Math.max(1, Math.min(500, Math.floor(options.limit || 100)));
  const actor = String(options.actor || '').trim() || 'system';
  const trigger = String(options.trigger || '').trim() || 'vip_expiry_reconciler';
  const serverId = String(options.serverId || '').trim();

  const expiredRows = await prisma.playerProfile.findMany({
    where: {
      isVip: true,
      vipExpiry: { not: null, lte: now },
    },
    orderBy: [{ vipExpiry: 'asc' }, { updatedAt: 'asc' }],
    take: limit,
    select: {
      steamId: true,
      name: true,
      vipPlan: true,
      vipExpiry: true,
    },
  });

  const items: VipExpiryReconcileItem[] = [];
  let updatedCount = 0;
  let updateFailures = 0;
  let dispatchQueuedCount = 0;
  let dispatchNotQueuedCount = 0;

  for (const row of expiredRows) {
    const item: VipExpiryReconcileItem = {
      steamId: row.steamId,
      name: row.name,
      ...(row.vipPlan ? { vipPlan: row.vipPlan } : {}),
      ...(row.vipExpiry ? { vipExpiry: row.vipExpiry.toISOString() } : {}),
      updated: false,
    };

    try {
      if (!dryRun) {
        await prisma.playerProfile.update({
          where: { steamId: row.steamId },
          data: {
            isVip: false,
            vipPlan: null,
            vipExpiry: null,
          },
        });
        item.updated = true;
        updatedCount += 1;
      }

      if (!dryRun && enqueue) {
        const dispatch = await dispatchVipAutomationAction({
          action: 'REVOKE',
          steamId: row.steamId,
          ...(serverId ? { serverId } : {}),
          metadata: {
            trigger,
            actor,
            reason: 'vip_expired',
          },
        });

        item.dispatch = {
          queued: dispatch.queued,
          ...(dispatch.skipped ? { skipped: true } : {}),
          ...(dispatch.reason ? { reason: dispatch.reason } : {}),
          ...(dispatch.serverId ? { serverId: dispatch.serverId } : {}),
          ...(dispatch.actionId ? { actionId: dispatch.actionId } : {}),
          ...(dispatch.vipActionId ? { vipActionId: dispatch.vipActionId } : {}),
        };

        if (dispatch.queued) dispatchQueuedCount += 1;
        else dispatchNotQueuedCount += 1;
      }
    } catch (err: any) {
      updateFailures += 1;
      item.error = err?.message ? String(err.message) : 'unknown_error';
    }

    items.push(item);
  }

  return {
    dryRun,
    limit,
    now: now.toISOString(),
    expiredCount: expiredRows.length,
    updatedCount,
    updateFailures,
    dispatchQueuedCount,
    dispatchNotQueuedCount,
    items,
  };
};

export const startVipExpiryReconcilerJob = () => {
  const enabled = parseBoolEnv(process.env.VIP_EXPIRY_RECONCILE_ENABLED, false);
  if (!enabled) {
    return () => undefined;
  }

  const intervalMinutes = parsePositiveIntEnv(process.env.VIP_EXPIRY_RECONCILE_INTERVAL_MINUTES, 10, 24 * 60);
  const limit = parsePositiveIntEnv(process.env.VIP_EXPIRY_RECONCILE_LIMIT, 100, 500);
  const dryRun = parseBoolEnv(process.env.VIP_EXPIRY_RECONCILE_DRY_RUN, false);
  const enqueue = parseBoolEnv(process.env.VIP_EXPIRY_RECONCILE_ENQUEUE, true);
  const serverId = String(process.env.VIP_EXPIRY_RECONCILE_SERVER_ID || '').trim() || undefined;

  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const summary = await reconcileExpiredVips({
        dryRun,
        limit,
        enqueue,
        ...(serverId ? { serverId } : {}),
        actor: 'vip_expiry_reconciler_job',
        trigger: 'vip_expiry_reconciler_job',
      });

      if (summary.expiredCount > 0 || summary.updateFailures > 0 || summary.dispatchNotQueuedCount > 0) {
        console.log(
          '[vip-expiry-reconciler]',
          JSON.stringify({
            dryRun: summary.dryRun,
            expiredCount: summary.expiredCount,
            updatedCount: summary.updatedCount,
            dispatchQueuedCount: summary.dispatchQueuedCount,
            dispatchNotQueuedCount: summary.dispatchNotQueuedCount,
            updateFailures: summary.updateFailures,
          }),
        );
      }
    } catch (err: any) {
      console.error('[vip-expiry-reconciler] run failed', err?.message || err);
    } finally {
      running = false;
    }
  };

  const intervalMs = intervalMinutes * 60 * 1000;
  const timer = setInterval(() => {
    void run();
  }, intervalMs);

  console.log(
    '[vip-expiry-reconciler] enabled',
    JSON.stringify({
      intervalMinutes,
      limit,
      dryRun,
      enqueue,
      ...(serverId ? { serverId } : {}),
    }),
  );

  void run();

  return () => clearInterval(timer);
};

export interface ServerAction {
  id: string;
  command: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

type ServerActionEntry = {
  action: ServerAction;
  createdAtMs: number;
  wsAttemptCount: number;
  wsFirstSentAtMs?: number;
  wsLastSentAtMs?: number;
  wsLastAckAtMs?: number;
  wsLastAckError?: string;
};

type ServerActionMetrics = {
  queuedTotal: number;
  wsSentTotal: number;
  wsAckedTotal: number;
  wsAckErrorTotal: number;
  wsRetryTotal: number;
  httpPulledTotal: number;
};

export type ServerActionRuntimeSnapshot = {
  queueSize: number;
  pendingWsAck: number;
  httpEligible: number;
  oldestQueuedAt?: string;
  queuedTotal: number;
  wsSentTotal: number;
  wsAckedTotal: number;
  wsAckErrorTotal: number;
  wsRetryTotal: number;
  httpPulledTotal: number;
};

export type ServerActionHealthSummary = {
  serversWithQueue: number;
  totalQueueSize: number;
  queuedTotal: number;
  wsSentTotal: number;
  wsAckedTotal: number;
  wsAckErrorTotal: number;
  wsRetryTotal: number;
  httpPulledTotal: number;
};

const ACTION_WS_RETRY_MS = 8_000;
const ACTION_HTTP_FALLBACK_GRACE_MS = 20_000;

const actionsByServerId = new Map<string, ServerActionEntry[]>();
const metricsByServerId = new Map<string, ServerActionMetrics>();
let onServerActionEnqueued: ((serverId: string) => void) | null = null;
const MAX_ACTIONS_PER_SERVER = 200;

const newActionId = () =>
  `act_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const toPublicAction = (entry: ServerActionEntry): ServerAction => entry.action;

const getOrInitMetrics = (serverId: string): ServerActionMetrics => {
  const existing = metricsByServerId.get(serverId);
  if (existing) return existing;
  const metrics: ServerActionMetrics = {
    queuedTotal: 0,
    wsSentTotal: 0,
    wsAckedTotal: 0,
    wsAckErrorTotal: 0,
    wsRetryTotal: 0,
    httpPulledTotal: 0,
  };
  metricsByServerId.set(serverId, metrics);
  return metrics;
};

export const setServerActionEnqueueListener = (
  listener: ((serverId: string) => void) | null,
) => {
  onServerActionEnqueued = listener;
};

export const enqueueServerAction = (
  serverId: string,
  command: string,
  metadata?: Record<string, unknown>,
): ServerAction | null => {
  const parsedServerId = String(serverId || '').trim();
  const parsedCommand = String(command || '').trim();
  if (!parsedServerId || !parsedCommand) return null;

  const nowMs = Date.now();
  const metrics = getOrInitMetrics(parsedServerId);
  const queue = actionsByServerId.get(parsedServerId) || [];
  const action: ServerAction = {
    id: newActionId(),
    command: parsedCommand,
    createdAt: new Date().toISOString(),
    ...(metadata ? { metadata } : {}),
  };
  const entry: ServerActionEntry = {
    action,
    createdAtMs: nowMs,
    wsAttemptCount: 0,
  };

  queue.push(entry);
  if (queue.length > MAX_ACTIONS_PER_SERVER) {
    queue.splice(0, queue.length - MAX_ACTIONS_PER_SERVER);
  }

  metrics.queuedTotal += 1;
  actionsByServerId.set(parsedServerId, queue);
  if (onServerActionEnqueued) {
    try {
      onServerActionEnqueued(parsedServerId);
    } catch {
      // no-op; enqueue should never fail because listener crashed
    }
  }
  return action;
};

export const drainServerActions = (serverId: string, limit = 20): ServerAction[] => {
  const parsedServerId = String(serverId || '').trim();
  if (!parsedServerId) return [];

  const queue = actionsByServerId.get(parsedServerId) || [];
  if (!queue.length) return [];

  const take = Math.max(1, Math.min(100, Math.floor(limit)));
  const nowMs = Date.now();
  const metrics = getOrInitMetrics(parsedServerId);
  const pulledEntries: ServerActionEntry[] = [];
  const keptEntries: ServerActionEntry[] = [];

  queue.forEach((entry) => {
    if (pulledEntries.length >= take) {
      keptEntries.push(entry);
      return;
    }

    const waitingWsAck =
      entry.wsFirstSentAtMs !== undefined &&
      nowMs - entry.wsFirstSentAtMs < ACTION_HTTP_FALLBACK_GRACE_MS;
    if (waitingWsAck) {
      keptEntries.push(entry);
      return;
    }

    pulledEntries.push(entry);
    metrics.httpPulledTotal += 1;
  });

  if (!keptEntries.length) {
    actionsByServerId.delete(parsedServerId);
  } else {
    actionsByServerId.set(parsedServerId, keptEntries);
  }
  return pulledEntries.map(toPublicAction);
};

export const claimServerActionsForWsDispatch = (
  serverId: string,
  limit = 20,
): ServerAction[] => {
  const parsedServerId = String(serverId || '').trim();
  if (!parsedServerId) return [];

  const queue = actionsByServerId.get(parsedServerId) || [];
  if (!queue.length) return [];

  const take = Math.max(1, Math.min(100, Math.floor(limit)));
  const nowMs = Date.now();
  const metrics = getOrInitMetrics(parsedServerId);
  const selected: ServerActionEntry[] = [];

  queue.forEach((entry) => {
    if (selected.length >= take) return;
    const readyByRetry =
      entry.wsLastSentAtMs === undefined ||
      nowMs - entry.wsLastSentAtMs >= ACTION_WS_RETRY_MS;
    if (!readyByRetry) return;

    if (entry.wsLastSentAtMs !== undefined) {
      metrics.wsRetryTotal += 1;
    }
    metrics.wsSentTotal += 1;
    entry.wsAttemptCount += 1;
    entry.wsLastSentAtMs = nowMs;
    if (entry.wsFirstSentAtMs === undefined) {
      entry.wsFirstSentAtMs = nowMs;
    }
    selected.push(entry);
  });

  return selected.map(toPublicAction);
};

export const ackServerAction = (
  serverId: string,
  actionId: string,
  ok = true,
  error?: string,
): boolean => {
  const parsedServerId = String(serverId || '').trim();
  const parsedActionId = String(actionId || '').trim();
  if (!parsedServerId || !parsedActionId) return false;

  const queue = actionsByServerId.get(parsedServerId) || [];
  if (!queue.length) return false;

  const idx = queue.findIndex((entry) => entry.action.id === parsedActionId);
  if (idx < 0) return false;

  const entry = queue[idx];
  if (!entry) return false;
  const metrics = getOrInitMetrics(parsedServerId);
  if (!ok) {
    entry.wsLastAckAtMs = Date.now();
    entry.wsLastAckError = String(error || '').trim() || 'server_action_failed';
    metrics.wsAckErrorTotal += 1;
    actionsByServerId.set(parsedServerId, queue);
    return true;
  }

  queue.splice(idx, 1);
  metrics.wsAckedTotal += 1;
  if (!queue.length) {
    actionsByServerId.delete(parsedServerId);
  } else {
    actionsByServerId.set(parsedServerId, queue);
  }
  return true;
};

export const getServerActionRuntimeSnapshot = (
  serverId: string,
): ServerActionRuntimeSnapshot => {
  const parsedServerId = String(serverId || '').trim();
  const queue = actionsByServerId.get(parsedServerId) || [];
  const metrics = metricsByServerId.get(parsedServerId);
  const nowMs = Date.now();

  let oldestQueuedMs: number | undefined;
  let pendingWsAck = 0;
  let httpEligible = 0;
  queue.forEach((entry) => {
    if (oldestQueuedMs === undefined || entry.createdAtMs < oldestQueuedMs) {
      oldestQueuedMs = entry.createdAtMs;
    }
    const waitingWsAck =
      entry.wsFirstSentAtMs !== undefined &&
      nowMs - entry.wsFirstSentAtMs < ACTION_HTTP_FALLBACK_GRACE_MS;
    if (waitingWsAck) {
      pendingWsAck += 1;
      return;
    }
    httpEligible += 1;
  });

  return {
    queueSize: queue.length,
    pendingWsAck,
    httpEligible,
    ...(oldestQueuedMs !== undefined ? { oldestQueuedAt: new Date(oldestQueuedMs).toISOString() } : {}),
    queuedTotal: metrics?.queuedTotal || 0,
    wsSentTotal: metrics?.wsSentTotal || 0,
    wsAckedTotal: metrics?.wsAckedTotal || 0,
    wsAckErrorTotal: metrics?.wsAckErrorTotal || 0,
    wsRetryTotal: metrics?.wsRetryTotal || 0,
    httpPulledTotal: metrics?.httpPulledTotal || 0,
  };
};

export const getServerActionHealthSummary = (): ServerActionHealthSummary => {
  const serverIds = new Set<string>([
    ...Array.from(actionsByServerId.keys()),
    ...Array.from(metricsByServerId.keys()),
  ]);

  let serversWithQueue = 0;
  let totalQueueSize = 0;
  let queuedTotal = 0;
  let wsSentTotal = 0;
  let wsAckedTotal = 0;
  let wsAckErrorTotal = 0;
  let wsRetryTotal = 0;
  let httpPulledTotal = 0;

  serverIds.forEach((serverId) => {
    const queue = actionsByServerId.get(serverId) || [];
    const metrics = metricsByServerId.get(serverId);
    if (queue.length > 0) serversWithQueue += 1;
    totalQueueSize += queue.length;
    queuedTotal += metrics?.queuedTotal || 0;
    wsSentTotal += metrics?.wsSentTotal || 0;
    wsAckedTotal += metrics?.wsAckedTotal || 0;
    wsAckErrorTotal += metrics?.wsAckErrorTotal || 0;
    wsRetryTotal += metrics?.wsRetryTotal || 0;
    httpPulledTotal += metrics?.httpPulledTotal || 0;
  });

  return {
    serversWithQueue,
    totalQueueSize,
    queuedTotal,
    wsSentTotal,
    wsAckedTotal,
    wsAckErrorTotal,
    wsRetryTotal,
    httpPulledTotal,
  };
};

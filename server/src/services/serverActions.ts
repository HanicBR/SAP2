export interface ServerAction {
  id: string;
  command: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export type ServerActionDispatchStatus = 'QUEUED' | 'ACK_OK' | 'ACK_FAILED' | 'HTTP_PULLED';

type ServerActionOutcomeRecord = {
  actionId: string;
  serverId: string;
  command: string;
  status: ServerActionDispatchStatus;
  createdAtMs: number;
  updatedAtMs: number;
  wsAttemptCount: number;
  wsLastSentAtMs?: number;
  wsLastAckAtMs?: number;
  error?: string;
  metadata?: Record<string, unknown>;
};

export type ServerActionOutcomeSnapshot = {
  actionId: string;
  serverId: string;
  command: string;
  status: ServerActionDispatchStatus;
  createdAt: string;
  updatedAt: string;
  wsAttemptCount: number;
  wsLastSentAt?: string;
  wsLastAckAt?: string;
  error?: string;
  metadata?: Record<string, unknown>;
};

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
const MAX_ACTION_OUTCOMES = 5_000;

const actionsByServerId = new Map<string, ServerActionEntry[]>();
const metricsByServerId = new Map<string, ServerActionMetrics>();
const actionOutcomeById = new Map<string, ServerActionOutcomeRecord>();
let onServerActionEnqueued: ((serverId: string) => void) | null = null;
const MAX_ACTIONS_PER_SERVER = 200;

const newActionId = () =>
  `act_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

const toPublicAction = (entry: ServerActionEntry): ServerAction => entry.action;

const toOutcomeSnapshot = (record: ServerActionOutcomeRecord): ServerActionOutcomeSnapshot => ({
  actionId: record.actionId,
  serverId: record.serverId,
  command: record.command,
  status: record.status,
  createdAt: new Date(record.createdAtMs).toISOString(),
  updatedAt: new Date(record.updatedAtMs).toISOString(),
  wsAttemptCount: record.wsAttemptCount,
  ...(record.wsLastSentAtMs !== undefined
    ? { wsLastSentAt: new Date(record.wsLastSentAtMs).toISOString() }
    : {}),
  ...(record.wsLastAckAtMs !== undefined
    ? { wsLastAckAt: new Date(record.wsLastAckAtMs).toISOString() }
    : {}),
  ...(record.error ? { error: record.error } : {}),
  ...(record.metadata ? { metadata: record.metadata } : {}),
});

const trimActionOutcomeCache = () => {
  if (actionOutcomeById.size <= MAX_ACTION_OUTCOMES) return;
  const overflow = actionOutcomeById.size - MAX_ACTION_OUTCOMES;
  const sorted = Array.from(actionOutcomeById.values()).sort(
    (left, right) => left.updatedAtMs - right.updatedAtMs,
  );
  for (let idx = 0; idx < overflow; idx += 1) {
    const candidate = sorted[idx];
    if (!candidate) continue;
    actionOutcomeById.delete(candidate.actionId);
  }
};

const upsertActionOutcome = (
  action: ServerAction,
  serverId: string,
  updater: (current?: ServerActionOutcomeRecord) => ServerActionOutcomeRecord,
) => {
  const current = actionOutcomeById.get(action.id);
  const next = updater(current);
  actionOutcomeById.set(action.id, next);
  trimActionOutcomeCache();
};

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
  upsertActionOutcome(action, parsedServerId, (current) => ({
    actionId: action.id,
    serverId: parsedServerId,
    command: parsedCommand,
    status: 'QUEUED',
    createdAtMs: current?.createdAtMs || nowMs,
    updatedAtMs: nowMs,
    wsAttemptCount: current?.wsAttemptCount || 0,
    ...(current?.wsLastSentAtMs !== undefined ? { wsLastSentAtMs: current.wsLastSentAtMs } : {}),
    ...(current?.wsLastAckAtMs !== undefined ? { wsLastAckAtMs: current.wsLastAckAtMs } : {}),
    ...(current?.error ? { error: current.error } : {}),
    ...(metadata ? { metadata } : {}),
  }));
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
    const action = entry.action;
    upsertActionOutcome(action, parsedServerId, (current) => ({
      actionId: action.id,
      serverId: parsedServerId,
      command: action.command,
      status: 'HTTP_PULLED',
      createdAtMs: current?.createdAtMs || entry.createdAtMs,
      updatedAtMs: nowMs,
      wsAttemptCount: entry.wsAttemptCount,
      ...(entry.wsLastSentAtMs !== undefined ? { wsLastSentAtMs: entry.wsLastSentAtMs } : {}),
      ...(entry.wsLastAckAtMs !== undefined ? { wsLastAckAtMs: entry.wsLastAckAtMs } : {}),
      ...(entry.wsLastAckError ? { error: entry.wsLastAckError } : {}),
      ...(action.metadata ? { metadata: action.metadata } : {}),
    }));
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
    const action = entry.action;
    upsertActionOutcome(action, parsedServerId, (current) => ({
      actionId: action.id,
      serverId: parsedServerId,
      command: action.command,
      status: 'QUEUED',
      createdAtMs: current?.createdAtMs || entry.createdAtMs,
      updatedAtMs: nowMs,
      wsAttemptCount: entry.wsAttemptCount,
      wsLastSentAtMs: nowMs,
      ...(entry.wsLastAckAtMs !== undefined ? { wsLastAckAtMs: entry.wsLastAckAtMs } : {}),
      ...(entry.wsLastAckError ? { error: entry.wsLastAckError } : {}),
      ...(action.metadata ? { metadata: action.metadata } : {}),
    }));
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
    const ackNowMs = Date.now();
    entry.wsLastAckAtMs = ackNowMs;
    entry.wsLastAckError = String(error || '').trim() || 'server_action_failed';
    metrics.wsAckErrorTotal += 1;
    const action = entry.action;
    upsertActionOutcome(action, parsedServerId, (current) => ({
      actionId: action.id,
      serverId: parsedServerId,
      command: action.command,
      status: 'ACK_FAILED',
      createdAtMs: current?.createdAtMs || entry.createdAtMs,
      updatedAtMs: ackNowMs,
      wsAttemptCount: entry.wsAttemptCount,
      ...(entry.wsLastSentAtMs !== undefined ? { wsLastSentAtMs: entry.wsLastSentAtMs } : {}),
      wsLastAckAtMs: ackNowMs,
      ...(entry.wsLastAckError ? { error: entry.wsLastAckError } : {}),
      ...(action.metadata ? { metadata: action.metadata } : {}),
    }));
    actionsByServerId.set(parsedServerId, queue);
    return true;
  }

  const ackNowMs = Date.now();
  const action = entry.action;
  queue.splice(idx, 1);
  metrics.wsAckedTotal += 1;
  upsertActionOutcome(action, parsedServerId, (current) => ({
    actionId: action.id,
    serverId: parsedServerId,
    command: action.command,
    status: 'ACK_OK',
    createdAtMs: current?.createdAtMs || entry.createdAtMs,
    updatedAtMs: ackNowMs,
    wsAttemptCount: entry.wsAttemptCount,
    ...(entry.wsLastSentAtMs !== undefined ? { wsLastSentAtMs: entry.wsLastSentAtMs } : {}),
    wsLastAckAtMs: ackNowMs,
    ...(action.metadata ? { metadata: action.metadata } : {}),
  }));
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

export const getServerActionOutcome = (
  serverId: string,
  actionId: string,
): ServerActionOutcomeSnapshot | null => {
  const parsedServerId = String(serverId || '').trim();
  const parsedActionId = String(actionId || '').trim();
  if (!parsedServerId || !parsedActionId) return null;

  const record = actionOutcomeById.get(parsedActionId);
  if (!record) return null;
  if (record.serverId !== parsedServerId) return null;
  return toOutcomeSnapshot(record);
};

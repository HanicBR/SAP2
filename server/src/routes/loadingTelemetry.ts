import { createHash } from 'crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../db/client';
import { authMiddleware, requireRole } from '../middleware/auth';
import { UserRole } from '../domain';
import {
  getLoadingTelemetryTokenTtlSec,
  isLoadingTelemetryTokenConfigured,
  isLoadingTelemetryTokenRequired,
  verifyLoadingTelemetryToken,
} from '../services/loadingTelemetryAuth';

const router = Router();

const MAX_EVENTS_PER_BATCH = 120;
const MAX_STATUS_TEXT_LENGTH = 300;
const MAX_FILE_NAME_LENGTH = 600;
const MAX_SOURCE_LENGTH = 48;
const MAX_SESSION_KEY_LENGTH = 128;
const MAX_PAYLOAD_JSON_LENGTH = 3_500;

const parseBoolEnv = (value: string | undefined, fallback: boolean): boolean => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!normalized) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
};

const parsePositiveIntEnv = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const MAX_ADMIN_SESSIONS = parsePositiveIntEnv(
  process.env.LOADING_TELEMETRY_ADMIN_MAX_SESSIONS,
  5_000,
);
const MAX_ADMIN_EVENTS = parsePositiveIntEnv(
  process.env.LOADING_TELEMETRY_ADMIN_MAX_EVENTS,
  150_000,
);
const MAX_TRACKED_FILES = parsePositiveIntEnv(
  process.env.LOADING_TELEMETRY_ADMIN_MAX_TRACKED_FILES,
  400,
);
const MAX_EVENT_STEP_DURATION_MS = parsePositiveIntEnv(
  process.env.LOADING_TELEMETRY_ADMIN_MAX_STEP_DURATION_MS,
  20 * 60 * 1000,
);

const ingestRateLimitMax = parsePositiveIntEnv(
  process.env.LOADING_TELEMETRY_INGEST_MAX_PER_MIN,
  360,
);
const MAX_EVENTS_PER_SESSION = parsePositiveIntEnv(
  process.env.LOADING_TELEMETRY_MAX_EVENTS_PER_SESSION,
  4_000,
);
const RETENTION_DAYS = parsePositiveIntEnv(process.env.LOADING_TELEMETRY_RETENTION_DAYS, 30);
const CLEANUP_INTERVAL_MIN = parsePositiveIntEnv(
  process.env.LOADING_TELEMETRY_CLEANUP_INTERVAL_MIN,
  60,
);
const CLEANUP_ENABLED = parseBoolEnv(process.env.LOADING_TELEMETRY_CLEANUP_ENABLED, true);

const ingestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: ingestRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
});

type TelemetryEventType =
  | 'SESSION_START'
  | 'HEARTBEAT'
  | 'STATUS_CHANGE'
  | 'FILE_DOWNLOAD'
  | 'STAGE_MARK'
  | 'SESSION_END';

const ALLOWED_EVENT_TYPES = new Set<TelemetryEventType>([
  'SESSION_START',
  'HEARTBEAT',
  'STATUS_CHANGE',
  'FILE_DOWNLOAD',
  'STAGE_MARK',
  'SESSION_END',
]);

type TelemetryPayloadValue =
  | null
  | boolean
  | number
  | string
  | TelemetryPayloadValue[]
  | { [key: string]: TelemetryPayloadValue };

type SanitizedEvent = {
  seq: number;
  type: TelemetryEventType;
  eventAt: Date;
  statusText?: string;
  fileName?: string;
  progressPct?: number;
  payload?: TelemetryPayloadValue;
};

type BatchSummary = {
  firstEventAt?: Date;
  lastEventAt?: Date;
  endedAt?: Date;
  sawCompletionSignal: boolean;
  lastStatus?: string;
  lastFile?: string;
  maxProgress?: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const trimTo = (value: unknown, maxLength: number): string | undefined => {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  return text.length <= maxLength ? text : text.slice(0, maxLength);
};

const sanitizeSlug = (value: unknown): string | undefined => {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!raw) return undefined;
  return raw.slice(0, 64);
};

const sanitizeSessionKey = (value: unknown): string | undefined => {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  if (raw.length > MAX_SESSION_KEY_LENGTH) return undefined;
  if (!/^[a-zA-Z0-9:_-]{8,128}$/.test(raw)) return undefined;
  return raw;
};

const toDate = (value: unknown): Date | undefined => {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  const next = new Date(raw);
  if (!Number.isFinite(next.getTime())) return undefined;
  return next;
};

const clampProgress = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  if (parsed < 0) return 0;
  if (parsed > 100) return 100;
  return Math.round(parsed);
};

const sanitizePayload = (value: unknown): TelemetryPayloadValue | undefined => {
  if (value === undefined) return undefined;
  try {
    const json = JSON.stringify(value);
    if (!json || json === 'undefined') return undefined;
    if (json.length > MAX_PAYLOAD_JSON_LENGTH) {
      return {
        truncated: true,
        size: json.length,
      };
    }
    return JSON.parse(json) as TelemetryPayloadValue;
  } catch {
    return undefined;
  }
};

const sanitizeEvent = (value: unknown): SanitizedEvent | null => {
  if (!isRecord(value)) return null;
  const seqRaw = Number.parseInt(String(value.seq ?? ''), 10);
  if (!Number.isFinite(seqRaw) || seqRaw < 0) return null;

  const typeRaw = String(value.type ?? '')
    .trim()
    .toUpperCase() as TelemetryEventType;
  if (!ALLOWED_EVENT_TYPES.has(typeRaw)) return null;

  const eventAt = toDate(value.at) || toDate(value.eventAt);
  if (!eventAt) return null;

  const statusText = trimTo(value.statusText, MAX_STATUS_TEXT_LENGTH);
  const fileName = trimTo(value.fileName, MAX_FILE_NAME_LENGTH);
  const progressPct = clampProgress(value.progressPct);
  const payload = sanitizePayload(value.payload);

  return {
    seq: seqRaw,
    type: typeRaw,
    eventAt,
    ...(statusText ? { statusText } : {}),
    ...(fileName ? { fileName } : {}),
    ...(typeof progressPct === 'number' ? { progressPct } : {}),
    ...(payload !== undefined ? { payload } : {}),
  };
};

const sanitizeEvents = (value: unknown): SanitizedEvent[] => {
  if (!Array.isArray(value) || value.length === 0) return [];

  const unique = new Map<number, SanitizedEvent>();
  value.slice(0, MAX_EVENTS_PER_BATCH).forEach((entry) => {
    const sanitized = sanitizeEvent(entry);
    if (!sanitized) return;
    if (unique.has(sanitized.seq)) return;
    unique.set(sanitized.seq, sanitized);
  });

  return [...unique.values()].sort((a, b) => a.seq - b.seq);
};

const minDate = (...values: Array<Date | undefined | null>): Date | undefined => {
  const list = values.filter((value): value is Date => value instanceof Date);
  if (!list.length) return undefined;
  return list.reduce((acc, current) => (current.getTime() < acc.getTime() ? current : acc));
};

const maxDate = (...values: Array<Date | undefined | null>): Date | undefined => {
  const list = values.filter((value): value is Date => value instanceof Date);
  if (!list.length) return undefined;
  return list.reduce((acc, current) => (current.getTime() > acc.getTime() ? current : acc));
};

const msDiff = (start: Date, end: Date): number => {
  const diff = end.getTime() - start.getTime();
  if (!Number.isFinite(diff)) return 0;
  return Math.max(0, Math.round(diff));
};

const isStartingLuaStatus = (value: unknown): boolean => {
  const text = String(value || '')
    .trim()
    .toLowerCase();
  return text === 'starting lua...' || text === 'starting lua';
};

const isConnectedStatus = (value: unknown): boolean => {
  const text = String(value || '')
    .trim()
    .toLowerCase();
  return (
    text === 'lua started!' ||
    text === 'lua started' ||
    text === 'fully connected!' ||
    text === 'fully connected'
  );
};

const isCompletionStatus = (value: unknown): boolean =>
  isStartingLuaStatus(value) || isConnectedStatus(value);

const summarizeBatch = (events: SanitizedEvent[]): BatchSummary => {
  if (!events.length) return { sawCompletionSignal: false };

  let firstEventAt: Date | undefined;
  let lastEventAt: Date | undefined;
  let endedAt: Date | undefined;
  let sawCompletionSignal = false;
  let lastStatus: string | undefined;
  let lastFile: string | undefined;
  let maxProgress: number | undefined;

  events.forEach((event) => {
    firstEventAt = minDate(firstEventAt, event.eventAt);
    lastEventAt = maxDate(lastEventAt, event.eventAt);

    if (event.type === 'SESSION_END') {
      endedAt = maxDate(endedAt, event.eventAt);
    }

    if (
      event.statusText &&
      (event.type === 'STATUS_CHANGE' || event.type === 'STAGE_MARK') &&
      isCompletionStatus(event.statusText)
    ) {
      sawCompletionSignal = true;
    }

    if (event.statusText) lastStatus = event.statusText;
    if (event.fileName) lastFile = event.fileName;
    if (typeof event.progressPct === 'number') {
      maxProgress = typeof maxProgress === 'number' ? Math.max(maxProgress, event.progressPct) : event.progressPct;
    }
  });

  return {
    ...(firstEventAt ? { firstEventAt } : {}),
    ...(lastEventAt ? { lastEventAt } : {}),
    ...(endedAt ? { endedAt } : {}),
    sawCompletionSignal,
    ...(lastStatus ? { lastStatus } : {}),
    ...(lastFile ? { lastFile } : {}),
    ...(typeof maxProgress === 'number' ? { maxProgress } : {}),
  };
};

const safeJsonBody = (value: unknown): Record<string, unknown> | null => {
  if (isRecord(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const readRequestToken = (req: any, body: Record<string, unknown>): string | undefined => {
  const fromBody = trimTo(body.token, 4096);
  if (fromBody) return fromBody;
  const fromHeader = trimTo(
    req?.header?.('x-loading-token') || req?.header?.('x-loading-telemetry-token'),
    4096,
  );
  return fromHeader || undefined;
};

const getIpHash = (req: { headers: Record<string, unknown>; socket?: { remoteAddress?: string } }): string | undefined => {
  const forwardedRaw = String(req.headers['x-forwarded-for'] || '').trim();
  const forwarded = forwardedRaw ? forwardedRaw.split(',')[0]?.trim() : '';
  const remote = String(req.socket?.remoteAddress || '').trim();
  const ip = String(forwarded || remote).replace(/^::ffff:/i, '').trim();
  if (!ip) return undefined;

  const salt = String(process.env.LOADING_TELEMETRY_IP_SALT || process.env.IP_HASH_SALT || '');
  return createHash('sha256').update(`${salt}|${ip}`).digest('hex');
};

const getLoadingTelemetrySessionClient = () => (prisma as any).loadingTelemetrySession;
const getLoadingTelemetryEventClient = () => (prisma as any).loadingTelemetryEvent;

type CleanupState = {
  enabled: boolean;
  retentionDays: number;
  intervalMin: number;
  running: boolean;
  totalRuns: number;
  totalDeletedSessions: number;
  lastRunAt?: Date;
  lastDeletedSessions: number;
  lastError: string | null;
};

const cleanupState: CleanupState = {
  enabled: CLEANUP_ENABLED,
  retentionDays: RETENTION_DAYS,
  intervalMin: CLEANUP_INTERVAL_MIN,
  running: false,
  totalRuns: 0,
  totalDeletedSessions: 0,
  lastDeletedSessions: 0,
  lastError: null,
};

const runRetentionCleanup = async () => {
  if (!cleanupState.enabled) return;
  if (cleanupState.running) return;
  cleanupState.running = true;
  try {
    const now = new Date();
    const cutoff = new Date(now.getTime() - cleanupState.retentionDays * 24 * 60 * 60 * 1000);
    const loadingTelemetrySessionClient = getLoadingTelemetrySessionClient();
    const deleted = await loadingTelemetrySessionClient.deleteMany({
      where: {
        startedAt: {
          lt: cutoff,
        },
      },
    });
    cleanupState.lastRunAt = now;
    cleanupState.lastDeletedSessions = deleted.count;
    cleanupState.totalDeletedSessions += deleted.count;
    cleanupState.totalRuns += 1;
    cleanupState.lastError = null;
  } catch (error) {
    cleanupState.lastRunAt = new Date();
    cleanupState.lastDeletedSessions = 0;
    cleanupState.totalRuns += 1;
    cleanupState.lastError = error instanceof Error ? error.message : 'cleanup_failed';
    console.error('loading telemetry retention cleanup failed', error);
  } finally {
    cleanupState.running = false;
  }
};

if (cleanupState.enabled) {
  const cleanupIntervalMs = Math.max(60_000, cleanupState.intervalMin * 60 * 1000);
  const cleanupTimer = setInterval(() => {
    void runRetentionCleanup();
  }, cleanupIntervalMs);
  if (typeof (cleanupTimer as any).unref === 'function') {
    (cleanupTimer as any).unref();
  }
  void runRetentionCleanup();
}

type TelemetryRange = '24h' | '7d' | '30d';

type AdminSessionRow = {
  id: string;
  slug: string;
  startedAt: Date;
  firstEventAt: Date | null;
  lastEventAt: Date | null;
  completedAt: Date | null;
  completed: boolean;
  totalDurationMs: number | null;
  lastStatus: string | null;
  lastFile: string | null;
  maxProgress: number | null;
  source: string | null;
  createdAt: Date;
};

type AdminEventRow = {
  sessionId: string;
  seq: number;
  type: TelemetryEventType;
  eventAt: Date;
  statusText: string | null;
  fileName: string | null;
  progressPct: number | null;
};

const parseRangeQuery = (value: unknown): TelemetryRange => {
  const raw = String(value || '')
    .trim()
    .toLowerCase();
  if (raw === '24h') return '24h';
  if (raw === '30d') return '30d';
  return '7d';
};

const rangeToWindowMs = (range: TelemetryRange): number => {
  if (range === '24h') return 24 * 60 * 60 * 1000;
  if (range === '30d') return 30 * 24 * 60 * 60 * 1000;
  return 7 * 24 * 60 * 60 * 1000;
};

const round1 = (value: number): number => Math.round(value * 10) / 10;

const average = (values: number[]): number => {
  if (!values.length) return 0;
  const sum = values.reduce((acc, current) => acc + current, 0);
  return sum / values.length;
};

const percentile = (values: number[], p: number): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (Math.max(0, Math.min(100, p)) / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const lowerValue = sorted[lower] || 0;
  const upperValue = sorted[upper] || 0;
  if (lower === upper) return lowerValue;
  return lowerValue + (upperValue - lowerValue) * (rank - lower);
};

const normalizeStageName = (value: string | null | undefined): string | undefined => {
  const text = String(value || '').trim();
  if (!text) return undefined;
  const lower = text.toLowerCase();

  if (/^\d+\s*\/\s*\d+$/.test(text)) return 'Downloading Workshop Files';
  if (lower === 'mounting addons') return 'Mounting Addons';
  if (lower === 'workshop complete') return 'Workshop Complete';
  if (lower === 'client info sent!' || lower === 'client info sent') return 'Client info sent';
  if (lower === 'starting lua...' || lower === 'starting lua') return 'Starting Lua';
  if (lower === 'conectando ao servidor...' || lower === 'conectando ao servidor') {
    return 'Conectando ao servidor';
  }
  if (lower === 'autenticando...' || lower === 'autenticando') return 'Autenticando';
  return text.length <= 90 ? text : text.slice(0, 90);
};

const normalizeFileName = (value: string | null | undefined): string | undefined => {
  const text = String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!text) return undefined;
  return text.length <= 180 ? text : text.slice(0, 180);
};

const getSessionDurationMs = (session: AdminSessionRow): number | undefined => {
  if (typeof session.totalDurationMs === 'number' && Number.isFinite(session.totalDurationMs)) {
    return Math.max(0, Math.round(session.totalDurationMs));
  }
  const startedAt = session.startedAt;
  if (!(startedAt instanceof Date) || !Number.isFinite(startedAt.getTime())) return undefined;
  if (session.completedAt instanceof Date && Number.isFinite(session.completedAt.getTime())) {
    return msDiff(startedAt, session.completedAt);
  }
  if (session.lastEventAt instanceof Date && Number.isFinite(session.lastEventAt.getTime())) {
    return msDiff(startedAt, session.lastEventAt);
  }
  return undefined;
};

const chunkArray = <T,>(items: T[], size: number): T[][] => {
  if (!items.length) return [];
  const safeSize = Math.max(1, size);
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += safeSize) {
    chunks.push(items.slice(i, i + safeSize));
  }
  return chunks;
};

type TimelineBucket = {
  from: Date;
  to: Date;
  label: string;
  sessions: number;
  completed: number;
  abandoned: number;
  durations: number[];
};

const buildTimelineBuckets = (range: TelemetryRange, since: Date, now: Date): TimelineBucket[] => {
  const bucketCount = range === '24h' ? 24 : range === '7d' ? 7 : 30;
  const sinceMs = since.getTime();
  const nowMs = now.getTime();
  const totalMs = Math.max(1, nowMs - sinceMs);
  const bucketMs = totalMs / bucketCount;

  const buckets: TimelineBucket[] = [];
  for (let idx = 0; idx < bucketCount; idx += 1) {
    const startMs = Math.floor(sinceMs + idx * bucketMs);
    const endMs =
      idx === bucketCount - 1 ? nowMs : Math.floor(sinceMs + (idx + 1) * bucketMs);
    const from = new Date(startMs);
    const to = new Date(endMs);
    const label =
      range === '24h' ? from.toISOString().slice(11, 16) : from.toISOString().slice(5, 10);
    buckets.push({
      from,
      to,
      label,
      sessions: 0,
      completed: 0,
      abandoned: 0,
      durations: [],
    });
  }
  return buckets;
};

router.post('/ingest', ingestLimiter, async (req, res) => {
  const body = safeJsonBody(req.body);
  if (!body) {
    return res.status(400).json({ error: 'invalid_json' });
  }

  const sessionKey = sanitizeSessionKey(body.sessionKey);
  const slug = sanitizeSlug(body.slug);
  const source = trimTo(body.source, MAX_SOURCE_LENGTH);
  const events = sanitizeEvents(body.events);

  if (!sessionKey) {
    return res.status(400).json({ error: 'invalid_session_key' });
  }
  if (!slug) {
    return res.status(400).json({ error: 'invalid_slug' });
  }
  if (events.length === 0) {
    return res.status(400).json({ error: 'invalid_events' });
  }

  const tokenRequired = isLoadingTelemetryTokenRequired();
  const token = readRequestToken(req as any, body);
  if (tokenRequired && !isLoadingTelemetryTokenConfigured()) {
    return res.status(503).json({ error: 'token_not_configured' });
  }

  let tokenValidated = false;
  let tokenReason: string | undefined;
  if (token) {
    const tokenResult = verifyLoadingTelemetryToken(token, slug);
    tokenValidated = tokenResult.ok;
    if (!tokenResult.ok) tokenReason = tokenResult.reason || 'invalid_token';
  } else if (tokenRequired) {
    tokenReason = 'missing_token';
  }

  if (tokenRequired && !tokenValidated) {
    return res.status(401).json({ error: tokenReason || 'invalid_token' });
  }

  const startedAtFromBody = toDate(body.startedAt);
  const startedAt = startedAtFromBody || events[0]?.eventAt || new Date();
  const userAgent = trimTo(req.header('user-agent'), 350);
  const ipHash = getIpHash(req as any);

  try {
    const loadingTelemetrySessionClient = getLoadingTelemetrySessionClient();
    const loadingTelemetryEventClient = getLoadingTelemetryEventClient();

    let session = await loadingTelemetrySessionClient.findUnique({
      where: { sessionKey },
    });

    if (!session) {
      session = await loadingTelemetrySessionClient.create({
        data: {
          sessionKey,
          slug,
          ...(source ? { source } : {}),
          startedAt,
          ...(userAgent ? { userAgent } : {}),
          ...(ipHash ? { ipHash } : {}),
        },
      });
    } else if (session.slug !== slug) {
      session = await loadingTelemetrySessionClient.update({
        where: { id: session.id },
        data: { slug },
      });
    }

    const existingEventsCount = await loadingTelemetryEventClient.count({
      where: { sessionId: session.id },
    });
    const remainingCapacity = Math.max(0, MAX_EVENTS_PER_SESSION - existingEventsCount);
    if (remainingCapacity <= 0) {
      return res.status(429).json({
        error: 'session_event_cap_reached',
        sessionKey,
        slug,
        maxEventsPerSession: MAX_EVENTS_PER_SESSION,
        existingEvents: existingEventsCount,
        droppedByCap: events.length,
      });
    }
    const acceptedEvents =
      remainingCapacity >= events.length ? events : events.slice(0, remainingCapacity);
    const droppedByCap = Math.max(0, events.length - acceptedEvents.length);
    const batch = summarizeBatch(acceptedEvents);

    const insertResult = await loadingTelemetryEventClient.createMany({
      data: acceptedEvents.map((event) => ({
        sessionId: session.id,
        seq: event.seq,
        type: event.type,
        eventAt: event.eventAt,
        ...(event.statusText ? { statusText: event.statusText } : {}),
        ...(event.fileName ? { fileName: event.fileName } : {}),
        ...(typeof event.progressPct === 'number' ? { progressPct: event.progressPct } : {}),
        ...(event.payload !== undefined ? { payload: event.payload as any } : {}),
      })),
      skipDuplicates: true,
    });

    const mergedStartedAt = minDate(session.startedAt, startedAt, batch.firstEventAt) || startedAt;
    const mergedFirstEventAt = minDate(session.firstEventAt, batch.firstEventAt);
    const mergedLastEventAt = maxDate(session.lastEventAt, batch.lastEventAt);
    const mergedStatus = batch.lastStatus || session.lastStatus || null;
    const mergedFile = batch.lastFile || session.lastFile || null;
    const mergedMaxProgress = Math.max(session.maxProgress || 0, batch.maxProgress || 0);
    const existingCompletionSignal =
      Boolean(session.completed) ||
      isCompletionStatus(session.lastStatus) ||
      (session.maxProgress || 0) >= 99;
    const mergedCompletionSignal =
      existingCompletionSignal ||
      batch.sawCompletionSignal ||
      isCompletionStatus(batch.lastStatus) ||
      mergedMaxProgress >= 99;
    const mergedCompletedAt =
      session.completedAt ||
      (mergedCompletionSignal
        ? batch.endedAt || batch.lastEventAt || session.lastEventAt || undefined
        : undefined);
    const mergedCompleted = Boolean(session.completed || (mergedCompletionSignal && mergedCompletedAt));
    const mergedUserAgent = session.userAgent || userAgent || null;
    const mergedSource = session.source || source || null;
    const mergedIpHash = session.ipHash || ipHash || null;
    const mergedDuration =
      mergedCompleted && mergedCompletedAt ? msDiff(mergedStartedAt, mergedCompletedAt) : session.totalDurationMs;

    await loadingTelemetrySessionClient.update({
      where: { id: session.id },
      data: {
        startedAt: mergedStartedAt,
        ...(mergedFirstEventAt ? { firstEventAt: mergedFirstEventAt } : {}),
        ...(mergedLastEventAt ? { lastEventAt: mergedLastEventAt } : {}),
        ...(mergedCompletedAt ? { completedAt: mergedCompletedAt } : {}),
        completed: mergedCompleted,
        ...(typeof mergedDuration === 'number' ? { totalDurationMs: mergedDuration } : {}),
        ...(mergedStatus ? { lastStatus: mergedStatus } : {}),
        ...(mergedFile ? { lastFile: mergedFile } : {}),
        ...(mergedMaxProgress > 0 ? { maxProgress: mergedMaxProgress } : {}),
        ...(mergedUserAgent ? { userAgent: mergedUserAgent } : {}),
        ...(mergedSource ? { source: mergedSource } : {}),
        ...(mergedIpHash ? { ipHash: mergedIpHash } : {}),
      },
    });

    return res.json({
      ok: true,
      sessionKey,
      slug,
      received: events.length,
      accepted: acceptedEvents.length,
      inserted: insertResult.count,
      deduplicated: Math.max(0, acceptedEvents.length - insertResult.count),
      droppedByCap,
      completed: mergedCompleted,
      tokenValidated,
      ...(tokenReason ? { tokenReason } : {}),
    });
  } catch (error) {
    console.error('loading telemetry ingest failed', error);
    return res.status(500).json({ error: 'ingest_failed' });
  }
});

router.get('/admin/health', authMiddleware, requireRole(UserRole.SUPERADMIN), async (_req, res) => {
  try {
    const loadingTelemetrySessionClient = getLoadingTelemetrySessionClient();
    const loadingTelemetryEventClient = getLoadingTelemetryEventClient();

    const now = new Date();
    const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const recentLiveSince = new Date(now.getTime() - 2 * 60 * 1000);
    const retentionCutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const [
      totalSessions,
      totalEvents,
      sessionsLast24h,
      eventsLast24h,
      recentActiveSessions,
      pendingRetentionSessions,
      oldestSession,
      newestSession,
    ] = await Promise.all([
      loadingTelemetrySessionClient.count(),
      loadingTelemetryEventClient.count(),
      loadingTelemetrySessionClient.count({
        where: {
          startedAt: {
            gte: since24h,
          },
        },
      }),
      loadingTelemetryEventClient.count({
        where: {
          eventAt: {
            gte: since24h,
          },
        },
      }),
      loadingTelemetrySessionClient.count({
        where: {
          lastEventAt: {
            gte: recentLiveSince,
          },
        },
      }),
      loadingTelemetrySessionClient.count({
        where: {
          startedAt: {
            lt: retentionCutoff,
          },
        },
      }),
      loadingTelemetrySessionClient.findFirst({
        select: { startedAt: true, slug: true },
        orderBy: {
          startedAt: 'asc',
        },
      }),
      loadingTelemetrySessionClient.findFirst({
        select: { startedAt: true, lastEventAt: true, slug: true },
        orderBy: {
          startedAt: 'desc',
        },
      }),
    ]);

    return res.json({
      generatedAt: now.toISOString(),
      ingest: {
        rateLimitPerMin: ingestRateLimitMax,
        maxEventsPerBatch: MAX_EVENTS_PER_BATCH,
        maxEventsPerSession: MAX_EVENTS_PER_SESSION,
      },
      token: {
        required: isLoadingTelemetryTokenRequired(),
        configured: isLoadingTelemetryTokenConfigured(),
        ttlSec: getLoadingTelemetryTokenTtlSec(),
      },
      retention: {
        enabled: CLEANUP_ENABLED,
        retentionDays: RETENTION_DAYS,
        cleanupIntervalMin: CLEANUP_INTERVAL_MIN,
        cutoff: retentionCutoff.toISOString(),
        pendingSessions: pendingRetentionSessions,
        cleanup: {
          running: cleanupState.running,
          totalRuns: cleanupState.totalRuns,
          totalDeletedSessions: cleanupState.totalDeletedSessions,
          lastRunAt: cleanupState.lastRunAt ? cleanupState.lastRunAt.toISOString() : null,
          lastDeletedSessions: cleanupState.lastDeletedSessions,
          lastError: cleanupState.lastError,
        },
      },
      limits: {
        maxAdminSessions: MAX_ADMIN_SESSIONS,
        maxAdminEvents: MAX_ADMIN_EVENTS,
        maxTrackedFiles: MAX_TRACKED_FILES,
        maxStepDurationMs: MAX_EVENT_STEP_DURATION_MS,
      },
      totals: {
        sessions: totalSessions,
        events: totalEvents,
        sessionsLast24h,
        eventsLast24h,
        recentActiveSessions,
      },
      oldestSession: oldestSession
        ? {
            slug: oldestSession.slug,
            startedAt: oldestSession.startedAt.toISOString(),
          }
        : null,
      newestSession: newestSession
        ? {
            slug: newestSession.slug,
            startedAt: newestSession.startedAt.toISOString(),
            lastEventAt: newestSession.lastEventAt ? newestSession.lastEventAt.toISOString() : null,
          }
        : null,
    });
  } catch (error) {
    console.error('loading telemetry health failed', error);
    return res.status(500).json({ error: 'telemetry_health_failed' });
  }
});

router.get('/admin/slugs', authMiddleware, requireRole(UserRole.SUPERADMIN), async (req, res) => {
  const range = parseRangeQuery(req.query.range);
  const now = new Date();
  const since = new Date(now.getTime() - rangeToWindowMs(range));

  try {
    const loadingTelemetrySessionClient = getLoadingTelemetrySessionClient();
    const rows = (await loadingTelemetrySessionClient.findMany({
      where: {
        startedAt: {
          gte: since,
          lte: now,
        },
      },
      select: {
        slug: true,
        startedAt: true,
        completed: true,
      },
      orderBy: [{ startedAt: 'desc' }, { slug: 'asc' }],
      take: MAX_ADMIN_SESSIONS,
    })) as Array<{
      slug: string;
      startedAt: Date;
      completed: boolean;
    }>;

    const bySlug = new Map<
      string,
      {
        slug: string;
        sessions: number;
        completed: number;
        lastStartedAt?: Date;
      }
    >();

    rows.forEach((row) => {
      const slug = String(row.slug || '').trim();
      if (!slug) return;
      const current =
        bySlug.get(slug) || {
          slug,
          sessions: 0,
          completed: 0,
        };
      current.sessions += 1;
      if (row.completed) current.completed += 1;
      if (!current.lastStartedAt || row.startedAt.getTime() > current.lastStartedAt.getTime()) {
        current.lastStartedAt = row.startedAt;
      }
      bySlug.set(slug, current);
    });

    const items = [...bySlug.values()]
      .sort((a, b) => {
        if (b.sessions !== a.sessions) return b.sessions - a.sessions;
        return a.slug.localeCompare(b.slug);
      })
      .map((entry) => ({
        slug: entry.slug,
        sessions: entry.sessions,
        completed: entry.completed,
        abandoned: Math.max(0, entry.sessions - entry.completed),
        completionRatePct: entry.sessions > 0 ? round1((entry.completed / entry.sessions) * 100) : 0,
        lastStartedAt: entry.lastStartedAt ? entry.lastStartedAt.toISOString() : null,
      }));

    return res.json({
      range,
      window: {
        from: since.toISOString(),
        to: now.toISOString(),
      },
      totalSessionsScanned: rows.length,
      truncated: rows.length >= MAX_ADMIN_SESSIONS,
      items,
    });
  } catch (error) {
    console.error('loading telemetry slug summary failed', error);
    return res.status(500).json({ error: 'telemetry_slug_summary_failed' });
  }
});

router.get('/admin/summary', authMiddleware, requireRole(UserRole.SUPERADMIN), async (req, res) => {
  const range = parseRangeQuery(req.query.range);
  const now = new Date();
  const since = new Date(now.getTime() - rangeToWindowMs(range));
  const slug = req.query.slug ? sanitizeSlug(req.query.slug) : undefined;
  if (req.query.slug && !slug) {
    return res.status(400).json({ error: 'invalid_slug' });
  }

  try {
    const loadingTelemetrySessionClient = getLoadingTelemetrySessionClient();
    const loadingTelemetryEventClient = getLoadingTelemetryEventClient();

    const where: Record<string, unknown> = {
      startedAt: {
        gte: since,
        lte: now,
      },
      ...(slug ? { slug } : {}),
    };

    const sessions = (await loadingTelemetrySessionClient.findMany({
      where,
      select: {
        id: true,
        slug: true,
        startedAt: true,
        firstEventAt: true,
        lastEventAt: true,
        completedAt: true,
        completed: true,
        totalDurationMs: true,
        lastStatus: true,
        lastFile: true,
        maxProgress: true,
        source: true,
        createdAt: true,
      },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: MAX_ADMIN_SESSIONS,
    })) as AdminSessionRow[];

    const sessionIds = sessions.map((session) => session.id);
    const eventTypesForAnalysis: TelemetryEventType[] = [
      'STATUS_CHANGE',
      'STAGE_MARK',
      'FILE_DOWNLOAD',
      'SESSION_END',
    ];

    const events: AdminEventRow[] = [];
    if (sessionIds.length > 0) {
      const sessionIdChunks = chunkArray(sessionIds, 500);
      for (const sessionIdChunk of sessionIdChunks) {
        if (events.length >= MAX_ADMIN_EVENTS) break;
        const remaining = MAX_ADMIN_EVENTS - events.length;
        const rows = (await loadingTelemetryEventClient.findMany({
          where: {
            sessionId: { in: sessionIdChunk },
            type: { in: eventTypesForAnalysis },
          },
          select: {
            sessionId: true,
            seq: true,
            type: true,
            eventAt: true,
            statusText: true,
            fileName: true,
            progressPct: true,
          },
          orderBy: [{ sessionId: 'asc' }, { seq: 'asc' }],
          take: remaining,
        })) as AdminEventRow[];
        events.push(...rows);
      }
    }

    const durations: number[] = [];
    const sourceCount = new Map<string, number>();
    let completedSessions = 0;

    const timelineBuckets = buildTimelineBuckets(range, since, now);
    const bucketTotalMs = Math.max(1, now.getTime() - since.getTime());

    const sessionEventMap = new Map<string, AdminEventRow[]>();
    events.forEach((event) => {
      const current = sessionEventMap.get(event.sessionId);
      if (!current) {
        sessionEventMap.set(event.sessionId, [event]);
        return;
      }
      current.push(event);
    });

    const statusCount = new Map<string, number>();
    const stageDurationMap = new Map<string, number[]>();
    const fileDurationMap = new Map<string, { occurrences: number; totalMs: number; maxMs: number; samples: number[] }>();

    sessions.forEach((session) => {
      if (session.completed) completedSessions += 1;

      const source = String(session.source || 'unknown').trim() || 'unknown';
      sourceCount.set(source, (sourceCount.get(source) || 0) + 1);

      const duration = getSessionDurationMs(session);
      if (typeof duration === 'number' && duration > 0) {
        durations.push(duration);
      }

      const startedMs = session.startedAt.getTime();
      const relative = startedMs - since.getTime();
      if (relative >= 0) {
        const idx = Math.min(
          timelineBuckets.length - 1,
          Math.floor((relative / bucketTotalMs) * timelineBuckets.length),
        );
        const bucket = timelineBuckets[idx];
        if (bucket) {
          bucket.sessions += 1;
          if (session.completed) {
            bucket.completed += 1;
          } else {
            bucket.abandoned += 1;
          }
          if (typeof duration === 'number' && duration > 0) {
            bucket.durations.push(duration);
          }
        }
      }

      const sessionEvents = sessionEventMap.get(session.id) || [];
      if (sessionEvents.length === 0) return;

      for (let i = 0; i < sessionEvents.length; i += 1) {
        const current = sessionEvents[i];
        if (!current) continue;

        if (current.type === 'STATUS_CHANGE' || current.type === 'STAGE_MARK') {
          const stage = normalizeStageName(current.statusText);
          if (stage) {
            statusCount.set(stage, (statusCount.get(stage) || 0) + 1);
          }
        }

        const next = sessionEvents[i + 1];
        if (!next) continue;

        let stepDurationMs = msDiff(current.eventAt, next.eventAt);
        if (stepDurationMs <= 0) continue;
        if (stepDurationMs > MAX_EVENT_STEP_DURATION_MS) {
          stepDurationMs = MAX_EVENT_STEP_DURATION_MS;
        }

        if (current.type === 'STATUS_CHANGE' || current.type === 'STAGE_MARK') {
          const stage = normalizeStageName(current.statusText);
          if (stage) {
            const samples = stageDurationMap.get(stage) || [];
            samples.push(stepDurationMs);
            stageDurationMap.set(stage, samples);
          }
        }

        if (current.type === 'FILE_DOWNLOAD') {
          const fileName = normalizeFileName(current.fileName);
          if (!fileName) continue;
          if (!fileDurationMap.has(fileName) && fileDurationMap.size >= MAX_TRACKED_FILES) {
            continue;
          }
          const fileStats = fileDurationMap.get(fileName) || {
            occurrences: 0,
            totalMs: 0,
            maxMs: 0,
            samples: [],
          };
          fileStats.occurrences += 1;
          fileStats.totalMs += stepDurationMs;
          fileStats.maxMs = Math.max(fileStats.maxMs, stepDurationMs);
          fileStats.samples.push(stepDurationMs);
          fileDurationMap.set(fileName, fileStats);
        }
      }
    });

    const totalSessions = sessions.length;
    const abandonedSessions = Math.max(0, totalSessions - completedSessions);
    const completionRatePct = totalSessions > 0 ? round1((completedSessions / totalSessions) * 100) : 0;
    const avgDurationMs = durations.length > 0 ? Math.round(average(durations)) : 0;
    const p50DurationMs = durations.length > 0 ? Math.round(percentile(durations, 50)) : 0;
    const p95DurationMs = durations.length > 0 ? Math.round(percentile(durations, 95)) : 0;

    const stageDurations = [...stageDurationMap.entries()]
      .map(([stage, samples]) => ({
        stage,
        count: samples.length,
        avgMs: Math.round(average(samples)),
        p50Ms: Math.round(percentile(samples, 50)),
        p95Ms: Math.round(percentile(samples, 95)),
        maxMs: samples.length > 0 ? Math.max(...samples) : 0,
      }))
      .sort((a, b) => {
        if (b.p95Ms !== a.p95Ms) return b.p95Ms - a.p95Ms;
        return b.count - a.count;
      })
      .slice(0, 16);

    const slowFiles = [...fileDurationMap.entries()]
      .map(([fileName, stats]) => ({
        fileName,
        occurrences: stats.occurrences,
        avgMs: Math.round(stats.totalMs / Math.max(1, stats.occurrences)),
        p95Ms: Math.round(percentile(stats.samples, 95)),
        maxMs: stats.maxMs,
      }))
      .sort((a, b) => {
        if (b.p95Ms !== a.p95Ms) return b.p95Ms - a.p95Ms;
        if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;
        return a.fileName.localeCompare(b.fileName);
      })
      .slice(0, 20);

    const statusBreakdown = [...statusCount.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.status.localeCompare(b.status);
      })
      .slice(0, 16);

    const sources = [...sourceCount.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count);

    const timeline = timelineBuckets.map((bucket) => {
      const bucketAvg = bucket.durations.length > 0 ? Math.round(average(bucket.durations)) : 0;
      const bucketP95 = bucket.durations.length > 0 ? Math.round(percentile(bucket.durations, 95)) : 0;
      return {
        from: bucket.from.toISOString(),
        to: bucket.to.toISOString(),
        label: bucket.label,
        sessions: bucket.sessions,
        completed: bucket.completed,
        abandoned: bucket.abandoned,
        avgDurationMs: bucketAvg,
        p95DurationMs: bucketP95,
      };
    });

    return res.json({
      generatedAt: now.toISOString(),
      range,
      window: {
        from: since.toISOString(),
        to: now.toISOString(),
      },
      slug: slug || null,
      limits: {
        maxSessions: MAX_ADMIN_SESSIONS,
        maxEvents: MAX_ADMIN_EVENTS,
        maxTrackedFiles: MAX_TRACKED_FILES,
        maxStepDurationMs: MAX_EVENT_STEP_DURATION_MS,
      },
      totals: {
        sessions: totalSessions,
        completed: completedSessions,
        abandoned: abandonedSessions,
        completionRatePct,
        eventsAnalyzed: events.length,
        sessionsWithDuration: durations.length,
        avgDurationMs,
        p50DurationMs,
        p95DurationMs,
      },
      statusBreakdown,
      stageDurations,
      slowFiles,
      sources,
      timeline,
      truncated: {
        sessions: sessions.length >= MAX_ADMIN_SESSIONS,
        events: events.length >= MAX_ADMIN_EVENTS,
      },
    });
  } catch (error) {
    console.error('loading telemetry summary failed', error);
    return res.status(500).json({ error: 'telemetry_summary_failed' });
  }
});

export default router;

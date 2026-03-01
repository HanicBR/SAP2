import { createHash } from 'crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../db/client';

const router = Router();

const MAX_EVENTS_PER_BATCH = 120;
const MAX_STATUS_TEXT_LENGTH = 300;
const MAX_FILE_NAME_LENGTH = 600;
const MAX_SOURCE_LENGTH = 48;
const MAX_SESSION_KEY_LENGTH = 128;
const MAX_PAYLOAD_JSON_LENGTH = 3_500;

const parsePositiveIntEnv = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const ingestRateLimitMax = parsePositiveIntEnv(
  process.env.LOADING_TELEMETRY_INGEST_MAX_PER_MIN,
  360,
);

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
  completedAt?: Date;
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

const summarizeBatch = (events: SanitizedEvent[]): BatchSummary => {
  if (!events.length) return {};

  let firstEventAt: Date | undefined;
  let lastEventAt: Date | undefined;
  let completedAt: Date | undefined;
  let lastStatus: string | undefined;
  let lastFile: string | undefined;
  let maxProgress: number | undefined;

  events.forEach((event) => {
    firstEventAt = minDate(firstEventAt, event.eventAt);
    lastEventAt = maxDate(lastEventAt, event.eventAt);

    if (event.type === 'SESSION_END') {
      completedAt = maxDate(completedAt, event.eventAt);
    }

    if (event.type === 'STATUS_CHANGE' && event.statusText) {
      const normalized = event.statusText.toLowerCase();
      if (normalized === 'starting lua...' || normalized === 'starting lua') {
        completedAt = maxDate(completedAt, event.eventAt);
      }
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
    ...(completedAt ? { completedAt } : {}),
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

  const startedAtFromBody = toDate(body.startedAt);
  const batch = summarizeBatch(events);
  const startedAt = startedAtFromBody || batch.firstEventAt || new Date();
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
          ...(batch.firstEventAt ? { firstEventAt: batch.firstEventAt } : {}),
          ...(batch.lastEventAt ? { lastEventAt: batch.lastEventAt } : {}),
          ...(batch.completedAt ? { completedAt: batch.completedAt, completed: true } : {}),
          ...(batch.lastStatus ? { lastStatus: batch.lastStatus } : {}),
          ...(batch.lastFile ? { lastFile: batch.lastFile } : {}),
          ...(typeof batch.maxProgress === 'number' ? { maxProgress: batch.maxProgress } : {}),
          ...(userAgent ? { userAgent } : {}),
          ...(ipHash ? { ipHash } : {}),
          ...(batch.completedAt ? { totalDurationMs: msDiff(startedAt, batch.completedAt) } : {}),
        },
      });
    } else if (session.slug !== slug) {
      session = await loadingTelemetrySessionClient.update({
        where: { id: session.id },
        data: { slug },
      });
    }

    const insertResult = await loadingTelemetryEventClient.createMany({
      data: events.map((event) => ({
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
    const mergedCompletedAt = session.completedAt || batch.completedAt;
    const mergedCompleted = Boolean(session.completed || mergedCompletedAt);
    const mergedStatus = batch.lastStatus || session.lastStatus || null;
    const mergedFile = batch.lastFile || session.lastFile || null;
    const mergedMaxProgress = Math.max(session.maxProgress || 0, batch.maxProgress || 0);
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
      inserted: insertResult.count,
      deduplicated: Math.max(0, events.length - insertResult.count),
      completed: mergedCompleted,
    });
  } catch (error) {
    console.error('loading telemetry ingest failed', error);
    return res.status(500).json({ error: 'ingest_failed' });
  }
});

export default router;

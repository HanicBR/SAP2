import { createHmac } from 'crypto';

type TokenPayload = {
  v: 1;
  slug: string;
  iat: number;
  exp: number;
};

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

const base64UrlEncode = (value: string): string =>
  Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

const base64UrlDecode = (value: string): string => {
  const normalized = String(value || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padding = normalized.length % 4;
  const padded = padding ? normalized + '='.repeat(4 - padding) : normalized;
  return Buffer.from(padded, 'base64').toString('utf8');
};

const normalizeSlug = (value: string): string =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);

const getTokenSecret = (): string =>
  String(process.env.LOADING_TELEMETRY_TOKEN_SECRET || process.env.JWT_SECRET || '').trim();

export const isLoadingTelemetryTokenConfigured = (): boolean => getTokenSecret().length >= 16;

export const isLoadingTelemetryTokenRequired = (): boolean =>
  parseBoolEnv(process.env.LOADING_TELEMETRY_REQUIRE_TOKEN, false);

export const getLoadingTelemetryTokenTtlSec = (): number =>
  parsePositiveIntEnv(process.env.LOADING_TELEMETRY_TOKEN_TTL_SEC, 15 * 60);

const signBody = (body: string, secret: string): string =>
  createHmac('sha256', secret)
    .update(body)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

export const issueLoadingTelemetryToken = (slugRaw: string): string | null => {
  const secret = getTokenSecret();
  const slug = normalizeSlug(slugRaw);
  if (!slug) return null;
  if (!secret) return null;

  const now = Math.floor(Date.now() / 1000);
  const ttl = getLoadingTelemetryTokenTtlSec();
  const payload: TokenPayload = {
    v: 1,
    slug,
    iat: now,
    exp: now + ttl,
  };

  const body = base64UrlEncode(JSON.stringify(payload));
  const sig = signBody(body, secret);
  return `${body}.${sig}`;
};

export const verifyLoadingTelemetryToken = (
  tokenRaw: string,
  expectedSlugRaw: string,
): { ok: boolean; reason?: string; payload?: TokenPayload } => {
  const token = String(tokenRaw || '').trim();
  if (!token) return { ok: false, reason: 'missing_token' };

  const secret = getTokenSecret();
  if (!secret) return { ok: false, reason: 'token_secret_not_configured' };

  const [body, sig] = token.split('.', 2);
  if (!body || !sig) return { ok: false, reason: 'malformed_token' };

  const expectedSig = signBody(body, secret);
  if (sig !== expectedSig) return { ok: false, reason: 'invalid_signature' };

  let payload: TokenPayload;
  try {
    const decoded = base64UrlDecode(body);
    payload = JSON.parse(decoded) as TokenPayload;
  } catch {
    return { ok: false, reason: 'invalid_payload' };
  }

  if (!payload || payload.v !== 1) return { ok: false, reason: 'invalid_version' };
  if (!Number.isFinite(payload.iat) || !Number.isFinite(payload.exp)) {
    return { ok: false, reason: 'invalid_timestamps' };
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) return { ok: false, reason: 'token_expired' };

  const expectedSlug = normalizeSlug(expectedSlugRaw);
  if (!expectedSlug) return { ok: false, reason: 'invalid_expected_slug' };
  if (normalizeSlug(payload.slug) !== expectedSlug) {
    return { ok: false, reason: 'slug_mismatch' };
  }

  return { ok: true, payload };
};

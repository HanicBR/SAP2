import type { NextFunction, Request, Response } from 'express';
import { recordSiteAudit } from '../services/siteAudit';

declare module 'express-serve-static-core' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Request {
    auditAction?: string;
    auditMetadata?: Record<string, unknown>;
  }
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SENSITIVE_KEYS = new Set([
  'password',
  'newPassword',
  'currentPassword',
  'token',
  'authorization',
  'auth',
  'secret',
  'smtpPass',
  'jwtSecret',
]);
const EXCLUDED_PATH_PREFIXES = ['/api/ingest', '/api/loading-telemetry/ingest'];

const truncateText = (value: unknown, max = 240): string | undefined => {
  const parsed = String(value ?? '').trim();
  if (!parsed) return undefined;
  return parsed.length > max ? parsed.slice(0, max) : parsed;
};

const sanitizeObjectKeys = (value: unknown): string[] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value as Record<string, unknown>).slice(0, 40);
};

const sanitizeQuery = (value: unknown): Record<string, string> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const result: Record<string, string> = {};
  Object.keys(source)
    .slice(0, 30)
    .forEach((key) => {
      if (SENSITIVE_KEYS.has(key)) {
        result[key] = '[redacted]';
        return;
      }
      const parsed = truncateText(source[key], 120);
      if (parsed) result[key] = parsed;
    });
  return Object.keys(result).length > 0 ? result : undefined;
};

const normalizePath = (value: unknown): string | undefined => {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  const withoutQuery = raw.split('?')[0] || raw;
  return withoutQuery.length > 400 ? withoutQuery.slice(0, 400) : withoutQuery;
};

const resolveAuditPath = (req: Request): string => {
  const routePath = typeof req.route?.path === 'string' ? req.route.path : '';
  const baseUrl = normalizePath(req.baseUrl) || '';
  if (routePath) {
    return `${baseUrl}${routePath}`;
  }
  return normalizePath(req.originalUrl || req.url) || '/';
};

const shouldAuditRequest = (req: Request): boolean => {
  const method = String(req.method || '').toUpperCase();
  if (!MUTATING_METHODS.has(method)) return false;
  const path = normalizePath(req.originalUrl || req.url) || '';
  if (!path.startsWith('/api/')) return false;
  if (EXCLUDED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) return false;
  return true;
};

export const setAuditContext = (
  req: Request,
  action: string,
  metadata?: Record<string, unknown>,
): void => {
  const parsedAction = String(action || '').trim();
  if (parsedAction) req.auditAction = parsedAction;
  else delete req.auditAction;

  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    req.auditMetadata = metadata;
  } else {
    delete req.auditMetadata;
  }
};

export const siteAuditMutationMiddleware = (req: Request, res: Response, next: NextFunction) => {
  if (!shouldAuditRequest(req)) {
    return next();
  }

  const startMs = Date.now();
  res.on('finish', () => {
    const user = req.user;
    if (!user?.id) return;

    const method = String(req.method || '').toUpperCase();
    const action = truncateText(req.auditAction || `${method} ${resolveAuditPath(req)}`, 160);
    if (!action) return;

    const query = sanitizeQuery(req.query);
    const params = sanitizeQuery(req.params);
    const metadata: Record<string, unknown> = {
      durationMs: Math.max(0, Date.now() - startMs),
      bodyKeys: sanitizeObjectKeys(req.body),
      ...(query ? { query } : {}),
      ...(params ? { params } : {}),
      ...(req.auditMetadata ? { context: req.auditMetadata } : {}),
    };

    void recordSiteAudit({
      userId: user.id,
      username: user.username,
      userRole: user.role,
      action,
      method,
      path: resolveAuditPath(req),
      statusCode: res.statusCode,
      ipAddress: truncateText(req.ip, 120),
      userAgent: truncateText(req.get('user-agent') || '', 300),
      metadata,
    });
  });

  return next();
};

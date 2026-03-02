import { prisma } from '../db/client';
import { UserRole } from '../domain';

const MAX_TEXT = 512;
const MAX_METADATA_JSON_BYTES = 12_000;

const toTrimmedText = (value: unknown, max = MAX_TEXT): string | undefined => {
  const parsed = String(value ?? '').trim();
  if (!parsed) return undefined;
  return parsed.length > max ? parsed.slice(0, max) : parsed;
};

const normalizeStatusCode = (value: unknown): number => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed;
};

const pruneMetadata = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  try {
    const body = JSON.stringify(candidate);
    if (!body) return undefined;
    if (body.length <= MAX_METADATA_JSON_BYTES) return JSON.parse(body) as Record<string, unknown>;
    return {
      truncated: true,
      bytes: body.length,
    };
  } catch {
    return { invalid: true };
  }
};

export interface SiteAuditCreateInput {
  userId?: string | undefined;
  username?: string | undefined;
  userRole?: UserRole | null | undefined;
  action: string;
  method: string;
  path: string;
  statusCode: number;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export const recordSiteAudit = async (input: SiteAuditCreateInput): Promise<void> => {
  const action = toTrimmedText(input.action, 160);
  const method = toTrimmedText(input.method, 24);
  const path = toTrimmedText(input.path, 400);
  const statusCode = normalizeStatusCode(input.statusCode);
  const userId = toTrimmedText(input.userId, 64);
  const username = toTrimmedText(input.username, 120);
  const ipAddress = toTrimmedText(input.ipAddress, 120);
  const userAgent = toTrimmedText(input.userAgent, 300);
  const metadata = pruneMetadata(input.metadata);
  if (!action || !method || !path || statusCode <= 0) return;

  try {
    await prisma.siteAuditLog.create({
      data: {
        ...(userId ? { userId } : {}),
        ...(username ? { username } : {}),
        ...(input.userRole && Object.values(UserRole).includes(input.userRole)
          ? { userRole: input.userRole as any }
          : {}),
        action,
        method: method.toUpperCase(),
        path,
        statusCode,
        ...(ipAddress ? { ipAddress } : {}),
        ...(userAgent ? { userAgent } : {}),
        ...(metadata ? { metadata: metadata as any } : {}),
      },
    });
  } catch (err: any) {
    console.error('[site-audit] create failed', err?.message || err);
  }
};

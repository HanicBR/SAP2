import { prisma } from '../db/client';
import {
  VipAutomationActionStatus as PrismaVipAutomationActionStatus,
  VipAutomationActionType as PrismaVipAutomationActionType,
} from '@prisma/client';
import { enqueueServerAction, ServerAction } from './serverActions';

export type VipAutomationActionType = 'GRANT' | 'REVOKE';

export interface VipAutomationBuildInput {
  action: VipAutomationActionType;
  steamId: string;
  vipPlan?: string | null;
  vipExpiry?: Date | string | null;
  vipDurationDays?: number | string | null;
  serverId?: string | null;
  retryOfActionId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface VipAutomationBuildResult {
  ok: boolean;
  skipped: boolean;
  reason?: string;
  serverId?: string;
  command?: string;
  metadata?: Record<string, unknown>;
}

export interface VipAutomationDispatchResult extends VipAutomationBuildResult {
  queued: boolean;
  actionId?: string;
  vipActionId?: string;
}

type VipAutomationEnvConfig = {
  enabled: boolean;
  sandboxServerId: string | undefined;
  grantTemplate: string | undefined;
  revokeTemplate: string | undefined;
};

export interface VipAutomationAdminConfig {
  enabled: boolean;
  sandboxServerId?: string;
  grantTemplate: string;
  revokeTemplate: string;
  source: 'env' | 'site_config';
}

type VipAutomationBuildOptions = {
  allowRawTokens: boolean;
  enforceSingleLineCommand: boolean;
};

const metrics = {
  vip_command_build_failures: 0,
  byReason: {} as Record<string, number>,
  lastFailureAt: '' as string,
  lastFailureReason: '' as string,
};

const parseBoolEnv = (value: string | undefined, fallback = false): boolean => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!normalized) return fallback;
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
};

const parseBoolUnknown = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) return undefined;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
};

const quoteConsoleArg = (value: string) => {
  const raw = String(value || '');
  return `"${raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
};

const bumpCommandBuildFailure = (reason: string) => {
  const key = String(reason || 'unknown').trim().toLowerCase() || 'unknown';
  metrics.vip_command_build_failures += 1;
  metrics.byReason[key] = (metrics.byReason[key] || 0) + 1;
  metrics.lastFailureAt = new Date().toISOString();
  metrics.lastFailureReason = key;
};

const getEnvConfig = (): VipAutomationEnvConfig => {
  // ENV contract:
  // - VIP_AUTOMATION_ENABLED=1|true
  // - VIP_AUTOMATION_SANDBOX_SERVER_ID=<serverId> (optional)
  // - VIP_AUTOMATION_GRANT_TEMPLATE=<console command template>
  // - VIP_AUTOMATION_REVOKE_TEMPLATE=<console command template>
  const sandboxServerId = String(process.env.VIP_AUTOMATION_SANDBOX_SERVER_ID || '').trim() || undefined;
  const grantTemplate = String(process.env.VIP_AUTOMATION_GRANT_TEMPLATE || '').trim() || undefined;
  const revokeTemplate = String(process.env.VIP_AUTOMATION_REVOKE_TEMPLATE || '').trim() || undefined;

  return {
    enabled: parseBoolEnv(process.env.VIP_AUTOMATION_ENABLED, false),
    sandboxServerId,
    grantTemplate,
    revokeTemplate,
  };
};

const readSiteVipAutomationOverride = async (): Promise<Partial<VipAutomationEnvConfig>> => {
  const row = await prisma.siteConfig.findUnique({
    where: { id: 1 },
    select: { data: true },
  });

  const root =
    row?.data && typeof row.data === 'object' && !Array.isArray(row.data)
      ? (row.data as Record<string, unknown>)
      : null;
  if (!root) return {};

  const raw = root.vipAutomation;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const data = raw as Record<string, unknown>;

  const enabled = parseBoolUnknown(data.enabled);
  const sandboxServerId = String(data.sandboxServerId || '').trim() || undefined;
  const grantTemplate = String(data.grantTemplate || '').trim() || undefined;
  const revokeTemplate = String(data.revokeTemplate || '').trim() || undefined;

  return {
    ...(enabled !== undefined ? { enabled } : {}),
    ...(sandboxServerId ? { sandboxServerId } : {}),
    ...(grantTemplate ? { grantTemplate } : {}),
    ...(revokeTemplate ? { revokeTemplate } : {}),
  };
};

const getRuntimeConfig = async (): Promise<VipAutomationEnvConfig & { source: 'env' | 'site_config' }> => {
  const env = getEnvConfig();
  try {
    const override = await readSiteVipAutomationOverride();
    if (!Object.keys(override).length) {
      return { ...env, source: 'env' };
    }
    return {
      enabled: override.enabled ?? env.enabled,
      sandboxServerId: override.sandboxServerId ?? env.sandboxServerId,
      grantTemplate: override.grantTemplate ?? env.grantTemplate,
      revokeTemplate: override.revokeTemplate ?? env.revokeTemplate,
      source: 'site_config',
    };
  } catch (err: any) {
    console.error('VIP automation config fallback to env', err?.message || err);
    return { ...env, source: 'env' };
  }
};

const parseExpiry = (raw: Date | string | null | undefined): Date | null => {
  if (!raw) return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  const parsed = new Date(String(raw));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const parseDurationDays = (raw: number | string | null | undefined): number | null => {
  if (raw === undefined || raw === null || raw === '') return null;
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

const mapVipPlanToServerGroup = (vipPlan: string): string => {
  const plan = String(vipPlan || '').trim();
  const normalized = plan.toLowerCase();

  if (normalized === 'vip bronze' || normalized === 'bronze' || normalized === 'vip') return 'VIP';
  if (normalized === 'vip prata' || normalized === 'prata' || normalized === 'vip+') return 'VIP+';
  if (normalized === 'vip ouro' || normalized === 'ouro' || normalized === 'vip++') return 'VIP++';

  return plan;
};

const extractTemplateTokens = (template: string): string[] => {
  const tokens: string[] = [];
  String(template).replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_match, token) => {
    tokens.push(String(token));
    return '';
  });
  return tokens;
};

const templateHasRawTokens = (template: string) =>
  extractTemplateTokens(template).some((token) => /raw$/i.test(token));

const templateHasDurationTokens = (template: string) =>
  extractTemplateTokens(template).some((token) =>
    ['vipDuration', 'vipDurationRaw', 'vipDurationDays'].includes(String(token)),
  );

const renderTemplate = (
  template: string,
  input: VipAutomationBuildInput,
): { ok: true; command: string } | { ok: false; reason: string } => {
  const steamId = String(input.steamId || '').trim();
  if (!steamId) {
    bumpCommandBuildFailure('missing_steam_id');
    return { ok: false, reason: 'missing_steam_id' };
  }

  const vipPlan = String(input.vipPlan || '').trim();
  const vipPlanServer = mapVipPlanToServerGroup(vipPlan);
  const vipExpiry = parseExpiry(input.vipExpiry);
  const vipDurationDays = parseDurationDays(input.vipDurationDays);
  const vipDurationText = vipDurationDays ? `${vipDurationDays}d` : '';
  const expiryIso = vipExpiry ? vipExpiry.toISOString() : '';
  const expiryUnix = vipExpiry ? Math.floor(vipExpiry.getTime() / 1000) : 0;
  const action = String(input.action || '').trim().toLowerCase();

  // Supported template tokens:
  // {{steamId}}, {{steamIdRaw}}, {{vipPlan}}, {{vipPlanRaw}},
  // {{vipPlanServer}}, {{vipPlanServerRaw}},
  // {{vipExpiryIso}}, {{vipExpiryIsoRaw}}, {{vipExpiryUnix}},
  // {{vipDuration}}, {{vipDurationRaw}}, {{vipDurationDays}},
  // {{action}}
  const tokenMap: Record<string, string> = {
    steamId: quoteConsoleArg(steamId),
    steamIdRaw: steamId,
    vipPlan: quoteConsoleArg(vipPlan),
    vipPlanRaw: vipPlan,
    vipPlanServer: quoteConsoleArg(vipPlanServer),
    vipPlanServerRaw: vipPlanServer,
    vipExpiryIso: quoteConsoleArg(expiryIso),
    vipExpiryIsoRaw: expiryIso,
    vipExpiryUnix: expiryUnix > 0 ? String(expiryUnix) : '',
    vipDuration: quoteConsoleArg(vipDurationText),
    vipDurationRaw: vipDurationText,
    vipDurationDays: vipDurationDays ? String(vipDurationDays) : '',
    action,
  };

  const unknownTokens = new Set<string>();
  const command = String(template).replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_match, token) => {
    if (Object.prototype.hasOwnProperty.call(tokenMap, token)) {
      return tokenMap[token] || '';
    }
    unknownTokens.add(String(token));
    return '';
  });

  if (unknownTokens.size > 0) {
    bumpCommandBuildFailure('unknown_template_token');
    return { ok: false, reason: `unknown_template_token:${Array.from(unknownTokens).join(',')}` };
  }

  const parsedCommand = command.trim();
  if (!parsedCommand) {
    bumpCommandBuildFailure('empty_command');
    return { ok: false, reason: 'empty_command' };
  }

  let finalCommand = parsedCommand;

  // Backward compatibility for legacy template:
  // sam setrankid {{steamId}} {{vipPlanServer}}
  // If duration tokens are absent, append "<N>d" automatically on GRANT.
  if (
    input.action === 'GRANT' &&
    vipDurationText &&
    !templateHasDurationTokens(template) &&
    /^sam\s+setrankid\b/i.test(parsedCommand)
  ) {
    finalCommand = `${parsedCommand} ${quoteConsoleArg(vipDurationText)}`;
  }

  return { ok: true, command: finalCommand };
};

const resolveSandboxServerId = async (
  requestedServerId: string | null | undefined,
  config: VipAutomationEnvConfig,
): Promise<{ ok: true; serverId: string } | { ok: false; reason: string }> => {
  const explicit = String(requestedServerId || config.sandboxServerId || '').trim();
  if (explicit) {
    const server = await prisma.gameServer.findUnique({
      where: { id: explicit },
      select: { id: true, mode: true },
    });
    if (!server) return { ok: false, reason: 'sandbox_server_not_found' };
    if (server.mode !== 'SANDBOX') return { ok: false, reason: 'sandbox_server_invalid_mode' };
    return { ok: true, serverId: server.id };
  }

  const onlineSandbox = await prisma.gameServer.findFirst({
    where: { mode: 'SANDBOX', status: 'ONLINE' },
    orderBy: [{ lastHeartbeat: 'desc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  if (onlineSandbox) {
    return { ok: true, serverId: onlineSandbox.id };
  }

  const fallbackSandbox = await prisma.gameServer.findFirst({
    where: { mode: 'SANDBOX' },
    orderBy: [{ lastHeartbeat: 'desc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  if (!fallbackSandbox) return { ok: false, reason: 'sandbox_server_missing' };
  return { ok: true, serverId: fallbackSandbox.id };
};

type VipAutomationAuditInput = {
  status: PrismaVipAutomationActionStatus;
  reason?: string | undefined;
  serverId?: string | undefined;
  command?: string | undefined;
  queuedActionId?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
};

const sanitizeMetadata = (
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined => {
  if (!metadata) return undefined;
  try {
    return JSON.parse(JSON.stringify(metadata)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
};

const toPrismaActionType = (action: VipAutomationActionType): PrismaVipAutomationActionType =>
  action === 'REVOKE' ? PrismaVipAutomationActionType.REVOKE : PrismaVipAutomationActionType.GRANT;

const createVipAutomationAudit = async (
  input: VipAutomationBuildInput,
  data: VipAutomationAuditInput,
): Promise<string | undefined> => {
  const steamId = String(input.steamId || '').trim();
  if (!steamId) return undefined;

  const vipPlan = String(input.vipPlan || '').trim() || null;
  const vipExpiry = parseExpiry(input.vipExpiry);
  const retryOfActionId = String(input.retryOfActionId || '').trim() || null;
  const metadata = sanitizeMetadata(data.metadata);

  try {
    const created = await prisma.vipAutomationAction.create({
      data: {
        action: toPrismaActionType(input.action),
        status: data.status,
        steamId,
        vipPlan,
        vipExpiry,
        serverId: String(data.serverId || '').trim() || null,
        command: String(data.command || '').trim() || null,
        metadata: metadata ? (metadata as any) : null,
        reason: String(data.reason || '').trim() || null,
        queuedActionId: String(data.queuedActionId || '').trim() || null,
        retryOfActionId,
      },
      select: { id: true },
    });
    return created.id;
  } catch (err: any) {
    console.error('VIP automation audit create failed', err?.message || err);
    return undefined;
  }
};

export const getVipAutomationMetrics = () => ({
  vip_command_build_failures: metrics.vip_command_build_failures,
  byReason: { ...metrics.byReason },
  lastFailureAt: metrics.lastFailureAt || undefined,
  lastFailureReason: metrics.lastFailureReason || undefined,
});

export const getVipAutomationAdminConfig = async (): Promise<VipAutomationAdminConfig> => {
  const config = await getRuntimeConfig();
  return {
    enabled: config.enabled,
    ...(config.sandboxServerId ? { sandboxServerId: config.sandboxServerId } : {}),
    grantTemplate: config.grantTemplate || '',
    revokeTemplate: config.revokeTemplate || '',
    source: config.source,
  };
};

export const setVipAutomationAdminConfig = async (input: {
  enabled: boolean;
  sandboxServerId?: string | null;
  grantTemplate: string;
  revokeTemplate: string;
}): Promise<VipAutomationAdminConfig> => {
  const enabled = input.enabled === true;
  const sandboxServerId = String(input.sandboxServerId || '').trim() || undefined;
  const grantTemplate = String(input.grantTemplate || '').trim();
  const revokeTemplate = String(input.revokeTemplate || '').trim();

  if (enabled && (!grantTemplate || !revokeTemplate)) {
    throw new Error('missing_template_when_enabled');
  }

  if (templateHasRawTokens(grantTemplate) || templateHasRawTokens(revokeTemplate)) {
    throw new Error('raw_tokens_not_allowed_in_dispatch');
  }

  if (/[\r\n]/.test(grantTemplate) || /[\r\n]/.test(revokeTemplate)) {
    throw new Error('template_contains_newline');
  }

  const existing = await prisma.siteConfig.findUnique({
    where: { id: 1 },
    select: { data: true },
  });

  const root =
    existing?.data && typeof existing.data === 'object' && !Array.isArray(existing.data)
      ? (existing.data as Record<string, unknown>)
      : {};

  const nextVipAutomation: Record<string, unknown> = {
    enabled,
    grantTemplate,
    revokeTemplate,
  };
  if (sandboxServerId) {
    nextVipAutomation.sandboxServerId = sandboxServerId;
  }

  const nextData: Record<string, unknown> = {
    ...root,
    vipAutomation: nextVipAutomation,
  };

  await prisma.siteConfig.upsert({
    where: { id: 1 },
    update: { data: nextData as any },
    create: { id: 1, data: nextData as any },
  });

  return {
    enabled,
    ...(sandboxServerId ? { sandboxServerId } : {}),
    grantTemplate,
    revokeTemplate,
    source: 'site_config',
  };
};

const buildVipAutomation = async (
  input: VipAutomationBuildInput,
  options: VipAutomationBuildOptions,
): Promise<VipAutomationBuildResult> => {
  const config = await getRuntimeConfig();
  if (!config.enabled) {
    return {
      ok: false,
      skipped: true,
      reason: 'vip_automation_disabled',
    };
  }

  const template =
    input.action === 'REVOKE'
      ? config.revokeTemplate
      : config.grantTemplate;

  if (!template) {
    bumpCommandBuildFailure('missing_template');
    return {
      ok: false,
      skipped: false,
      reason: input.action === 'REVOKE' ? 'missing_revoke_template' : 'missing_grant_template',
    };
  }

  if (!options.allowRawTokens) {
    const hasRawToken = templateHasRawTokens(template);
    if (hasRawToken) {
      bumpCommandBuildFailure('raw_tokens_not_allowed_in_dispatch');
      return {
        ok: false,
        skipped: false,
        reason: 'raw_tokens_not_allowed_in_dispatch',
      };
    }
  }

  const renderResult = renderTemplate(template, input);
  if (!renderResult.ok) {
    return {
      ok: false,
      skipped: false,
      reason: renderResult.reason,
    };
  }

  if (options.enforceSingleLineCommand && /[\r\n]/.test(renderResult.command)) {
    bumpCommandBuildFailure('command_contains_newline');
    return {
      ok: false,
      skipped: false,
      reason: 'command_contains_newline',
    };
  }

  const serverResolution = await resolveSandboxServerId(input.serverId, config);
  if (!serverResolution.ok) {
    return {
      ok: false,
      skipped: false,
      reason: serverResolution.reason,
    };
  }

  return {
    ok: true,
    skipped: false,
    serverId: serverResolution.serverId,
    command: renderResult.command,
    metadata: {
      ...(input.metadata || {}),
      source: 'vip_automation',
      action: input.action,
      steamId: String(input.steamId || '').trim(),
      vipPlan: String(input.vipPlan || '').trim() || undefined,
      vipDurationDays: parseDurationDays(input.vipDurationDays) || undefined,
    },
  };
};

export const previewVipAutomationBuild = async (
  input: VipAutomationBuildInput,
): Promise<VipAutomationBuildResult> =>
  buildVipAutomation(input, {
    allowRawTokens: true,
    enforceSingleLineCommand: false,
  });

export const dispatchVipAutomationAction = async (
  input: VipAutomationBuildInput,
): Promise<VipAutomationDispatchResult> => {
  const preview = await buildVipAutomation(input, {
    allowRawTokens: false,
    enforceSingleLineCommand: true,
  });
  if (!preview.ok || preview.skipped || !preview.serverId || !preview.command) {
    const vipActionId = await createVipAutomationAudit(input, {
      status: preview.skipped
        ? PrismaVipAutomationActionStatus.SKIPPED
        : PrismaVipAutomationActionStatus.FAILED,
      reason: preview.reason || (!preview.ok ? 'build_failed' : 'dispatch_precondition_failed'),
      serverId: preview.serverId,
      command: preview.command,
      metadata: preview.metadata,
    });

    return {
      ...preview,
      queued: false,
      ...(vipActionId ? { vipActionId } : {}),
    };
  }

  const action: ServerAction | null = enqueueServerAction(
    preview.serverId,
    preview.command,
    preview.metadata,
  );

  if (!action) {
    const vipActionId = await createVipAutomationAudit(input, {
      status: PrismaVipAutomationActionStatus.FAILED,
      reason: 'enqueue_failed',
      serverId: preview.serverId,
      command: preview.command,
      metadata: preview.metadata,
    });

    return {
      ok: false,
      skipped: false,
      queued: false,
      reason: 'enqueue_failed',
      ...(vipActionId ? { vipActionId } : {}),
    };
  }

  const vipActionId = await createVipAutomationAudit(input, {
    status: PrismaVipAutomationActionStatus.QUEUED,
    serverId: preview.serverId,
    command: preview.command,
    queuedActionId: action.id,
    metadata: preview.metadata,
  });

  return {
    ...preview,
    queued: true,
    actionId: action.id,
    ...(vipActionId ? { vipActionId } : {}),
  };
};

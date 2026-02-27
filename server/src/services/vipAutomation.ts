import { prisma } from '../db/client';
import { enqueueServerAction, ServerAction } from './serverActions';

export type VipAutomationActionType = 'GRANT' | 'REVOKE';

export interface VipAutomationBuildInput {
  action: VipAutomationActionType;
  steamId: string;
  vipPlan?: string | null;
  vipExpiry?: Date | string | null;
  serverId?: string | null;
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
}

type VipAutomationEnvConfig = {
  enabled: boolean;
  sandboxServerId: string | undefined;
  grantTemplate: string | undefined;
  revokeTemplate: string | undefined;
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

const parseExpiry = (raw: Date | string | null | undefined): Date | null => {
  if (!raw) return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  const parsed = new Date(String(raw));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

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
  const vipExpiry = parseExpiry(input.vipExpiry);
  const expiryIso = vipExpiry ? vipExpiry.toISOString() : '';
  const expiryUnix = vipExpiry ? Math.floor(vipExpiry.getTime() / 1000) : 0;
  const action = String(input.action || '').trim().toLowerCase();

  // Supported template tokens:
  // {{steamId}}, {{steamIdRaw}}, {{vipPlan}}, {{vipPlanRaw}},
  // {{vipExpiryIso}}, {{vipExpiryIsoRaw}}, {{vipExpiryUnix}}, {{action}}
  const tokenMap: Record<string, string> = {
    steamId: quoteConsoleArg(steamId),
    steamIdRaw: steamId,
    vipPlan: quoteConsoleArg(vipPlan),
    vipPlanRaw: vipPlan,
    vipExpiryIso: quoteConsoleArg(expiryIso),
    vipExpiryIsoRaw: expiryIso,
    vipExpiryUnix: expiryUnix > 0 ? String(expiryUnix) : '',
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

  return { ok: true, command: parsedCommand };
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

export const getVipAutomationMetrics = () => ({
  vip_command_build_failures: metrics.vip_command_build_failures,
  byReason: { ...metrics.byReason },
  lastFailureAt: metrics.lastFailureAt || undefined,
  lastFailureReason: metrics.lastFailureReason || undefined,
});

export const previewVipAutomationBuild = async (
  input: VipAutomationBuildInput,
): Promise<VipAutomationBuildResult> => {
  const config = getEnvConfig();
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

  const renderResult = renderTemplate(template, input);
  if (!renderResult.ok) {
    return {
      ok: false,
      skipped: false,
      reason: renderResult.reason,
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
      source: 'vip_automation',
      action: input.action,
      steamId: String(input.steamId || '').trim(),
      vipPlan: String(input.vipPlan || '').trim() || undefined,
    },
  };
};

export const dispatchVipAutomationAction = async (
  input: VipAutomationBuildInput,
): Promise<VipAutomationDispatchResult> => {
  const preview = await previewVipAutomationBuild(input);
  if (!preview.ok || preview.skipped || !preview.serverId || !preview.command) {
    return {
      ...preview,
      queued: false,
    };
  }

  const action: ServerAction | null = enqueueServerAction(
    preview.serverId,
    preview.command,
    preview.metadata,
  );

  if (!action) {
    return {
      ok: false,
      skipped: false,
      queued: false,
      reason: 'enqueue_failed',
    };
  }

  return {
    ...preview,
    queued: true,
    actionId: action.id,
  };
};

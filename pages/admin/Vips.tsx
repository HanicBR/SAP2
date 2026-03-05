import React, { useEffect, useMemo, useState } from 'react';
import { ApiService } from '../../services/api';
import {
  GameMode,
  GameServer,
  VipAdminItem,
  VipAutomationActionItem,
  VipAutomationActionStatus,
  VipAutomationConfig,
} from '../../types';
import { Icons } from '../../components/Icon';
import { useConfig } from '../../contexts/ConfigContext';

const formatDateTime = (raw?: string) => {
  if (!raw) return '-';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString();
};

const formatCommand = (raw?: string) => {
  if (!raw) return '-';
  const parsed = String(raw).trim();
  if (parsed.length <= 70) return parsed;
  return `${parsed.slice(0, 67)}...`;
};

const automationStatusLabel = (status: VipAutomationActionStatus) => {
  if (status === 'QUEUED') return 'Enfileirado';
  if (status === 'FAILED') return 'Falhou';
  return 'Ignorado';
};

const automationActionLabel = (action: 'GRANT' | 'REVOKE') =>
  action === 'GRANT' ? 'Conceder' : 'Revogar';

const automationOperationLabel = (item: VipAutomationActionItem) => {
  if (item.action === 'REVOKE') return 'Retirado';
  if (item.trigger === 'vip_admin_extend') return 'Acrescentado';
  return 'Adicionado';
};

const automationSourceLabel = (trigger?: string) => {
  const code = String(trigger || '').trim();
  if (!code) return 'Origem nao informada';
  const known: Record<string, string> = {
    transaction_create: 'Financeiro (venda VIP)',
    vip_admin_grant: 'VIP manual (conceder)',
    vip_admin_extend: 'VIP manual (estender)',
    vip_admin_revoke: 'VIP manual (revogar)',
    vip_admin_retry: 'Retry manual da auditoria',
    vip_admin_reconcile_expired: 'Reconcilia expirados (manual)',
    vip_expiry_reconciler: 'Rotina automatica de expiracao',
    vip_expiry_reconciler_job: 'Job automatico de expiracao',
  };
  return known[code] || code;
};

const automationContextLabel = (item: VipAutomationActionItem) => {
  const parts: string[] = [];
  if (item.actor) parts.push(`ator: ${item.actor}`);
  if (item.transactionId) parts.push(`tx: ${item.transactionId}`);
  if (item.vipDurationDays) parts.push(`duracao: ${item.vipDurationDays}d`);
  if (item.retryOfActionId) parts.push(`retryDe: ${item.retryOfActionId}`);
  return parts.join(' | ');
};

const hasVipDurationToken = (template: string): boolean =>
  /\{\{\s*(vipDuration|vipDurationRaw|vipDurationDays)\s*\}\}/.test(String(template || ''));

const automationReasonLabel = (reason?: string) => {
  const code = String(reason || '').trim();
  if (!code) return '-';
  if (code.startsWith('unknown_template_token:')) {
    return `Token de template desconhecido: ${code.slice('unknown_template_token:'.length)}`;
  }
  const known: Record<string, string> = {
    vip_automation_disabled: 'Automacao VIP desativada',
    missing_grant_template: 'Template de concessao ausente',
    missing_revoke_template: 'Template de revogacao ausente',
    missing_steam_id: 'SteamID ausente',
    empty_command: 'Comando vazio',
    raw_tokens_not_allowed_in_dispatch: 'Tokens raw nao permitidos no envio real',
    command_contains_newline: 'Comando invalido com quebra de linha',
    sandbox_server_not_found: 'Servidor Sandbox nao encontrado',
    sandbox_server_invalid_mode: 'Servidor selecionado nao e Sandbox',
    sandbox_server_missing: 'Nenhum servidor Sandbox disponivel',
    enqueue_failed: 'Falha ao enfileirar comando',
    dispatch_error: 'Erro no envio da automacao',
    mock_mode: 'Modo mock sem envio real',
  };
  return known[code] || code;
};

const dispatchResultLabel = (dispatch?: { queued: boolean; skipped?: boolean; reason?: string }) => {
  if (!dispatch) return 'sem automacao';
  if (dispatch.queued) return 'enfileirada';
  if (dispatch.skipped) return 'ignorada';
  return 'falhou';
};

const normalizeIdList = (values: string[]): string[] =>
  Array.from(new Set(values.map((entry) => String(entry || '').trim()).filter(Boolean)));

const Vips: React.FC = () => {
  const { config } = useConfig();
  const [activeTab, setActiveTab] = useState<'overview' | 'operations' | 'automation'>('overview');
  const [showAutomationConfig, setShowAutomationConfig] = useState(false);
  const [items, setItems] = useState<VipAdminItem[]>([]);
  const [actions, setActions] = useState<VipAutomationActionItem[]>([]);
  const [servers, setServers] = useState<GameServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionsLoading, setActionsLoading] = useState(true);
  const [automationLoading, setAutomationLoading] = useState(true);
  const [serversLoading, setServersLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reconcileBusy, setReconcileBusy] = useState(false);
  const [automationSaving, setAutomationSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'ALL' | 'ACTIVE' | 'EXPIRED'>('ALL');
  const [actionStatus, setActionStatus] = useState<'ALL' | VipAutomationActionStatus>('ALL');
  const [actionSteamId, setActionSteamId] = useState('');
  const [automationConfig, setAutomationConfig] = useState<VipAutomationConfig>({
    enabled: false,
    grantTemplate: '',
    revokeTemplate: '',
    source: 'env',
  });

  const [grantSteamId, setGrantSteamId] = useState('');
  const [grantName, setGrantName] = useState('');
  const [grantPlan, setGrantPlan] = useState('');
  const [grantDurationDays, setGrantDurationDays] = useState('');
  const [grantServerIds, setGrantServerIds] = useState<string[]>([]);

  const [extendSteamId, setExtendSteamId] = useState('');
  const [extendPlan, setExtendPlan] = useState('');
  const [extendDurationDays, setExtendDurationDays] = useState('');
  const [extendServerIds, setExtendServerIds] = useState<string[]>([]);
  const [revokeReason, setRevokeReason] = useState('');
  const [applyVipOnServer, setApplyVipOnServer] = useState(true);

  const planOptions = useMemo(() => {
    const options = config.vip.plans.map((plan) => String(plan.name || '').trim()).filter(Boolean);
    if (config.vip.ultimatePlan.enabled) {
      const ultimateName = String(config.vip.ultimatePlan.name || '').trim();
      if (ultimateName) options.push(ultimateName);
    }
    const unique = Array.from(new Set(options));
    return unique.length ? unique : ['VIP'];
  }, [config.vip.plans, config.vip.ultimatePlan.enabled, config.vip.ultimatePlan.name]);

  const durationOptions = useMemo(() => {
    const options = (config.vip.billingOptions || []).map((cycle) => {
      const months = Math.max(1, Math.floor(Number(cycle.months) || 1));
      const days = months * 30;
      return { value: String(days), label: `${days} dias (${cycle.label})` };
    });
    const uniqueByValue = options.filter(
      (option, index, array) => array.findIndex((item) => item.value === option.value) === index,
    );
    return uniqueByValue.length ? uniqueByValue : [{ value: '30', label: '30 dias (Mensal)' }];
  }, [config.vip.billingOptions]);

  const sandboxServers = useMemo(
    () => servers.filter((server) => server.mode === GameMode.SANDBOX),
    [servers],
  );

  const hasSelectedSandboxServer = useMemo(
    () =>
      !!automationConfig.sandboxServerId &&
      sandboxServers.some((server) => server.id === automationConfig.sandboxServerId),
    [automationConfig.sandboxServerId, sandboxServers],
  );

  const summary = useMemo(() => {
    const activeCount = items.filter((item) => item.vipStatus === 'ACTIVE').length;
    const expiredCount = items.filter((item) => item.vipStatus === 'EXPIRED').length;
    const inactiveCount = items.filter((item) => item.vipStatus !== 'ACTIVE' && item.vipStatus !== 'EXPIRED').length;
    const queuedCount = actions.filter((action) => action.status === 'QUEUED').length;
    const failedCount = actions.filter((action) => action.status === 'FAILED').length;
    const skippedCount = actions.filter((action) => action.status === 'SKIPPED').length;

    return {
      totalVips: items.length,
      activeCount,
      expiredCount,
      inactiveCount,
      queuedCount,
      failedCount,
      skippedCount,
      sandboxCount: sandboxServers.length,
      automationEnabled: automationConfig.enabled,
    };
  }, [actions, automationConfig.enabled, items, sandboxServers.length]);

  const isRefreshingAll = loading || actionsLoading || automationLoading || serversLoading;
  const grantTemplateHasDurationToken = hasVipDurationToken(automationConfig.grantTemplate);

  const loadData = async () => {
    setLoading(true);
    try {
      const result = await ApiService.getVips({
        search: search || undefined,
        status,
        limit: 200,
      });
      setItems(result.items);
    } catch (err: any) {
      setFeedback(err?.message || 'Erro ao carregar VIPs');
    } finally {
      setLoading(false);
    }
  };

  const loadActions = async () => {
    setActionsLoading(true);
    try {
      const result = await ApiService.getVipAutomationActions({
        status: actionStatus,
        steamId: actionSteamId.trim() || undefined,
        limit: 100,
      });
      setActions(result.items);
    } catch (err: any) {
      setFeedback(err?.message || 'Erro ao carregar auditoria VIP');
    } finally {
      setActionsLoading(false);
    }
  };

  const loadAutomationConfig = async () => {
    setAutomationLoading(true);
    try {
      const result = await ApiService.getVipAutomationConfig();
      setAutomationConfig(result);
    } catch (err: any) {
      setFeedback(err?.message || 'Erro ao carregar config da automacao VIP');
    } finally {
      setAutomationLoading(false);
    }
  };

  const loadServers = async () => {
    setServersLoading(true);
    try {
      const result = await ApiService.getServers();
      setServers(result);
    } catch (err: any) {
      setFeedback(err?.message || 'Erro ao carregar servidores');
    } finally {
      setServersLoading(false);
    }
  };

  const refreshAll = async () => {
    await Promise.all([loadData(), loadActions(), loadAutomationConfig(), loadServers()]);
  };

  useEffect(() => {
    if (!grantPlan) setGrantPlan(planOptions[0]);
    if (!extendPlan) setExtendPlan(planOptions[0]);
  }, [grantPlan, extendPlan, planOptions]);

  useEffect(() => {
    loadData();
  }, [status]);

  useEffect(() => {
    loadActions();
  }, [actionStatus]);

  useEffect(() => {
    loadAutomationConfig();
  }, []);

  useEffect(() => {
    loadServers();
  }, []);

  const toggleServerSelection = (
    serverId: string,
    setState: React.Dispatch<React.SetStateAction<string[]>>,
  ) => {
    setState((prev) => {
      const safeCurrent = normalizeIdList(prev);
      if (safeCurrent.includes(serverId)) {
        return safeCurrent.filter((id) => id !== serverId);
      }
      return [...safeCurrent, serverId];
    });
  };

  const sanitizeDaysInput = (value: string) => value.replace(/[^0-9]/g, '');
  const operationEnqueue = applyVipOnServer;
  const isFeedbackError = /erro|falhou|invalido|invalid/i.test(feedback);
  const surfaceClass =
    'rounded-2xl border border-zinc-800/80 bg-zinc-900/80 backdrop-blur-sm shadow-[0_10px_40px_-24px_rgba(0,0,0,0.9)]';
  const inputClass =
    'w-full bg-zinc-950/90 border border-zinc-700/80 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-brand/60 focus:border-brand/60 transition';
  const inputMonoClass = `${inputClass} font-mono`;
  const subtleButtonClass =
    'inline-flex items-center justify-center rounded-lg border border-zinc-700/80 bg-zinc-900/70 px-3 py-2 text-xs font-bold uppercase tracking-wide text-zinc-200 hover:bg-zinc-800/90 hover:border-zinc-500 transition disabled:opacity-60 disabled:cursor-not-allowed';
  const primaryButtonClass =
    'inline-flex items-center justify-center rounded-lg bg-brand hover:bg-brand-dark px-4 py-2 text-sm font-bold uppercase tracking-wide text-white transition disabled:opacity-60 disabled:cursor-not-allowed';

  const handleGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedDurationDays = Number.parseInt(grantDurationDays, 10);
    if (!Number.isFinite(parsedDurationDays) || parsedDurationDays <= 0) {
      setFeedback('Informe um numero de dias valido para conceder VIP.');
      return;
    }
    setBusy(true);
    setFeedback('');
    try {
      const result = await ApiService.grantVip({
        steamId: grantSteamId.trim(),
        name: grantName.trim() || undefined,
        vipPlan: grantPlan,
        vipDurationDays: parsedDurationDays,
        enqueue: operationEnqueue,
        vipServerIds: normalizeIdList(grantServerIds),
      });
      setFeedback(
        operationEnqueue && result.dispatch
          ? `VIP concedido. Automacao ${dispatchResultLabel(result.dispatch)}${
              result.dispatch.reason ? ` (${automationReasonLabel(result.dispatch.reason)})` : ''
            }.`
          : 'VIP concedido e registrado apenas no site (sem envio ao servidor).',
      );
      setGrantSteamId('');
      setGrantName('');
      setGrantServerIds([]);
      await refreshAll();
    } catch (err: any) {
      setFeedback(err?.message || 'Erro ao conceder VIP');
    } finally {
      setBusy(false);
    }
  };

  const handleExtend = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedDurationDays = Number.parseInt(extendDurationDays, 10);
    if (!Number.isFinite(parsedDurationDays) || parsedDurationDays <= 0) {
      setFeedback('Informe um numero de dias valido para estender VIP.');
      return;
    }
    setBusy(true);
    setFeedback('');
    try {
      const result = await ApiService.extendVip({
        steamId: extendSteamId.trim(),
        vipPlan: extendPlan || undefined,
        vipDurationDays: parsedDurationDays,
        enqueue: operationEnqueue,
        vipServerIds: normalizeIdList(extendServerIds),
      });
      setFeedback(
        operationEnqueue && result.dispatch
          ? `VIP estendido. Automacao ${dispatchResultLabel(result.dispatch)}${
              result.dispatch.reason ? ` (${automationReasonLabel(result.dispatch.reason)})` : ''
            }.`
          : 'VIP estendido e registrado apenas no site (sem envio ao servidor).',
      );
      await refreshAll();
    } catch (err: any) {
      setFeedback(err?.message || 'Erro ao estender VIP');
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async (steamId: string, options?: { enqueue?: boolean }) => {
    const confirmed = window.confirm(`Revogar VIP de ${steamId}?`);
    if (!confirmed) return;
    const enqueue = options?.enqueue ?? true;
    setBusy(true);
    setFeedback('');
    try {
      const result = await ApiService.revokeVip({
        steamId,
        enqueue,
        reason: revokeReason.trim() || undefined,
      });
      setFeedback(
        enqueue && result.dispatch
          ? `VIP revogado. Automacao ${dispatchResultLabel(result.dispatch)}${
              result.dispatch.reason ? ` (${automationReasonLabel(result.dispatch.reason)})` : ''
            }.`
          : 'VIP revogado apenas no site (sem envio ao servidor).',
      );
      await refreshAll();
    } catch (err: any) {
      setFeedback(err?.message || 'Erro ao revogar VIP');
    } finally {
      setBusy(false);
    }
  };

  const handleRetryAction = async (actionId: string) => {
    setBusy(true);
    setFeedback('');
    try {
      const result = await ApiService.retryVipAutomationAction(actionId);
      setFeedback(
        `Tentativa ${actionId}: automacao ${dispatchResultLabel(result.dispatch)}${
          result.dispatch.reason ? ` (${automationReasonLabel(result.dispatch.reason)})` : ''
        }.`,
      );
      await refreshAll();
    } catch (err: any) {
      setFeedback(err?.message || 'Erro ao executar retry da acao VIP');
    } finally {
      setBusy(false);
    }
  };

  const handleReconcileExpired = async (dryRun: boolean) => {
    setReconcileBusy(true);
    setFeedback('');
    try {
      const summaryResult = await ApiService.reconcileExpiredVips({
        dryRun,
        enqueue: true,
        limit: 200,
      });
      setFeedback(
        dryRun
          ? `Simulacao de VIPs expirados: encontrados=${summaryResult.expiredCount}.`
          : `Processamento de VIPs expirados: encontrados=${summaryResult.expiredCount}, atualizados=${summaryResult.updatedCount}, dispatchQueued=${summaryResult.dispatchQueuedCount}, dispatchNotQueued=${summaryResult.dispatchNotQueuedCount}.`,
      );
      if (!dryRun) {
        await refreshAll();
      }
    } catch (err: any) {
      setFeedback(err?.message || 'Erro ao processar VIPs expirados');
    } finally {
      setReconcileBusy(false);
    }
  };

  const handleSaveAutomationConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setAutomationSaving(true);
    setFeedback('');
    try {
      const updated = await ApiService.updateVipAutomationConfig({
        enabled: automationConfig.enabled,
        sandboxServerId: automationConfig.sandboxServerId?.trim() || undefined,
        grantTemplate: automationConfig.grantTemplate,
        revokeTemplate: automationConfig.revokeTemplate,
      });
      setAutomationConfig(updated);
      setFeedback('Configuracao da automacao VIP salva.');
    } catch (err: any) {
      setFeedback(err?.message || 'Erro ao salvar config da automacao VIP');
    } finally {
      setAutomationSaving(false);
    }
  };

  return (
    <div className="relative space-y-6 animate-fade-in">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-20 right-0 h-72 w-72 rounded-full bg-brand/10 blur-3xl" />
        <div className="absolute top-1/3 -left-16 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl" />
      </div>

      <div className={`${surfaceClass} overflow-hidden`}>
        <div className="border-b border-zinc-800/80 bg-gradient-to-r from-zinc-900/90 via-zinc-900/75 to-zinc-900/55 p-4 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-brand/40 bg-brand/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-brand">
                <Icons.Crown className="h-3.5 w-3.5" />
                Modulo VIP
              </div>
              <h1 className="mt-3 flex items-center text-2xl font-black text-white">
                VIPs
              </h1>
              <p className="mt-1 text-xs text-zinc-400">
                Gestao centralizada de beneficios, expiracao e automacao em servidor.
              </p>
            </div>
            <button
              onClick={refreshAll}
              className={`${primaryButtonClass} min-w-[170px]`}
              disabled={isRefreshingAll}
            >
              <Icons.RefreshCw className={`mr-2 h-4 w-4 ${isRefreshingAll ? 'animate-spin' : ''}`} />
              Atualizar tudo
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className={`group rounded-xl border px-3 py-3 text-left transition-all ${
              activeTab === 'overview'
                ? 'border-brand/60 bg-gradient-to-r from-brand/25 to-red-900/15 shadow-lg shadow-brand/10'
                : 'border-zinc-700/80 bg-zinc-950/65 hover:border-zinc-500'
            }`}
          >
            <div className="flex items-center gap-2">
              <Icons.BarChart className={`h-4 w-4 ${activeTab === 'overview' ? 'text-white' : 'text-zinc-500 group-hover:text-zinc-300'}`} />
              <span className={`text-xs font-bold uppercase tracking-wider ${activeTab === 'overview' ? 'text-white' : 'text-zinc-300'}`}>
                Visao geral
              </span>
            </div>
            <p className={`mt-1 text-[11px] ${activeTab === 'overview' ? 'text-zinc-200' : 'text-zinc-500'}`}>
              Lista de VIPs e filtros rapidos
            </p>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('operations')}
            className={`group rounded-xl border px-3 py-3 text-left transition-all ${
              activeTab === 'operations'
                ? 'border-blue-700/70 bg-gradient-to-r from-blue-900/30 to-cyan-900/20 shadow-lg shadow-blue-900/10'
                : 'border-zinc-700/80 bg-zinc-950/65 hover:border-zinc-500'
            }`}
          >
            <div className="flex items-center gap-2">
              <Icons.Settings className={`h-4 w-4 ${activeTab === 'operations' ? 'text-white' : 'text-zinc-500 group-hover:text-zinc-300'}`} />
              <span className={`text-xs font-bold uppercase tracking-wider ${activeTab === 'operations' ? 'text-white' : 'text-zinc-300'}`}>
                Operacoes
              </span>
            </div>
            <p className={`mt-1 text-[11px] ${activeTab === 'operations' ? 'text-zinc-200' : 'text-zinc-500'}`}>
              Conceder, estender, revogar e reconciliar
            </p>
          </button>
          <button
            type="button"
            onClick={() => {
              setShowAutomationConfig(false);
              setActiveTab('automation');
            }}
            className={`group rounded-xl border px-3 py-3 text-left transition-all ${
              activeTab === 'automation'
                ? 'border-emerald-700/70 bg-gradient-to-r from-emerald-900/30 to-green-900/20 shadow-lg shadow-emerald-900/10'
                : 'border-zinc-700/80 bg-zinc-950/65 hover:border-zinc-500'
            }`}
          >
            <div className="flex items-center gap-2">
              <Icons.Activity className={`h-4 w-4 ${activeTab === 'automation' ? 'text-white' : 'text-zinc-500 group-hover:text-zinc-300'}`} />
              <span className={`text-xs font-bold uppercase tracking-wider ${activeTab === 'automation' ? 'text-white' : 'text-zinc-300'}`}>
                Automacao
              </span>
            </div>
            <p className={`mt-1 text-[11px] ${activeTab === 'automation' ? 'text-zinc-200' : 'text-zinc-500'}`}>
              Configuracao e auditoria de comandos
            </p>
          </button>
        </div>
      </div>

      {feedback ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            isFeedbackError
              ? 'border-red-900/60 bg-red-900/20 text-red-200'
              : 'border-emerald-900/60 bg-emerald-900/20 text-emerald-200'
          }`}
        >
          {feedback}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <div className={`${surfaceClass} p-3`}>
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase text-zinc-500">Total VIPs</p>
            <Icons.Crown className="h-4 w-4 text-brand" />
          </div>
          <p className="mt-1 text-xl font-black text-white">{summary.totalVips}</p>
        </div>
        <div className={`${surfaceClass} p-3`}>
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase text-zinc-500">Ativos</p>
            <Icons.Check className="h-4 w-4 text-green-400" />
          </div>
          <p className="mt-1 text-xl font-black text-green-400">{summary.activeCount}</p>
        </div>
        <div className={`${surfaceClass} p-3`}>
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase text-zinc-500">Expirados</p>
            <Icons.Clock className="h-4 w-4 text-yellow-400" />
          </div>
          <p className="mt-1 text-xl font-black text-yellow-400">{summary.expiredCount}</p>
        </div>
        <div className={`${surfaceClass} p-3`}>
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase text-zinc-500">Inativos</p>
            <Icons.Users className="h-4 w-4 text-zinc-400" />
          </div>
          <p className="mt-1 text-xl font-black text-zinc-400">{summary.inactiveCount}</p>
        </div>
        <div className={`${surfaceClass} p-3`}>
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase text-zinc-500">Fila auto</p>
            <Icons.Activity className="h-4 w-4 text-cyan-400" />
          </div>
          <p className="mt-1 text-xl font-black text-cyan-400">{summary.queuedCount}</p>
          <p className="mt-1 text-[10px] text-zinc-500">
            falhou {summary.failedCount} | ignorou {summary.skippedCount}
          </p>
        </div>
        <div className={`${surfaceClass} p-3`}>
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase text-zinc-500">Sandbox</p>
            <Icons.Server className="h-4 w-4 text-zinc-200" />
          </div>
          <p className="mt-1 text-xl font-black text-white">{summary.sandboxCount}</p>
          <p className={`mt-1 text-[10px] ${summary.automationEnabled ? 'text-green-400' : 'text-zinc-500'}`}>
            auto {summary.automationEnabled ? 'ativa' : 'desativada'}
          </p>
        </div>
      </div>

      {activeTab === 'overview' ? (
        <>
          <div className={`${surfaceClass} p-4`}>
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
              <h2 className="text-sm uppercase font-bold tracking-wide text-zinc-200">VIPs registrados</h2>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(220px,1fr)_170px_auto]">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className={inputClass}
                  placeholder="Buscar por SteamID ou nome"
                />
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as 'ALL' | 'ACTIVE' | 'EXPIRED')}
                  className={inputClass}
                >
                  <option value="ALL">Todos</option>
                  <option value="ACTIVE">Ativos</option>
                  <option value="EXPIRED">Expirados</option>
                </select>
                <button
                  type="button"
                  onClick={loadData}
                  className={subtleButtonClass}
                >
                  <Icons.Search className="mr-2 h-3.5 w-3.5" />
                  Buscar
                </button>
              </div>
            </div>
          </div>

          <div className={`${surfaceClass} overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-zinc-800">
                <thead className="bg-zinc-950/75 backdrop-blur">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs uppercase text-zinc-500">Jogador</th>
                    <th className="px-4 py-3 text-left text-xs uppercase text-zinc-500">SteamID</th>
                    <th className="px-4 py-3 text-left text-xs uppercase text-zinc-500">Plano</th>
                    <th className="px-4 py-3 text-left text-xs uppercase text-zinc-500">Expira em</th>
                    <th className="px-4 py-3 text-left text-xs uppercase text-zinc-500">Servidores VIP</th>
                    <th className="px-4 py-3 text-left text-xs uppercase text-zinc-500">Status</th>
                    <th className="px-4 py-3 text-right text-xs uppercase text-zinc-500">Acoes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/80">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-zinc-500">
                        Carregando VIPs...
                      </td>
                    </tr>
                  ) : items.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-zinc-500">
                        Nenhum VIP encontrado.
                      </td>
                    </tr>
                  ) : (
                    items.map((item) => (
                      <tr key={item.steamId} className="transition-colors hover:bg-zinc-800/45">
                        <td className="px-4 py-3 text-sm text-white">
                          <div className="flex items-center gap-3">
                            {item.avatarUrl ? (
                              <img
                                src={item.avatarUrl}
                                alt={item.name}
                                className="h-9 w-9 rounded-lg border border-zinc-700 object-cover"
                              />
                            ) : (
                              <div className="h-9 w-9 rounded-lg border border-zinc-700 bg-zinc-800" />
                            )}
                            <div className="min-w-0">
                              <p className="text-white font-semibold truncate">{item.name || item.steamId}</p>
                              <p className="text-[11px] text-zinc-500">{item.vipStatus || 'INACTIVE'}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-zinc-400 font-mono">{item.steamId}</td>
                        <td className="px-4 py-3 text-sm text-zinc-300">{item.vipPlan || '-'}</td>
                        <td className="px-4 py-3 text-sm text-zinc-300">{formatDateTime(item.vipExpiry)}</td>
                        <td className="px-4 py-3 text-xs text-zinc-300">
                          {!item.vipServerIds || item.vipServerIds.length === 0 ? (
                            <span className="inline-flex rounded border border-emerald-800/60 bg-emerald-900/20 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-300">
                              Todos os servidores
                            </span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {(item.vipServerNames && item.vipServerNames.length > 0
                                ? item.vipServerNames
                                : item.vipServerIds
                              ).map((name) => (
                                <span
                                  key={`${item.steamId}-${name}`}
                                  className="inline-flex rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] font-bold uppercase text-zinc-300"
                                >
                                  {name}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              item.vipStatus === 'ACTIVE'
                                ? 'bg-green-900/30 text-green-400 border border-green-800'
                                : item.vipStatus === 'EXPIRED'
                                ? 'bg-yellow-900/30 text-yellow-400 border border-yellow-800'
                                : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                            }`}
                          >
                            {item.vipStatus || 'INACTIVE'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              setExtendSteamId(item.steamId);
                              setExtendPlan(item.vipPlan || planOptions[0]);
                              setExtendServerIds(item.vipServerIds || []);
                              setActiveTab('operations');
                            }}
                            className="mr-2 inline-flex items-center rounded-md border border-zinc-700/80 bg-zinc-900/70 px-3 py-1 text-xs font-bold text-zinc-200 transition hover:bg-zinc-800"
                          >
                            Operar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRevoke(item.steamId)}
                            className="inline-flex items-center rounded-md border border-red-700/70 bg-red-900/60 px-3 py-1 text-xs font-bold text-white transition hover:bg-red-700"
                            disabled={busy}
                          >
                            Revogar
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}

      {activeTab === 'operations' ? (
        <>
          <datalist id="vip-duration-suggestions">
            {durationOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </datalist>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <form onSubmit={handleGrant} className={`${surfaceClass} p-5 space-y-4`}>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm uppercase font-bold tracking-wide text-zinc-200">Conceder VIP</h2>
                <span className="rounded-full border border-emerald-700/60 bg-emerald-900/20 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-300">
                  Grant
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="space-y-1.5">
                  <span className="text-[11px] uppercase font-bold text-zinc-500">SteamID</span>
                  <input
                    required
                    value={grantSteamId}
                    onChange={(e) => setGrantSteamId(e.target.value)}
                    className={inputMonoClass}
                    placeholder="STEAM_0:1:123456"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-[11px] uppercase font-bold text-zinc-500">Nome (opcional)</span>
                  <input
                    value={grantName}
                    onChange={(e) => setGrantName(e.target.value)}
                    className={inputClass}
                    placeholder="Nome do jogador"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-[11px] uppercase font-bold text-zinc-500">Plano</span>
                  <select
                    value={grantPlan}
                    onChange={(e) => setGrantPlan(e.target.value)}
                    className={inputClass}
                  >
                    {planOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-[11px] uppercase font-bold text-zinc-500">Duracao em dias</span>
                  <input
                    required
                    inputMode="numeric"
                    pattern="[0-9]*"
                    list="vip-duration-suggestions"
                    value={grantDurationDays}
                    onChange={(e) => setGrantDurationDays(sanitizeDaysInput(e.target.value))}
                    className={inputClass}
                    placeholder="Ex: 30"
                  />
                </label>
              </div>
              <p className="text-[11px] text-zinc-500">Dias do VIP (manual). Use qualquer valor inteiro positivo.</p>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
                <p className="text-[11px] uppercase font-bold text-zinc-500">Escopo de servidores VIP</p>
                <p className="mt-1 text-xs text-zinc-400">
                  Se nada for marcado, vale para todos os servidores.
                </p>
                <div className="mt-2 grid max-h-56 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                  {servers.map((server) => {
                    const checked = grantServerIds.includes(server.id);
                    return (
                      <label
                        key={`grant-${server.id}`}
                        className={`flex items-center gap-2 rounded border px-2 py-1.5 text-xs ${
                          checked
                            ? 'border-emerald-700/70 bg-emerald-900/20 text-emerald-200'
                            : 'border-zinc-700 bg-zinc-900/60 text-zinc-300'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleServerSelection(server.id, setGrantServerIds)}
                        />
                        <span className="min-w-0 truncate">{server.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <label className="flex items-center justify-between rounded-xl border border-zinc-700 bg-zinc-950/70 px-3 py-2">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-zinc-200">
                    Aplicar VIP no servidor
                  </p>
                  <p className="text-[11px] text-zinc-500">
                    Desmarcado: so registra no site; remocao no servidor ocorre pela rotina de expiracao.
                  </p>
                </div>
                <span className="relative inline-flex items-center">
                  <input
                    type="checkbox"
                    checked={applyVipOnServer}
                    onChange={(e) => setApplyVipOnServer(e.target.checked)}
                    className="peer sr-only"
                  />
                  <span className="h-6 w-11 rounded-full bg-zinc-700 transition peer-checked:bg-emerald-600" />
                  <span className="pointer-events-none absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-5" />
                </span>
              </label>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center justify-center rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-emerald-600 disabled:opacity-60"
              >
                <Icons.Crown className="mr-2 h-4 w-4" />
                Conceder
              </button>
            </form>

            <form onSubmit={handleExtend} className={`${surfaceClass} p-5 space-y-4`}>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm uppercase font-bold tracking-wide text-zinc-200">Estender ou revogar</h2>
                <span className="rounded-full border border-cyan-700/60 bg-cyan-900/20 px-2 py-0.5 text-[10px] font-bold uppercase text-cyan-300">
                  Manage
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="space-y-1.5">
                  <span className="text-[11px] uppercase font-bold text-zinc-500">SteamID</span>
                  <input
                    required
                    value={extendSteamId}
                    onChange={(e) => setExtendSteamId(e.target.value)}
                    className={inputMonoClass}
                    placeholder="STEAM_0:1:123456"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-[11px] uppercase font-bold text-zinc-500">Motivo da revogacao</span>
                  <input
                    value={revokeReason}
                    onChange={(e) => setRevokeReason(e.target.value)}
                    className={inputClass}
                    placeholder="Opcional"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-[11px] uppercase font-bold text-zinc-500">Plano</span>
                  <select
                    value={extendPlan}
                    onChange={(e) => setExtendPlan(e.target.value)}
                    className={inputClass}
                  >
                    {planOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-[11px] uppercase font-bold text-zinc-500">Dias para estender</span>
                  <input
                    required
                    inputMode="numeric"
                    pattern="[0-9]*"
                    list="vip-duration-suggestions"
                    value={extendDurationDays}
                    onChange={(e) => setExtendDurationDays(sanitizeDaysInput(e.target.value))}
                    className={inputClass}
                    placeholder="Ex: 30"
                  />
                </label>
              </div>
              <p className="text-[11px] text-zinc-500">Dias para estender (manual). Use qualquer valor inteiro positivo.</p>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3">
                <p className="text-[11px] uppercase font-bold text-zinc-500">Atualizar escopo de servidores</p>
                <p className="mt-1 text-xs text-zinc-400">
                  Marque os servidores onde esse VIP vale. Deixe vazio para todos.
                </p>
                <div className="mt-2 grid max-h-56 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                  {servers.map((server) => {
                    const checked = extendServerIds.includes(server.id);
                    return (
                      <label
                        key={`extend-${server.id}`}
                        className={`flex items-center gap-2 rounded border px-2 py-1.5 text-xs ${
                          checked
                            ? 'border-cyan-700/70 bg-cyan-900/20 text-cyan-200'
                            : 'border-zinc-700 bg-zinc-900/60 text-zinc-300'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleServerSelection(server.id, setExtendServerIds)}
                        />
                        <span className="min-w-0 truncate">{server.name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <label className="flex items-center justify-between rounded-xl border border-zinc-700 bg-zinc-950/70 px-3 py-2">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-zinc-200">
                    Aplicar VIP no servidor
                  </p>
                  <p className="text-[11px] text-zinc-500">
                    Desmarcado: so atualiza cadastro no site para esta operacao.
                  </p>
                </div>
                <span className="relative inline-flex items-center">
                  <input
                    type="checkbox"
                    checked={applyVipOnServer}
                    onChange={(e) => setApplyVipOnServer(e.target.checked)}
                    className="peer sr-only"
                  />
                  <span className="h-6 w-11 rounded-full bg-zinc-700 transition peer-checked:bg-emerald-600" />
                  <span className="pointer-events-none absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition peer-checked:translate-x-5" />
                </span>
              </label>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex items-center justify-center rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-blue-600 disabled:opacity-60"
                >
                  <Icons.Plus className="mr-2 h-4 w-4" />
                  Estender
                </button>
                <button
                  type="button"
                  onClick={() => handleRevoke(extendSteamId.trim(), { enqueue: operationEnqueue })}
                  disabled={busy || !extendSteamId.trim()}
                  className="inline-flex items-center justify-center rounded-lg bg-red-700 px-4 py-2 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-red-600 disabled:opacity-60"
                >
                  <Icons.Trash className="mr-2 h-4 w-4" />
                  Revogar
                </button>
              </div>
            </form>
          </div>

          <div className={`${surfaceClass} p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3`}>
            <div>
              <h3 className="text-sm uppercase font-bold tracking-wide text-zinc-200">Conciliar expirados</h3>
              <p className="mt-1 text-xs text-zinc-500">
                Remove VIP vencido no painel e dispara REVOKE para o servidor.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleReconcileExpired(true)}
                disabled={reconcileBusy}
                className={subtleButtonClass}
              >
                Simular
              </button>
              <button
                type="button"
                onClick={() => handleReconcileExpired(false)}
                disabled={reconcileBusy}
                className="inline-flex items-center justify-center rounded-lg bg-yellow-700 px-3 py-2 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-yellow-600 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Processar agora
              </button>
            </div>
          </div>
        </>
      ) : null}

      {activeTab === 'automation' ? (
        <>
          <div className={`${surfaceClass} overflow-hidden`}>
            <button
              type="button"
              onClick={() => setShowAutomationConfig((prev) => !prev)}
              className="w-full border-b border-zinc-800/80 bg-gradient-to-r from-zinc-950/80 to-zinc-900/60 p-4 text-left"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm uppercase font-bold tracking-wide text-zinc-200">Config da automacao VIP</h2>
                  <p className="mt-1 text-xs text-zinc-500">
                    Painel recolhido por seguranca. Expanda apenas quando for editar.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-md border border-zinc-700/70 bg-zinc-900/70 px-2 py-0.5 text-[11px] text-zinc-400">
                    source={automationConfig.source || 'env'}
                  </span>
                  <span
                    className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase ${
                      automationConfig.enabled
                        ? 'border-green-800 bg-green-900/30 text-green-400'
                        : 'border-zinc-700 bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {automationConfig.enabled ? 'ativa' : 'desativada'}
                  </span>
                  <span className="text-xs font-bold uppercase text-zinc-300">
                    {showAutomationConfig ? 'ocultar' : 'expandir'}
                  </span>
                </div>
              </div>
            </button>

            {showAutomationConfig ? (
              <form
                onSubmit={handleSaveAutomationConfig}
                className="p-4 space-y-4"
              >
                <label className="flex items-center gap-2 rounded-lg border border-zinc-700/70 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    checked={automationConfig.enabled}
                    onChange={(e) =>
                      setAutomationConfig((prev) => ({
                        ...prev,
                        enabled: e.target.checked,
                      }))
                    }
                  />
                  Ativar envio automatico de comando VIP
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <select
                    value={automationConfig.sandboxServerId || ''}
                    onChange={(e) =>
                      setAutomationConfig((prev) => ({
                        ...prev,
                        sandboxServerId: e.target.value || undefined,
                      }))
                    }
                    className={inputMonoClass}
                    disabled={serversLoading}
                  >
                    <option value="">Automatico (primeiro Sandbox online)</option>
                    {sandboxServers.map((server) => (
                      <option key={server.id} value={server.id}>
                        {server.name} - {server.id}
                      </option>
                    ))}
                    {automationConfig.sandboxServerId && !hasSelectedSandboxServer ? (
                      <option value={automationConfig.sandboxServerId}>
                        Atual (nao listado): {automationConfig.sandboxServerId}
                      </option>
                    ) : null}
                  </select>
                  <div className="flex items-center rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 text-xs text-zinc-500">
                    {serversLoading
                      ? 'Carregando servidores...'
                      : `${sandboxServers.length} servidor(es) Sandbox disponivel(is)`}
                  </div>
                  <textarea
                    value={automationConfig.grantTemplate}
                    onChange={(e) =>
                      setAutomationConfig((prev) => ({
                        ...prev,
                        grantTemplate: e.target.value,
                      }))
                    }
                    className={`${inputMonoClass} min-h-[76px] md:col-span-2`}
                    placeholder='Template GRANT. Ex: sam setrankid {{steamId}} {{vipPlanServer}} {{vipDuration}}'
                    rows={2}
                  />
                  <textarea
                    value={automationConfig.revokeTemplate}
                    onChange={(e) =>
                      setAutomationConfig((prev) => ({
                        ...prev,
                        revokeTemplate: e.target.value,
                      }))
                    }
                    className={`${inputMonoClass} min-h-[76px] md:col-span-2`}
                    placeholder='Template REVOKE. Ex: sam setrank {{steamId}} "user"'
                    rows={2}
                  />
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-500 md:col-span-2">
                    Tokens permitidos: {'{{steamId}}'}, {'{{vipPlanServer}}'}, {'{{vipExpiryUnix}}'},
                    {' {{vipDuration}}'}, {'{{vipDurationRaw}}'}, {'{{vipDurationDays}}'}
                  </div>
                  {!grantTemplateHasDurationToken ? (
                    <div className="rounded-lg border border-amber-900/70 bg-amber-900/20 px-3 py-2 text-xs text-amber-300 md:col-span-2">
                      Aviso: o template GRANT atual nao tem token de duracao. Sem {'{{vipDuration}}'} o comando sera enviado sem tempo (ex.: 30d).
                    </div>
                  ) : null}
                </div>
                <button
                  type="submit"
                  disabled={automationSaving}
                  className={primaryButtonClass}
                >
                  Salvar automacao
                </button>
              </form>
            ) : (
              <div className="p-4 text-xs text-zinc-500">
                Configuracao protegida contra alteracao acidental. Clique em <span className="text-zinc-300 font-bold">expandir</span> para editar.
              </div>
            )}
          </div>

          <div className={`${surfaceClass} overflow-hidden`}>
            <div className="border-b border-zinc-800/80 bg-gradient-to-r from-zinc-950/80 to-zinc-900/60 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <h2 className="text-sm uppercase font-bold tracking-wide text-zinc-200">Auditoria da automacao VIP</h2>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(220px,1fr)_170px_auto]">
                <input
                  value={actionSteamId}
                  onChange={(e) => setActionSteamId(e.target.value)}
                  className={inputClass}
                  placeholder="Filtrar SteamID"
                />
                <select
                  value={actionStatus}
                  onChange={(e) => setActionStatus(e.target.value as 'ALL' | VipAutomationActionStatus)}
                  className={inputClass}
                >
                  <option value="ALL">Todos</option>
                  <option value="QUEUED">Enfileirado</option>
                  <option value="FAILED">Falhou</option>
                  <option value="SKIPPED">Ignorado</option>
                </select>
                <button
                  type="button"
                  onClick={loadActions}
                  className={subtleButtonClass}
                >
                  <Icons.Search className="mr-2 h-3.5 w-3.5" />
                  Buscar
                </button>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-zinc-800">
                <thead className="bg-zinc-950/75 backdrop-blur">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs uppercase text-zinc-500">Quando</th>
                    <th className="px-4 py-3 text-left text-xs uppercase text-zinc-500">Acao</th>
                    <th className="px-4 py-3 text-left text-xs uppercase text-zinc-500">Operacao / Origem</th>
                    <th className="px-4 py-3 text-left text-xs uppercase text-zinc-500">SteamID</th>
                    <th className="px-4 py-3 text-left text-xs uppercase text-zinc-500">Status</th>
                    <th className="px-4 py-3 text-left text-xs uppercase text-zinc-500">Motivo</th>
                    <th className="px-4 py-3 text-left text-xs uppercase text-zinc-500">Comando</th>
                    <th className="px-4 py-3 text-right text-xs uppercase text-zinc-500">Acoes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/80">
                  {actionsLoading ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-10 text-center text-zinc-500">
                        Carregando auditoria...
                      </td>
                    </tr>
                  ) : actions.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-10 text-center text-zinc-500">
                        Nenhuma acao encontrada.
                      </td>
                    </tr>
                  ) : (
                    actions.map((action) => (
                      <tr key={action.id} className="transition-colors hover:bg-zinc-800/45">
                        <td className="px-4 py-3 text-xs text-zinc-300">{formatDateTime(action.createdAt)}</td>
                        <td className="px-4 py-3 text-xs text-zinc-300">{automationActionLabel(action.action)}</td>
                        <td className="px-4 py-3 text-xs">
                          <p className="font-bold text-zinc-200">{automationOperationLabel(action)}</p>
                          <p className="text-zinc-500">{automationSourceLabel(action.trigger)}</p>
                          {automationContextLabel(action) ? (
                            <p className="mt-1 text-[11px] text-zinc-600">{automationContextLabel(action)}</p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-xs text-zinc-400 font-mono">{action.steamId}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              action.status === 'QUEUED'
                                ? 'bg-green-900/30 text-green-400 border border-green-800'
                                : action.status === 'FAILED'
                                ? 'bg-red-900/30 text-red-400 border border-red-800'
                                : 'bg-yellow-900/30 text-yellow-400 border border-yellow-800'
                            }`}
                          >
                            {automationStatusLabel(action.status)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-zinc-400">{automationReasonLabel(action.reason)}</td>
                        <td className="px-4 py-3 text-xs text-zinc-400 font-mono">{formatCommand(action.command)}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleRetryAction(action.id)}
                            disabled={busy || action.status === 'QUEUED'}
                            className="inline-flex items-center rounded-md border border-zinc-700/80 bg-zinc-900/70 px-3 py-1 text-xs font-bold text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-60"
                          >
                            Tentar novamente
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
};

export default Vips;

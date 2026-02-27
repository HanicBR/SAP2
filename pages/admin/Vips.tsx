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
    raw_tokens_not_allowed_in_dispatch: 'Tokens Raw nao permitidos no envio real',
    command_contains_newline: 'Comando invalido (contendo quebra de linha)',
    sandbox_server_not_found: 'Servidor Sandbox nao encontrado',
    sandbox_server_invalid_mode: 'Servidor selecionado nao e Sandbox',
    sandbox_server_missing: 'Nenhum servidor Sandbox disponivel',
    enqueue_failed: 'Falha ao enfileirar comando',
    dispatch_error: 'Erro no envio da automacao',
    mock_mode: 'Modo mock (sem envio real)',
  };
  return known[code] || code;
};

const dispatchResultLabel = (dispatch?: { queued: boolean; skipped?: boolean; reason?: string }) => {
  if (!dispatch) return 'sem automacao';
  if (dispatch.queued) return 'enfileirada';
  if (dispatch.skipped) return 'ignorada';
  return 'falhou';
};

const Vips: React.FC = () => {
  const { config } = useConfig();
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
  const [grantDurationDays, setGrantDurationDays] = useState('30');

  const [extendSteamId, setExtendSteamId] = useState('');
  const [extendPlan, setExtendPlan] = useState('');
  const [extendDurationDays, setExtendDurationDays] = useState('30');
  const [revokeReason, setRevokeReason] = useState('');

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
    if (!durationOptions.some((d) => d.value === grantDurationDays)) {
      setGrantDurationDays(durationOptions[0]?.value || '30');
    }
    if (!durationOptions.some((d) => d.value === extendDurationDays)) {
      setExtendDurationDays(durationOptions[0]?.value || '30');
    }
  }, [grantDurationDays, extendDurationDays, durationOptions]);

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

  const handleGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFeedback('');
    try {
      const result = await ApiService.grantVip({
        steamId: grantSteamId.trim(),
        name: grantName.trim() || undefined,
        vipPlan: grantPlan,
        vipDurationDays: Number.parseInt(grantDurationDays, 10),
      });
      setFeedback(
        result.dispatch
          ? `VIP concedido. Automacao ${dispatchResultLabel(result.dispatch)}${
              result.dispatch.reason ? ` (${automationReasonLabel(result.dispatch.reason)})` : ''
            }.`
          : 'VIP concedido.',
      );
      setGrantSteamId('');
      setGrantName('');
      await refreshAll();
    } catch (err: any) {
      setFeedback(err?.message || 'Erro ao conceder VIP');
    } finally {
      setBusy(false);
    }
  };

  const handleExtend = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFeedback('');
    try {
      const result = await ApiService.extendVip({
        steamId: extendSteamId.trim(),
        vipPlan: extendPlan || undefined,
        vipDurationDays: Number.parseInt(extendDurationDays, 10),
      });
      setFeedback(
        result.dispatch
          ? `VIP estendido. Automacao ${dispatchResultLabel(result.dispatch)}${
              result.dispatch.reason ? ` (${automationReasonLabel(result.dispatch.reason)})` : ''
            }.`
          : 'VIP estendido.',
      );
      await refreshAll();
    } catch (err: any) {
      setFeedback(err?.message || 'Erro ao estender VIP');
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async (steamId: string) => {
    const confirmed = window.confirm(`Revogar VIP de ${steamId}?`);
    if (!confirmed) return;
    setBusy(true);
    setFeedback('');
    try {
      const result = await ApiService.revokeVip({
        steamId,
        reason: revokeReason.trim() || undefined,
      });
      setFeedback(
        result.dispatch
          ? `VIP revogado. Automacao ${dispatchResultLabel(result.dispatch)}${
              result.dispatch.reason ? ` (${automationReasonLabel(result.dispatch.reason)})` : ''
            }.`
          : 'VIP revogado.',
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
      setFeedback(err?.message || 'Erro ao executar retry da ação VIP');
    } finally {
      setBusy(false);
    }
  };

  const handleReconcileExpired = async (dryRun: boolean) => {
    setReconcileBusy(true);
    setFeedback('');
    try {
      const summary = await ApiService.reconcileExpiredVips({
        dryRun,
        enqueue: true,
        limit: 200,
      });
      setFeedback(
        dryRun
          ? `Simulação de VIPs expirados: encontrados=${summary.expiredCount}.`
          : `Processamento de VIPs expirados: encontrados=${summary.expiredCount}, atualizados=${summary.updatedCount}, dispatchQueued=${summary.dispatchQueuedCount}, dispatchNotQueued=${summary.dispatchNotQueuedCount}.`,
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
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-2xl font-bold text-white flex items-center">
          <Icons.Crown className="w-6 h-6 mr-3 text-brand" />
          VIPs
        </h1>
        <button
          onClick={refreshAll}
          className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-4 py-2 rounded text-sm font-bold uppercase tracking-wider flex items-center"
          disabled={loading || actionsLoading || automationLoading || serversLoading}
        >
          <Icons.RefreshCw className="w-4 h-4 mr-2" />
          Atualizar
        </button>
      </div>

      {feedback ? (
        <div className="bg-zinc-900 border border-zinc-700 rounded p-3 text-sm text-zinc-300">{feedback}</div>
      ) : null}

      <form onSubmit={handleSaveAutomationConfig} className="bg-zinc-900 border border-zinc-800 rounded p-4 space-y-3">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          <h2 className="text-sm uppercase font-bold text-zinc-300">Automacao VIP no servidor</h2>
          <span className="text-xs text-zinc-500">source={automationConfig.source || 'env'}</span>
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-300">
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
            className="bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm font-mono"
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
          <div className="text-xs text-zinc-500 flex items-center">
            {serversLoading
              ? 'Carregando servidores...'
              : `${sandboxServers.length} servidor(es) Sandbox disponivel(is)`}
          </div>
          <div className="text-xs text-zinc-500 flex items-center">
            Tokens: {'{{steamId}}'}, {'{{vipPlanServer}}'}, {'{{vipExpiryUnix}}'}
          </div>
          <input
            value={automationConfig.grantTemplate}
            onChange={(e) =>
              setAutomationConfig((prev) => ({
                ...prev,
                grantTemplate: e.target.value,
              }))
            }
            className="bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm font-mono md:col-span-2"
            placeholder='Template GRANT. Ex: sam setrank {{steamId}} {{vipPlanServer}}'
          />
          <input
            value={automationConfig.revokeTemplate}
            onChange={(e) =>
              setAutomationConfig((prev) => ({
                ...prev,
                revokeTemplate: e.target.value,
              }))
            }
            className="bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm font-mono md:col-span-2"
            placeholder='Template REVOKE. Ex: sam setrank {{steamId}} "user"'
          />
        </div>
        <button
          type="submit"
          disabled={automationSaving}
          className="bg-brand hover:bg-brand-dark text-white px-4 py-2 rounded text-sm font-bold uppercase disabled:opacity-60"
        >
          Salvar automacao
        </button>
      </form>

      <div className="bg-zinc-900 border border-zinc-800 rounded p-4 flex flex-wrap gap-2 items-center">
        <span className="text-xs uppercase font-bold text-zinc-400">VIP expirado</span>
        <span className="text-xs text-zinc-500">
          Remove VIP vencido no painel e dispara REVOKE para o servidor.
        </span>
        <button
          type="button"
          onClick={() => handleReconcileExpired(true)}
          disabled={reconcileBusy}
          className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3 py-2 rounded text-xs font-bold uppercase disabled:opacity-60"
        >
          Simular expirados
        </button>
        <button
          type="button"
          onClick={() => handleReconcileExpired(false)}
          disabled={reconcileBusy}
          className="bg-yellow-700 hover:bg-yellow-600 text-white px-3 py-2 rounded text-xs font-bold uppercase disabled:opacity-60"
        >
          Remover expirados agora
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <form onSubmit={handleGrant} className="bg-zinc-900 border border-zinc-800 rounded p-4 space-y-3">
          <h2 className="text-sm uppercase font-bold text-zinc-300">Conceder VIP</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              required
              value={grantSteamId}
              onChange={(e) => setGrantSteamId(e.target.value)}
              className="bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm font-mono"
              placeholder="SteamID"
            />
            <input
              value={grantName}
              onChange={(e) => setGrantName(e.target.value)}
              className="bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm"
              placeholder="Nome (opcional)"
            />
            <select
              value={grantPlan}
              onChange={(e) => setGrantPlan(e.target.value)}
              className="bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm"
            >
              {planOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <select
              value={grantDurationDays}
              onChange={(e) => setGrantDurationDays(e.target.value)}
              className="bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm"
            >
              {durationOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={busy}
            className="bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded text-sm font-bold uppercase disabled:opacity-60"
          >
            Conceder
          </button>
        </form>

        <form onSubmit={handleExtend} className="bg-zinc-900 border border-zinc-800 rounded p-4 space-y-3">
          <h2 className="text-sm uppercase font-bold text-zinc-300">Estender VIP</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              required
              value={extendSteamId}
              onChange={(e) => setExtendSteamId(e.target.value)}
              className="bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm font-mono"
              placeholder="SteamID"
            />
            <input
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              className="bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm"
              placeholder="Motivo revogação (opcional)"
            />
            <select
              value={extendPlan}
              onChange={(e) => setExtendPlan(e.target.value)}
              className="bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm"
            >
              {planOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <select
              value={extendDurationDays}
              onChange={(e) => setExtendDurationDays(e.target.value)}
              className="bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm"
            >
              {durationOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="bg-blue-700 hover:bg-blue-600 text-white px-4 py-2 rounded text-sm font-bold uppercase disabled:opacity-60"
            >
              Estender
            </button>
            <button
              type="button"
              onClick={() => handleRevoke(extendSteamId.trim())}
              disabled={busy || !extendSteamId.trim()}
              className="bg-red-700 hover:bg-red-600 text-white px-4 py-2 rounded text-sm font-bold uppercase disabled:opacity-60"
            >
              Revogar
            </button>
          </div>
        </form>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded overflow-hidden">
        <div className="p-4 border-b border-zinc-800 bg-zinc-950/40 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
          <h2 className="text-sm uppercase font-bold text-zinc-300">VIPs registrados</h2>
          <div className="flex gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm"
              placeholder="Buscar por SteamID ou nome"
            />
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as 'ALL' | 'ACTIVE' | 'EXPIRED')}
              className="bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm"
            >
              <option value="ALL">Todos</option>
              <option value="ACTIVE">Ativos</option>
              <option value="EXPIRED">Expirados</option>
            </select>
            <button onClick={loadData} className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3 rounded text-sm">
              Buscar
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-800">
            <thead className="bg-zinc-950/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs uppercase text-zinc-500">Jogador</th>
                <th className="px-4 py-3 text-left text-xs uppercase text-zinc-500">SteamID</th>
                <th className="px-4 py-3 text-left text-xs uppercase text-zinc-500">Plano</th>
                <th className="px-4 py-3 text-left text-xs uppercase text-zinc-500">Expira em</th>
                <th className="px-4 py-3 text-left text-xs uppercase text-zinc-500">Status</th>
                <th className="px-4 py-3 text-right text-xs uppercase text-zinc-500">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                    Carregando VIPs...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                    Nenhum VIP encontrado.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.steamId} className="hover:bg-zinc-800/40">
                    <td className="px-4 py-3 text-sm text-white">{item.name}</td>
                    <td className="px-4 py-3 text-xs text-zinc-400 font-mono">{item.steamId}</td>
                    <td className="px-4 py-3 text-sm text-zinc-300">{item.vipPlan || '-'}</td>
                    <td className="px-4 py-3 text-sm text-zinc-300">{formatDateTime(item.vipExpiry)}</td>
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
                        onClick={() => {
                          setExtendSteamId(item.steamId);
                          setExtendPlan(item.vipPlan || planOptions[0]);
                        }}
                        className="text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3 py-1 rounded mr-2"
                      >
                        Selecionar
                      </button>
                      <button
                        onClick={() => handleRevoke(item.steamId)}
                        className="text-xs bg-red-800 hover:bg-red-700 text-white px-3 py-1 rounded"
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

      <div className="bg-zinc-900 border border-zinc-800 rounded overflow-hidden">
        <div className="p-4 border-b border-zinc-800 bg-zinc-950/40 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
          <h2 className="text-sm uppercase font-bold text-zinc-300">Auditoria automação VIP</h2>
          <div className="flex gap-2">
            <input
              value={actionSteamId}
              onChange={(e) => setActionSteamId(e.target.value)}
              className="bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm"
              placeholder="Filtrar SteamID"
            />
            <select
              value={actionStatus}
              onChange={(e) => setActionStatus(e.target.value as 'ALL' | VipAutomationActionStatus)}
              className="bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm"
            >
              <option value="ALL">Todos</option>
              <option value="QUEUED">Enfileirado</option>
              <option value="FAILED">Falhou</option>
              <option value="SKIPPED">Ignorado</option>
            </select>
            <button
              onClick={loadActions}
              className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3 rounded text-sm"
            >
              Buscar
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-800">
            <thead className="bg-zinc-950/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs uppercase text-zinc-500">Quando</th>
                <th className="px-4 py-3 text-left text-xs uppercase text-zinc-500">Ação</th>
                <th className="px-4 py-3 text-left text-xs uppercase text-zinc-500">SteamID</th>
                <th className="px-4 py-3 text-left text-xs uppercase text-zinc-500">Status</th>
                <th className="px-4 py-3 text-left text-xs uppercase text-zinc-500">Motivo</th>
                <th className="px-4 py-3 text-left text-xs uppercase text-zinc-500">Comando</th>
                <th className="px-4 py-3 text-right text-xs uppercase text-zinc-500">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {actionsLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">
                    Carregando auditoria...
                  </td>
                </tr>
              ) : actions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">
                    Nenhuma ação encontrada.
                  </td>
                </tr>
              ) : (
                actions.map((action) => (
                  <tr key={action.id} className="hover:bg-zinc-800/40">
                    <td className="px-4 py-3 text-xs text-zinc-300">{formatDateTime(action.createdAt)}</td>
                    <td className="px-4 py-3 text-xs text-zinc-300">{automationActionLabel(action.action)}</td>
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
                        onClick={() => handleRetryAction(action.id)}
                        disabled={busy || action.status === 'QUEUED'}
                        className="text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-3 py-1 rounded disabled:opacity-60"
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
    </div>
  );
};

export default Vips;

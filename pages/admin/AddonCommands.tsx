import React, { useMemo, useState } from 'react';
import { Icons } from '../../components/Icon';

type CommandKind = 'bool' | 'url' | 'seconds' | 'number' | 'text';

type AddonCommandDef = {
  name: string;
  defaultValue: string;
  kind: CommandKind;
  section: string;
  summary: string;
  note?: string;
  example?: string;
  recommended?: boolean;
};

const ADDON_PATH = 'sandbox/addons/sam_spawnlogs/lua/autorun/server/backstabber_sandbox_mvp_ingest.lua';

const COMMANDS: AddonCommandDef[] = [
  {
    name: 'bsb_ingest_enable',
    defaultValue: '0',
    kind: 'bool',
    section: 'Base',
    summary: 'Liga/desliga o addon de ingest no servidor.',
    recommended: true,
  },
  {
    name: 'bsb_ingest_url',
    defaultValue: 'http://127.0.0.1:4000/api/ingest/logs',
    kind: 'url',
    section: 'Base',
    summary: 'Endpoint HTTP de ingest de logs.',
    note: 'Em producao use URL publica HTTPS.',
    recommended: true,
  },
  {
    name: 'bsb_server_key',
    defaultValue: '""',
    kind: 'text',
    section: 'Base',
    summary: 'Chave do servidor para autenticar no backend Backstabber.',
    example: 'bsb_server_key sk_live_srv_sandbox_01_xxx',
    recommended: true,
  },
  {
    name: 'bsb_ws_enable',
    defaultValue: '0',
    kind: 'bool',
    section: 'WebSocket',
    summary: 'Liga transporte WS para pulse/live-state/viewer-state.',
    recommended: true,
  },
  {
    name: 'bsb_ws_url',
    defaultValue: '""',
    kind: 'url',
    section: 'WebSocket',
    summary: 'URL WS do backend (auto-resolve via ingest_url se vazio).',
    example: 'bsb_ws_url wss://backstabberbrasil.com/ws/servers',
    recommended: true,
  },
  {
    name: 'bsb_ws_verify_tls',
    defaultValue: '1',
    kind: 'bool',
    section: 'WebSocket',
    summary: 'Valida certificado TLS em conexoes WSS.',
  },
  {
    name: 'bsb_ws_reconnect_seconds',
    defaultValue: '5',
    kind: 'seconds',
    section: 'WebSocket',
    summary: 'Delay base de reconexao do WS.',
  },
  {
    name: 'bsb_state_enable',
    defaultValue: '1',
    kind: 'bool',
    section: 'Live State',
    summary: 'Envia snapshots de presenca de players por WS.',
    recommended: true,
  },
  {
    name: 'bsb_state_seconds',
    defaultValue: '10',
    kind: 'seconds',
    section: 'Live State',
    summary: 'Intervalo dos snapshots player_state.',
  },
  {
    name: 'bsb_viewer_enable',
    defaultValue: '0',
    kind: 'bool',
    section: 'WebViewer',
    summary: 'Liga snapshots viewer_state (posicao/angulo para WebViewer).',
    recommended: true,
  },
  {
    name: 'bsb_viewer_seconds',
    defaultValue: '1',
    kind: 'seconds',
    section: 'WebViewer',
    summary: 'Intervalo dos snapshots do WebViewer.',
    recommended: true,
  },
  {
    name: 'bsb_pulse_enable',
    defaultValue: '1',
    kind: 'bool',
    section: 'Playtime',
    summary: 'Liga envio de pulse para calculo de playtime.',
  },
  {
    name: 'bsb_pulse_url',
    defaultValue: '""',
    kind: 'url',
    section: 'Playtime',
    summary: 'Endpoint de pulse (auto-resolve se vazio).',
  },
  {
    name: 'bsb_pulse_seconds',
    defaultValue: '60',
    kind: 'seconds',
    section: 'Playtime',
    summary: 'Intervalo dos pulses de playtime.',
  },
  {
    name: 'bsb_heartbeat_url',
    defaultValue: 'http://127.0.0.1:4000/api/servers/heartbeat',
    kind: 'url',
    section: 'Fallback HTTP',
    summary: 'Endpoint HTTP de heartbeat (fallback de presenca).',
  },
  {
    name: 'bsb_heartbeat_seconds',
    defaultValue: '30',
    kind: 'seconds',
    section: 'Fallback HTTP',
    summary: 'Intervalo padrao do heartbeat HTTP.',
  },
  {
    name: 'bsb_heartbeat_ws_fallback_seconds',
    defaultValue: '120',
    kind: 'seconds',
    section: 'Fallback HTTP',
    summary: 'Intervalo do heartbeat quando WS esta saudavel (0 pausa fallback).',
  },
  {
    name: 'bsb_actions_enable',
    defaultValue: '1',
    kind: 'bool',
    section: 'Actions',
    summary: 'Liga pull de acoes remotas (punicoes/comandos) no servidor.',
  },
  {
    name: 'bsb_actions_url',
    defaultValue: '""',
    kind: 'url',
    section: 'Actions',
    summary: 'Endpoint HTTP de pull de actions.',
  },
  {
    name: 'bsb_actions_seconds',
    defaultValue: '3',
    kind: 'seconds',
    section: 'Actions',
    summary: 'Intervalo do poll HTTP de actions.',
  },
  {
    name: 'bsb_actions_http_fallback_seconds',
    defaultValue: '30',
    kind: 'seconds',
    section: 'Actions',
    summary: 'Poll HTTP enquanto WS saudavel (0 pausa poll HTTP).',
  },
  {
    name: 'bsb_batch_size',
    defaultValue: '100',
    kind: 'number',
    section: 'Ingest Queue',
    summary: 'Quantidade maxima de eventos por request.',
  },
  {
    name: 'bsb_flush_seconds',
    defaultValue: '2',
    kind: 'seconds',
    section: 'Ingest Queue',
    summary: 'Intervalo de flush da fila de ingest.',
  },
  {
    name: 'bsb_max_payload_bytes',
    defaultValue: '524288',
    kind: 'number',
    section: 'Ingest Queue',
    summary: 'Tamanho maximo do JSON de ingest por request.',
  },
  {
    name: 'bsb_max_retry_attempts',
    defaultValue: '0',
    kind: 'number',
    section: 'Ingest Queue',
    summary: 'Tentativas de retry (0 = infinito).',
  },
  {
    name: 'bsb_queue_warn_size',
    defaultValue: '1000',
    kind: 'number',
    section: 'Ingest Queue',
    summary: 'Limite para alerta de backlog da fila.',
  },
  {
    name: 'bsb_prop_spawn_enable',
    defaultValue: '1',
    kind: 'bool',
    section: 'Eventos',
    summary: 'Liga eventos PROP_SPAWN no ingest.',
  },
  {
    name: 'bsb_prop_spawn_max_per_window',
    defaultValue: '0',
    kind: 'number',
    section: 'Eventos',
    summary: 'Maximo por jogador na janela (0 = ilimitado).',
  },
  {
    name: 'bsb_prop_spawn_window_seconds',
    defaultValue: '10',
    kind: 'seconds',
    section: 'Eventos',
    summary: 'Janela do rate limit de PROP_SPAWN.',
  },
  {
    name: 'bsb_ingest_debug',
    defaultValue: '0',
    kind: 'bool',
    section: 'Debug',
    summary: 'Liga logs de debug do addon no console do servidor.',
  },
];

const WS_PRESET = [
  'bsb_ingest_enable 1',
  'bsb_server_key SUA_SERVER_KEY',
  'bsb_ingest_url https://backstabberbrasil.com/api/ingest/logs',
  'bsb_ws_enable 1',
  'bsb_ws_url wss://backstabberbrasil.com/ws/servers',
  'bsb_state_enable 1',
  'bsb_state_seconds 10',
  'bsb_viewer_enable 1',
  'bsb_viewer_seconds 1',
].join('\n');

const DIAG_PRESET = [
  'bsb_ingest_debug 1',
  'bsb_ws_enable 1',
  'bsb_viewer_enable 1',
  'bsb_viewer_seconds 1',
  'bsb_actions_http_fallback_seconds 30',
  'bsb_heartbeat_ws_fallback_seconds 120',
].join('\n');

const kindLabel = (kind: CommandKind): string => {
  if (kind === 'bool') return 'bool';
  if (kind === 'url') return 'url';
  if (kind === 'seconds') return 'seconds';
  if (kind === 'number') return 'number';
  return 'text';
};

const kindClass = (kind: CommandKind): string => {
  if (kind === 'bool') return 'border-emerald-900/40 bg-emerald-900/20 text-emerald-300';
  if (kind === 'url') return 'border-cyan-900/40 bg-cyan-900/20 text-cyan-300';
  if (kind === 'seconds') return 'border-yellow-900/40 bg-yellow-900/20 text-yellow-300';
  if (kind === 'number') return 'border-purple-900/40 bg-purple-900/20 text-purple-300';
  return 'border-zinc-700 bg-zinc-800 text-zinc-300';
};

const copyToClipboard = async (value: string): Promise<void> => {
  const text = String(value || '');
  if (!text) return;
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', 'true');
  area.style.position = 'absolute';
  area.style.left = '-9999px';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  document.body.removeChild(area);
};

const AddonCommands: React.FC = () => {
  const [search, setSearch] = useState('');
  const [sectionFilter, setSectionFilter] = useState('all');
  const [copyState, setCopyState] = useState<string | null>(null);

  const sections = useMemo(
    () => Array.from(new Set(COMMANDS.map((item) => item.section))),
    [],
  );

  const filtered = useMemo(() => {
    const term = String(search || '').trim().toLowerCase();
    return COMMANDS.filter((item) => {
      if (sectionFilter !== 'all' && item.section !== sectionFilter) return false;
      if (!term) return true;
      const haystack = `${item.name} ${item.summary} ${item.note || ''}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [search, sectionFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, AddonCommandDef[]>();
    filtered.forEach((item) => {
      const list = map.get(item.section) || [];
      list.push(item);
      map.set(item.section, list);
    });
    return map;
  }, [filtered]);

  const copyWithToast = async (key: string, value: string) => {
    try {
      await copyToClipboard(value);
      setCopyState(key);
      window.setTimeout(() => {
        setCopyState((prev) => (prev === key ? null : prev));
      }, 1200);
    } catch {
      setCopyState(null);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-black text-white flex items-center">
          <Icons.Terminal className="w-6 h-6 mr-3 text-red-500" />
          Comandos do Addon
        </h1>
        <p className="text-sm text-zinc-500">
          Referencia rapida dos `bsb_*` usados no console do servidor GMod.
        </p>
        <p className="text-xs text-zinc-600 font-mono">{ADDON_PATH}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-center justify-between gap-3 mb-2">
            <h2 className="text-sm font-bold uppercase text-zinc-200">Preset recomendado (WS + Viewer)</h2>
            <button
              type="button"
              onClick={() => void copyWithToast('preset_ws', WS_PRESET)}
              className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] font-bold uppercase text-zinc-300 hover:text-white"
            >
              <Icons.Copy className="h-3.5 w-3.5" />
              {copyState === 'preset_ws' ? 'Copiado' : 'Copiar'}
            </button>
          </div>
          <pre className="rounded border border-zinc-800 bg-zinc-950 p-3 text-[11px] text-zinc-300 overflow-x-auto">
            <code>{WS_PRESET}</code>
          </pre>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-center justify-between gap-3 mb-2">
            <h2 className="text-sm font-bold uppercase text-zinc-200">Preset diagnostico</h2>
            <button
              type="button"
              onClick={() => void copyWithToast('preset_diag', DIAG_PRESET)}
              className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] font-bold uppercase text-zinc-300 hover:text-white"
            >
              <Icons.Copy className="h-3.5 w-3.5" />
              {copyState === 'preset_diag' ? 'Copiado' : 'Copiar'}
            </button>
          </div>
          <pre className="rounded border border-zinc-800 bg-zinc-950 p-3 text-[11px] text-zinc-300 overflow-x-auto">
            <code>{DIAG_PRESET}</code>
          </pre>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_220px_auto] md:items-center">
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar comando ou descricao..."
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-red-600 focus:outline-none"
          />
          <select
            value={sectionFilter}
            onChange={(event) => setSectionFilter(event.target.value)}
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-red-600 focus:outline-none"
          >
            <option value="all">Todas secoes</option>
            {sections.map((section) => (
              <option key={section} value={section}>
                {section}
              </option>
            ))}
          </select>
          <div className="rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-bold uppercase text-zinc-400 text-center">
            {filtered.length} comando(s)
          </div>
        </div>
      </div>

      {sections
        .filter((section) => grouped.has(section))
        .map((section) => (
          <div key={section} className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-4">
            <h3 className="text-sm font-black uppercase tracking-wide text-zinc-200 mb-3">{section}</h3>
            <div className="grid gap-3">
              {(grouped.get(section) || []).map((item) => (
                <div key={item.name} className="rounded border border-zinc-800 bg-zinc-950 p-3">
                  <div className="flex flex-wrap items-center gap-2 justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="rounded bg-black/30 px-2 py-1 text-[12px] text-zinc-100 font-mono">
                        {item.name}
                      </code>
                      <span className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${kindClass(item.kind)}`}>
                        {kindLabel(item.kind)}
                      </span>
                      {item.recommended ? (
                        <span className="rounded border border-emerald-900/40 bg-emerald-900/20 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-300">
                          recomendado
                        </span>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => void copyWithToast(item.name, item.example || `${item.name} `)}
                      className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] font-bold uppercase text-zinc-300 hover:text-white"
                    >
                      <Icons.Copy className="h-3.5 w-3.5" />
                      {copyState === item.name ? 'Copiado' : 'Copiar'}
                    </button>
                  </div>

                  <p className="mt-2 text-sm text-zinc-200">{item.summary}</p>
                  {item.note ? <p className="mt-1 text-xs text-zinc-500">{item.note}</p> : null}

                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    <div className="rounded border border-zinc-800 bg-zinc-900/40 px-2 py-1 text-[11px]">
                      <span className="text-zinc-500 uppercase font-bold">Default: </span>
                      <code className="text-zinc-200">{item.defaultValue}</code>
                    </div>
                    <div className="rounded border border-zinc-800 bg-zinc-900/40 px-2 py-1 text-[11px]">
                      <span className="text-zinc-500 uppercase font-bold">Exemplo: </span>
                      <code className="text-zinc-200">{item.example || `${item.name} ${item.defaultValue}`}</code>
                    </div>
                  </div>

                  {item.kind === 'bool' ? (
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void copyWithToast(`${item.name}_on`, `${item.name} 1`)}
                        className="rounded border border-emerald-900/40 bg-emerald-900/20 px-2 py-1 text-[11px] font-bold uppercase text-emerald-300"
                      >
                        ON
                      </button>
                      <button
                        type="button"
                        onClick={() => void copyWithToast(`${item.name}_off`, `${item.name} 0`)}
                        className="rounded border border-red-900/40 bg-red-900/20 px-2 py-1 text-[11px] font-bold uppercase text-red-300"
                      >
                        OFF
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}
    </div>
  );
};

export default AddonCommands;

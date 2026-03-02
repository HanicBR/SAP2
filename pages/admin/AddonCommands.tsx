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
  { name: 'bsb_ingest_enable', defaultValue: '0', kind: 'bool', section: 'Essencial', summary: 'Liga/desliga o addon.', recommended: true },
  { name: 'bsb_ingest_url', defaultValue: 'http://127.0.0.1:4000/api/ingest/logs', kind: 'url', section: 'Essencial', summary: 'Endpoint de ingest de logs.', note: 'Use URL publica HTTPS em producao.', recommended: true },
  { name: 'bsb_server_key', defaultValue: '""', kind: 'text', section: 'Essencial', summary: 'Chave de autenticacao do servidor no backend.', example: 'bsb_server_key sk_live_srv_sandbox_01_xxx', recommended: true },

  { name: 'bsb_ws_enable', defaultValue: '0', kind: 'bool', section: 'WebSocket', summary: 'Ativa transporte WS para updates em tempo real.', recommended: true },
  { name: 'bsb_ws_url', defaultValue: '""', kind: 'url', section: 'WebSocket', summary: 'URL WS do backend (auto se vazio).', example: 'bsb_ws_url wss://backstabberbrasil.com/ws/servers', recommended: true },
  { name: 'bsb_ws_verify_tls', defaultValue: '1', kind: 'bool', section: 'WebSocket', summary: 'Valida certificado TLS do WSS.' },
  { name: 'bsb_ws_reconnect_seconds', defaultValue: '5', kind: 'seconds', section: 'WebSocket', summary: 'Delay base de reconexao do WS.' },

  { name: 'bsb_state_enable', defaultValue: '1', kind: 'bool', section: 'Presenca / Live', summary: 'Envia player_state (presenca de players).', recommended: true },
  { name: 'bsb_state_seconds', defaultValue: '10', kind: 'seconds', section: 'Presenca / Live', summary: 'Intervalo de player_state.' },

  { name: 'bsb_viewer_enable', defaultValue: '0', kind: 'bool', section: 'WebViewer', summary: 'Envia viewer_state (posicao/angulo para WebViewer).', recommended: true },
  { name: 'bsb_viewer_seconds', defaultValue: '1', kind: 'seconds', section: 'WebViewer', summary: 'Intervalo dos frames do WebViewer.', recommended: true },

  { name: 'bsb_pulse_enable', defaultValue: '1', kind: 'bool', section: 'Playtime', summary: 'Ativa pulse para calculo de playtime.' },
  { name: 'bsb_pulse_url', defaultValue: '""', kind: 'url', section: 'Playtime', summary: 'Endpoint de pulse (auto se vazio).' },
  { name: 'bsb_pulse_seconds', defaultValue: '60', kind: 'seconds', section: 'Playtime', summary: 'Intervalo dos pulses.' },

  { name: 'bsb_heartbeat_url', defaultValue: 'http://127.0.0.1:4000/api/servers/heartbeat', kind: 'url', section: 'Fallback HTTP', summary: 'Endpoint de heartbeat HTTP.' },
  { name: 'bsb_heartbeat_seconds', defaultValue: '30', kind: 'seconds', section: 'Fallback HTTP', summary: 'Intervalo do heartbeat.' },
  { name: 'bsb_heartbeat_ws_fallback_seconds', defaultValue: '120', kind: 'seconds', section: 'Fallback HTTP', summary: 'Heartbeat com WS saudavel (0 pausa fallback).' },

  { name: 'bsb_actions_enable', defaultValue: '1', kind: 'bool', section: 'Acoes remotas', summary: 'Ativa poll de actions no servidor.' },
  { name: 'bsb_actions_url', defaultValue: '""', kind: 'url', section: 'Acoes remotas', summary: 'Endpoint HTTP de pull de actions.' },
  { name: 'bsb_actions_seconds', defaultValue: '3', kind: 'seconds', section: 'Acoes remotas', summary: 'Intervalo padrao do poll HTTP.' },
  { name: 'bsb_actions_http_fallback_seconds', defaultValue: '30', kind: 'seconds', section: 'Acoes remotas', summary: 'Poll HTTP quando WS saudavel (0 pausa).' },

  { name: 'bsb_batch_size', defaultValue: '100', kind: 'number', section: 'Fila / Ingest', summary: 'Maximo de eventos por request.' },
  { name: 'bsb_flush_seconds', defaultValue: '2', kind: 'seconds', section: 'Fila / Ingest', summary: 'Intervalo de flush da fila.' },
  { name: 'bsb_max_payload_bytes', defaultValue: '524288', kind: 'number', section: 'Fila / Ingest', summary: 'Maximo de bytes por payload de ingest.' },
  { name: 'bsb_max_retry_attempts', defaultValue: '0', kind: 'number', section: 'Fila / Ingest', summary: 'Tentativas de retry (0 = infinito).' },
  { name: 'bsb_queue_warn_size', defaultValue: '1000', kind: 'number', section: 'Fila / Ingest', summary: 'Aviso de backlog da fila.' },

  { name: 'bsb_prop_spawn_enable', defaultValue: '1', kind: 'bool', section: 'Eventos', summary: 'Ativa evento PROP_SPAWN.' },
  { name: 'bsb_prop_spawn_max_per_window', defaultValue: '0', kind: 'number', section: 'Eventos', summary: 'Maximo por jogador na janela (0 = ilimitado).' },
  { name: 'bsb_prop_spawn_window_seconds', defaultValue: '10', kind: 'seconds', section: 'Eventos', summary: 'Janela do rate limit de PROP_SPAWN.' },

  { name: 'bsb_ingest_debug', defaultValue: '0', kind: 'bool', section: 'Debug', summary: 'Ativa logs de debug do addon no console.' },
];

const QUICK_START: Array<{ title: string; command: string; help: string }> = [
  { title: 'Ativar addon', command: 'bsb_ingest_enable 1', help: 'Sem isso nada envia.' },
  { title: 'Definir chave do servidor', command: 'bsb_server_key SUA_SERVER_KEY', help: 'Autentica no backend.' },
  { title: 'Ativar WS', command: 'bsb_ws_enable 1', help: 'Atualizacao em tempo real.' },
  { title: 'Ativar WebViewer', command: 'bsb_viewer_enable 1', help: 'Libera frame de posicao no painel.' },
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

const SAFE_DEFAULTS_PRESET = [
  'bsb_actions_http_fallback_seconds 30',
  'bsb_heartbeat_ws_fallback_seconds 120',
  'bsb_max_payload_bytes 524288',
  'bsb_batch_size 100',
  'bsb_flush_seconds 2',
].join('\n');

const SECTION_ORDER = [
  'Essencial',
  'WebSocket',
  'Presenca / Live',
  'WebViewer',
  'Playtime',
  'Fallback HTTP',
  'Acoes remotas',
  'Fila / Ingest',
  'Eventos',
  'Debug',
];

const kindLabel = (kind: CommandKind): string => {
  if (kind === 'bool') return 'booleano';
  if (kind === 'url') return 'url';
  if (kind === 'seconds') return 'segundos';
  if (kind === 'number') return 'numero';
  return 'texto';
};

const kindTone = (kind: CommandKind): string => {
  if (kind === 'bool') return 'border-emerald-900/40 bg-emerald-900/15 text-emerald-300';
  if (kind === 'url') return 'border-cyan-900/40 bg-cyan-900/15 text-cyan-300';
  if (kind === 'seconds') return 'border-yellow-900/40 bg-yellow-900/15 text-yellow-300';
  if (kind === 'number') return 'border-violet-900/40 bg-violet-900/15 text-violet-300';
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

  const visibleSections = useMemo(() => {
    const existing = new Set(COMMANDS.map((item) => item.section));
    return SECTION_ORDER.filter((section) => existing.has(section));
  }, []);

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
      const sectionItems = map.get(item.section) || [];
      sectionItems.push(item);
      map.set(item.section, sectionItems);
    });
    return map;
  }, [filtered]);

  const copyWithToast = async (key: string, value: string) => {
    try {
      await copyToClipboard(value);
      setCopyState(key);
      window.setTimeout(() => {
        setCopyState((prev) => (prev === key ? null : prev));
      }, 1300);
    } catch {
      setCopyState(null);
    }
  };

  return (
    <div className="ui-page animate-fade-in">
      <section className="ui-hero">
        <div className="flex items-start gap-3 flex-wrap justify-between">
          <div>
            <h1 className="text-2xl font-black text-white flex items-center">
              <Icons.Terminal className="w-6 h-6 mr-3 text-red-400" />
              Comandos do Addon
            </h1>
            <p className="mt-1 text-sm text-zinc-300">
              Guia simples para console do servidor GMod. Foco em comandos que voce realmente usa no dia a dia.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <span className="ui-chip">para leigos</span>
            <span className="ui-chip">copiar e colar</span>
            <span className="ui-chip">baixo risco</span>
          </div>
        </div>
        <p className="mt-2 text-xs text-zinc-500 font-mono">{ADDON_PATH}</p>
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        <section className="ui-card xl:col-span-2">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
            <h2 className="text-sm font-black uppercase tracking-wide text-zinc-100">Comeco rapido (4 passos)</h2>
            <span className="text-[11px] text-zinc-500 uppercase font-bold">Copie em ordem</span>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {QUICK_START.map((step, index) => (
              <div key={step.title} className="ui-card-soft p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold text-zinc-200">
                    {index + 1}. {step.title}
                  </p>
                  <button
                    type="button"
                    onClick={() => void copyWithToast(`quick_${index}`, step.command)}
                    className="ui-btn ui-btn-primary"
                  >
                    <Icons.Copy className="w-3.5 h-3.5" />
                    {copyState === `quick_${index}` ? 'Copiado' : 'Copiar'}
                  </button>
                </div>
                <code className="mt-2 block rounded bg-black/35 px-2 py-1 text-[12px] text-zinc-100 font-mono break-all">
                  {step.command}
                </code>
                <p className="mt-1 text-xs text-zinc-500">{step.help}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="ui-card">
          <h2 className="text-sm font-black uppercase tracking-wide text-zinc-100 mb-2">Presets completos</h2>
          <div className="space-y-3">
            <div className="ui-card-soft p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-xs uppercase font-bold text-zinc-300">WS + Viewer</p>
                <button
                  type="button"
                  onClick={() => void copyWithToast('preset_ws', WS_PRESET)}
                  className="ui-btn ui-btn-primary"
                >
                  <Icons.Copy className="w-3.5 h-3.5" />
                  {copyState === 'preset_ws' ? 'Copiado' : 'Copiar'}
                </button>
              </div>
              <pre className="rounded bg-zinc-950 border border-zinc-800 p-2 text-[11px] text-zinc-300 overflow-x-auto">
                <code>{WS_PRESET}</code>
              </pre>
            </div>
            <div className="ui-card-soft p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-xs uppercase font-bold text-zinc-300">Defaults seguros</p>
                <button
                  type="button"
                  onClick={() => void copyWithToast('preset_safe', SAFE_DEFAULTS_PRESET)}
                  className="ui-btn ui-btn-ghost"
                >
                  <Icons.Copy className="w-3.5 h-3.5" />
                  {copyState === 'preset_safe' ? 'Copiado' : 'Copiar'}
                </button>
              </div>
              <pre className="rounded bg-zinc-950 border border-zinc-800 p-2 text-[11px] text-zinc-300 overflow-x-auto">
                <code>{SAFE_DEFAULTS_PRESET}</code>
              </pre>
            </div>
          </div>
        </section>
      </div>

      <section className="ui-card">
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar comando, secao ou descricao..."
            className="w-full px-3 py-2 text-sm"
          />
          <div className="rounded border border-zinc-700 bg-zinc-900/70 px-3 py-2 text-xs uppercase font-bold text-zinc-400 text-center">
            {filtered.length} comandos
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSectionFilter('all')}
            className={`ui-chip ${sectionFilter === 'all' ? 'ui-chip-active' : ''}`}
          >
            Todas secoes
          </button>
          {visibleSections.map((section) => (
            <button
              key={section}
              type="button"
              onClick={() => setSectionFilter(section)}
              className={`ui-chip ${sectionFilter === section ? 'ui-chip-active' : ''}`}
            >
              {section}
            </button>
          ))}
        </div>
      </section>

      {visibleSections
        .filter((section) => grouped.has(section))
        .map((section) => (
          <details
            key={section}
            className="ui-card"
            open={section === 'Essencial' || sectionFilter !== 'all'}
          >
            <summary className="cursor-pointer list-none flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-black uppercase tracking-wide text-zinc-100">{section}</h3>
              </div>
              <span className="text-xs text-zinc-500 uppercase font-bold">
                {(grouped.get(section) || []).length} item(ns)
              </span>
            </summary>

            <div className="mt-3 grid gap-3">
              {(grouped.get(section) || []).map((item) => (
                <div key={item.name} className="ui-card-soft p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="rounded bg-black/35 px-2 py-1 text-[12px] text-zinc-100 font-mono break-all">
                          {item.name}
                        </code>
                        <span className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase ${kindTone(item.kind)}`}>
                          {kindLabel(item.kind)}
                        </span>
                        {item.recommended ? (
                          <span className="rounded border border-emerald-900/40 bg-emerald-900/15 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-300">
                            recomendado
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm text-zinc-200">{item.summary}</p>
                      {item.note ? <p className="mt-1 text-xs text-zinc-500">{item.note}</p> : null}
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => void copyWithToast(item.name, item.example || `${item.name} ${item.defaultValue}`)}
                        className="ui-btn ui-btn-ghost"
                      >
                        <Icons.Copy className="w-3.5 h-3.5" />
                        {copyState === item.name ? 'Copiado' : 'Copiar exemplo'}
                      </button>
                      {item.kind === 'bool' ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void copyWithToast(`${item.name}_on`, `${item.name} 1`)}
                            className="ui-btn ui-btn-primary"
                          >
                            ON
                          </button>
                          <button
                            type="button"
                            onClick={() => void copyWithToast(`${item.name}_off`, `${item.name} 0`)}
                            className="ui-btn ui-btn-danger"
                          >
                            OFF
                          </button>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-3 grid gap-1">
                    <div className="ui-kv">
                      <span>Padrao</span>
                      <span>
                        <code className="font-mono text-zinc-200">{item.defaultValue}</code>
                      </span>
                    </div>
                    <div className="ui-kv">
                      <span>Exemplo</span>
                      <span>
                        <code className="font-mono text-zinc-200 break-all">
                          {item.example || `${item.name} ${item.defaultValue}`}
                        </code>
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </details>
        ))}
    </div>
  );
};

export default AddonCommands;

import React, { useEffect, useState } from 'react';
import { ApiService } from '../../services/api';
import { GameMode, GameServer, LegacyImportSummary } from '../../types';
import { Icons } from '../../components/Icon';

const ImportLogs: React.FC = () => {
  const [servers, setServers] = useState<GameServer[]>([]);
  const [selectedServerId, setSelectedServerId] = useState<string>('');
  const [defaultGameMode, setDefaultGameMode] = useState<GameMode | 'AUTO'>(
    'AUTO',
  );
  const [timezoneOffsetMinutes, setTimezoneOffsetMinutes] = useState<string>(
    '-180',
  );
  const [baseDate, setBaseDate] = useState<string>('');
  const [formatHint, setFormatHint] = useState<'AUTO' | 'ULX' | 'TAGGED'>(
    'AUTO',
  );
  const [content, setContent] = useState<string>('');
  const [dryRun, setDryRun] = useState<boolean>(true);
  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<LegacyImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ApiService.getServers()
      .then((list) => {
        setServers(list);
        if (list.length && !selectedServerId) {
          setSelectedServerId(list[0].id);
        }
      })
      .catch(() => undefined);
  }, [selectedServerId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result?.toString() || '';
      setContent(text);
    };
    reader.readAsText(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedServerId || !content.trim()) {
      setError('Selecione um servidor e cole o conteúdo do log.');
      return;
    }
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const tz =
        timezoneOffsetMinutes.trim() === ''
          ? undefined
          : Number(timezoneOffsetMinutes);

      const modeToSend =
        defaultGameMode === 'AUTO' ? undefined : defaultGameMode;

      const summary = await ApiService.importLegacyLogs({
        serverId: selectedServerId,
        content,
        formatHint,
        defaultGameMode: modeToSend as GameMode | undefined,
        timezoneOffsetMinutes: Number.isFinite(tz || NaN) ? tz : undefined,
        baseDate: baseDate || undefined,
        dryRun,
      });
      setResult(summary);
    } catch (err: any) {
      setError(err?.message || 'Erro ao importar logs.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Icons.Upload className="w-6 h-6 text-red-500" />
          Importar Logs Legados (ULX / Console)
        </h1>
        <span className="text-xs text-zinc-500">
          Cole o conteúdo dos arquivos .txt antigos para popular o painel.
        </span>
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-4"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-[11px] font-bold text-zinc-500 uppercase mb-1">
              Servidor
            </label>
            <select
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm text-white"
              value={selectedServerId}
              onChange={(e) => setSelectedServerId(e.target.value)}
            >
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-zinc-500 uppercase mb-1">
              Modo de jogo padrão
            </label>
            <select
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm text-white"
              value={defaultGameMode}
              onChange={(e) =>
                setDefaultGameMode(e.target.value as GameMode | 'AUTO')
              }
            >
              <option value="AUTO">Auto (modo do servidor)</option>
              <option value={GameMode.TTT}>TTT</option>
              <option value={GameMode.MURDER}>Murder</option>
              <option value={GameMode.SANDBOX}>Sandbox</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-[11px] font-bold text-zinc-500 uppercase mb-1">
              Timezone do log (offset em minutos)
            </label>
            <input
              type="number"
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm text-white"
              value={timezoneOffsetMinutes}
              onChange={(e) => setTimezoneOffsetMinutes(e.target.value)}
              placeholder="-180 para BRT"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-zinc-500 uppercase mb-1">
              Data base (YYYY-MM-DD)
            </label>
            <input
              type="date"
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm text-white"
              value={baseDate}
              onChange={(e) => setBaseDate(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-zinc-500 uppercase mb-1">
              Formato
            </label>
            <select
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm text-white"
              value={formatHint}
              onChange={(e) =>
                setFormatHint(e.target.value as 'AUTO' | 'ULX' | 'TAGGED')
              }
            >
              <option value="AUTO">Detectar automaticamente</option>
              <option value="ULX">ULX / console padrão</option>
              <option value="TAGGED">Backstabber [TAGGED]</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <label className="inline-flex items-center text-xs text-zinc-400">
              <input
                type="checkbox"
                className="mr-2"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
              />
              Apenas simular (dry-run, não salvar no banco)
            </label>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs text-zinc-500">
              ou selecione um arquivo .txt
            </label>
            <input
              type="file"
              accept=".txt"
              className="text-xs text-zinc-400"
              onChange={handleFileChange}
            />
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-bold text-zinc-500 uppercase mb-1">
            Conteúdo do log (.txt)
          </label>
          <textarea
            className="w-full h-64 bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-xs text-white font-mono resize-y"
            placeholder="Cole aqui o conteúdo do arquivo 2025-12-05.txt ou 12-06-25.txt..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>

        {error && (
          <div className="text-sm text-red-400 bg-red-950/40 border border-red-900 rounded px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 bg-red-700 hover:bg-red-600 disabled:opacity-60 text-white text-sm font-bold uppercase rounded border border-red-800 flex items-center gap-2"
          >
            {loading && (
              <Icons.Activity className="w-4 h-4 animate-spin text-white" />
            )}
            {dryRun ? 'Simular Importação' : 'Importar Logs'}
          </button>
        </div>
      </form>

      {result && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icons.FileText className="w-5 h-5 text-zinc-400" />
              <span className="text-sm font-bold text-white">
                Resultado da importação ({result.format})
              </span>
            </div>
            <span
              className={`text-xs font-bold uppercase ${
                result.dryRun
                  ? 'text-yellow-400 bg-yellow-900/30 border border-yellow-700 px-2 py-0.5 rounded'
                  : 'text-green-400 bg-green-900/30 border border-green-700 px-2 py-0.5 rounded'
              }`}
            >
              {result.dryRun ? 'Simulação' : 'Aplicado'}
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-[11px] text-zinc-500 uppercase font-bold">
                Linhas analisadas
              </div>
              <div className="text-white font-mono">
                {result.linesParsed}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-500 uppercase font-bold">
                Eventos gerados
              </div>
              <div className="text-white font-mono">
                {result.eventsGenerated}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-500 uppercase font-bold">
                Eventos inseridos
              </div>
              <div className="text-white font-mono">
                {result.eventsInserted}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-500 uppercase font-bold">
                Jogadores tocados
              </div>
              <div className="text-white font-mono">
                {result.playersTouched}
              </div>
            </div>
          </div>

          {result.byType && (
            <div>
              <div className="text-[11px] text-zinc-500 uppercase font-bold mb-1">
                Eventos por tipo
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {Object.entries(result.byType).map(([type, count]) => (
                  <span
                    key={type}
                    className="px-2 py-1 bg-zinc-950 border border-zinc-700 rounded text-zinc-300 font-mono"
                  >
                    {type}: {count}
                  </span>
                ))}
              </div>
            </div>
          )}

          {result.errors && result.errors.length > 0 && (
            <div>
              <div className="text-[11px] text-red-400 uppercase font-bold mb-1">
                Erros de parsing (primeiros)
              </div>
              <ul className="text-xs text-zinc-400 space-y-1 max-h-40 overflow-auto">
                {result.errors.slice(0, 10).map((err, idx) => (
                  <li key={`${err.line}_${idx}`}>
                    <span className="text-red-400 font-mono">
                      L{err.line}:{' '}
                    </span>
                    <span>{err.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ImportLogs;


import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Icons } from '../../components/Icon';
import { ApiService } from '../../services/api';
import { GameServer, ServerStatus, ServerWsLiveStateItem } from '../../types';

const LIVE_STATE_MAX_AGE_SECONDS = 30;
const DEFAULT_VIEWER_MAP = 'rp_evocity_v33x';

type ServerLivePresentation = {
  status: ServerStatus;
  players: number;
  maxPlayers: number;
  map?: string;
  lastSignal?: string;
  sourceLabel: 'LIVE (WS)' | 'WS stale' | 'Fallback';
  sourceClass: string;
};

const getStatusBadgeClass = (status: ServerStatus) => {
  if (status === ServerStatus.ONLINE) return 'bg-green-900/20 text-green-300 border-green-700';
  if (status === ServerStatus.MAINTENANCE) return 'bg-yellow-900/20 text-yellow-300 border-yellow-700';
  return 'bg-red-900/20 text-red-300 border-red-700';
};

const getStatusLabel = (status: ServerStatus) => {
  if (status === ServerStatus.ONLINE) return 'online';
  if (status === ServerStatus.MAINTENANCE) return 'maintenance';
  return 'offline';
};

const normalizeViewerMap = (raw: string | undefined): string => {
  const map = String(raw || '').trim();
  if (!map) return DEFAULT_VIEWER_MAP;
  if (map.toLowerCase() === 'desconhecido') return DEFAULT_VIEWER_MAP;
  return map;
};

const getServerLivePresentation = (
  server: GameServer,
  snapshot?: ServerWsLiveStateItem,
): ServerLivePresentation => {
  const ageSeconds = Number(snapshot?.ageSeconds ?? Number.POSITIVE_INFINITY);
  const hasFreshWs = Boolean(
    snapshot &&
      snapshot.connected &&
      Number.isFinite(ageSeconds) &&
      ageSeconds <= LIVE_STATE_MAX_AGE_SECONDS,
  );

  if (hasFreshWs && snapshot) {
    return {
      status: ServerStatus.ONLINE,
      players: Number(snapshot.playerCount || 0),
      maxPlayers: server.maxPlayers,
      ...(snapshot.map ? { map: snapshot.map } : {}),
      ...(snapshot.receivedAt ? { lastSignal: snapshot.receivedAt } : {}),
      sourceLabel: 'LIVE (WS)',
      sourceClass: 'bg-emerald-900/20 text-emerald-300 border-emerald-700',
    };
  }

  if (snapshot) {
    return {
      status: server.status,
      players: server.currentPlayers,
      maxPlayers: server.maxPlayers,
      ...(server.currentMap ? { map: server.currentMap } : {}),
      ...(server.lastHeartbeat || snapshot.receivedAt ? { lastSignal: server.lastHeartbeat || snapshot.receivedAt } : {}),
      sourceLabel: 'WS stale',
      sourceClass: 'bg-yellow-900/20 text-yellow-300 border-yellow-700',
    };
  }

  return {
    status: server.status,
    players: server.currentPlayers,
    maxPlayers: server.maxPlayers,
    ...(server.currentMap ? { map: server.currentMap } : {}),
    ...(server.lastHeartbeat ? { lastSignal: server.lastHeartbeat } : {}),
    sourceLabel: 'Fallback',
    sourceClass: 'bg-zinc-800 text-zinc-400 border-zinc-700',
  };
};

const WebViewer: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [servers, setServers] = useState<GameServer[]>([]);
  const [liveStateByServerId, setLiveStateByServerId] = useState<Record<string, ServerWsLiveStateItem>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedServerId, setSelectedServerId] = useState<string>('');

  const loadServers = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const nextServers = await ApiService.getServers();
      setServers(nextServers || []);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Erro ao carregar servidores');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const loadLiveState = useCallback(async () => {
    try {
      const response = await ApiService.getServersLiveState();
      const mapById: Record<string, ServerWsLiveStateItem> = {};
      for (const item of response.items || []) {
        if (!item?.serverId) continue;
        mapById[item.serverId] = item;
      }
      setLiveStateByServerId(mapById);
    } catch {
      // Best effort, fallback already available in server snapshot.
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadServers(true), loadLiveState()]);
    setRefreshing(false);
  }, [loadLiveState, loadServers]);

  const sortedServers = useMemo(
    () =>
      [...servers].sort((left, right) =>
        String(left.name || '').toLowerCase().localeCompare(String(right.name || '').toLowerCase()),
      ),
    [servers],
  );

  useEffect(() => {
    void Promise.all([loadServers(), loadLiveState()]);
    const timer = window.setInterval(() => {
      void loadLiveState();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [loadLiveState, loadServers]);

  useEffect(() => {
    if (!sortedServers.length) {
      setSelectedServerId('');
      return;
    }

    const fromQuery = String(searchParams.get('serverId') || '').trim();
    if (fromQuery && sortedServers.some((item) => item.id === fromQuery)) {
      setSelectedServerId((current) => (current === fromQuery ? current : fromQuery));
      return;
    }

    setSelectedServerId((current) => (current && sortedServers.some((item) => item.id === current) ? current : sortedServers[0].id));
  }, [searchParams, sortedServers]);

  useEffect(() => {
    if (!selectedServerId) return;
    const current = String(searchParams.get('serverId') || '').trim();
    if (current === selectedServerId) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('serverId', selectedServerId);
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, selectedServerId, setSearchParams]);

  const selectedServer = useMemo(
    () => sortedServers.find((item) => item.id === selectedServerId) || null,
    [selectedServerId, sortedServers],
  );

  const selectedMap = useMemo(() => {
    if (!selectedServer) return DEFAULT_VIEWER_MAP;
    const liveMap = liveStateByServerId[selectedServer.id]?.map;
    return normalizeViewerMap(liveMap || selectedServer.currentMap);
  }, [liveStateByServerId, selectedServer]);

  const openViewerForServer = useCallback((serverId: string) => {
    if (!serverId) return;
    const server = sortedServers.find((item) => item.id === serverId);
    const liveMap = server ? liveStateByServerId[server.id]?.map : '';
    const fallbackMap = server?.currentMap || '';
    const mapName = normalizeViewerMap(liveMap || fallbackMap);
    navigate(`/admin/web-viewer/${serverId}/view3d?map=${encodeURIComponent(mapName)}`);
  }, [liveStateByServerId, navigate, sortedServers]);

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black text-white uppercase tracking-tight">Web Viewer</h1>
          <p className="text-sm text-zinc-500 mt-1">Selecione um servidor para abrir o Map Viewer 3D.</p>
        </div>
        <button
          type="button"
          onClick={() => void refreshAll()}
          disabled={refreshing}
          className="px-3 py-2 rounded border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-xs font-bold uppercase tracking-wider text-zinc-200 disabled:opacity-60"
        >
          {refreshing ? 'Atualizando...' : 'Atualizar'}
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-900/40 bg-red-900/10 px-3 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded border border-zinc-800 bg-zinc-900 px-4 py-6 text-zinc-400">
          Carregando servidores...
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(320px,420px)_1fr] gap-4">
          <div className="rounded border border-zinc-800 bg-zinc-900">
            <div className="px-4 py-3 border-b border-zinc-800">
              <p className="text-xs uppercase tracking-wider font-bold text-zinc-500">Servidores</p>
            </div>
            <div className="max-h-[560px] overflow-y-auto">
              {!sortedServers.length ? (
                <div className="px-4 py-6 text-sm text-zinc-500">Nenhum servidor encontrado.</div>
              ) : (
                sortedServers.map((server) => {
                  const display = getServerLivePresentation(server, liveStateByServerId[server.id]);
                  const selected = server.id === selectedServerId;
                  return (
                    <button
                      key={server.id}
                      type="button"
                      onClick={() => setSelectedServerId(server.id)}
                      className={`w-full text-left px-4 py-3 border-b border-zinc-800 transition-colors ${
                        selected ? 'bg-zinc-800/80' : 'hover:bg-zinc-800/40'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-bold text-white truncate">{server.name}</p>
                        <span className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${display.sourceClass}`}>
                          {display.sourceLabel}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-400">
                        <span className={`px-2 py-0.5 rounded border font-bold uppercase ${getStatusBadgeClass(display.status)}`}>
                          {getStatusLabel(display.status)}
                        </span>
                        <span className="font-mono">{display.players}/{display.maxPlayers}</span>
                        <span className="truncate">map={normalizeViewerMap(display.map)}</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="rounded border border-zinc-800 bg-zinc-900 p-5">
            {!selectedServer ? (
              <p className="text-zinc-500 text-sm">Selecione um servidor para abrir o viewer.</p>
            ) : (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-[11px] uppercase tracking-wider font-bold text-zinc-500">Servidor selecionado</p>
                    <h2 className="text-xl font-black text-white uppercase tracking-tight mt-1">{selectedServer.name}</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/admin/servers/${selectedServer.id}`}
                      className="px-3 py-2 rounded border border-zinc-700 bg-zinc-950 hover:bg-zinc-800 text-[11px] font-bold uppercase tracking-wider text-zinc-300"
                    >
                      Detalhes
                    </Link>
                    <button
                      type="button"
                      onClick={() => openViewerForServer(selectedServer.id)}
                      className="px-3 py-2 rounded border border-cyan-800 bg-cyan-900/20 hover:bg-cyan-800/30 text-[11px] font-bold uppercase tracking-wider text-cyan-300 flex items-center"
                    >
                      <Icons.Box className="w-4 h-4 mr-1" />
                      Abrir Web Viewer
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="rounded border border-zinc-800 bg-zinc-950 px-3 py-2">
                    <p className="text-[10px] uppercase font-bold tracking-wider text-zinc-500">IP</p>
                    <p className="text-sm font-mono text-zinc-200">{selectedServer.ip}:{selectedServer.port}</p>
                  </div>
                  <div className="rounded border border-zinc-800 bg-zinc-950 px-3 py-2">
                    <p className="text-[10px] uppercase font-bold tracking-wider text-zinc-500">Modo</p>
                    <p className="text-sm text-zinc-200">{selectedServer.mode}</p>
                  </div>
                  <div className="rounded border border-zinc-800 bg-zinc-950 px-3 py-2">
                    <p className="text-[10px] uppercase font-bold tracking-wider text-zinc-500">Mapa para abrir</p>
                    <p className="text-sm text-zinc-200 break-all">{selectedMap}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default WebViewer;

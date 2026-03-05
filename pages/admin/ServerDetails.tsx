import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ApiService } from '../../services/api';
import {
  GameServer,
  ServerAnalytics,
  ServerLiveStateResponse,
  ServerStatus,
  ServerViewerActionStatusResponse,
  ServerViewerActionType,
  ServerViewerMapOverlayResolved,
  ServerViewerStatePlayer,
  ServerViewerStateSnapshot,
} from '../../types';
import { Icons } from '../../components/Icon';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from 'recharts';

type RangeKey = '24h' | '7d' | '30d';
const LIVE_STATE_MAX_AGE_SECONDS = 30;
const VIEWER_STATE_STALE_SECONDS = 8;
const VIEWER_RECONNECT_BASE_MS = 1000;
const VIEWER_RECONNECT_MAX_MS = 15000;
const VIEWER_ACTION_STATUS_POLL_INTERVAL_MS = 1200;
const VIEWER_ACTION_STATUS_MAX_POLLS = 18;
const VIEWER_ACTION_REASON_MAX_LENGTH = 160;

type ViewerWsStatus = 'idle' | 'connecting' | 'connected' | 'subscribed' | 'error';

const KPICard = memo(
  ({
    title,
    value,
    subText,
    icon: Icon,
    colorClass,
  }: {
    title: string;
    value: string;
    subText: string;
    icon: any;
    colorClass: string;
  }) => (
    <div className="bg-zinc-900 p-6 rounded border border-zinc-800 relative overflow-hidden group">
      <div className="relative z-10">
        <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{title}</p>
        <p className={`text-4xl font-black mt-1 font-mono ${colorClass}`}>{value}</p>
        <p className="text-xs text-zinc-500 mt-2">{subText}</p>
      </div>
      <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:scale-110 transition-transform duration-500">
        <Icon className={`w-16 h-16 ${colorClass}`} />
      </div>
    </div>
  ),
);

const PlaytimeChart = memo(({ data }: { data: { date: string; hours: number }[] }) => (
  <div className="bg-zinc-900 p-6 rounded border border-zinc-800">
    <h3 className="text-sm font-bold text-white uppercase mb-6 flex items-center">
      <Icons.BarChart className="w-4 h-4 mr-2 text-zinc-500" /> Horas Jogadas no Período
    </h3>
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
          <XAxis dataKey="date" stroke="#71717a" tick={{ fontSize: 10 }} />
          <YAxis stroke="#71717a" tick={{ fontSize: 12 }} />
          <Tooltip
            cursor={{ fill: '#27272a' }}
            formatter={(value: number) => [`${value}h`, 'Horas']}
            contentStyle={{ backgroundColor: '#09090b', border: '1px solid #3f3f46', color: '#f4f4f5' }}
          />
          <Bar dataKey="hours" fill="#b91c1c" radius={[4, 4, 0, 0]}>
            {data.map((entry, index) => (
              <Cell key={`${entry.date}_${index}`} fill={index % 2 === 0 ? '#b91c1c' : '#991b1b'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  </div>
));

const PlayerCountChart = memo(({ data }: { data: { date: string; count: number }[] }) => (
  <div className="bg-zinc-900 p-6 rounded border border-zinc-800">
    <h3 className="text-sm font-bold text-white uppercase mb-6 flex items-center">
      <Icons.Activity className="w-4 h-4 mr-2 text-zinc-500" /> Média de Jogadores Simultâneos
    </h3>
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
          <XAxis dataKey="date" stroke="#71717a" tick={{ fontSize: 10 }} />
          <YAxis stroke="#71717a" tick={{ fontSize: 12 }} />
          <Tooltip
            formatter={(value: number) => [`${value}`, 'Jogadores']}
            contentStyle={{ backgroundColor: '#09090b', border: '1px solid #3f3f46', color: '#f4f4f5' }}
          />
          <Line
            type="monotone"
            dataKey="count"
            stroke="#06b6d4"
            strokeWidth={3}
            dot={{ r: 3, fill: '#06b6d4' }}
            activeDot={{ r: 5, stroke: '#fff' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  </div>
));

const TopPlayersList = memo(({ players, range }: { players: ServerAnalytics['topPlayers']; range: RangeKey }) => (
  <div className="bg-zinc-900 rounded border border-zinc-800 flex flex-col h-full">
    <div className="p-4 border-b border-zinc-800 bg-zinc-950/30">
      <h3 className="text-sm font-bold text-zinc-300 uppercase flex items-center">
        <Icons.Trophy className="w-4 h-4 mr-2 text-yellow-500" /> Top Jogadores ({range})
      </h3>
    </div>
    <div className="flex-1 overflow-y-auto p-2">
      {!players.length && (
        <p className="text-zinc-500 text-sm p-3">Sem dados de jogadores nesse período.</p>
      )}
      {players.map((player, idx) => (
        <div
          key={player.steamId}
          className="flex items-center p-3 hover:bg-zinc-800/50 rounded transition-colors border-b border-zinc-800/50 last:border-0 group"
        >
          <div className="flex-shrink-0 w-8 text-center font-black text-zinc-600 group-hover:text-white transition-colors">
            #{idx + 1}
          </div>
          <img src={player.avatarUrl} className="w-10 h-10 rounded-full bg-zinc-800 mx-3" alt="" />
          <div className="flex-1 min-w-0">
            <Link to={`/admin/players/${player.steamId}`} className="text-sm font-bold text-white hover:text-cyan-400 truncate block">
              {player.name}
            </Link>
            <p className="text-xs text-zinc-500 font-mono">{player.steamId}</p>
          </div>
          <div className="text-right">
            <span className="block text-sm font-black text-zinc-200">{player.hours.toLocaleString('pt-BR')}h</span>
            <span className="text-[10px] text-zinc-500 uppercase font-bold">Jogado</span>
          </div>
        </div>
      ))}
    </div>
    <div className="p-4 border-t border-zinc-800 bg-zinc-950/30 text-center">
      <Link to="/admin/players" className="text-xs text-zinc-500 hover:text-white uppercase font-bold">
        Ver todos os jogadores
      </Link>
    </div>
  </div>
));

const statusText = (status: ServerStatus): string => {
  if (status === ServerStatus.ONLINE) return 'Online';
  if (status === ServerStatus.MAINTENANCE) return 'Manutenção';
  return 'Offline';
};

const statusClass = (status: ServerStatus): string => {
  if (status === ServerStatus.ONLINE) return 'bg-green-900/30 text-green-300 border-green-800';
  if (status === ServerStatus.MAINTENANCE) return 'bg-yellow-900/30 text-yellow-300 border-yellow-800';
  return 'bg-red-900/30 text-red-300 border-red-800';
};

const playtimeSourceLabel = (source?: 'legacy' | 'pulse') => {
  if (source === 'pulse') return 'Pulso';
  return 'Legado';
};

const playtimeDecisionLabel = (reason?: string) => {
  const normalized = String(reason || '').trim().toLowerCase();
  if (normalized === 'pulse_forced') return 'Modo pulse ativo';
  if (normalized === 'hybrid_coverage_ok') return 'Hibrido com cobertura suficiente';
  if (normalized === 'hybrid_coverage_below_threshold') return 'Hibrido com cobertura abaixo do minimo';
  if (normalized === 'hybrid_no_pulse_data') return 'Hibrido sem dados de pulso';
  if (normalized === 'pulse_no_data_fallback') return 'Pulse sem dados, usando legado';
  if (normalized === 'pulse_query_error_fallback') return 'Erro ao ler pulso, fallback legado';
  if (normalized === 'legacy_forced') return 'Modo legado ativo';
  return normalized ? normalized : 'Nao informado';
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const formatCoord = (value: number | undefined): string => {
  if (!Number.isFinite(Number(value))) return '0.0';
  return Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
};

const normalizeYawDeg = (value: number | undefined): number => {
  const raw = Number(value || 0);
  if (!Number.isFinite(raw)) return 0;
  const normalized = ((raw % 360) + 360) % 360;
  return normalized;
};

const TEAM_MARKER_COLORS = [
  '#22c55e',
  '#38bdf8',
  '#f59e0b',
  '#ef4444',
  '#a78bfa',
  '#14b8a6',
  '#f472b6',
  '#84cc16',
];

const hashSteamId = (steamId: string): number => {
  let hash = 0;
  for (let index = 0; index < steamId.length; index += 1) {
    hash = (hash * 31 + steamId.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const getViewerMarkerColor = (entry: ServerViewerStatePlayer): string => {
  const teamId = Number(entry.teamId);
  if (Number.isFinite(teamId)) {
    return TEAM_MARKER_COLORS[Math.abs(Math.floor(teamId)) % TEAM_MARKER_COLORS.length];
  }
  return TEAM_MARKER_COLORS[hashSteamId(entry.steamId) % TEAM_MARKER_COLORS.length];
};

const viewerActionStatusLabel = (status: string): string => {
  const normalized = String(status || '').trim().toUpperCase();
  if (normalized === 'ACK_OK') return 'Confirmada (ACK)';
  if (normalized === 'ACK_FAILED') return 'Falhou no servidor';
  if (normalized === 'HTTP_PULLED') return 'Fallback HTTP';
  if (normalized === 'QUEUED') return 'Na fila';
  return normalized || 'Desconhecido';
};

const viewerActionStatusClass = (status: string): string => {
  const normalized = String(status || '').trim().toUpperCase();
  if (normalized === 'ACK_OK') return 'bg-emerald-900/20 text-emerald-300 border-emerald-700';
  if (normalized === 'ACK_FAILED') return 'bg-red-900/20 text-red-300 border-red-700';
  if (normalized === 'HTTP_PULLED') return 'bg-yellow-900/20 text-yellow-300 border-yellow-700';
  return 'bg-zinc-800 text-zinc-300 border-zinc-700';
};

const toViewerWsUrl = (): string | null => {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem('backstabber_token');
  if (!token) return null;

  const wsProtocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const envApiBase = String((import.meta as any)?.env?.VITE_API_BASE_URL || '').trim();

  if (envApiBase.startsWith('http://') || envApiBase.startsWith('https://')) {
    try {
      const apiUrl = new URL(envApiBase);
      return `${wsProtocol}://${apiUrl.host}/ws/admin/viewer?token=${encodeURIComponent(token)}`;
    } catch {
      // fallback to current host
    }
  }

  return `${wsProtocol}://${window.location.host}/ws/admin/viewer?token=${encodeURIComponent(token)}`;
};

const normalizeViewerPlayer = (raw: any): ServerViewerStatePlayer | null => {
  const steamId = String(raw?.steamId || '').trim();
  if (!steamId) return null;
  const pos = raw?.pos || {};
  const eyeAngles = raw?.eyeAngles || {};

  return {
    steamId,
    ...(String(raw?.name || '').trim() ? { name: String(raw.name).trim() } : {}),
    pos: {
      x: Number(pos?.x || 0),
      y: Number(pos?.y || 0),
      z: Number(pos?.z || 0),
    },
    eyeAngles: {
      pitch: Number(eyeAngles?.pitch || 0),
      yaw: Number(eyeAngles?.yaw || 0),
      roll: Number(eyeAngles?.roll || 0),
    },
    ...(Number.isFinite(Number(raw?.health)) ? { health: Math.max(0, Number(raw.health)) } : {}),
    ...(Number.isFinite(Number(raw?.armor)) ? { armor: Math.max(0, Number(raw.armor)) } : {}),
    ...(Number.isFinite(Number(raw?.teamId)) ? { teamId: Number(raw.teamId) } : {}),
    ...(String(raw?.teamName || '').trim() ? { teamName: String(raw.teamName).trim() } : {}),
    ...(typeof raw?.alive === 'boolean' ? { alive: raw.alive } : {}),
  };
};

const parseViewerSnapshotMessage = (raw: any): ServerViewerStateSnapshot | null => {
  const serverId = String(raw?.serverId || '').trim();
  const receivedAt = String(raw?.receivedAt || '').trim();
  if (!serverId || !receivedAt) return null;

  const playersRaw = Array.isArray(raw?.players) ? raw.players : [];
  const players = playersRaw
    .map((entry: any) => normalizeViewerPlayer(entry))
    .filter((entry: ServerViewerStatePlayer | null): entry is ServerViewerStatePlayer => Boolean(entry));

  return {
    serverId,
    receivedAt,
    ...(String(raw?.sentAt || '').trim() ? { sentAt: String(raw.sentAt).trim() } : {}),
    ...(String(raw?.map || '').trim() ? { map: String(raw.map).trim() } : {}),
    playerCount: Number.isFinite(Number(raw?.playerCount)) ? Math.max(0, Number(raw.playerCount)) : players.length,
    players,
  };
};

const ServerDetails: React.FC = () => {
  const { serverId } = useParams<{ serverId: string }>();
  const [server, setServer] = useState<GameServer | null>(null);
  const [analytics, setAnalytics] = useState<ServerAnalytics | null>(null);
  const [liveState, setLiveState] = useState<ServerLiveStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange] = useState<RangeKey>('7d');
  const viewerSocketRef = useRef<WebSocket | null>(null);
  const viewerPingTimerRef = useRef<number | null>(null);
  const viewerReconnectTimerRef = useRef<number | null>(null);
  const [viewerWsStatus, setViewerWsStatus] = useState<ViewerWsStatus>('idle');
  const [viewerWsError, setViewerWsError] = useState<string | null>(null);
  const [viewerConnectedAt, setViewerConnectedAt] = useState<string | null>(null);
  const [viewerLastMessageAt, setViewerLastMessageAt] = useState<string | null>(null);
  const [viewerState, setViewerState] = useState<ServerViewerStateSnapshot | null>(null);
  const [viewerZoomPct, setViewerZoomPct] = useState<number>(100);
  const [viewerSelectedSteamId, setViewerSelectedSteamId] = useState<string | null>(null);
  const [viewerReconnectNonce, setViewerReconnectNonce] = useState<number>(0);
  const [viewerActionReason, setViewerActionReason] = useState<string>('Acao via painel WebViewer');
  const [viewerActionBusy, setViewerActionBusy] = useState(false);
  const [viewerActionError, setViewerActionError] = useState<string | null>(null);
  const [viewerActionStatus, setViewerActionStatus] = useState<ServerViewerActionStatusResponse | null>(null);
  const [viewerMapOverlay, setViewerMapOverlay] = useState<ServerViewerMapOverlayResolved | null>(null);
  const [viewerMapOverlayReason, setViewerMapOverlayReason] = useState<string | null>(null);
  const [viewerSearch, setViewerSearch] = useState<string>('');
  const [viewerShowDead, setViewerShowDead] = useState<boolean>(true);
  const [viewerShowLabels, setViewerShowLabels] = useState<boolean>(true);
  const [viewerShowHeading, setViewerShowHeading] = useState<boolean>(true);
  const [viewerShowGrid, setViewerShowGrid] = useState<boolean>(true);
  const [viewerMarkerScalePct, setViewerMarkerScalePct] = useState<number>(100);
  const [viewerWorldCursor, setViewerWorldCursor] = useState<{ x: number; y: number } | null>(null);
  const viewerActionPollTokenRef = useRef<number>(0);

  const loadData = useCallback(
    async (silent = false) => {
      if (!serverId) return;
      if (silent) setRefreshing(true);
      else setLoading(true);

      try {
        const [serverData, analyticsData, liveStateData] = await Promise.all([
          ApiService.getServerById(serverId),
          ApiService.getServerAnalytics(serverId, range),
          ApiService.getServerLiveState(serverId),
        ]);
        if (serverData) setServer(serverData);
        setAnalytics(analyticsData);
        setLiveState(liveStateData);
      } finally {
        if (silent) setRefreshing(false);
        else setLoading(false);
      }
    },
    [serverId, range],
  );

  useEffect(() => {
    void loadData(false);
    const interval = window.setInterval(() => {
      void loadData(true);
    }, 20000);
    return () => window.clearInterval(interval);
  }, [loadData]);

  useEffect(() => {
    if (!serverId) return undefined;

    let closedByEffect = false;
    let reconnectAttempts = 0;

    const clearPingTimer = () => {
      if (viewerPingTimerRef.current !== null) {
        window.clearInterval(viewerPingTimerRef.current);
        viewerPingTimerRef.current = null;
      }
    };

    const clearReconnectTimer = () => {
      if (viewerReconnectTimerRef.current !== null) {
        window.clearTimeout(viewerReconnectTimerRef.current);
        viewerReconnectTimerRef.current = null;
      }
    };

    const closeSocket = () => {
      const current = viewerSocketRef.current;
      if (!current) return;
      current.onopen = null;
      current.onmessage = null;
      current.onerror = null;
      current.onclose = null;
      try {
        current.close();
      } catch {
        // ignore
      }
      viewerSocketRef.current = null;
    };

    const scheduleReconnect = () => {
      if (closedByEffect) return;
      clearReconnectTimer();
      reconnectAttempts += 1;
      const delayMs = Math.min(
        VIEWER_RECONNECT_MAX_MS,
        VIEWER_RECONNECT_BASE_MS * 2 ** Math.max(0, reconnectAttempts - 1),
      );
      viewerReconnectTimerRef.current = window.setTimeout(() => {
        connectViewer();
      }, delayMs);
    };

    const connectViewer = () => {
      clearReconnectTimer();
      clearPingTimer();
      closeSocket();

      const wsUrl = toViewerWsUrl();
      if (!wsUrl) {
        setViewerWsStatus('error');
        setViewerWsError('Token de admin ausente para conectar no WebViewer.');
        return;
      }

      setViewerWsStatus('connecting');
      setViewerWsError(null);

      let socket: WebSocket;
      try {
        socket = new WebSocket(wsUrl);
      } catch (err: any) {
        setViewerWsStatus('error');
        setViewerWsError(String(err?.message || 'Falha ao abrir WebSocket do WebViewer.'));
        scheduleReconnect();
        return;
      }

      viewerSocketRef.current = socket;

      socket.onopen = () => {
        reconnectAttempts = 0;
        setViewerWsStatus('connected');
        setViewerWsError(null);
        setViewerConnectedAt(new Date().toISOString());

        try {
          socket.send(JSON.stringify({ type: 'subscribe', payload: { serverId } }));
        } catch {
          // ignore send error here; onclose/onerror handles retry
        }

        viewerPingTimerRef.current = window.setInterval(() => {
          const active = viewerSocketRef.current;
          if (!active || active.readyState !== WebSocket.OPEN) return;
          try {
            active.send(JSON.stringify({ type: 'ping' }));
          } catch {
            // no-op
          }
        }, 15000);
      };

      socket.onmessage = (event: MessageEvent) => {
        setViewerLastMessageAt(new Date().toISOString());

        let parsed: any = null;
        try {
          parsed = JSON.parse(String(event.data || ''));
        } catch {
          return;
        }
        const type = String(parsed?.type || '').trim().toLowerCase();

        if (type === 'connected') {
          setViewerWsStatus('connected');
          return;
        }

        if (type === 'subscribed') {
          setViewerWsStatus('subscribed');
          return;
        }

        if (type === 'viewer_state') {
          const snapshot = parseViewerSnapshotMessage(parsed);
          if (!snapshot) return;
          if (snapshot.serverId !== serverId) return;
          setViewerState(snapshot);
          setViewerWsStatus('subscribed');
          return;
        }

        if (type === 'viewer_state_unavailable') {
          if (String(parsed?.serverId || '') === serverId) {
            setViewerState(null);
          }
          return;
        }

        if (type === 'error') {
          const reason = String(parsed?.reason || 'viewer_ws_error');
          setViewerWsError(reason);
          if (reason === 'invalid_or_expired_token') {
            setViewerWsStatus('error');
          }
        }
      };

      socket.onerror = () => {
        setViewerWsError('Erro de conexao no canal do WebViewer.');
      };

      socket.onclose = () => {
        clearPingTimer();
        if (viewerSocketRef.current === socket) {
          viewerSocketRef.current = null;
        }
        if (closedByEffect) return;
        setViewerWsStatus('connecting');
        scheduleReconnect();
      };
    };

    connectViewer();

    return () => {
      closedByEffect = true;
      clearReconnectTimer();
      clearPingTimer();
      closeSocket();
    };
  }, [serverId, viewerReconnectNonce]);

  const currentState = useMemo(() => analytics?.currentState, [analytics]);
  const liveStateAgeSeconds = Number(liveState?.ageSeconds ?? Number.POSITIVE_INFINITY);
  const hasFreshLiveState = Boolean(
    liveState?.available &&
      liveState?.connected &&
      Number.isFinite(liveStateAgeSeconds) &&
      liveStateAgeSeconds <= LIVE_STATE_MAX_AGE_SECONDS,
  );
  const liveStatePlayers = hasFreshLiveState ? liveState?.players || [] : [];
  const liveStateSourceLabel = hasFreshLiveState
    ? 'LIVE (WS)'
    : liveState?.available
    ? 'WS stale'
    : 'Fallback';
  const liveStateSourceClass = hasFreshLiveState
    ? 'bg-emerald-900/20 text-emerald-300 border-emerald-700'
    : liveState?.available
    ? 'bg-yellow-900/20 text-yellow-300 border-yellow-700'
    : 'bg-zinc-800 text-zinc-400 border-zinc-700';
  const displayPlayers = hasFreshLiveState
    ? Number(liveState?.playerCount || 0)
    : currentState?.currentPlayers ?? server?.currentPlayers ?? 0;
  const displayMaxPlayers = currentState?.maxPlayers ?? server?.maxPlayers ?? 0;
  const displayMap = (hasFreshLiveState ? liveState?.map : undefined) || currentState?.currentMap || server?.currentMap || 'Desconhecido';
  const displayStatus = hasFreshLiveState ? ServerStatus.ONLINE : currentState?.status ?? server?.status ?? ServerStatus.OFFLINE;
  const displayLastSignal = hasFreshLiveState ? liveState?.receivedAt : currentState?.lastHeartbeat || server?.lastHeartbeat;
  const playtimeDiagnostics = analytics?.playtimeDiagnostics;
  const playtimeSource = playtimeSourceLabel(analytics?.playtimeSource);
  const playtimeDecision = playtimeDecisionLabel(playtimeDiagnostics?.decisionReason);
  const pulseCoveragePct = Number(analytics?.pulseCoveragePct || 0);
  const pulseVsLegacyHours = Number(playtimeDiagnostics?.diffHours || 0);
  const pulseVsLegacyPct = Number(playtimeDiagnostics?.diffPct || 0);
  const viewerPlayers = useMemo(
    () => {
      const term = String(viewerSearch || '').trim().toLowerCase();
      return [...(viewerState?.players || [])]
        .filter((entry) => {
          if (!viewerShowDead && entry.alive === false) return false;
          if (!term) return true;
          const byName = String(entry.name || '').toLowerCase().includes(term);
          const bySteam = String(entry.steamId || '').toLowerCase().includes(term);
          return byName || bySteam;
        })
        .sort((left, right) => {
          const leftName = String(left.name || left.steamId || '').toLowerCase();
          const rightName = String(right.name || right.steamId || '').toLowerCase();
          return leftName.localeCompare(rightName);
        });
    },
    [viewerSearch, viewerShowDead, viewerState],
  );
  const viewerSnapshotAgeSeconds = useMemo(() => {
    if (!viewerState?.receivedAt) return Number.POSITIVE_INFINITY;
    const parsed = new Date(viewerState.receivedAt).getTime();
    if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
    return Math.max(0, Math.floor((Date.now() - parsed) / 1000));
  }, [viewerState]);
  const hasFreshViewerSnapshot =
    Number.isFinite(viewerSnapshotAgeSeconds) && viewerSnapshotAgeSeconds <= VIEWER_STATE_STALE_SECONDS;
  const viewerMapName = useMemo(() => {
    const resolved = String(
      viewerState?.map || liveState?.map || currentState?.currentMap || server?.currentMap || '',
    ).trim();
    if (!resolved) return '';
    if (resolved.toLowerCase() === 'desconhecido') return '';
    return resolved;
  }, [currentState?.currentMap, liveState?.map, server?.currentMap, viewerState?.map]);
  const hasViewerMapOverlay = Boolean(viewerMapOverlay?.imageUrl);

  useEffect(() => {
    if (!hasViewerMapOverlay) {
      setViewerWorldCursor(null);
    }
  }, [hasViewerMapOverlay]);

  useEffect(() => {
    let cancelled = false;

    const loadOverlay = async () => {
      if (!serverId) return;
      if (!viewerMapName) {
        setViewerMapOverlay(null);
        setViewerMapOverlayReason('map_not_available');
        return;
      }

      try {
        const response = await ApiService.getServerViewerMapOverlay(serverId, viewerMapName);
        if (cancelled) return;
        if (response.available && response.overlay) {
          setViewerMapOverlay(response.overlay);
          setViewerMapOverlayReason(null);
          return;
        }
        setViewerMapOverlay(null);
        setViewerMapOverlayReason(String(response.reason || 'overlay_not_found'));
      } catch {
        if (cancelled) return;
        setViewerMapOverlay(null);
        setViewerMapOverlayReason('overlay_lookup_failed');
      }
    };

    void loadOverlay();
    return () => {
      cancelled = true;
    };
  }, [serverId, viewerMapName]);

  useEffect(() => {
    if (!viewerPlayers.length) {
      setViewerSelectedSteamId(null);
      return;
    }
    const hasSelected = viewerSelectedSteamId
      ? viewerPlayers.some((entry) => entry.steamId === viewerSelectedSteamId)
      : false;
    if (!hasSelected) {
      setViewerSelectedSteamId(viewerPlayers[0].steamId);
    }
  }, [viewerPlayers, viewerSelectedSteamId]);

  const selectedViewerPlayer = useMemo(
    () => viewerPlayers.find((entry) => entry.steamId === viewerSelectedSteamId) || null,
    [viewerPlayers, viewerSelectedSteamId],
  );

  useEffect(() => {
    setViewerActionError(null);
  }, [viewerSelectedSteamId]);

  const viewerMapPoints = useMemo(() => {
    if (!viewerPlayers.length) return [];
    const scale = Math.max(0.6, Math.min(2.4, viewerMarkerScalePct / 100));
    const baseSizePx = Math.round(9 * scale);

    if (viewerMapOverlay) {
      const width = viewerMapOverlay.worldMaxX - viewerMapOverlay.worldMinX;
      const height = viewerMapOverlay.worldMaxY - viewerMapOverlay.worldMinY;
      if (width > 0 && height > 0) {
        return viewerPlayers.map((entry) => {
          let nx = clamp01((Number(entry.pos?.x || 0) - viewerMapOverlay.worldMinX) / width);
          let ny = clamp01((Number(entry.pos?.y || 0) - viewerMapOverlay.worldMinY) / height);
          if (viewerMapOverlay.flipX) nx = 1 - nx;
          if (viewerMapOverlay.flipY) ny = 1 - ny;
          let yawDeg = normalizeYawDeg(entry.eyeAngles?.yaw);
          if (viewerMapOverlay.flipX) yawDeg = normalizeYawDeg(180 - yawDeg);
          if (viewerMapOverlay.flipY) yawDeg = normalizeYawDeg(360 - yawDeg);
          return {
            player: entry,
            isSelected: entry.steamId === viewerSelectedSteamId,
            leftPct: nx * 100,
            topPct: ny * 100,
            markerColor: getViewerMarkerColor(entry),
            yawDeg,
            sizePx: entry.steamId === viewerSelectedSteamId ? baseSizePx + 4 : baseSizePx,
          };
        });
      }
    }

    const focusX =
      selectedViewerPlayer?.pos?.x ??
      viewerPlayers.reduce((acc, entry) => acc + Number(entry.pos?.x || 0), 0) / viewerPlayers.length;
    const focusY =
      selectedViewerPlayer?.pos?.y ??
      viewerPlayers.reduce((acc, entry) => acc + Number(entry.pos?.y || 0), 0) / viewerPlayers.length;

    let radius = 1;
    viewerPlayers.forEach((entry) => {
      const dx = Number(entry.pos?.x || 0) - focusX;
      const dy = Number(entry.pos?.y || 0) - focusY;
      radius = Math.max(radius, Math.sqrt(dx * dx + dy * dy));
    });
    const zoomFactor = Math.max(0.5, Math.min(2.2, viewerZoomPct / 100));
    const effectiveRadius = Math.max(1, radius / zoomFactor);

    return viewerPlayers.map((entry) => {
      const dx = Number(entry.pos?.x || 0) - focusX;
      const dy = Number(entry.pos?.y || 0) - focusY;
      const nx = clamp01(dx / (effectiveRadius * 2) + 0.5);
      const ny = clamp01(dy / (effectiveRadius * 2) + 0.5);
      return {
        player: entry,
        isSelected: entry.steamId === viewerSelectedSteamId,
        leftPct: nx * 100,
        topPct: (1 - ny) * 100,
        markerColor: getViewerMarkerColor(entry),
        yawDeg: normalizeYawDeg(360 - Number(entry.eyeAngles?.yaw || 0)),
        sizePx: entry.steamId === viewerSelectedSteamId ? baseSizePx + 4 : baseSizePx,
      };
    });
  }, [
    viewerMapOverlay,
    viewerMarkerScalePct,
    viewerPlayers,
    selectedViewerPlayer,
    viewerSelectedSteamId,
    viewerZoomPct,
  ]);

  const viewerStatusBadge = useMemo(() => {
    if (viewerWsStatus === 'error') {
      return { label: 'WS error', className: 'bg-red-900/20 text-red-300 border-red-700' };
    }
    if (viewerWsStatus === 'connecting' || viewerWsStatus === 'idle') {
      return { label: 'Connecting', className: 'bg-yellow-900/20 text-yellow-300 border-yellow-700' };
    }
    if (!viewerState) {
      return { label: 'No frame', className: 'bg-zinc-800 text-zinc-400 border-zinc-700' };
    }
    if (!hasFreshViewerSnapshot) {
      return { label: 'Frame stale', className: 'bg-orange-900/20 text-orange-300 border-orange-700' };
    }
    return { label: 'Live frame', className: 'bg-emerald-900/20 text-emerald-300 border-emerald-700' };
  }, [hasFreshViewerSnapshot, viewerState, viewerWsStatus]);

  useEffect(() => {
    return () => {
      viewerActionPollTokenRef.current += 1;
    };
  }, []);

  const pollViewerActionStatus = useCallback(
    async (actionId: string, pollToken: number) => {
      if (!serverId) return;

      for (let attempt = 0; attempt < VIEWER_ACTION_STATUS_MAX_POLLS; attempt += 1) {
        const status = await ApiService.getServerViewerActionStatus(serverId, actionId);
        if (viewerActionPollTokenRef.current !== pollToken) return;
        setViewerActionStatus(status);
        if (status.status !== 'QUEUED') return;
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, VIEWER_ACTION_STATUS_POLL_INTERVAL_MS);
        });
      }
    },
    [serverId],
  );

  const dispatchViewerAction = useCallback(
    async (action: ServerViewerActionType) => {
      if (!serverId || viewerActionBusy) return;
      if (!hasFreshViewerSnapshot) {
        setViewerActionError('Acoes bloqueadas: snapshot do viewer stale/desconectado.');
        return;
      }
      if (!selectedViewerPlayer) {
        setViewerActionError('Selecione um player no frame para executar a acao.');
        return;
      }

      if (action === 'KICK' || action === 'MUTE_10M' || action === 'GAG_10M') {
        const playerLabel = selectedViewerPlayer.name || selectedViewerPlayer.steamId;
        const confirmOk = window.confirm(`Confirmar ${action} em ${playerLabel}?`);
        if (!confirmOk) return;
      }

      setViewerActionBusy(true);
      setViewerActionError(null);

      try {
        const parsedReason = String(viewerActionReason || '')
          .replace(/[\r\n\t]+/g, ' ')
          .trim()
          .slice(0, VIEWER_ACTION_REASON_MAX_LENGTH);
        const response = await ApiService.dispatchServerViewerAction(serverId, {
          action,
          steamId: selectedViewerPlayer.steamId,
          ...(parsedReason ? { reason: parsedReason } : {}),
        });

        setViewerActionStatus({
          ok: true,
          actionId: response.actionId,
          serverId: response.serverId,
          command: '',
          status: response.status,
          createdAt: response.requestedAt,
          updatedAt: response.requestedAt,
          wsAttemptCount: 0,
          metadata: { targetSteamId: selectedViewerPlayer.steamId },
        });

        const pollToken = Date.now();
        viewerActionPollTokenRef.current = pollToken;
        await pollViewerActionStatus(response.actionId, pollToken);
      } catch (err: any) {
        setViewerActionError(String(err?.message || 'Falha ao disparar acao do WebViewer.'));
      } finally {
        setViewerActionBusy(false);
      }
    },
    [
      hasFreshViewerSnapshot,
      pollViewerActionStatus,
      selectedViewerPlayer,
      serverId,
      viewerActionBusy,
      viewerActionReason,
    ],
  );

  const viewerActionForSelected = useMemo(() => {
    if (!viewerActionStatus || !selectedViewerPlayer) return null;
    const metadata = viewerActionStatus.metadata as { targetSteamId?: string } | undefined;
    const targetSteamId = String(metadata?.targetSteamId || '').trim();
    if (targetSteamId && targetSteamId !== selectedViewerPlayer.steamId) return null;
    return viewerActionStatus;
  }, [selectedViewerPlayer, viewerActionStatus]);

  const viewerActionsDisabled =
    viewerActionBusy ||
    !selectedViewerPlayer ||
    !hasFreshViewerSnapshot ||
    viewerWsStatus === 'connecting' ||
    viewerWsStatus === 'error';

  const handleViewerMapMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!viewerMapOverlay) {
        setViewerWorldCursor(null);
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const localX = (event.clientX - rect.left) / Math.max(1, rect.width);
      const localY = (event.clientY - rect.top) / Math.max(1, rect.height);
      let normalizedX = clamp01(localX);
      let normalizedY = clamp01(localY);
      if (viewerMapOverlay.flipX) normalizedX = 1 - normalizedX;
      if (viewerMapOverlay.flipY) normalizedY = 1 - normalizedY;

      const worldX =
        viewerMapOverlay.worldMinX +
        normalizedX * (viewerMapOverlay.worldMaxX - viewerMapOverlay.worldMinX);
      const worldY =
        viewerMapOverlay.worldMinY +
        normalizedY * (viewerMapOverlay.worldMaxY - viewerMapOverlay.worldMinY);
      setViewerWorldCursor({ x: worldX, y: worldY });
    },
    [viewerMapOverlay],
  );

  const handleViewerMapMouseLeave = useCallback(() => {
    setViewerWorldCursor(null);
  }, []);

  if (loading) return <div className="p-8 text-zinc-500">Carregando detalhes do servidor...</div>;
  if (!server || !analytics) return <div className="p-8 text-zinc-500">Servidor não encontrado.</div>;

  return (
    <div className="space-y-8 animate-fade-in pb-10">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <Link to="/admin/servers" className="text-zinc-500 hover:text-white text-sm font-bold uppercase flex items-center mb-2">
            <Icons.ArrowLeft className="w-4 h-4 mr-1" /> Voltar para Lista
          </Link>
          <h1 className="text-3xl font-black text-white uppercase italic tracking-tight">{server.name}</h1>
          <div className="flex items-center gap-3 mt-2 text-sm text-zinc-400 font-mono flex-wrap">
            <span className="bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">{server.ip}:{server.port}</span>
            <span>{server.mode}</span>
            <span className={`px-2 py-0.5 rounded border text-xs font-bold uppercase ${statusClass(displayStatus)}`}>
              {statusText(displayStatus)}
            </span>
            <span className={`px-2 py-0.5 rounded border text-xs font-bold uppercase ${liveStateSourceClass}`}>
              {liveStateSourceLabel}
            </span>
            {refreshing && <span className="text-zinc-500 text-xs">Atualizando...</span>}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Link
            to={`/admin/web-viewer?serverId=${encodeURIComponent(server.id)}`}
            className="px-3 py-2 rounded border border-cyan-800 bg-cyan-900/20 text-cyan-300 text-xs font-bold uppercase tracking-wider hover:bg-cyan-800/30 transition-colors flex items-center"
          >
            <Icons.Box className="w-4 h-4 mr-1" /> Web Viewer
          </Link>
          <div className="bg-zinc-900 p-1 rounded border border-zinc-800 flex">
          {(['24h', '7d', '30d'] as RangeKey[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-4 py-2 rounded text-xs font-bold uppercase tracking-wider transition-all ${
                range === r ? 'bg-zinc-100 text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-white hover:bg-zinc-800'
              }`}
            >
              {r === '24h' ? 'Últimas 24h' : r === '7d' ? '7 Dias' : '30 Dias'}
            </button>
          ))}
        </div>
      </div>
      </div>

      <div className="bg-zinc-900 rounded border border-zinc-800 p-4">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 text-sm">
          <div>
            <p className="text-zinc-500 uppercase text-xs font-bold">Mapa Atual</p>
            <p className="text-white font-semibold">{displayMap}</p>
          </div>
          <div>
            <p className="text-zinc-500 uppercase text-xs font-bold">Slots</p>
            <p className="text-white font-semibold">{displayPlayers}/{displayMaxPlayers}</p>
          </div>
          <div>
            <p className="text-zinc-500 uppercase text-xs font-bold">Sessões</p>
            <p className="text-white font-semibold">{analytics.totalSessions.toLocaleString('pt-BR')}</p>
          </div>
          <div>
            <p className="text-zinc-500 uppercase text-xs font-bold">Último Sinal</p>
            <p className="text-white font-semibold">
              {displayLastSignal ? new Date(displayLastSignal).toLocaleString('pt-BR') : 'Sem heartbeat'}
            </p>
          </div>
          <div>
            <p className="text-zinc-500 uppercase text-xs font-bold">Fonte de Presenca</p>
            <p className="text-white font-semibold">
              {hasFreshLiveState
                ? `WebSocket (${Math.max(0, Math.floor(liveStateAgeSeconds))}s)`
                : liveState?.available
                ? 'WebSocket stale, usando fallback'
                : 'Heartbeat/Pulse fallback'}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-zinc-900 rounded border border-zinc-800 overflow-hidden">
        <div className="p-4 border-b border-zinc-800 bg-zinc-950/30 flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-sm font-bold text-zinc-300 uppercase flex items-center">
            <Icons.Crosshair className="w-4 h-4 mr-2 text-zinc-500" /> WebViewer (Beta)
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-2 py-0.5 rounded border text-xs font-bold uppercase ${viewerStatusBadge.className}`}>
              {viewerStatusBadge.label}
            </span>
            <button
              onClick={() => setViewerReconnectNonce((prev) => prev + 1)}
              className="px-2.5 py-1.5 rounded border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-xs font-bold uppercase tracking-wider text-zinc-100"
            >
              Reconectar
            </button>
          </div>
        </div>
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
            <div className="bg-zinc-950/40 border border-zinc-800 rounded px-3 py-2">
              <p className="text-zinc-500 uppercase font-bold">Canal</p>
              <p className="text-zinc-200 mt-0.5">{viewerWsStatus.toUpperCase()}</p>
            </div>
            <div className="bg-zinc-950/40 border border-zinc-800 rounded px-3 py-2">
              <p className="text-zinc-500 uppercase font-bold">Players no frame</p>
              <p className="text-zinc-200 mt-0.5">
                {(viewerState?.playerCount ?? viewerPlayers.length).toLocaleString('pt-BR')}
              </p>
            </div>
            <div className="bg-zinc-950/40 border border-zinc-800 rounded px-3 py-2">
              <p className="text-zinc-500 uppercase font-bold">Frame recebido</p>
              <p className="text-zinc-200 mt-0.5">
                {viewerState?.receivedAt ? new Date(viewerState.receivedAt).toLocaleTimeString('pt-BR') : 'Sem frame'}
              </p>
            </div>
            <div className="bg-zinc-950/40 border border-zinc-800 rounded px-3 py-2">
              <p className="text-zinc-500 uppercase font-bold">Idade do frame</p>
              <p className="text-zinc-200 mt-0.5">
                {Number.isFinite(viewerSnapshotAgeSeconds) ? `${viewerSnapshotAgeSeconds}s` : 'N/A'}
              </p>
            </div>
          </div>

          {viewerWsError && (
            <div className="bg-red-900/10 border border-red-900/40 text-red-300 rounded px-3 py-2 text-xs">
              {viewerWsError}
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div className="xl:col-span-2 bg-zinc-950/40 border border-zinc-800 rounded p-3">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                <p className="text-xs text-zinc-400 uppercase font-bold">
                  Plano tatico 2D ({viewerState?.map || displayMap})
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${
                      hasViewerMapOverlay
                        ? 'border-emerald-700 bg-emerald-900/20 text-emerald-300'
                        : 'border-zinc-700 bg-zinc-800 text-zinc-400'
                    }`}
                  >
                    {hasViewerMapOverlay ? 'Overlay real' : 'Plano relativo'}
                  </span>
                  <label className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900/50 px-2 py-1 text-[10px] font-bold uppercase text-zinc-300">
                    <input
                      type="checkbox"
                      checked={viewerShowGrid}
                      onChange={(event) => setViewerShowGrid(event.target.checked)}
                    />
                    Grid
                  </label>
                  <label className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900/50 px-2 py-1 text-[10px] font-bold uppercase text-zinc-300">
                    <input
                      type="checkbox"
                      checked={viewerShowLabels}
                      onChange={(event) => setViewerShowLabels(event.target.checked)}
                    />
                    Labels
                  </label>
                  <label className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900/50 px-2 py-1 text-[10px] font-bold uppercase text-zinc-300">
                    <input
                      type="checkbox"
                      checked={viewerShowHeading}
                      onChange={(event) => setViewerShowHeading(event.target.checked)}
                    />
                    Direcao
                  </label>
                  <label className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900/50 px-2 py-1 text-[10px] font-bold uppercase text-zinc-300">
                    <input
                      type="checkbox"
                      checked={viewerShowDead}
                      onChange={(event) => setViewerShowDead(event.target.checked)}
                    />
                    Mortos
                  </label>
                  <label className="text-[10px] text-zinc-400 flex items-center gap-2 rounded border border-zinc-700 bg-zinc-900/50 px-2 py-1">
                    Marker
                    <input
                      type="range"
                      min={70}
                      max={180}
                      step={5}
                      value={viewerMarkerScalePct}
                      onChange={(event) => setViewerMarkerScalePct(Number(event.target.value))}
                    />
                    <span className="font-mono text-zinc-200">{viewerMarkerScalePct}%</span>
                  </label>
                  {!hasViewerMapOverlay && (
                    <label className="text-[10px] text-zinc-400 flex items-center gap-2 rounded border border-zinc-700 bg-zinc-900/50 px-2 py-1">
                      Zoom
                      <input
                        type="range"
                        min={50}
                        max={220}
                        step={5}
                        value={viewerZoomPct}
                        onChange={(event) => setViewerZoomPct(Number(event.target.value))}
                      />
                      <span className="font-mono text-zinc-200">{viewerZoomPct}%</span>
                    </label>
                  )}
                </div>
              </div>
              <div
                className="relative h-72 rounded border border-zinc-800 overflow-hidden bg-zinc-950"
                onMouseMove={handleViewerMapMouseMove}
                onMouseLeave={handleViewerMapMouseLeave}
              >
                {hasViewerMapOverlay && viewerMapOverlay ? (
                  <img
                    src={viewerMapOverlay.imageUrl}
                    alt={`Overlay ${viewerMapOverlay.map}`}
                    className="pointer-events-none absolute inset-0 h-full w-full select-none object-fill"
                    loading="lazy"
                    decoding="async"
                  />
                ) : null}
                <div
                  className="pointer-events-none absolute inset-0"
                  style={{
                    backgroundImage:
                      'linear-gradient(rgba(63,63,70,0.25) 1px, transparent 1px), linear-gradient(90deg, rgba(63,63,70,0.25) 1px, transparent 1px)',
                    backgroundSize: '32px 32px',
                    opacity: viewerShowGrid ? (hasViewerMapOverlay ? 0.2 : 1) : 0,
                  }}
                />
                {!viewerMapPoints.length && (
                  <div className="absolute inset-0 flex items-center justify-center text-zinc-500 text-sm">
                    Sem dados de viewer_state para renderizar.
                  </div>
                )}
                {viewerMapPoints.map((point) => (
                  <React.Fragment key={point.player.steamId}>
                    {viewerShowHeading && point.player.alive !== false && (
                      <span
                        className="pointer-events-none absolute"
                        style={{
                          left: `${point.leftPct}%`,
                          top: `${point.topPct}%`,
                          width: `${Math.max(10, Math.round(point.sizePx * 2))}px`,
                          transform: `translate(-50%, -50%) rotate(${point.yawDeg}deg)`,
                          transformOrigin: '50% 50%',
                        }}
                      >
                        <span
                          className="absolute left-0 top-1/2 h-[2px] w-full -translate-y-1/2 bg-zinc-50/80"
                          style={{ boxShadow: '0 0 6px rgba(255,255,255,0.35)' }}
                        />
                        <span
                          className="absolute right-[-1px] top-1/2 -translate-y-1/2 border-y-[4px] border-l-[7px] border-y-transparent border-l-zinc-50/90"
                        />
                      </span>
                    )}
                    <button
                      onClick={() => setViewerSelectedSteamId(point.player.steamId)}
                      className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition-all"
                      style={{
                        left: `${point.leftPct}%`,
                        top: `${point.topPct}%`,
                        width: `${point.sizePx}px`,
                        height: `${point.sizePx}px`,
                        backgroundColor:
                          point.player.alive === false ? 'rgba(239,68,68,0.85)' : point.markerColor,
                        borderColor: point.isSelected ? 'rgba(34,211,238,0.95)' : 'rgba(255,255,255,0.85)',
                        boxShadow: point.isSelected
                          ? '0 0 0 4px rgba(34,211,238,0.2), 0 0 10px rgba(34,211,238,0.35)'
                          : '0 0 8px rgba(0,0,0,0.35)',
                      }}
                      title={`${point.player.name || point.player.steamId} (${formatCoord(point.player.pos.x)}, ${formatCoord(point.player.pos.y)})`}
                    />
                    {viewerShowLabels && (
                      <span
                        className="pointer-events-none absolute max-w-[160px] -translate-x-1/2 rounded border border-zinc-700 bg-zinc-950/90 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-100 truncate"
                        style={{
                          left: `${point.leftPct}%`,
                          top: `${Math.max(2, point.topPct - 5)}%`,
                        }}
                      >
                        {point.player.name || point.player.steamId}
                      </span>
                    )}
                  </React.Fragment>
                ))}
              </div>
              {hasViewerMapOverlay && viewerMapOverlay ? (
                <p className="mt-2 text-[11px] text-zinc-500">
                  Overlay ativo para <span className="font-mono">{viewerMapOverlay.map}</span> (
                  {viewerMapOverlay.flipX ? 'flipX on' : 'flipX off'} /{' '}
                  {viewerMapOverlay.flipY ? 'flipY on' : 'flipY off'}).
                </p>
              ) : (
                <p className="mt-2 text-[11px] text-zinc-500">
                  Referencia relativa ao frame atual. Sem geometria real do mapa nesta fase.
                  {viewerMapOverlayReason ? ` (${viewerMapOverlayReason})` : ''}
                </p>
              )}
              {hasViewerMapOverlay && viewerWorldCursor && (
                <p className="mt-1 text-[11px] text-zinc-500">
                  Cursor world XY: <span className="font-mono">{formatCoord(viewerWorldCursor.x)}</span> /{' '}
                  <span className="font-mono">{formatCoord(viewerWorldCursor.y)}</span>
                </p>
              )}
            </div>

            <div className="bg-zinc-950/40 border border-zinc-800 rounded p-3">
              <p className="text-xs text-zinc-400 uppercase font-bold mb-2">Players do frame</p>
              <div className="mb-3 space-y-2">
                <input
                  type="text"
                  value={viewerSearch}
                  onChange={(event) => setViewerSearch(event.target.value)}
                  placeholder="Buscar por nome ou steamId"
                  className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-cyan-700"
                />
                <p className="text-[11px] text-zinc-500">
                  Exibindo {viewerPlayers.length.toLocaleString('pt-BR')} de{' '}
                  {Number(viewerState?.playerCount || viewerPlayers.length).toLocaleString('pt-BR')} players no frame.
                </p>
              </div>
              <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                {!viewerPlayers.length && (
                  <p className="text-zinc-500 text-sm">Nenhum player no snapshot do viewer.</p>
                )}
                {viewerPlayers.map((entry) => (
                  <button
                    key={entry.steamId}
                    onClick={() => setViewerSelectedSteamId(entry.steamId)}
                    className={`w-full text-left rounded border px-3 py-2 transition-colors ${
                      viewerSelectedSteamId === entry.steamId
                        ? 'border-cyan-700 bg-cyan-900/20'
                        : 'border-zinc-800 bg-zinc-900/40 hover:bg-zinc-800/60'
                    }`}
                  >
                    <p className="text-sm text-white font-semibold truncate">{entry.name || 'Sem nome'}</p>
                    <p className="text-[11px] text-zinc-500 font-mono truncate">{entry.steamId}</p>
                    <p className="text-[11px] text-zinc-400 mt-1">
                      x:{formatCoord(entry.pos.x)} y:{formatCoord(entry.pos.y)} z:{formatCoord(entry.pos.z)}
                    </p>
                    <p className="text-[11px] text-zinc-500 mt-0.5">
                      HP {Math.floor(Number(entry.health || 0))} | ARM {Math.floor(Number(entry.armor || 0))} |{' '}
                      {entry.alive === false ? 'Morto' : 'Vivo'}
                      {entry.teamName ? ` | ${entry.teamName}` : ''}
                    </p>
                  </button>
                ))}
              </div>
              {selectedViewerPlayer && (
                <div className="mt-3 border-t border-zinc-800 pt-3 space-y-3">
                  <div className="text-[11px] text-zinc-500">
                    Foco: {selectedViewerPlayer.name || selectedViewerPlayer.steamId}
                  </div>

                  <div>
                    <label className="text-[11px] text-zinc-500 uppercase font-bold">
                      Motivo da acao
                    </label>
                    <input
                      type="text"
                      value={viewerActionReason}
                      maxLength={VIEWER_ACTION_REASON_MAX_LENGTH}
                      onChange={(event) => setViewerActionReason(event.target.value)}
                      placeholder="Acao via painel WebViewer"
                      className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 focus:outline-none focus:ring-2 focus:ring-cyan-700"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => dispatchViewerAction('KICK')}
                      disabled={viewerActionsDisabled}
                      className="px-2 py-1.5 rounded border border-red-800 bg-red-900/20 text-red-300 text-xs font-bold uppercase disabled:opacity-50"
                    >
                      Kick
                    </button>
                    <button
                      onClick={() => dispatchViewerAction('MUTE_10M')}
                      disabled={viewerActionsDisabled}
                      className="px-2 py-1.5 rounded border border-yellow-800 bg-yellow-900/20 text-yellow-300 text-xs font-bold uppercase disabled:opacity-50"
                    >
                      Mute 10m
                    </button>
                    <button
                      onClick={() => dispatchViewerAction('GAG_10M')}
                      disabled={viewerActionsDisabled}
                      className="px-2 py-1.5 rounded border border-orange-800 bg-orange-900/20 text-orange-300 text-xs font-bold uppercase disabled:opacity-50"
                    >
                      Gag 10m
                    </button>
                    <button
                      onClick={() => dispatchViewerAction('UNMUTE')}
                      disabled={viewerActionsDisabled}
                      className="px-2 py-1.5 rounded border border-emerald-800 bg-emerald-900/20 text-emerald-300 text-xs font-bold uppercase disabled:opacity-50"
                    >
                      Unmute
                    </button>
                    <button
                      onClick={() => dispatchViewerAction('UNGAG')}
                      disabled={viewerActionsDisabled}
                      className="col-span-2 px-2 py-1.5 rounded border border-emerald-800 bg-emerald-900/20 text-emerald-300 text-xs font-bold uppercase disabled:opacity-50"
                    >
                      Ungag
                    </button>
                  </div>

                  {!hasFreshViewerSnapshot && (
                    <div className="rounded border border-yellow-900/50 bg-yellow-900/10 px-2 py-1.5 text-[11px] text-yellow-300">
                      Acoes bloqueadas: snapshot do viewer stale/desconectado.
                    </div>
                  )}

                  {viewerActionError && (
                    <div className="rounded border border-red-900/50 bg-red-900/10 px-2 py-1.5 text-[11px] text-red-300">
                      {viewerActionError}
                    </div>
                  )}

                  {viewerActionForSelected && (
                    <div className="rounded border border-zinc-700 bg-zinc-900/60 px-2 py-2 text-[11px] space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-zinc-400 uppercase font-bold">Status da acao</span>
                        <span
                          className={`px-1.5 py-0.5 rounded border uppercase font-bold ${viewerActionStatusClass(
                            viewerActionForSelected.status,
                          )}`}
                        >
                          {viewerActionStatusLabel(viewerActionForSelected.status)}
                        </span>
                      </div>
                      <div className="text-zinc-500 font-mono truncate">
                        actionId: {viewerActionForSelected.actionId}
                      </div>
                      <div className="text-zinc-500">
                        Tentativas WS: {viewerActionForSelected.wsAttemptCount}
                        {viewerActionForSelected.wsLastAckAt
                          ? ` | ack ${new Date(viewerActionForSelected.wsLastAckAt).toLocaleTimeString('pt-BR')}`
                          : ''}
                      </div>
                      {viewerActionForSelected.error && (
                        <div className="text-red-300">{viewerActionForSelected.error}</div>
                      )}
                    </div>
                  )}
                </div>
              )}
              <div className="mt-2 text-[11px] text-zinc-600">
                Ultima msg WS: {viewerLastMessageAt ? new Date(viewerLastMessageAt).toLocaleTimeString('pt-BR') : 'N/A'}
              </div>
              <div className="text-[11px] text-zinc-600">
                Conectado em: {viewerConnectedAt ? new Date(viewerConnectedAt).toLocaleTimeString('pt-BR') : 'N/A'}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-zinc-900 rounded border border-zinc-800">
        <div className="p-4 border-b border-zinc-800 bg-zinc-950/30 flex items-center justify-between">
          <h3 className="text-sm font-bold text-zinc-300 uppercase flex items-center">
            <Icons.Users className="w-4 h-4 mr-2 text-zinc-500" /> Players Ao Vivo
          </h3>
          <span className={`px-2 py-0.5 rounded border text-xs font-bold uppercase ${liveStateSourceClass}`}>
            {liveStateSourceLabel}
          </span>
        </div>
        <div className="p-3 space-y-2">
          {hasFreshLiveState && liveStatePlayers.length === 0 && (
            <p className="text-zinc-500 text-sm">Snapshot WS ativo, sem players no momento.</p>
          )}

          {hasFreshLiveState && liveStatePlayers.length > 0 && (
            <>
              <p className="text-zinc-400 text-xs uppercase font-bold px-1">
                {displayPlayers.toLocaleString('pt-BR')} online
              </p>
              {liveStatePlayers.map((entry) => (
                <div
                  key={entry.steamId}
                  className="flex items-center justify-between bg-zinc-950/40 border border-zinc-800 rounded px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-white text-sm font-semibold truncate">{entry.name || 'Sem nome'}</p>
                    <p className="text-zinc-500 text-xs font-mono truncate">{entry.steamId}</p>
                  </div>
                  <Link
                    to={`/admin/players/${entry.steamId}`}
                    className="text-xs text-cyan-300 hover:text-cyan-200 font-bold uppercase"
                  >
                    Perfil
                  </Link>
                </div>
              ))}
            </>
          )}

          {!hasFreshLiveState && (
            <p className="text-zinc-500 text-sm">
              {liveState?.available
                ? `WS conectado, mas snapshot antigo (${Math.max(0, Math.floor(liveStateAgeSeconds))}s). Exibindo fallback.`
                : 'Live-state WS indisponivel. Exibindo fallback por heartbeat/pulse.'}
            </p>
          )}
        </div>
      </div>

      <div className="bg-zinc-900 rounded border border-zinc-800 p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-zinc-500 uppercase text-xs font-bold">Fonte do Playtime</p>
            <p className="text-white font-semibold">{playtimeSource}</p>
          </div>
          <div>
            <p className="text-zinc-500 uppercase text-xs font-bold">Cobertura Pulse</p>
            <p className="text-white font-semibold">{pulseCoveragePct.toLocaleString('pt-BR')}%</p>
          </div>
          <div>
            <p className="text-zinc-500 uppercase text-xs font-bold">Comparativo Pulse x Legado</p>
            <p className="text-white font-semibold">
              {playtimeDiagnostics?.pulseHours === undefined
                ? 'Sem dados de pulse'
                : `${pulseVsLegacyHours.toLocaleString('pt-BR')}h (${pulseVsLegacyPct.toLocaleString('pt-BR')}%)`}
            </p>
          </div>
          <div>
            <p className="text-zinc-500 uppercase text-xs font-bold">Decisao da Fonte</p>
            <p className="text-white font-semibold">{playtimeDecision}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <KPICard
          title="Tempo Total Jogado"
          value={`${analytics.totalPlayTimeHours.toLocaleString('pt-BR')}h`}
          subText="Soma de horas jogadas por todos os players"
          icon={Icons.Clock}
          colorClass="text-white"
        />
        <KPICard
          title="Jogadores Únicos"
          value={(analytics.uniquePlayers ?? 0).toLocaleString('pt-BR')}
          subText="Contas únicas com atividade no período"
          icon={Icons.UserGroup}
          colorClass="text-cyan-400"
        />
        <KPICard
          title="Novos Jogadores"
          value={`+${analytics.newPlayers.toLocaleString('pt-BR')}`}
          subText="Primeiro CONNECT neste servidor durante o período"
          icon={Icons.Users}
          colorClass="text-green-500"
        />
        <KPICard
          title="Pico de Jogadores"
          value={`${analytics.peakPlayers.toLocaleString('pt-BR')} / ${displayMaxPlayers.toLocaleString('pt-BR')}`}
          subText="Maior simultâneo observado no período"
          icon={Icons.Activity}
          colorClass="text-yellow-500"
        />
        <KPICard
          title="Sessão Média"
          value={`${(analytics.avgSessionMinutes ?? 0).toLocaleString('pt-BR')} min`}
          subText="Média de duração das sessões fechadas/ativas"
          icon={Icons.Calendar}
          colorClass="text-purple-400"
        />
        <KPICard
          title="Sessão Mediana"
          value={`${(analytics.medianSessionMinutes ?? 0).toLocaleString('pt-BR')} min`}
          subText="Valor central para reduzir impacto de extremos"
          icon={Icons.BarChart}
          colorClass="text-red-400"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <PlaytimeChart data={analytics.playTimeTrend} />
          <PlayerCountChart data={analytics.playerCountTrend} />
        </div>
        <TopPlayersList players={analytics.topPlayers} range={range} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-zinc-900 rounded border border-zinc-800">
          <div className="p-4 border-b border-zinc-800 bg-zinc-950/30">
            <h3 className="text-sm font-bold text-zinc-300 uppercase flex items-center">
              <Icons.Map className="w-4 h-4 mr-2 text-zinc-500" /> Mapas Mais Jogados
            </h3>
          </div>
          <div className="p-3 space-y-2">
            {!analytics.topMaps?.length && <p className="text-zinc-500 text-sm">Sem dados de mapa no período.</p>}
            {analytics.topMaps?.map((item) => (
              <div key={item.name} className="flex items-center justify-between bg-zinc-950/40 border border-zinc-800 rounded px-3 py-2">
                <div>
                  <p className="text-white text-sm font-semibold">{item.name}</p>
                  <p className="text-zinc-500 text-xs">{item.count} ciclos detectados</p>
                </div>
                <span className="text-cyan-300 text-sm font-bold">{item.percentage.toLocaleString('pt-BR')}%</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-zinc-900 rounded border border-zinc-800">
          <div className="p-4 border-b border-zinc-800 bg-zinc-950/30">
            <h3 className="text-sm font-bold text-zinc-300 uppercase flex items-center">
              <Icons.List className="w-4 h-4 mr-2 text-zinc-500" /> Distribuição de Eventos
            </h3>
          </div>
          <div className="p-3 space-y-2">
            {!analytics.eventBreakdown?.length && <p className="text-zinc-500 text-sm">Sem eventos no período.</p>}
            {analytics.eventBreakdown?.slice(0, 8).map((item) => (
              <div key={item.type} className="flex items-center justify-between bg-zinc-950/40 border border-zinc-800 rounded px-3 py-2">
                <span className="text-zinc-200 text-sm font-mono">{item.type}</span>
                <span className="text-zinc-100 text-sm font-bold">{item.count.toLocaleString('pt-BR')}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ServerDetails;

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { Icons } from '../../components/Icon';
import { ApiService } from '../../services/api';
import {
  ServerViewerActionStatusResponse,
  ServerViewerActionType,
  ServerViewerStatePlayer,
  ServerViewerStateSnapshot,
} from '../../types';

type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type ChunkEntry = {
  id: string;
  url: string;
  lodUrls?: {
    lod0?: string;
    lod1?: string;
    lod2?: string;
  };
  lodStats?: {
    lod0?: {
      totalTris?: number;
      totalBytes?: number;
      drawCallsAfterInstancing?: number;
    };
    lod1?: {
      totalTris?: number;
      totalBytes?: number;
      drawCallsAfterInstancing?: number;
    };
    lod2?: {
      totalTris?: number;
      totalBytes?: number;
      drawCallsAfterInstancing?: number;
    };
  };
  bounds: Bounds;
  size: number;
  baseCell?: { x: number; y: number };
  stats?: {
    totalTris?: number;
    totalBytes?: number;
    drawCallsAfterInstancing?: number;
  };
};

type ChunkIndex = {
  generatedAt: string;
  lod: number;
  chunks: ChunkEntry[];
};

type Manifest = {
  version: number;
  generatedAt: string;
  map: {
    name: string;
    worldBounds: { min: [number, number, number]; max: [number, number, number] };
    chunkSize: number;
  };
  streaming?: {
    activeRadiusChunks?: number;
    renderRadiusChunks?: number;
    prefetchRadiusChunks?: number;
    discardRadiusChunks?: number;
    gracePeriodMs?: number;
  };
  assets: {
    base?: Array<{ id: string; url: string; format: string }>;
    materials?: {
      indexUrl: string;
      ktx2TranscoderPath?: string;
      primaryFormat?: string;
      fallbackFormat?: string;
    };
    models?: {
      indexUrl: string;
      format?: string;
    };
    chunks: {
      lod0IndexUrl: string;
      lod1IndexUrl?: string;
      lod2IndexUrl?: string;
      format: string;
    };
  };
  textures?: {
    primary?: string;
    fallback?: string;
    vramBudgetBytes?: number;
  };
};

type MaterialIndex = {
  generatedAt: string;
  total: number;
  primaryFormat?: string;
  fallbackFormat?: string;
  ktx2Enabled?: boolean;
  ktx2Mode?: string;
  textureVramBudgetBytes?: number;
  textureVramEstimateTotal?: number;
  textureVramBudgetPass?: boolean;
  rootsScanned?: string[];
  materials: Array<{
    id: string;
    material: string;
    placeholder: boolean;
    status: string;
    textureUrl?: string;
    fallbackTextureUrl?: string;
    ktx2Url?: string;
    textureClass?: string;
    textureProfile?: {
      maxSize?: number;
      compression?: string;
      srgb?: boolean;
    };
    vramEstimateBytes?: number;
    usage?: string[];
    sourcePath?: string;
    resolvedBaseTexture?: string;
    searchedVmt?: string;
    searchedVtf?: string;
    error?: string;
  }>;
};

type ModelIndex = {
  generatedAt: string;
  total: number;
  rootsScanned?: string[];
  models: Array<{
    id: string;
    model: string;
    placeholder: boolean;
    status: string;
    meshUrl?: string;
    sourcePath?: string;
    searchedMdl?: string;
    searchedVtx?: string;
    searchedVvd?: string;
    triCount?: number;
    vertexCount?: number;
    subMeshCount?: number;
    byteEstimate?: number;
    materials?: string[];
    error?: string;
  }>;
};

type ModelMeshPayload = {
  id: string;
  sourceModel: string;
  lod: number;
  stats?: {
    triCount?: number;
    vertexCount?: number;
    subMeshCount?: number;
    byteEstimate?: number;
  };
  subMeshes?: Array<{
    material?: string;
    materialId?: string;
    placeholderMaterial?: boolean;
    triCount?: number;
    vertexCount?: number;
    positions: number[];
    uvs?: number[];
    indices?: number[];
  }>;
};

type ModelCacheEntry = {
  id: string;
  triCount: number;
  vertexCount: number;
  byteEstimate: number;
  lastUsedAtMs: number;
  subMeshes: Array<{
    material: string;
    materialId: string;
    placeholderMaterial: boolean;
    geometry: THREE.BufferGeometry;
  }>;
};

type ChunkPayload = {
  id: string;
  bounds: Bounds;
  counts?: {
    worldFaces?: number;
    staticProps?: number;
    placeholderWorldFaces?: number;
    placeholderStaticProps?: number;
  };
  stats?: {
    totalTris?: number;
    totalBytes?: number;
    drawCallsAfterInstancing?: number;
  };
  world?: {
    meshes?: Array<{
      materialId?: string;
      material: string;
      placeholderMaterial: boolean;
      faceCount?: number;
      triCount?: number;
      vertexCount?: number;
      positions: number[];
      uvs?: number[];
    }>;
    faces?: Array<{
      position: [number, number, number];
      material: string;
      placeholderMaterial: boolean;
      triCount?: number;
    }>;
  };
  props?: {
    instances?: Array<{
      model: string;
      sourceModel?: string;
      placeholderModel: boolean;
      placeholderReason?: string;
      origin: [number, number, number];
      angles: [number, number, number];
      scale: [number, number, number];
    }>;
  };
};

type RuntimeStats = {
  loadedChunks: number;
  visibleChunks: number;
  loadedTrisEstimate: number;
  loadedBytesEstimate: number;
  textureCacheCount: number;
  textureCacheBytesEstimate: number;
  modelCacheCount: number;
  modelCacheBytesEstimate: number;
  cameraCell: { x: number; y: number };
  firstActiveLoadMs: number | null;
};

type ViewerDiagnostic = {
  id: string;
  level: 'warn' | 'error';
  code: string;
  assetType: 'material' | 'texture' | 'model' | 'chunk' | 'runtime';
  assetId: string;
  message: string;
  searchedIn: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  count: number;
};

type ViewerWsStatus = 'idle' | 'connecting' | 'connected' | 'subscribed' | 'error';

const VIEWER_STATE_STALE_SECONDS = 8;
const VIEWER_RECONNECT_BASE_MS = 1000;
const VIEWER_RECONNECT_MAX_MS = 15000;
const VIEWER_ACTION_STATUS_POLL_INTERVAL_MS = 1200;
const VIEWER_ACTION_STATUS_MAX_POLLS = 18;
const VIEWER_ACTION_REASON_MAX_LENGTH = 160;
const PLAYER_MARKER_HEIGHT = 30;
const PLAYER_MARKER_SMOOTH_RATE = 10;
const PLAYER_MARKER_SELECTED_SCALE = 1.45;
const FOLLOW_CAMERA_DISTANCE = 520;
const FOLLOW_CAMERA_HEIGHT = 220;
const FOLLOW_CAMERA_SMOOTH_RATE = 6;
const CAMERA_MOVE_SPEED = 1800;
const CAMERA_MOVE_FAST_MULTIPLIER = 2.25;
const CAMERA_MOVE_SLOW_MULTIPLIER = 0.5;
const MODEL_CACHE_MAX_BYTES = 220 * 1024 * 1024;
const MODEL_CACHE_EVICT_GRACE_MS = 18000;
const MODEL_CACHE_SWEEP_INTERVAL_MS = 1800;
const PLAYER_MARKER_COLORS = [
  0x22c55e,
  0x38bdf8,
  0xf59e0b,
  0xef4444,
  0xa78bfa,
  0x14b8a6,
  0xf472b6,
  0x84cc16,
];

const toAssetUrl = (manifestUrl: string, relativeOrAbsoluteUrl: string): string => {
  const resolved = new URL(relativeOrAbsoluteUrl, new URL(manifestUrl, window.location.origin));
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
};

const readJson = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`http_${response.status}: ${url}`);
  }
  return (await response.json()) as T;
};

const hashColor = (input: string, alpha = 1): THREE.Color => {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hue = Math.abs(hash % 360);
  const color = new THREE.Color(`hsl(${hue}, 62%, 55%)`);
  color.multiplyScalar(alpha);
  return color;
};

const sourceToThree = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, z, y);

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

const hashSteamId = (steamId: string): number => {
  let hash = 0;
  for (let index = 0; index < steamId.length; index += 1) {
    hash = (hash * 31 + steamId.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const getViewerMarkerColorHex = (entry: ServerViewerStatePlayer): number => {
  const teamId = Number(entry.teamId);
  if (Number.isFinite(teamId)) {
    return PLAYER_MARKER_COLORS[Math.abs(Math.floor(teamId)) % PLAYER_MARKER_COLORS.length];
  }
  return PLAYER_MARKER_COLORS[hashSteamId(entry.steamId) % PLAYER_MARKER_COLORS.length];
};

const formatCoord = (value: number | undefined): string => {
  if (!Number.isFinite(Number(value))) return '0.0';
  return Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
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

const disposeObject3D = (root: THREE.Object3D) => {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    const points = obj as THREE.Points;

    if (mesh.geometry && !(mesh.geometry as any)?.userData?.sharedFromCache) {
      mesh.geometry.dispose();
    }
    if (points.geometry && !(points.geometry as any)?.userData?.sharedFromCache) {
      points.geometry.dispose();
    }

    const materialCandidate = (mesh.material || (points as any).material) as THREE.Material | THREE.Material[] | undefined;
    if (!materialCandidate) return;
    if (Array.isArray(materialCandidate)) {
      materialCandidate.forEach((material) => material.dispose());
    } else {
      materialCandidate.dispose();
    }
  });
};

const normalizeMapName = (raw: string | null): string => {
  const value = String(raw || '').trim();
  if (!value) return 'rp_evocity_v33x';
  return value.replace(/\.bsp$/i, '');
};

const ServerView3D: React.FC = () => {
  const { serverId } = useParams<{ serverId: string }>();
  const [searchParams] = useSearchParams();
  const mapName = useMemo(() => normalizeMapName(searchParams.get('map')), [searchParams]);
  const manifestUrl = useMemo(() => `/maps/${mapName}/manifest.json`, [mapName]);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const viewerSocketRef = useRef<WebSocket | null>(null);
  const viewerPingTimerRef = useRef<number | null>(null);
  const viewerReconnectTimerRef = useRef<number | null>(null);
  const [status, setStatus] = useState<string>('Aguardando inicializacao...');
  const [error, setError] = useState<string | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [viewerWsStatus, setViewerWsStatus] = useState<ViewerWsStatus>('idle');
  const [viewerWsError, setViewerWsError] = useState<string | null>(null);
  const [viewerLastMessageAt, setViewerLastMessageAt] = useState<string | null>(null);
  const [viewerState, setViewerState] = useState<ServerViewerStateSnapshot | null>(null);
  const [viewerSelectedSteamId, setViewerSelectedSteamId] = useState<string | null>(null);
  const [viewerFollowSelected, setViewerFollowSelected] = useState<boolean>(false);
  const [viewerActionReason, setViewerActionReason] = useState<string>('Acao via painel WebViewer 3D');
  const [viewerActionBusy, setViewerActionBusy] = useState<boolean>(false);
  const [viewerActionError, setViewerActionError] = useState<string | null>(null);
  const [viewerActionStatus, setViewerActionStatus] = useState<ServerViewerActionStatusResponse | null>(null);
  const [runtimeStats, setRuntimeStats] = useState<RuntimeStats>({
    loadedChunks: 0,
    visibleChunks: 0,
    loadedTrisEstimate: 0,
    loadedBytesEstimate: 0,
    textureCacheCount: 0,
    textureCacheBytesEstimate: 0,
    modelCacheCount: 0,
    modelCacheBytesEstimate: 0,
    cameraCell: { x: 0, y: 0 },
    firstActiveLoadMs: null,
  });
  const [streamingLogs, setStreamingLogs] = useState<string[]>([]);
  const [diagnostics, setDiagnostics] = useState<ViewerDiagnostic[]>([]);
  const viewerStateRef = useRef<ServerViewerStateSnapshot | null>(null);
  const viewerSelectedSteamIdRef = useRef<string | null>(null);
  const viewerFollowSelectedRef = useRef<boolean>(false);
  const viewerActionPollTokenRef = useRef<number>(0);

  const viewerPlayers = useMemo(
    () =>
      [...(viewerState?.players || [])].sort((left, right) =>
        String(left.name || left.steamId || '')
          .toLowerCase()
          .localeCompare(String(right.name || right.steamId || '').toLowerCase()),
      ),
    [viewerState],
  );

  const selectedViewerPlayer = useMemo(
    () => viewerPlayers.find((entry) => entry.steamId === viewerSelectedSteamId) || null,
    [viewerPlayers, viewerSelectedSteamId],
  );

  const viewerSnapshotAgeSeconds = useMemo(() => {
    if (!viewerState?.receivedAt) return Number.POSITIVE_INFINITY;
    const parsed = new Date(viewerState.receivedAt).getTime();
    if (!Number.isFinite(parsed)) return Number.POSITIVE_INFINITY;
    return Math.max(0, Math.floor((Date.now() - parsed) / 1000));
  }, [viewerState]);

  const hasFreshViewerSnapshot =
    Number.isFinite(viewerSnapshotAgeSeconds) && viewerSnapshotAgeSeconds <= VIEWER_STATE_STALE_SECONDS;

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
      if (!hasFreshViewerSnapshot || viewerWsStatus === 'connecting' || viewerWsStatus === 'error') {
        setViewerActionError('Acoes bloqueadas: snapshot stale/desconectado.');
        return;
      }
      if (!selectedViewerPlayer) {
        setViewerActionError('Selecione um player no viewer 3D.');
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
      viewerWsStatus,
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
    viewerWsStatus === 'error' ||
    viewerWsStatus === 'idle';

  useEffect(() => {
    viewerStateRef.current = viewerState;
  }, [viewerState]);

  useEffect(() => {
    viewerSelectedSteamIdRef.current = viewerSelectedSteamId;
  }, [viewerSelectedSteamId]);

  useEffect(() => {
    viewerFollowSelectedRef.current = viewerFollowSelected;
  }, [viewerFollowSelected]);

  useEffect(() => {
    if (!viewerPlayers.length) {
      setViewerSelectedSteamId(null);
      setViewerFollowSelected(false);
      return;
    }
    if (viewerSelectedSteamId && !viewerPlayers.some((entry) => entry.steamId === viewerSelectedSteamId)) {
      setViewerSelectedSteamId(viewerPlayers[0].steamId);
      setViewerFollowSelected(false);
    }
  }, [viewerPlayers, viewerSelectedSteamId]);

  useEffect(() => {
    setViewerActionError(null);
  }, [viewerSelectedSteamId]);

  useEffect(() => {
    if (!viewerSelectedSteamId && viewerFollowSelected) {
      setViewerFollowSelected(false);
    }
  }, [viewerFollowSelected, viewerSelectedSteamId]);

  useEffect(() => {
    return () => {
      viewerActionPollTokenRef.current += 1;
    };
  }, []);

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
        setViewerWsError('Token de admin ausente para conectar no canal viewer_state.');
        return;
      }

      setViewerWsStatus('connecting');
      setViewerWsError(null);

      let socket: WebSocket;
      try {
        socket = new WebSocket(wsUrl);
      } catch (err: any) {
        setViewerWsStatus('error');
        setViewerWsError(String(err?.message || 'Falha ao abrir WebSocket viewer_state.'));
        scheduleReconnect();
        return;
      }

      viewerSocketRef.current = socket;

      socket.onopen = () => {
        reconnectAttempts = 0;
        setViewerWsStatus('connected');
        setViewerWsError(null);

        try {
          socket.send(JSON.stringify({ type: 'subscribe', payload: { serverId } }));
        } catch {
          // onclose/onerror handles retries
        }

        viewerPingTimerRef.current = window.setInterval(() => {
          const active = viewerSocketRef.current;
          if (!active || active.readyState !== WebSocket.OPEN) return;
          try {
            active.send(JSON.stringify({ type: 'ping' }));
          } catch {
            // ignore
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
        setViewerWsError('Erro de conexao no canal viewer_state.');
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
  }, [serverId]);

  useEffect(() => {
    const host = mountRef.current;
    if (!host) return undefined;
    setDiagnostics([]);

    let cancelled = false;
    let animationFrameId = 0;
    let streamIntervalMs = 0;
    let playerSyncIntervalMs = 0;
    let lastFrameAtMs = performance.now();
    let hostResizeObserver: ResizeObserver | null = null;
    let warmupResizeTimer: number | null = null;
    let startedAt = performance.now();
    let firstActiveLoadMs: number | null = null;
    let lastTextureBudgetWarnAt = 0;

    const appendLog = (line: string) => {
      const msg = `[${new Date().toLocaleTimeString('pt-BR')}] ${line}`;
      setStreamingLogs((current) => [msg, ...current].slice(0, 24));
      console.log(`[viewer3d] ${line}`);
    };

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x09090b, 1);
    host.innerHTML = '';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(65, host.clientWidth / Math.max(1, host.clientHeight), 1, 250000);

    const ambient = new THREE.HemisphereLight(0x8aa2ff, 0x101010, 0.95);
    const dir = new THREE.DirectionalLight(0xffffff, 0.65);
    dir.position.set(0.5, 1.2, 0.3).multiplyScalar(5000);
    scene.add(ambient, dir);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.rotateSpeed = 0.65;
    controls.zoomSpeed = 1;
    controls.panSpeed = 0.55;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.PAN,
    };

    const chunkRoot = new THREE.Group();
    chunkRoot.name = 'chunk-root';
    scene.add(chunkRoot);

    const playersRoot = new THREE.Group();
    playersRoot.name = 'players-root';
    scene.add(playersRoot);

    const grid = new THREE.GridHelper(36000, 120, 0x1f2937, 0x111827);
    grid.position.y = 0;
    scene.add(grid);

    const chunkRecords = new Map<string, {
      entry: ChunkEntry;
      lod: 0 | 1 | 2;
      group: THREE.Group;
      touchedAtMs: number;
      tris: number;
      bytes: number;
      drawCalls: number;
      usedModels: string[];
    }>();
    const loadingChunkIds = new Set<string>();
    const textureLoader = new THREE.TextureLoader();
    const ktx2Loader = new KTX2Loader();
    const textureCache = new Map<string, THREE.Texture | null>();
    const textureLoading = new Set<string>(); // chain keys
    const pendingMaterialBindings = new Map<string, Set<THREE.MeshStandardMaterial>>(); // chain keys
    const textureCacheBytesByUrl = new Map<string, number>();
    let textureCacheBytesEstimate = 0;
    let textureVramBudgetBytes = Math.max(256, 1536) * 1024 * 1024;
    let ktx2RuntimeEnabled = false;
    let ktx2TranscoderPath = '/vendor/basis/';
    const materialDefs = new Map<string, {
      placeholder: boolean;
      textureUrl?: string;
      fallbackTextureUrl?: string;
      ktx2Url?: string;
      textureClass?: string;
      textureProfile?: {
        maxSize?: number;
        compression?: string;
        srgb?: boolean;
      };
      vramEstimateBytes?: number;
      status?: string;
      sourcePath?: string;
      resolvedBaseTexture?: string;
      searchedVmt?: string;
      searchedVtf?: string;
      usage?: string[];
      error?: string;
    }>();
    let materialRootsScanned: string[] = [];
    const modelDefs = new Map<string, {
      id: string;
      placeholder: boolean;
      meshUrl?: string;
      status?: string;
      sourcePath?: string;
      searchedMdl?: string;
      searchedVtx?: string;
      searchedVvd?: string;
      materials?: string[];
      error?: string;
    }>();
    let modelRootsScanned: string[] = [];
    const modelCache = new Map<string, ModelCacheEntry | null>();
    const modelLoading = new Map<string, Promise<ModelCacheEntry | null>>();
    const modelUsageCount = new Map<string, number>();
    let modelCacheBytesEstimate = 0;
    let lastModelCacheSweepAtMs = 0;
    const movementKeys = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      fast: false,
      slow: false,
    };
    const moveForward = new THREE.Vector3();
    const moveRight = new THREE.Vector3();
    const moveDelta = new THREE.Vector3();
    const moveUp = new THREE.Vector3(0, 1, 0);
    const playerGeometry = new THREE.SphereGeometry(20, 14, 12);
    const playerMarkers = new Map<string, {
      steamId: string;
      mesh: THREE.Mesh;
      targetPosition: THREE.Vector3;
      lastSeenAtMs: number;
      yawRad: number;
    }>();
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    const pointerDown = { x: 0, y: 0 };
    let pointerDownAt = 0;
    let lastSelectionVisualKey = '__none__';
    const followForward = new THREE.Vector3();
    const followFocus = new THREE.Vector3();
    const followDesiredCamera = new THREE.Vector3();
    let lastPlayerSnapshotKey = '';
    const diagnosticsMap = new Map<string, ViewerDiagnostic>();

    const pushDiagnostic = (
      level: 'warn' | 'error',
      code: string,
      assetType: ViewerDiagnostic['assetType'],
      assetIdRaw: string,
      message: string,
      searchedIn: string[] = [],
    ) => {
      const assetId = String(assetIdRaw || '__unknown__').trim() || '__unknown__';
      const key = `${code}|${assetType}|${assetId}`;
      const nowIso = new Date().toISOString();
      const cleanSearched = Array.from(
        new Set(
          searchedIn
            .map((item) => String(item || '').trim())
            .filter((item) => item.length > 0),
        ),
      );
      const current = diagnosticsMap.get(key);
      if (current) {
        current.count += 1;
        current.lastSeenAt = nowIso;
        if (!current.message && message) current.message = message;
        if (cleanSearched.length > 0) {
          current.searchedIn = Array.from(new Set(current.searchedIn.concat(cleanSearched))).slice(0, 10);
        }
      } else {
        diagnosticsMap.set(key, {
          id: key,
          level,
          code,
          assetType,
          assetId,
          message,
          searchedIn: cleanSearched.slice(0, 10),
          firstSeenAt: nowIso,
          lastSeenAt: nowIso,
          count: 1,
        });
      }

      const sorted = Array.from(diagnosticsMap.values()).sort((a, b) => {
        const levelScore = (item: ViewerDiagnostic) => (item.level === 'error' ? 2 : 1);
        const diffLevel = levelScore(b) - levelScore(a);
        if (diffLevel !== 0) return diffLevel;
        if (b.count !== a.count) return b.count - a.count;
        return b.lastSeenAt.localeCompare(a.lastSeenAt);
      });
      setDiagnostics(sorted.slice(0, 120));
    };

    const withRoots = (roots: string[], relPaths: string[]): string[] => {
      const cleaned = relPaths
        .map((item) => String(item || '').trim())
        .filter((item) => item.length > 0);
      if (!cleaned.length) return [];
      const out: string[] = [];
      for (const rel of cleaned) {
        out.push(rel);
        for (const rootRaw of roots) {
          const root = String(rootRaw || '').trim().replace(/\\/g, '/').replace(/\/$/, '');
          const relNorm = rel.replace(/\\/g, '/').replace(/^\//, '');
          if (!root) continue;
          out.push(`${root}/${relNorm}`);
        }
      }
      return Array.from(new Set(out));
    };

    const estimateTextureBytes = (
      texture: THREE.Texture,
      hintBytes?: number,
    ): number => {
      const hinted = Number(hintBytes || 0);
      if (Number.isFinite(hinted) && hinted > 0) return Math.floor(hinted);
      const image: any = (texture as any).image;
      const width = Math.max(1, Number(image?.width || 1));
      const height = Math.max(1, Number(image?.height || 1));
      return Math.floor(width * height * 4 * 1.3334);
    };

    const applyTextureToMaterial = (material: THREE.MeshStandardMaterial, texture: THREE.Texture) => {
      material.map = texture;
      material.color.set(0xffffff);
      material.needsUpdate = true;
    };

    const loadTextureChain = (
      chainKey: string,
      materialId: string,
      candidates: string[],
      vramHintBytes?: number,
    ) => {
      if (textureLoading.has(chainKey)) return;
      textureLoading.add(chainKey);

      const tryCandidate = (index: number) => {
        if (index >= candidates.length) {
          textureLoading.delete(chainKey);
          pendingMaterialBindings.delete(chainKey);
          pushDiagnostic(
            'error',
            'texture_chain_failed',
            'texture',
            chainKey,
            `falha ao carregar textura para material=${materialId} em todos os formatos`,
            withRoots(materialRootsScanned, candidates),
          );
          return;
        }

        const url = candidates[index];
        const cached = textureCache.get(url);
        if (cached) {
          const waiting = pendingMaterialBindings.get(chainKey);
          if (waiting) {
            for (const mat of waiting) applyTextureToMaterial(mat, cached);
          }
          pendingMaterialBindings.delete(chainKey);
          textureLoading.delete(chainKey);
          return;
        }
        if (cached === null) {
          tryCandidate(index + 1);
          return;
        }

        const isKtx2 = url.toLowerCase().endsWith('.ktx2');
        const loader = isKtx2 ? ktx2Loader : textureLoader;
        loader.load(
          url,
          (texture) => {
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = 4;
            textureCache.set(url, texture);
            if (!textureCacheBytesByUrl.has(url)) {
              const bytes = estimateTextureBytes(texture, vramHintBytes);
              textureCacheBytesByUrl.set(url, bytes);
              textureCacheBytesEstimate += bytes;
            }
            const waiting = pendingMaterialBindings.get(chainKey);
            if (waiting) {
              for (const mat of waiting) applyTextureToMaterial(mat, texture);
            }
            pendingMaterialBindings.delete(chainKey);
            textureLoading.delete(chainKey);
          },
          undefined,
          () => {
            textureCache.set(url, null);
            tryCandidate(index + 1);
          },
        );
      };

      tryCandidate(0);
    };

    const getWorldMaterial = (materialIdRaw: string, placeholderFlag: boolean): THREE.MeshStandardMaterial => {
      const materialId = String(materialIdRaw || '__missing_material');
      const def = materialDefs.get(materialId);
      const fallbackTextureUrl = def?.fallbackTextureUrl || def?.textureUrl;
      const primaryTextureUrl = ktx2RuntimeEnabled && def?.ktx2Url ? def.ktx2Url : fallbackTextureUrl;
      const shouldPlaceholder = placeholderFlag || !def || def.placeholder || !primaryTextureUrl;
      const isToolMaterial = materialId.startsWith('tools/') || materialId.startsWith('editor/');
      if (shouldPlaceholder && !isToolMaterial) {
        const searchedIn = withRoots(materialRootsScanned, [
          def?.searchedVmt || (materialId ? `materials/${materialId}.vmt` : ''),
          def?.searchedVtf || (def?.resolvedBaseTexture ? `materials/${def.resolvedBaseTexture}.vtf` : ''),
          def?.sourcePath || '',
        ]);
        const status = String(def?.status || '').trim().toLowerCase();
        const code = status === 'ok'
          ? 'material_runtime_placeholder'
          : status
            ? `material_${status}`
            : 'material_placeholder';
        const message = status === 'ok'
          ? 'material marcado como placeholder no chunk runtime'
          : def?.error
            ? `material sem textura (${def.status || 'placeholder'}): ${def.error}`
            : `material sem textura (${def?.status || 'not_in_index'})`;
        pushDiagnostic(
          def?.error ? 'error' : 'warn',
          code,
          'material',
          materialId,
          message,
          searchedIn,
        );
      }
      const baseColor = shouldPlaceholder ? new THREE.Color(0x6b7280) : hashColor(materialId, 0.92);
      const material = new THREE.MeshStandardMaterial({
        color: baseColor,
        metalness: 0.04,
        roughness: 0.94,
        side: THREE.DoubleSide,
      });

      if (!shouldPlaceholder && primaryTextureUrl) {
        const candidateUrls: string[] = [];
        const primary = toAssetUrl(manifestUrl, primaryTextureUrl);
        candidateUrls.push(primary);
        if (fallbackTextureUrl) {
          const fallback = toAssetUrl(manifestUrl, fallbackTextureUrl);
          if (fallback !== primary) candidateUrls.push(fallback);
        }

        const cachedReady = candidateUrls.find((url) => textureCache.has(url) && !!textureCache.get(url));
        if (cachedReady) {
          const texture = textureCache.get(cachedReady);
          if (texture) applyTextureToMaterial(material, texture);
        } else {
          const allFailed = candidateUrls.every((url) => textureCache.get(url) === null);
          if (!allFailed) {
            const chainKey = `${materialId}|${candidateUrls.join('||')}`;
            const pending = pendingMaterialBindings.get(chainKey) || new Set<THREE.MeshStandardMaterial>();
            pending.add(material);
            pendingMaterialBindings.set(chainKey, pending);
            loadTextureChain(chainKey, materialId, candidateUrls, def?.vramEstimateBytes);
          } else {
            pushDiagnostic(
              'error',
              'texture_fetch_failed',
              'texture',
              materialId,
              `falha ao carregar textura no browser: ${candidateUrls[0] || 'n/a'}`,
              withRoots(materialRootsScanned, [
                ...candidateUrls,
                materialId ? `materials/${materialId}.vmt` : '',
                def?.searchedVtf || '',
                def?.sourcePath || '',
              ]),
            );
          }
        }
      }

      return material;
    };

    const disposeTextureCache = () => {
      for (const texture of textureCache.values()) {
        if (texture) texture.dispose();
      }
      textureCache.clear();
      textureCacheBytesByUrl.clear();
      textureCacheBytesEstimate = 0;
      textureLoading.clear();
      pendingMaterialBindings.clear();
    };

    const disposeModelCache = () => {
      for (const model of modelCache.values()) {
        if (!model) continue;
        for (const subMesh of model.subMeshes) {
          subMesh.geometry.dispose();
        }
      }
      modelCache.clear();
      modelLoading.clear();
      modelUsageCount.clear();
      modelCacheBytesEstimate = 0;
    };

    const normalizeModelId = (modelIdRaw: string): string => String(modelIdRaw || '').trim().toLowerCase();

    const estimateGeometryBytes = (geometry: THREE.BufferGeometry): number => {
      let bytes = 0;
      const position = geometry.getAttribute('position');
      if (position?.array) bytes += (position.array as ArrayLike<number> & { byteLength?: number }).byteLength || 0;
      const uv = geometry.getAttribute('uv');
      if (uv?.array) bytes += (uv.array as ArrayLike<number> & { byteLength?: number }).byteLength || 0;
      const normal = geometry.getAttribute('normal');
      if (normal?.array) bytes += (normal.array as ArrayLike<number> & { byteLength?: number }).byteLength || 0;
      const index = geometry.getIndex();
      if (index?.array) bytes += (index.array as ArrayLike<number> & { byteLength?: number }).byteLength || 0;
      return Math.max(0, bytes);
    };

    const modelBytes = (model: ModelCacheEntry): number => {
      if (model.byteEstimate > 0) return model.byteEstimate;
      let bytes = 0;
      for (const sub of model.subMeshes) {
        bytes += estimateGeometryBytes(sub.geometry);
      }
      return Math.max(0, bytes);
    };

    const touchModelUsage = (modelIdRaw: string, atMs = performance.now()) => {
      const modelId = normalizeModelId(modelIdRaw);
      if (!modelId || modelId === '__placeholder_box__') return;
      const model = modelCache.get(modelId);
      if (model) {
        model.lastUsedAtMs = atMs;
      }
    };

    const addModelUsage = (modelIds: Iterable<string>, atMs = performance.now()) => {
      for (const modelIdRaw of modelIds) {
        const modelId = normalizeModelId(modelIdRaw);
        if (!modelId || modelId === '__placeholder_box__') continue;
        const current = modelUsageCount.get(modelId) || 0;
        modelUsageCount.set(modelId, current + 1);
        touchModelUsage(modelId, atMs);
      }
    };

    const releaseModelUsage = (modelIds: Iterable<string>) => {
      for (const modelIdRaw of modelIds) {
        const modelId = normalizeModelId(modelIdRaw);
        if (!modelId || modelId === '__placeholder_box__') continue;
        const current = modelUsageCount.get(modelId) || 0;
        if (current <= 1) {
          modelUsageCount.delete(modelId);
        } else {
          modelUsageCount.set(modelId, current - 1);
        }
      }
    };

    const sweepModelCache = (nowMs: number, force = false) => {
      if (!force && nowMs - lastModelCacheSweepAtMs < MODEL_CACHE_SWEEP_INTERVAL_MS) return;
      lastModelCacheSweepAtMs = nowMs;

      const candidates: Array<{ id: string; bytes: number; idleMs: number }> = [];
      for (const [modelId, model] of modelCache.entries()) {
        if (!model) continue;
        if ((modelUsageCount.get(modelId) || 0) > 0) continue;
        const bytes = modelBytes(model);
        const idleMs = Math.max(0, nowMs - model.lastUsedAtMs);
        const oldEnough = idleMs >= MODEL_CACHE_EVICT_GRACE_MS;
        const overBudget = modelCacheBytesEstimate > MODEL_CACHE_MAX_BYTES;
        if (force || oldEnough || overBudget) {
          candidates.push({ id: modelId, bytes, idleMs });
        }
      }

      if (!candidates.length) return;
      candidates.sort((a, b) => {
        if (b.idleMs !== a.idleMs) return b.idleMs - a.idleMs;
        return b.bytes - a.bytes;
      });

      let evictedModels = 0;
      let evictedBytes = 0;
      for (const candidate of candidates) {
        if (!force && modelCacheBytesEstimate <= MODEL_CACHE_MAX_BYTES && candidate.idleMs < MODEL_CACHE_EVICT_GRACE_MS) {
          continue;
        }
        const model = modelCache.get(candidate.id);
        if (!model) continue;
        for (const subMesh of model.subMeshes) {
          subMesh.geometry.dispose();
        }
        modelCache.delete(candidate.id);
        modelUsageCount.delete(candidate.id);
        const bytes = modelBytes(model);
        evictedBytes += bytes;
        modelCacheBytesEstimate = Math.max(0, modelCacheBytesEstimate - bytes);
        evictedModels += 1;
      }

      if (evictedModels > 0) {
        appendLog(
          `model cache evict: count=${evictedModels} freed=${Math.round(evictedBytes / (1024 * 1024))}MB remaining=${Math.round(modelCacheBytesEstimate / (1024 * 1024))}MB`,
        );
      }
    };

    const loadModelMesh = async (modelIdRaw: string) => {
      const modelId = normalizeModelId(modelIdRaw);
      if (!modelId) return null;
      if (modelCache.has(modelId)) {
        touchModelUsage(modelId);
        return modelCache.get(modelId) || null;
      }
      const existing = modelLoading.get(modelId);
      if (existing) return existing;

      const def = modelDefs.get(modelId);
      if (!def || def.placeholder || !def.meshUrl) {
        modelCache.set(modelId, null);
        pushDiagnostic(
          def?.error ? 'error' : 'warn',
          def?.status ? `model_${def.status}` : 'model_not_in_index',
          'model',
          modelId,
          def?.error
            ? `modelo sem malha exportada (${def.status || 'placeholder'}): ${def.error}`
            : `modelo sem malha exportada (${def?.status || 'missing_index'})`,
          withRoots(modelRootsScanned, [
            def?.sourcePath || '',
            def?.searchedMdl || (modelId ? `models/${modelId}.mdl` : ''),
            def?.searchedVtx || '',
            def?.searchedVvd || '',
          ]),
        );
        return null;
      }

      const promise = (async () => {
        try {
          const payload = await readJson<ModelMeshPayload>(toAssetUrl(manifestUrl, def.meshUrl!));
          if (cancelled) return null;
          const subMeshesRaw = Array.isArray(payload.subMeshes) ? payload.subMeshes : [];
          const subMeshes: Array<{
            material: string;
            materialId: string;
            placeholderMaterial: boolean;
            geometry: THREE.BufferGeometry;
          }> = [];

          for (const sub of subMeshesRaw) {
            const rawPositions = Array.isArray(sub.positions) ? sub.positions : [];
            if (rawPositions.length < 9) continue;
            const positionArray = new Float32Array(rawPositions.length);
            for (let i = 0; i < rawPositions.length; i += 3) {
              const x = Number(rawPositions[i] || 0);
              const y = Number(rawPositions[i + 1] || 0);
              const z = Number(rawPositions[i + 2] || 0);
              positionArray[i + 0] = x;
              positionArray[i + 1] = z;
              positionArray[i + 2] = y;
            }

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positionArray, 3));

            const rawUvs = Array.isArray(sub.uvs) ? sub.uvs : [];
            if (rawUvs.length === (rawPositions.length / 3) * 2) {
              const uvArray = new Float32Array(rawUvs.length);
              for (let i = 0; i < rawUvs.length; i += 2) {
                uvArray[i + 0] = Number(rawUvs[i] || 0);
                uvArray[i + 1] = 1 - Number(rawUvs[i + 1] || 0);
              }
              geometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
            }

            const rawIndices = Array.isArray(sub.indices) ? sub.indices : [];
            if (rawIndices.length >= 3) {
              const indexArray = new Uint32Array(rawIndices.length);
              for (let i = 0; i < rawIndices.length; i += 1) {
                indexArray[i] = Math.max(0, Math.floor(Number(rawIndices[i] || 0)));
              }
              geometry.setIndex(new THREE.BufferAttribute(indexArray, 1));
            }

            geometry.computeVertexNormals();
            geometry.computeBoundingSphere();
            (geometry.userData as any).sharedFromCache = true;

            subMeshes.push({
              material: String(sub.material || '__missing_material'),
              materialId: String(sub.materialId || sub.material || '__missing_material'),
              placeholderMaterial: !!sub.placeholderMaterial,
              geometry,
            });
          }

          if (!subMeshes.length) {
            modelCache.set(modelId, null);
            pushDiagnostic(
              'warn',
              'model_no_submeshes',
              'model',
              modelId,
              'modelo carregado sem submeshes utilizaveis',
              withRoots(modelRootsScanned, [def.sourcePath || '', def.meshUrl || '', def.searchedMdl || '']),
            );
            return null;
          }

          const resolved: ModelCacheEntry = {
            id: modelId,
            triCount: Math.max(0, Number(payload.stats?.triCount || 0)),
            vertexCount: Math.max(0, Number(payload.stats?.vertexCount || 0)),
            byteEstimate: Math.max(0, Number(payload.stats?.byteEstimate || 0)),
            lastUsedAtMs: performance.now(),
            subMeshes,
          };
          const estimatedBytes = modelBytes(resolved);
          resolved.byteEstimate = estimatedBytes;
          modelCache.set(modelId, resolved);
          modelCacheBytesEstimate += estimatedBytes;
          if (modelCacheBytesEstimate > MODEL_CACHE_MAX_BYTES) {
            sweepModelCache(performance.now());
          }
          return resolved;
        } catch (error: any) {
          modelCache.set(modelId, null);
          pushDiagnostic(
            'error',
            'model_mesh_fetch_failed',
            'model',
            modelId,
            `falha ao carregar malha do modelo: ${String(error?.message || error || 'unknown')}`,
            withRoots(modelRootsScanned, [def.meshUrl || '', def.sourcePath || '', def.searchedMdl || '']),
          );
          return null;
        } finally {
          modelLoading.delete(modelId);
        }
      })();

      modelLoading.set(modelId, promise);
      return promise;
    };

    const clearPlayerMarkers = () => {
      for (const marker of playerMarkers.values()) {
        playersRoot.remove(marker.mesh);
        const material = marker.mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) {
          material.forEach((item) => item.dispose());
        } else {
          material?.dispose();
        }
      }
      playerMarkers.clear();
    };

    const updateMarkerSelectionVisuals = () => {
      const selectedSteamId = viewerSelectedSteamIdRef.current;
      for (const marker of playerMarkers.values()) {
        const isSelected = !!selectedSteamId && marker.steamId === selectedSteamId;
        const mat = marker.mesh.material as THREE.MeshStandardMaterial;
        mat.emissive.setHex(isSelected ? 0xffffff : 0x000000);
        mat.emissiveIntensity = isSelected ? 0.28 : 0;
        mat.needsUpdate = true;
        marker.mesh.scale.setScalar(isSelected ? PLAYER_MARKER_SELECTED_SCALE : 1);
      }
    };

    const pickPlayerSteamIdAtClientPoint = (clientX: number, clientY: number): string | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      pointerNdc.x = ((clientX - rect.left) / width) * 2 - 1;
      pointerNdc.y = -(((clientY - rect.top) / height) * 2 - 1);
      raycaster.setFromCamera(pointerNdc, camera);

      const markerMeshes = Array.from(playerMarkers.values()).map((entry) => entry.mesh);
      if (!markerMeshes.length) return null;
      const hits = raycaster.intersectObjects(markerMeshes, false);
      if (!hits.length) return null;
      const first = hits[0].object as THREE.Object3D & { userData?: { steamId?: string } };
      const steamId = String(first.userData?.steamId || '').trim();
      return steamId || null;
    };

    const onCanvasPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      pointerDown.x = event.clientX;
      pointerDown.y = event.clientY;
      pointerDownAt = performance.now();
    };

    const onCanvasPointerUp = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
      const elapsed = performance.now() - pointerDownAt;
      if (moved > 8 || elapsed > 450) return;
      const pickedSteamId = pickPlayerSteamIdAtClientPoint(event.clientX, event.clientY);
      if (!pickedSteamId) return;
      setViewerSelectedSteamId(pickedSteamId);
    };

    const clearMovementKeys = () => {
      movementKeys.forward = false;
      movementKeys.backward = false;
      movementKeys.left = false;
      movementKeys.right = false;
      movementKeys.fast = false;
      movementKeys.slow = false;
    };

    const isTypingElement = (target: EventTarget | null): boolean => {
      if (!target) return false;
      const element = target as HTMLElement;
      if (!element) return false;
      const tag = String((element as any).tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      return !!(element as any).isContentEditable;
    };

    const setMovementByCode = (code: string, active: boolean): boolean => {
      switch (code) {
        case 'KeyW':
        case 'ArrowUp':
          movementKeys.forward = active;
          return true;
        case 'KeyS':
        case 'ArrowDown':
          movementKeys.backward = active;
          return true;
        case 'KeyA':
        case 'ArrowLeft':
          movementKeys.left = active;
          return true;
        case 'KeyD':
        case 'ArrowRight':
          movementKeys.right = active;
          return true;
        case 'ShiftLeft':
        case 'ShiftRight':
          movementKeys.fast = active;
          return true;
        case 'ControlLeft':
        case 'ControlRight':
          movementKeys.slow = active;
          return true;
        default:
          return false;
      }
    };

    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (isTypingElement(event.target)) return;
      if (setMovementByCode(event.code, true)) {
        event.preventDefault();
      }
    };

    const onWindowKeyUp = (event: KeyboardEvent) => {
      if (setMovementByCode(event.code, false)) {
        event.preventDefault();
      }
    };

    const upsertPlayersFromSnapshot = (snapshot: ServerViewerStateSnapshot | null) => {
      if (!snapshot) {
        clearPlayerMarkers();
        return;
      }

      const now = performance.now();
      const seen = new Set<string>();

      for (const player of snapshot.players || []) {
        const steamId = String(player.steamId || '').trim();
        if (!steamId) continue;
        seen.add(steamId);

        const sourcePos = sourceToThree(
          Number(player.pos?.x || 0),
          Number(player.pos?.y || 0),
          Number(player.pos?.z || 0),
        );
        sourcePos.y += PLAYER_MARKER_HEIGHT;

        let marker = playerMarkers.get(steamId);
        if (!marker) {
          const markerMaterial = new THREE.MeshStandardMaterial({
            color: new THREE.Color(getViewerMarkerColorHex(player)),
            metalness: 0.02,
            roughness: 0.45,
            transparent: true,
            opacity: player.alive === false ? 0.35 : 0.95,
            depthWrite: player.alive !== false,
          });
          const markerMesh = new THREE.Mesh(playerGeometry, markerMaterial);
          markerMesh.userData = {
            ...markerMesh.userData,
            steamId,
          };
          markerMesh.position.copy(sourcePos);
          markerMesh.frustumCulled = true;
          playersRoot.add(markerMesh);
          marker = {
            steamId,
            mesh: markerMesh,
            targetPosition: sourcePos.clone(),
            lastSeenAtMs: now,
            yawRad: THREE.MathUtils.degToRad(Number(player.eyeAngles?.yaw || 0)),
          };
          playerMarkers.set(steamId, marker);
        } else {
          marker.targetPosition.copy(sourcePos);
          marker.lastSeenAtMs = now;
          marker.yawRad = THREE.MathUtils.degToRad(Number(player.eyeAngles?.yaw || 0));
          const mat = marker.mesh.material as THREE.MeshStandardMaterial;
          mat.color.setHex(getViewerMarkerColorHex(player));
          mat.opacity = player.alive === false ? 0.35 : 0.95;
          mat.depthWrite = player.alive !== false;
          mat.needsUpdate = true;
        }
      }

      for (const [steamId, marker] of playerMarkers.entries()) {
        if (seen.has(steamId)) continue;
        playersRoot.remove(marker.mesh);
        const material = marker.mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) {
          material.forEach((item) => item.dispose());
        } else {
          material?.dispose();
        }
        playerMarkers.delete(steamId);
      }

      updateMarkerSelectionVisuals();
    };

    const resolveChunkLodUrl = (entry: ChunkEntry, lod: 0 | 1 | 2): string => {
      const urls = entry.lodUrls || {};
      if (lod === 0) return String(urls.lod0 || entry.url || '');
      if (lod === 1) return String(urls.lod1 || urls.lod0 || entry.url || '');
      return String(urls.lod2 || urls.lod1 || urls.lod0 || entry.url || '');
    };

    const resolveChunkLodStats = (
      entry: ChunkEntry,
      lod: 0 | 1 | 2,
    ): { totalTris?: number; totalBytes?: number; drawCallsAfterInstancing?: number } | null => {
      const lodStats = entry.lodStats || {};
      if (lod === 0) return lodStats.lod0 || entry.stats || null;
      if (lod === 1) return lodStats.lod1 || lodStats.lod0 || entry.stats || null;
      return lodStats.lod2 || lodStats.lod1 || lodStats.lod0 || entry.stats || null;
    };

    const unloadChunkRecord = (chunkId: string, reason: string) => {
      const record = chunkRecords.get(chunkId);
      if (!record) return;
      chunkRoot.remove(record.group);
      disposeObject3D(record.group);
      releaseModelUsage(record.usedModels);
      chunkRecords.delete(chunkId);
      appendLog(`chunk descarregado: ${chunkId} (lod${record.lod}, reason=${reason})`);
    };

    const loadChunkGroup = async (entry: ChunkEntry, lod: 0 | 1 | 2): Promise<void> => {
      const existing = chunkRecords.get(entry.id);
      if (existing && existing.lod === lod) return;
      if (loadingChunkIds.has(entry.id)) return;
      if (existing && existing.lod !== lod) {
        unloadChunkRecord(entry.id, `lod_switch_${existing.lod}->${lod}`);
      }
      loadingChunkIds.add(entry.id);
      const chunkUrl = resolveChunkLodUrl(entry, lod);
      try {
        const payload = await readJson<ChunkPayload>(toAssetUrl(manifestUrl, chunkUrl));
        if (cancelled) return;

        const group = new THREE.Group();
        group.name = `chunk_${entry.id}_lod${lod}`;

        const worldMeshes = Array.isArray(payload.world?.meshes) ? payload.world?.meshes : [];
        if (worldMeshes.length > 0) {
          for (const meshData of worldMeshes) {
            const rawPositions = Array.isArray(meshData.positions) ? meshData.positions : [];
            if (rawPositions.length < 9) continue;
            const positionArray = new Float32Array(rawPositions.length);
            for (let i = 0; i < rawPositions.length; i += 3) {
              const x = Number(rawPositions[i] || 0);
              const y = Number(rawPositions[i + 1] || 0);
              const z = Number(rawPositions[i + 2] || 0);
              // Source1 (x,y,z-up) -> Three.js (x,y-up,z)
              positionArray[i + 0] = x;
              positionArray[i + 1] = z;
              positionArray[i + 2] = y;
            }

            const worldGeo = new THREE.BufferGeometry();
            worldGeo.setAttribute('position', new THREE.BufferAttribute(positionArray, 3));
            const rawUvs = Array.isArray(meshData.uvs) ? meshData.uvs : [];
            if (rawUvs.length === (rawPositions.length / 3) * 2) {
              const uvArray = new Float32Array(rawUvs.length);
              for (let i = 0; i < rawUvs.length; i += 2) {
                uvArray[i + 0] = Number(rawUvs[i] || 0);
                uvArray[i + 1] = 1 - Number(rawUvs[i + 1] || 0);
              }
              worldGeo.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
            }
            worldGeo.computeVertexNormals();
            worldGeo.computeBoundingSphere();

            const matId = String(meshData.materialId || meshData.material || '__missing_material');
            const worldMat = getWorldMaterial(matId, !!meshData.placeholderMaterial);
            const worldMesh = new THREE.Mesh(worldGeo, worldMat);
            worldMesh.frustumCulled = true;
            group.add(worldMesh);
          }
        } else {
          const worldFaces = Array.isArray(payload.world?.faces) ? payload.world?.faces : [];
          if (worldFaces.length > 0) {
            const positionArray = new Float32Array(worldFaces.length * 3);
            const colorArray = new Float32Array(worldFaces.length * 3);
            for (let i = 0; i < worldFaces.length; i += 1) {
              const face = worldFaces[i];
              const point = sourceToThree(face.position[0], face.position[1], face.position[2]);
              positionArray[i * 3 + 0] = point.x;
              positionArray[i * 3 + 1] = point.y;
              positionArray[i * 3 + 2] = point.z;
              const color = face.placeholderMaterial ? new THREE.Color(0x6b7280) : hashColor(face.material || 'world-material');
              colorArray[i * 3 + 0] = color.r;
              colorArray[i * 3 + 1] = color.g;
              colorArray[i * 3 + 2] = color.b;
            }

            const worldGeo = new THREE.BufferGeometry();
            worldGeo.setAttribute('position', new THREE.BufferAttribute(positionArray, 3));
            worldGeo.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));
            const worldMat = new THREE.PointsMaterial({
              size: 14,
              sizeAttenuation: true,
              vertexColors: true,
              opacity: 0.92,
              transparent: true,
              depthWrite: false,
            });
            const points = new THREE.Points(worldGeo, worldMat);
            points.frustumCulled = true;
            group.add(points);
          }
        }

        const usedModelsInChunk = new Set<string>();
        const props = Array.isArray(payload.props?.instances) ? payload.props.instances : [];
        if (props.length > 0) {
          const byModel = new Map<string, typeof props>();
          for (const instance of props) {
            const key = String(instance.model || '__placeholder_box__');
            const arr = byModel.get(key) || [];
            arr.push(instance);
            byModel.set(key, arr);
          }

          const modelIdsToPrefetch = Array.from(byModel.keys())
            .map((item) => normalizeModelId(item))
            .filter((item) => item && item !== '__placeholder_box__');
          if (modelIdsToPrefetch.length > 0) {
            await Promise.all(modelIdsToPrefetch.map((modelId) => loadModelMesh(modelId)));
          }

          for (const [model, instances] of byModel.entries()) {
            const normalizedModel = normalizeModelId(model);
            const explicitPlaceholder = instances.some((item) => item.placeholderModel);
            if (explicitPlaceholder) {
              const placeholderBySource = new Map<string, { count: number; reasons: Set<string> }>();
              for (const instance of instances) {
                if (!instance.placeholderModel) continue;
                const sourceModelId = normalizeModelId(instance.sourceModel || model || '__missing_model');
                const sourceId = sourceModelId && sourceModelId !== '__placeholder_box__' ? sourceModelId : '__missing_model';
                const reason = String(instance.placeholderReason || '').trim().toLowerCase();
                const current = placeholderBySource.get(sourceId) || { count: 0, reasons: new Set<string>() };
                current.count += 1;
                if (reason) current.reasons.add(reason);
                placeholderBySource.set(sourceId, current);
              }

              for (const [sourceId, sourceMeta] of placeholderBySource.entries()) {
                const def = modelDefs.get(sourceId);
                const status = String(def?.status || '').trim().toLowerCase();
                const code = status ? `model_${status}` : 'model_explicit_placeholder';
                const reasonSuffix = sourceMeta.reasons.size > 0
                  ? ` | reason=${Array.from(sourceMeta.reasons).sort((a, b) => a.localeCompare(b)).join(',')}`
                  : '';
                const message = def?.error
                  ? `modelo em placeholder (${status || 'placeholder'}): ${def.error} | instances=${sourceMeta.count}${reasonSuffix}`
                  : `modelo em placeholder (${status || 'placeholder'}) no chunk runtime | instances=${sourceMeta.count}${reasonSuffix}`;
                pushDiagnostic(
                  def?.error ? 'error' : 'warn',
                  code,
                  'model',
                  sourceId,
                  message,
                  withRoots(modelRootsScanned, [
                    def?.sourcePath || '',
                    def?.searchedMdl || (sourceId && sourceId !== '__missing_model' ? `models/${sourceId}.mdl` : ''),
                    def?.searchedVtx || '',
                    def?.searchedVvd || '',
                  ]),
                );
              }
            }
            const loadedModel = !explicitPlaceholder && normalizedModel !== '__placeholder_box__'
              ? (modelCache.get(normalizedModel) || null)
              : null;

            const tmpPosition = new THREE.Vector3();
            const tmpQuaternion = new THREE.Quaternion();
            const tmpScale = new THREE.Vector3();
            const tmpMatrix = new THREE.Matrix4();
            const applyInstanceMatrices = (instanced: THREE.InstancedMesh) => {
              for (let i = 0; i < instances.length; i += 1) {
                const instance = instances[i];
                const pos = sourceToThree(instance.origin[0], instance.origin[1], instance.origin[2]);
                tmpPosition.set(pos.x, pos.y + 36, pos.z);
                const pitch = THREE.MathUtils.degToRad(Number(instance.angles[0] || 0));
                const yaw = THREE.MathUtils.degToRad(Number(instance.angles[1] || 0));
                const roll = THREE.MathUtils.degToRad(Number(instance.angles[2] || 0));
                tmpQuaternion.setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
                tmpScale.set(
                  Math.max(0.25, Number(instance.scale[0] || 1)),
                  Math.max(0.25, Number(instance.scale[2] || 1)),
                  Math.max(0.25, Number(instance.scale[1] || 1)),
                );
                tmpMatrix.compose(tmpPosition, tmpQuaternion, tmpScale);
                instanced.setMatrixAt(i, tmpMatrix);
              }
              instanced.instanceMatrix.needsUpdate = true;
              instanced.frustumCulled = true;
            };

            if (loadedModel && loadedModel.subMeshes.length > 0) {
              usedModelsInChunk.add(normalizedModel);
              touchModelUsage(normalizedModel);
              for (const sub of loadedModel.subMeshes) {
                const modelMat = getWorldMaterial(sub.materialId || sub.material, !!sub.placeholderMaterial);
                const instanced = new THREE.InstancedMesh(sub.geometry, modelMat, instances.length);
                applyInstanceMatrices(instanced);
                group.add(instanced);
              }
              continue;
            }

            if (!explicitPlaceholder && normalizedModel !== '__placeholder_box__') {
              const def = modelDefs.get(normalizedModel);
              pushDiagnostic(
                'warn',
                'model_runtime_placeholder',
                'model',
                normalizedModel,
                'modelo renderizado como placeholder (caixa) por falta de mesh no runtime',
                withRoots(modelRootsScanned, [
                  def?.meshUrl || '',
                  def?.sourcePath || '',
                  def?.searchedMdl || '',
                  def?.searchedVtx || '',
                  def?.searchedVvd || '',
                ]),
              );
            }

            const color = explicitPlaceholder ? new THREE.Color(0xdc2626) : hashColor(model, 0.9);
            const boxGeo = new THREE.BoxGeometry(34, 72, 34);
            const boxMat = new THREE.MeshStandardMaterial({
              color,
              metalness: 0.08,
              roughness: 0.9,
              opacity: explicitPlaceholder ? 0.72 : 0.85,
              transparent: true,
            });
            const instanced = new THREE.InstancedMesh(boxGeo, boxMat, instances.length);
            applyInstanceMatrices(instanced);
            group.add(instanced);
          }
        }

        group.visible = false;
        chunkRoot.add(group);

        const usedModels = Array.from(usedModelsInChunk);
        addModelUsage(usedModels);
        const statsFromEntry = resolveChunkLodStats(entry, lod);
        chunkRecords.set(entry.id, {
          entry,
          lod,
          group,
          touchedAtMs: performance.now(),
          tris: Math.max(0, Number(payload.stats?.totalTris || statsFromEntry?.totalTris || 0)),
          bytes: Math.max(0, Number(payload.stats?.totalBytes || statsFromEntry?.totalBytes || 0)),
          drawCalls: Math.max(0, Number(payload.stats?.drawCallsAfterInstancing || statsFromEntry?.drawCallsAfterInstancing || 0)),
          usedModels,
        });

        appendLog(`chunk carregado: ${entry.id} (lod${lod})`);
      } catch (loadErr: any) {
        appendLog(`erro ao carregar chunk ${entry.id} (lod${lod}): ${String(loadErr?.message || loadErr)}`);
        pushDiagnostic(
          'error',
          'chunk_load_failed',
          'chunk',
          `${entry.id}@lod${lod}`,
          `erro ao carregar chunk ${entry.id} (lod${lod}): ${String(loadErr?.message || loadErr)}`,
          [chunkUrl || entry.url || ''],
        );
      } finally {
        loadingChunkIds.delete(entry.id);
      }
    };

    const setup = async () => {
      try {
        setStatus('Carregando manifest...');
        const loadedManifest = await readJson<Manifest>(manifestUrl);
        if (cancelled) return;
        setManifest(loadedManifest);
        textureVramBudgetBytes = Math.max(
          256 * 1024 * 1024,
          Number(loadedManifest.textures?.vramBudgetBytes || textureVramBudgetBytes),
        );
        ktx2TranscoderPath = String(
          loadedManifest.assets.materials?.ktx2TranscoderPath
          || '/vendor/basis/',
        );
        try {
          const resolvedTranscoder = toAssetUrl(manifestUrl, ktx2TranscoderPath);
          ktx2Loader.setTranscoderPath(resolvedTranscoder.endsWith('/') ? resolvedTranscoder : `${resolvedTranscoder}/`);
          ktx2Loader.detectSupport(renderer);
          ktx2RuntimeEnabled = true;
          appendLog(`ktx2 runtime: enabled path=${resolvedTranscoder}`);
        } catch (ktxErr: any) {
          ktx2RuntimeEnabled = false;
          appendLog(`ktx2 runtime indisponivel: ${String(ktxErr?.message || ktxErr)}`);
        }

        if (loadedManifest.assets.materials?.indexUrl) {
          try {
            const materialIndexUrl = toAssetUrl(manifestUrl, loadedManifest.assets.materials.indexUrl);
            const materialIndex = await readJson<MaterialIndex>(materialIndexUrl);
            if (!cancelled) {
              if (Number.isFinite(Number(materialIndex.textureVramBudgetBytes || 0)) && Number(materialIndex.textureVramBudgetBytes) > 0) {
                textureVramBudgetBytes = Number(materialIndex.textureVramBudgetBytes);
              }
              if (materialIndex.ktx2Enabled === false) {
                ktx2RuntimeEnabled = false;
              }
              materialRootsScanned = Array.isArray(materialIndex.rootsScanned)
                ? materialIndex.rootsScanned.map((item) => String(item || '')).filter(Boolean)
                : [];
              for (const item of materialIndex.materials || []) {
                const key = String(item.material || item.id || '').trim();
                if (!key) continue;
                materialDefs.set(key, {
                  placeholder: !!item.placeholder,
                  ...(item.textureUrl ? { textureUrl: item.textureUrl } : {}),
                  ...(item.fallbackTextureUrl ? { fallbackTextureUrl: item.fallbackTextureUrl } : {}),
                  ...(item.ktx2Url ? { ktx2Url: item.ktx2Url } : {}),
                  ...(item.textureClass ? { textureClass: String(item.textureClass) } : {}),
                  ...(item.textureProfile ? { textureProfile: item.textureProfile } : {}),
                  ...(Number.isFinite(Number(item.vramEstimateBytes || 0)) ? { vramEstimateBytes: Number(item.vramEstimateBytes) } : {}),
                  ...(item.status ? { status: String(item.status) } : {}),
                  ...(item.sourcePath ? { sourcePath: String(item.sourcePath) } : {}),
                  ...(item.resolvedBaseTexture ? { resolvedBaseTexture: String(item.resolvedBaseTexture) } : {}),
                  ...(item.searchedVmt ? { searchedVmt: String(item.searchedVmt) } : {}),
                  ...(item.searchedVtf ? { searchedVtf: String(item.searchedVtf) } : {}),
                  ...(Array.isArray(item.usage) ? { usage: item.usage.map((entry) => String(entry || '')) } : {}),
                  ...(item.error ? { error: String(item.error) } : {}),
                });
              }
              appendLog(`materials index carregado: total=${materialDefs.size} primary=${materialIndex.primaryFormat || 'png'} ktx2=${materialIndex.ktx2Enabled ? 'on' : 'off'}`);
            }
          } catch (materialErr: any) {
            appendLog(`materials index indisponivel: ${String(materialErr?.message || materialErr)}`);
            pushDiagnostic(
              'error',
              'materials_index_unavailable',
              'runtime',
              'materials_index',
              `falha ao carregar materials/index: ${String(materialErr?.message || materialErr)}`,
              [loadedManifest.assets.materials.indexUrl],
            );
          }
        }

        if (loadedManifest.assets.models?.indexUrl) {
          try {
            const modelIndexUrl = toAssetUrl(manifestUrl, loadedManifest.assets.models.indexUrl);
            const modelIndex = await readJson<ModelIndex>(modelIndexUrl);
            if (!cancelled) {
              modelRootsScanned = Array.isArray(modelIndex.rootsScanned)
                ? modelIndex.rootsScanned.map((item) => String(item || '')).filter(Boolean)
                : [];
              for (const model of modelIndex.models || []) {
                const key = String(model.id || model.model || '').trim().toLowerCase();
                if (!key) continue;
                modelDefs.set(key, {
                  id: key,
                  placeholder: !!model.placeholder,
                  ...(model.meshUrl ? { meshUrl: model.meshUrl } : {}),
                  ...(model.status ? { status: String(model.status) } : {}),
                  ...(model.sourcePath ? { sourcePath: String(model.sourcePath) } : {}),
                  ...(model.searchedMdl ? { searchedMdl: String(model.searchedMdl) } : {}),
                  ...(model.searchedVtx ? { searchedVtx: String(model.searchedVtx) } : {}),
                  ...(model.searchedVvd ? { searchedVvd: String(model.searchedVvd) } : {}),
                  ...(Array.isArray(model.materials) ? { materials: model.materials.map((item) => String(item || '')) } : {}),
                  ...(model.error ? { error: String(model.error) } : {}),
                });
              }
              appendLog(`models index carregado: total=${modelDefs.size}`);
            }
          } catch (modelErr: any) {
            appendLog(`models index indisponivel: ${String(modelErr?.message || modelErr)}`);
            pushDiagnostic(
              'error',
              'models_index_unavailable',
              'runtime',
              'models_index',
              `falha ao carregar models/index: ${String(modelErr?.message || modelErr)}`,
              [loadedManifest.assets.models.indexUrl],
            );
          }
        }

        const lod0IndexUrl = toAssetUrl(manifestUrl, loadedManifest.assets.chunks.lod0IndexUrl);
        setStatus('Carregando indice de chunks...');
        const chunkIndex = await readJson<ChunkIndex>(lod0IndexUrl);
        if (cancelled) return;

        const worldMinX = Number(loadedManifest.map.worldBounds.min[0] || 0);
        const worldMinY = Number(loadedManifest.map.worldBounds.min[1] || 0);
        const worldMaxX = Number(loadedManifest.map.worldBounds.max[0] || 0);
        const worldMaxY = Number(loadedManifest.map.worldBounds.max[1] || 0);
        const worldCenterX = (worldMinX + worldMaxX) * 0.5;
        const worldCenterY = (worldMinY + worldMaxY) * 0.5;
        const worldCenter = sourceToThree(worldCenterX, worldCenterY, 128);

        camera.position.set(worldCenter.x + 3200, worldCenter.y + 2200, worldCenter.z + 3200);
        controls.target.copy(worldCenter);
        controls.update();

        const chunkSize = Math.max(256, Number(loadedManifest.map.chunkSize || 2048));
        const activeRadius = Math.max(1, Number(loadedManifest.streaming?.activeRadiusChunks || 1));
        const renderRadius = Math.max(activeRadius, Number(loadedManifest.streaming?.renderRadiusChunks || activeRadius + 2));
        const prefetchRadius = Math.max(renderRadius, Number(loadedManifest.streaming?.prefetchRadiusChunks || renderRadius));
        const discardRadius = Math.max(prefetchRadius, Number(loadedManifest.streaming?.discardRadiusChunks || (prefetchRadius + 1)));
        const gracePeriodMs = Math.max(1000, Number(loadedManifest.streaming?.gracePeriodMs || 5000));
        const lod1Radius = Math.max(activeRadius + 1, Math.min(renderRadius - 1, prefetchRadius - 1));
        const resolveDesiredLod = (ring: number): 0 | 1 | 2 => {
          if (ring <= activeRadius) return 0;
          if (ring <= lod1Radius) return 1;
          return 2;
        };

        const entries = chunkIndex.chunks || [];
        const byId = new Map(entries.map((entry) => [entry.id, entry] as const));

        const toBaseCell = (entry: ChunkEntry): { x: number; y: number } => {
          if (entry.baseCell && Number.isFinite(entry.baseCell.x) && Number.isFinite(entry.baseCell.y)) return entry.baseCell;
          const centerX = (entry.bounds.minX + entry.bounds.maxX) * 0.5;
          const centerY = (entry.bounds.minY + entry.bounds.maxY) * 0.5;
          return {
            x: Math.floor((centerX - worldMinX) / chunkSize),
            y: Math.floor((centerY - worldMinY) / chunkSize),
          };
        };

        const chunkCells = new Map<string, { x: number; y: number }>();
        for (const entry of entries) {
          chunkCells.set(entry.id, toBaseCell(entry));
        }

        const updateStreaming = () => {
          const now = performance.now();
          const cameraCell = {
            x: Math.floor((camera.position.x - worldMinX) / chunkSize),
            y: Math.floor((camera.position.z - worldMinY) / chunkSize),
          };

          const activeIds = new Set<string>();
          const visibleIds = new Set<string>();
          const keepIds = new Set<string>();
          const desiredLoadByChunk = new Map<string, 0 | 1 | 2>();

          for (const entry of entries) {
            const cell = chunkCells.get(entry.id) || { x: 0, y: 0 };
            const dx = Math.abs(cell.x - cameraCell.x);
            const dy = Math.abs(cell.y - cameraCell.y);
            const ring = Math.max(dx, dy);
            const desiredLod = resolveDesiredLod(ring);
            if (dx <= activeRadius && dy <= activeRadius) {
              activeIds.add(entry.id);
            }
            if (dx <= renderRadius && dy <= renderRadius) {
              visibleIds.add(entry.id);
            }
            if (dx <= prefetchRadius && dy <= prefetchRadius) desiredLoadByChunk.set(entry.id, desiredLod);
            if (dx <= discardRadius && dy <= discardRadius) {
              keepIds.add(entry.id);
            }
          }

          for (const [chunkId, desiredLod] of desiredLoadByChunk.entries()) {
            const entry = byId.get(chunkId);
            if (!entry) continue;
            const current = chunkRecords.get(chunkId);
            if (current) {
              current.touchedAtMs = now;
              // Avoid downgrade thrash: upgrade quality only when needed.
              if (current.lod <= desiredLod) continue;
            }
            void loadChunkGroup(entry, desiredLod);
          }

          for (const [chunkId, record] of chunkRecords.entries()) {
            if (visibleIds.has(chunkId)) {
              record.group.visible = true;
              record.touchedAtMs = now;
            } else {
              record.group.visible = false;
            }

            if (keepIds.has(chunkId)) continue;
            if (now - record.touchedAtMs < gracePeriodMs) continue;
            unloadChunkRecord(chunkId, 'out_of_discard_radius');
          }
          sweepModelCache(now);

          if (firstActiveLoadMs === null && activeIds.size > 0 && Array.from(activeIds).every((id) => chunkRecords.has(id))) {
            firstActiveLoadMs = Math.round(performance.now() - startedAt);
            appendLog(`first_active_set_loaded_ms=${firstActiveLoadMs}`);
          }

          let visibleChunks = 0;
          let loadedTrisEstimate = 0;
          let loadedBytesEstimate = 0;
          for (const record of chunkRecords.values()) {
            if (record.group.visible) visibleChunks += 1;
            loadedTrisEstimate += record.tris;
            loadedBytesEstimate += record.bytes;
          }

          setRuntimeStats({
            loadedChunks: chunkRecords.size,
            visibleChunks,
            loadedTrisEstimate,
            loadedBytesEstimate,
            textureCacheCount: Array.from(textureCache.values()).reduce((count, item) => (item ? count + 1 : count), 0),
            textureCacheBytesEstimate,
            modelCacheCount: Array.from(modelCache.values()).reduce((count, item) => (item ? count + 1 : count), 0),
            modelCacheBytesEstimate,
            cameraCell,
            firstActiveLoadMs,
          });

          if (textureCacheBytesEstimate > textureVramBudgetBytes && (now - lastTextureBudgetWarnAt) > 10_000) {
            lastTextureBudgetWarnAt = now;
            appendLog(
              `texture cache above budget: ${Math.round(textureCacheBytesEstimate / (1024 * 1024))}MB > ${Math.round(textureVramBudgetBytes / (1024 * 1024))}MB`,
            );
          }
        };

        const onResize = () => {
          if (!mountRef.current) return;
          const width = Math.max(1, mountRef.current.clientWidth);
          const height = Math.max(1, mountRef.current.clientHeight);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          renderer.setSize(width, height);
        };

        const animate = () => {
          if (cancelled) return;
          animationFrameId = window.requestAnimationFrame(animate);

          const now = performance.now();
          const dtSec = Math.min(0.15, Math.max(0, (now - lastFrameAtMs) / 1000));
          lastFrameAtMs = now;

          const smoothAlpha = 1 - Math.exp(-PLAYER_MARKER_SMOOTH_RATE * dtSec);
          for (const marker of playerMarkers.values()) {
            marker.mesh.position.lerp(marker.targetPosition, smoothAlpha);
          }

          if (now - playerSyncIntervalMs >= 120) {
            playerSyncIntervalMs = now;
            const snapshot = viewerStateRef.current;
            const snapshotKey = snapshot
              ? `${snapshot.serverId}:${snapshot.receivedAt}:${snapshot.playerCount}:${snapshot.players.length}`
              : '__none__';
            if (snapshotKey !== lastPlayerSnapshotKey) {
              lastPlayerSnapshotKey = snapshotKey;
              upsertPlayersFromSnapshot(snapshot);
            }
          }

          const selectedSteamId = viewerSelectedSteamIdRef.current || '';
          if (selectedSteamId !== lastSelectionVisualKey) {
            lastSelectionVisualKey = selectedSteamId;
            updateMarkerSelectionVisuals();
          }

          if (viewerFollowSelectedRef.current && selectedSteamId) {
            const selectedMarker = playerMarkers.get(selectedSteamId);
            if (selectedMarker) {
              followFocus.copy(selectedMarker.targetPosition);
              followFocus.y += 40;
              followForward.set(Math.cos(selectedMarker.yawRad), 0, Math.sin(selectedMarker.yawRad));
              followDesiredCamera.copy(followFocus);
              followDesiredCamera.addScaledVector(followForward, -FOLLOW_CAMERA_DISTANCE);
              followDesiredCamera.y += FOLLOW_CAMERA_HEIGHT;
              const followAlpha = 1 - Math.exp(-FOLLOW_CAMERA_SMOOTH_RATE * dtSec);
              camera.position.lerp(followDesiredCamera, followAlpha);
              controls.target.lerp(followFocus, followAlpha);
            }
          }

          const shouldManualMove = !(viewerFollowSelectedRef.current && selectedSteamId);
          if (shouldManualMove) {
            const moveForwardBack = (movementKeys.forward ? 1 : 0) + (movementKeys.backward ? -1 : 0);
            const moveLeftRight = (movementKeys.right ? 1 : 0) + (movementKeys.left ? -1 : 0);
            if (moveForwardBack !== 0 || moveLeftRight !== 0) {
              camera.getWorldDirection(moveForward);
              moveForward.y = 0;
              if (moveForward.lengthSq() < 1e-6) {
                moveForward.set(0, 0, -1);
              } else {
                moveForward.normalize();
              }
              moveRight.crossVectors(moveForward, moveUp).normalize();
              moveDelta.set(0, 0, 0);
              if (moveForwardBack !== 0) moveDelta.addScaledVector(moveForward, moveForwardBack);
              if (moveLeftRight !== 0) moveDelta.addScaledVector(moveRight, moveLeftRight);
              if (moveDelta.lengthSq() > 1e-8) {
                moveDelta.normalize();
                let speed = CAMERA_MOVE_SPEED;
                if (movementKeys.fast) speed *= CAMERA_MOVE_FAST_MULTIPLIER;
                if (movementKeys.slow) speed *= CAMERA_MOVE_SLOW_MULTIPLIER;
                const distance = speed * dtSec;
                camera.position.addScaledVector(moveDelta, distance);
                controls.target.addScaledVector(moveDelta, distance);
              }
            }
          }

          controls.update();
          renderer.render(scene, camera);
          if (now - streamIntervalMs >= 300) {
            streamIntervalMs = now;
            updateStreaming();
          }
        };

        onResize();
        window.addEventListener('resize', onResize);
        window.addEventListener('keydown', onWindowKeyDown);
        window.addEventListener('keyup', onWindowKeyUp);
        window.addEventListener('blur', clearMovementKeys);
        renderer.domElement.addEventListener('pointerdown', onCanvasPointerDown);
        renderer.domElement.addEventListener('pointerup', onCanvasPointerUp);
        if (typeof ResizeObserver !== 'undefined' && mountRef.current) {
          hostResizeObserver = new ResizeObserver(() => {
            onResize();
          });
          hostResizeObserver.observe(mountRef.current);
        }
        let warmupTick = 0;
        warmupResizeTimer = window.setInterval(() => {
          onResize();
          warmupTick += 1;
          if (warmupTick >= 12 && warmupResizeTimer !== null) {
            window.clearInterval(warmupResizeTimer);
            warmupResizeTimer = null;
          }
        }, 250);
        animate();

        setStatus(`Viewer online | map=${loadedManifest.map.name} | chunks=${entries.length}`);
        appendLog(`manifest carregado: ${loadedManifest.map.name}`);
        appendLog(
          `chunk_count=${entries.length} active=${activeRadius * 2 + 1}x${activeRadius * 2 + 1} render=${renderRadius * 2 + 1}x${renderRadius * 2 + 1} prefetch=${prefetchRadius * 2 + 1}x${prefetchRadius * 2 + 1}`,
        );
        appendLog(`chunk_lod_bands: ring<=${activeRadius}=lod0 | ring<=${lod1Radius}=lod1 | ring<=${renderRadius}=lod2`);
        appendLog('controles: WASD movimenta | Shift acelera | Ctrl reduz | botao do meio gira camera');

        return () => {
          window.removeEventListener('resize', onResize);
          window.removeEventListener('keydown', onWindowKeyDown);
          window.removeEventListener('keyup', onWindowKeyUp);
          window.removeEventListener('blur', clearMovementKeys);
          clearMovementKeys();
          renderer.domElement.removeEventListener('pointerdown', onCanvasPointerDown);
          renderer.domElement.removeEventListener('pointerup', onCanvasPointerUp);
          if (hostResizeObserver) {
            hostResizeObserver.disconnect();
            hostResizeObserver = null;
          }
          if (warmupResizeTimer !== null) {
            window.clearInterval(warmupResizeTimer);
            warmupResizeTimer = null;
          }
        };
      } catch (setupErr: any) {
        const message = String(setupErr?.message || setupErr);
        setError(message);
        setStatus('Falha ao inicializar viewer');
        pushDiagnostic('error', 'viewer_setup_failed', 'runtime', 'viewer_setup', message, [manifestUrl]);
      }
      return undefined;
    };

    let teardown: (() => void) | undefined;
    void setup().then((cleanup) => {
      teardown = cleanup;
    });

    return () => {
      cancelled = true;
      if (animationFrameId) {
        window.cancelAnimationFrame(animationFrameId);
      }
      if (teardown) teardown();
      controls.dispose();
      for (const record of chunkRecords.values()) {
        chunkRoot.remove(record.group);
        disposeObject3D(record.group);
        releaseModelUsage(record.usedModels);
      }
      chunkRecords.clear();
      clearPlayerMarkers();
      playerGeometry.dispose();
      disposeTextureCache();
      disposeModelCache();
      try {
        ktx2Loader.dispose();
      } catch {
        // no-op
      }
      renderer.dispose();
      host.innerHTML = '';
    };
  }, [manifestUrl]);

  return (
    <div className="space-y-4 pb-8">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <Link
            to={serverId ? `/admin/servers/${serverId}` : '/admin/servers'}
            className="text-zinc-500 hover:text-white text-sm font-bold uppercase flex items-center mb-2"
          >
            <Icons.ArrowLeft className="w-4 h-4 mr-1" /> Voltar para servidor
          </Link>
          <h1 className="text-2xl md:text-3xl font-black text-white uppercase italic tracking-tight">Web Viewer 3D (MVP)</h1>
          <p className="text-zinc-400 text-sm font-mono">map={mapName}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-xs text-zinc-300 font-mono">
          <div>{status}</div>
          {manifest && <div>manifest v{manifest.version} | chunkSize={manifest.map.chunkSize}</div>}
          <div>viewerState: {viewerStatusBadge.label}</div>
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-900/50 bg-red-950/20 px-3 py-2 text-sm text-red-300">
          Erro: {error}
          <div className="text-xs text-zinc-400 mt-1">Verifique se os artefatos existem em `public/maps/{mapName}/manifest.json`.</div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-3 rounded border border-zinc-800 bg-zinc-950 overflow-hidden relative">
          <div ref={mountRef} className="h-[62vh] w-full" />
          {selectedViewerPlayer && (
            <div className="absolute left-3 bottom-3 rounded border border-cyan-800 bg-zinc-950/90 px-3 py-2 text-[11px] text-zinc-200 font-mono backdrop-blur">
              <p className="text-cyan-300 font-bold truncate max-w-[340px]">
                {selectedViewerPlayer.name || selectedViewerPlayer.steamId}
              </p>
              <p className="text-zinc-400 truncate max-w-[340px]">{selectedViewerPlayer.steamId}</p>
              <p className="text-zinc-400">
                x:{formatCoord(selectedViewerPlayer.pos.x)} y:{formatCoord(selectedViewerPlayer.pos.y)} z:{formatCoord(selectedViewerPlayer.pos.z)}
              </p>
              <p className="text-zinc-500">
                HP {Math.floor(Number(selectedViewerPlayer.health || 0))} | ARM {Math.floor(Number(selectedViewerPlayer.armor || 0))} |{' '}
                {selectedViewerPlayer.alive === false ? 'Morto' : 'Vivo'}
                {selectedViewerPlayer.teamName ? ` | ${selectedViewerPlayer.teamName}` : ''}
              </p>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div className="rounded border border-zinc-800 bg-zinc-900 p-3 text-xs text-zinc-300 space-y-1">
            <p className="text-zinc-500 uppercase font-bold text-[11px]">Streaming</p>
            <p>cameraCell: {runtimeStats.cameraCell.x}:{runtimeStats.cameraCell.y}</p>
            <p>loadedChunks: {runtimeStats.loadedChunks}</p>
            <p>visibleChunks: {runtimeStats.visibleChunks}</p>
            <p>loadedTris(est): {runtimeStats.loadedTrisEstimate.toLocaleString('pt-BR')}</p>
            <p>loadedBytes(est): {Math.round(runtimeStats.loadedBytesEstimate / (1024 * 1024)).toLocaleString('pt-BR')} MB</p>
            <p>textureCache: {runtimeStats.textureCacheCount} texturas</p>
            <p>textureCacheBytes(est): {Math.round(runtimeStats.textureCacheBytesEstimate / (1024 * 1024)).toLocaleString('pt-BR')} MB</p>
            <p>modelCache: {runtimeStats.modelCacheCount} modelos</p>
            <p>modelCacheBytes(est): {Math.round(runtimeStats.modelCacheBytesEstimate / (1024 * 1024)).toLocaleString('pt-BR')} MB</p>
            <p>firstActiveLoadMs: {runtimeStats.firstActiveLoadMs ?? 'pendente'}</p>
          </div>

          <div className="rounded border border-zinc-800 bg-zinc-900 p-3 text-xs text-zinc-300 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-zinc-500 uppercase font-bold text-[11px]">Players (viewer_state)</p>
              <span className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${viewerStatusBadge.className}`}>
                {viewerStatusBadge.label}
              </span>
            </div>
            <p>framePlayers: {viewerState?.playerCount ?? 0}</p>
            <p>frameAge: {Number.isFinite(viewerSnapshotAgeSeconds) ? `${viewerSnapshotAgeSeconds}s` : 'sem frame'}</p>
            <p>lastWsMsg: {viewerLastMessageAt ? new Date(viewerLastMessageAt).toLocaleTimeString('pt-BR') : 'n/a'}</p>
            <p>snapshotFresh: {hasFreshViewerSnapshot ? 'sim' : 'nao'}</p>
            {viewerWsError && <p className="text-red-300 break-words">wsError: {viewerWsError}</p>}
            <div className="max-h-[180px] overflow-y-auto space-y-2 pt-1 border-t border-zinc-800">
              {!viewerPlayers.length && <p className="text-zinc-500">Sem players no frame.</p>}
              {viewerPlayers.map((player) => (
                <button
                  key={player.steamId}
                  onClick={() => setViewerSelectedSteamId(player.steamId)}
                  className={`w-full text-left rounded border px-2 py-1.5 transition-colors ${
                    viewerSelectedSteamId === player.steamId
                      ? 'border-cyan-700 bg-cyan-900/20'
                      : 'border-zinc-800 bg-zinc-900/40 hover:bg-zinc-800/60'
                  }`}
                >
                  <p className="text-[12px] text-white font-semibold truncate">{player.name || 'Sem nome'}</p>
                  <p className="text-[10px] text-zinc-500 font-mono truncate">{player.steamId}</p>
                  <p className="text-[10px] text-zinc-500 mt-0.5">{player.alive === false ? 'Morto' : 'Vivo'} {player.teamName ? `| ${player.teamName}` : ''}</p>
                </button>
              ))}
            </div>

            {selectedViewerPlayer && (
              <div className="mt-2 border-t border-zinc-800 pt-2 space-y-2">
                <button
                  onClick={() => setViewerFollowSelected((current) => !current)}
                  className={`w-full px-2 py-1.5 rounded border text-[11px] font-bold uppercase transition-colors ${
                    viewerFollowSelected
                      ? 'border-cyan-700 bg-cyan-900/25 text-cyan-300'
                      : 'border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  {viewerFollowSelected ? 'Follow ON' : 'Follow OFF'}
                </button>

                <label className="block text-[10px] text-zinc-500 uppercase font-bold">
                  Motivo da acao
                </label>
                <input
                  type="text"
                  value={viewerActionReason}
                  maxLength={VIEWER_ACTION_REASON_MAX_LENGTH}
                  onChange={(event) => setViewerActionReason(event.target.value)}
                  placeholder="Acao via painel WebViewer 3D"
                  className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-100 focus:outline-none focus:ring-2 focus:ring-cyan-700"
                />

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => dispatchViewerAction('KICK')}
                    disabled={viewerActionsDisabled}
                    className="px-2 py-1.5 rounded border border-red-800 bg-red-900/20 text-red-300 text-[11px] font-bold uppercase disabled:opacity-50"
                  >
                    Kick
                  </button>
                  <button
                    onClick={() => dispatchViewerAction('MUTE_10M')}
                    disabled={viewerActionsDisabled}
                    className="px-2 py-1.5 rounded border border-yellow-800 bg-yellow-900/20 text-yellow-300 text-[11px] font-bold uppercase disabled:opacity-50"
                  >
                    Mute 10m
                  </button>
                  <button
                    onClick={() => dispatchViewerAction('GAG_10M')}
                    disabled={viewerActionsDisabled}
                    className="px-2 py-1.5 rounded border border-orange-800 bg-orange-900/20 text-orange-300 text-[11px] font-bold uppercase disabled:opacity-50"
                  >
                    Gag 10m
                  </button>
                  <button
                    onClick={() => dispatchViewerAction('UNMUTE')}
                    disabled={viewerActionsDisabled}
                    className="px-2 py-1.5 rounded border border-emerald-800 bg-emerald-900/20 text-emerald-300 text-[11px] font-bold uppercase disabled:opacity-50"
                  >
                    Unmute
                  </button>
                  <button
                    onClick={() => dispatchViewerAction('UNGAG')}
                    disabled={viewerActionsDisabled}
                    className="col-span-2 px-2 py-1.5 rounded border border-emerald-800 bg-emerald-900/20 text-emerald-300 text-[11px] font-bold uppercase disabled:opacity-50"
                  >
                    Ungag
                  </button>
                </div>

                {!hasFreshViewerSnapshot && (
                  <div className="rounded border border-yellow-900/50 bg-yellow-900/10 px-2 py-1.5 text-[10px] text-yellow-300">
                    Acoes bloqueadas: snapshot stale/desconectado.
                  </div>
                )}

                {viewerActionError && (
                  <div className="rounded border border-red-900/50 bg-red-900/10 px-2 py-1.5 text-[10px] text-red-300">
                    {viewerActionError}
                  </div>
                )}

                {viewerActionForSelected && (
                  <div className="rounded border border-zinc-700 bg-zinc-900/60 px-2 py-2 text-[10px] space-y-1">
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
                    <div className="text-zinc-500 font-mono truncate">actionId: {viewerActionForSelected.actionId}</div>
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
          </div>

          <div className="rounded border border-zinc-800 bg-zinc-900 p-3">
            <p className="text-zinc-500 uppercase font-bold text-[11px] mb-2">Logs</p>
            <div className="max-h-[260px] overflow-y-auto space-y-1 text-[11px] font-mono text-zinc-300">
              {!streamingLogs.length && <p className="text-zinc-500">Sem logs ainda...</p>}
              {streamingLogs.map((line, idx) => (
                <p key={`${line}_${idx}`}>{line}</p>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded border border-zinc-800 bg-zinc-950 p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-zinc-500 uppercase font-bold text-[11px]">Diagnostico de assets (missing/errors)</p>
          <span className="text-[10px] text-zinc-400 font-mono">entries={diagnostics.length}</span>
        </div>
        <div className="max-h-[280px] overflow-y-auto space-y-2 text-[11px] font-mono">
          {!diagnostics.length && <p className="text-zinc-500">Sem diagnosticos ainda.</p>}
          {diagnostics.map((item) => (
            <div
              key={item.id}
              className={`rounded border px-2 py-1.5 ${
                item.level === 'error'
                  ? 'border-red-900/70 bg-red-950/20 text-red-200'
                  : 'border-yellow-900/60 bg-yellow-950/20 text-yellow-200'
              }`}
            >
              <p>
                [{item.level.toUpperCase()}] {item.code} x{item.count}
              </p>
              <p className="break-all">
                {item.assetType}:{item.assetId}
              </p>
              <p className="text-zinc-300 break-words">{item.message}</p>
              {item.searchedIn.length > 0 && (
                <p className="text-zinc-400 break-all">
                  searchedIn: {item.searchedIn.join(' | ')}
                </p>
              )}
              <p className="text-zinc-500">
                first={new Date(item.firstSeenAt).toLocaleTimeString('pt-BR')} last={new Date(item.lastSeenAt).toLocaleTimeString('pt-BR')}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ServerView3D;

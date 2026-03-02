import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Icons } from '../../components/Icon';
import { ServerViewerStatePlayer, ServerViewerStateSnapshot } from '../../types';

type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type ChunkEntry = {
  id: string;
  url: string;
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
    prefetchRadiusChunks?: number;
    discardRadiusChunks?: number;
    gracePeriodMs?: number;
  };
  assets: {
    base?: Array<{ id: string; url: string; format: string }>;
    materials?: {
      indexUrl: string;
    };
    chunks: {
      lod0IndexUrl: string;
      format: string;
    };
  };
};

type MaterialIndex = {
  generatedAt: string;
  total: number;
  materials: Array<{
    id: string;
    material: string;
    placeholder: boolean;
    status: string;
    textureUrl?: string;
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
  cameraCell: { x: number; y: number };
  firstActiveLoadMs: number | null;
};

type ViewerWsStatus = 'idle' | 'connecting' | 'connected' | 'subscribed' | 'error';

const VIEWER_STATE_STALE_SECONDS = 8;
const VIEWER_RECONNECT_BASE_MS = 1000;
const VIEWER_RECONNECT_MAX_MS = 15000;
const PLAYER_MARKER_HEIGHT = 30;
const PLAYER_MARKER_SMOOTH_RATE = 10;
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

const disposeObject3D = (root: THREE.Object3D) => {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    const points = obj as THREE.Points;

    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    if (points.geometry) {
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
  const [runtimeStats, setRuntimeStats] = useState<RuntimeStats>({
    loadedChunks: 0,
    visibleChunks: 0,
    loadedTrisEstimate: 0,
    loadedBytesEstimate: 0,
    cameraCell: { x: 0, y: 0 },
    firstActiveLoadMs: null,
  });
  const [streamingLogs, setStreamingLogs] = useState<string[]>([]);
  const viewerStateRef = useRef<ServerViewerStateSnapshot | null>(null);

  const viewerPlayers = useMemo(
    () =>
      [...(viewerState?.players || [])].sort((left, right) =>
        String(left.name || left.steamId || '')
          .toLowerCase()
          .localeCompare(String(right.name || right.steamId || '').toLowerCase()),
      ),
    [viewerState],
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

  useEffect(() => {
    viewerStateRef.current = viewerState;
  }, [viewerState]);

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

    let cancelled = false;
    let animationFrameId = 0;
    let streamIntervalMs = 0;
    let playerSyncIntervalMs = 0;
    let lastFrameAtMs = performance.now();
    let hostResizeObserver: ResizeObserver | null = null;
    let warmupResizeTimer: number | null = null;
    let startedAt = performance.now();
    let firstActiveLoadMs: number | null = null;

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
      group: THREE.Group;
      touchedAtMs: number;
      tris: number;
      bytes: number;
      drawCalls: number;
    }>();
    const loadingChunkIds = new Set<string>();
    const textureLoader = new THREE.TextureLoader();
    const textureCache = new Map<string, THREE.Texture | null>();
    const textureLoading = new Set<string>();
    const pendingMaterialBindings = new Map<string, Set<THREE.MeshStandardMaterial>>();
    const materialDefs = new Map<string, { placeholder: boolean; textureUrl?: string }>();
    const playerGeometry = new THREE.SphereGeometry(20, 14, 12);
    const playerMarkers = new Map<string, {
      mesh: THREE.Mesh;
      targetPosition: THREE.Vector3;
      lastSeenAtMs: number;
    }>();
    let lastPlayerSnapshotKey = '';

    const getWorldMaterial = (materialIdRaw: string, placeholderFlag: boolean): THREE.MeshStandardMaterial => {
      const materialId = String(materialIdRaw || '__missing_material');
      const def = materialDefs.get(materialId);
      const shouldPlaceholder = placeholderFlag || !def || def.placeholder || !def.textureUrl;
      const baseColor = shouldPlaceholder ? new THREE.Color(0x6b7280) : hashColor(materialId, 0.92);
      const material = new THREE.MeshStandardMaterial({
        color: baseColor,
        metalness: 0.04,
        roughness: 0.94,
        side: THREE.DoubleSide,
      });

      if (!shouldPlaceholder && def?.textureUrl) {
        const textureUrl = toAssetUrl(manifestUrl, def.textureUrl);
        const cachedTexture = textureCache.get(textureUrl);
        if (cachedTexture) {
          material.map = cachedTexture;
          material.color.set(0xffffff);
          material.needsUpdate = true;
        } else if (cachedTexture !== null) {
          const pending = pendingMaterialBindings.get(textureUrl) || new Set<THREE.MeshStandardMaterial>();
          pending.add(material);
          pendingMaterialBindings.set(textureUrl, pending);

          if (!textureLoading.has(textureUrl)) {
            textureLoading.add(textureUrl);
            textureLoader.load(
              textureUrl,
              (texture) => {
                texture.wrapS = THREE.RepeatWrapping;
                texture.wrapT = THREE.RepeatWrapping;
                texture.colorSpace = THREE.SRGBColorSpace;
                texture.anisotropy = 4;
                textureCache.set(textureUrl, texture);
                textureLoading.delete(textureUrl);
                const waiting = pendingMaterialBindings.get(textureUrl);
                if (waiting) {
                  for (const mat of waiting) {
                    mat.map = texture;
                    mat.color.set(0xffffff);
                    mat.needsUpdate = true;
                  }
                }
                pendingMaterialBindings.delete(textureUrl);
              },
              undefined,
              () => {
                textureCache.set(textureUrl, null);
                textureLoading.delete(textureUrl);
                pendingMaterialBindings.delete(textureUrl);
              },
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
      textureLoading.clear();
      pendingMaterialBindings.clear();
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
          markerMesh.position.copy(sourcePos);
          markerMesh.frustumCulled = true;
          playersRoot.add(markerMesh);
          marker = {
            mesh: markerMesh,
            targetPosition: sourcePos.clone(),
            lastSeenAtMs: now,
          };
          playerMarkers.set(steamId, marker);
        } else {
          marker.targetPosition.copy(sourcePos);
          marker.lastSeenAtMs = now;
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
    };

    const loadChunkGroup = async (entry: ChunkEntry): Promise<void> => {
      if (chunkRecords.has(entry.id) || loadingChunkIds.has(entry.id)) return;
      loadingChunkIds.add(entry.id);
      try {
        const payload = await readJson<ChunkPayload>(toAssetUrl(manifestUrl, entry.url));
        if (cancelled) return;

        const group = new THREE.Group();
        group.name = `chunk_${entry.id}`;

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

        const props = Array.isArray(payload.props?.instances) ? payload.props.instances : [];
        if (props.length > 0) {
          const byModel = new Map<string, typeof props>();
          for (const instance of props) {
            const key = String(instance.model || '__placeholder_box__');
            const arr = byModel.get(key) || [];
            arr.push(instance);
            byModel.set(key, arr);
          }

          for (const [model, instances] of byModel.entries()) {
            const placeholder = instances.some((item) => item.placeholderModel);
            const color = placeholder ? new THREE.Color(0xdc2626) : hashColor(model, 0.9);
            const boxGeo = new THREE.BoxGeometry(34, 72, 34);
            const boxMat = new THREE.MeshStandardMaterial({
              color,
              metalness: 0.08,
              roughness: 0.9,
              opacity: placeholder ? 0.72 : 0.85,
              transparent: true,
            });
            const instanced = new THREE.InstancedMesh(boxGeo, boxMat, instances.length);
            instanced.frustumCulled = true;

            const tmpPosition = new THREE.Vector3();
            const tmpQuaternion = new THREE.Quaternion();
            const tmpScale = new THREE.Vector3();
            const tmpMatrix = new THREE.Matrix4();
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
            group.add(instanced);
          }
        }

        group.visible = false;
        chunkRoot.add(group);

        chunkRecords.set(entry.id, {
          entry,
          group,
          touchedAtMs: performance.now(),
          tris: Math.max(0, Number(payload.stats?.totalTris || entry.stats?.totalTris || 0)),
          bytes: Math.max(0, Number(payload.stats?.totalBytes || entry.stats?.totalBytes || 0)),
          drawCalls: Math.max(0, Number(payload.stats?.drawCallsAfterInstancing || entry.stats?.drawCallsAfterInstancing || 0)),
        });

        appendLog(`chunk carregado: ${entry.id}`);
      } catch (loadErr: any) {
        appendLog(`erro ao carregar chunk ${entry.id}: ${String(loadErr?.message || loadErr)}`);
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

        if (loadedManifest.assets.materials?.indexUrl) {
          try {
            const materialIndexUrl = toAssetUrl(manifestUrl, loadedManifest.assets.materials.indexUrl);
            const materialIndex = await readJson<MaterialIndex>(materialIndexUrl);
            if (!cancelled) {
              for (const item of materialIndex.materials || []) {
                const key = String(item.material || item.id || '').trim();
                if (!key) continue;
                materialDefs.set(key, {
                  placeholder: !!item.placeholder,
                  ...(item.textureUrl ? { textureUrl: item.textureUrl } : {}),
                });
              }
              appendLog(`materials index carregado: total=${materialDefs.size}`);
            }
          } catch (materialErr: any) {
            appendLog(`materials index indisponivel: ${String(materialErr?.message || materialErr)}`);
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
        const prefetchRadius = Math.max(activeRadius, Number(loadedManifest.streaming?.prefetchRadiusChunks || 2));
        const discardRadius = Math.max(prefetchRadius, Number(loadedManifest.streaming?.discardRadiusChunks || prefetchRadius));
        const gracePeriodMs = Math.max(1000, Number(loadedManifest.streaming?.gracePeriodMs || 4000));

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
          const prefetchIds = new Set<string>();
          const keepIds = new Set<string>();

          for (const entry of entries) {
            const cell = chunkCells.get(entry.id) || { x: 0, y: 0 };
            const dx = Math.abs(cell.x - cameraCell.x);
            const dy = Math.abs(cell.y - cameraCell.y);
            if (dx <= activeRadius && dy <= activeRadius) {
              activeIds.add(entry.id);
            }
            if (dx <= prefetchRadius && dy <= prefetchRadius) {
              prefetchIds.add(entry.id);
            }
            if (dx <= discardRadius && dy <= discardRadius) {
              keepIds.add(entry.id);
            }
          }

          for (const chunkId of prefetchIds) {
            const entry = byId.get(chunkId);
            if (!entry) continue;
            void loadChunkGroup(entry);
          }

          for (const [chunkId, record] of chunkRecords.entries()) {
            if (activeIds.has(chunkId)) {
              record.group.visible = true;
              record.touchedAtMs = now;
            } else {
              record.group.visible = false;
            }

            if (keepIds.has(chunkId)) continue;
            if (now - record.touchedAtMs < gracePeriodMs) continue;

            chunkRoot.remove(record.group);
            disposeObject3D(record.group);
            chunkRecords.delete(chunkId);
            appendLog(`chunk descarregado: ${chunkId}`);
          }

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
            cameraCell,
            firstActiveLoadMs,
          });
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

          controls.update();
          renderer.render(scene, camera);
          if (now - streamIntervalMs >= 300) {
            streamIntervalMs = now;
            updateStreaming();
          }
        };

        onResize();
        window.addEventListener('resize', onResize);
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
        appendLog(`chunk_count=${entries.length} active=${activeRadius * 2 + 1}x${activeRadius * 2 + 1} prefetch=${prefetchRadius * 2 + 1}x${prefetchRadius * 2 + 1}`);

        return () => {
          window.removeEventListener('resize', onResize);
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
      }
      chunkRecords.clear();
      clearPlayerMarkers();
      playerGeometry.dispose();
      disposeTextureCache();
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
        <div className="lg:col-span-3 rounded border border-zinc-800 bg-zinc-950 overflow-hidden">
          <div ref={mountRef} className="h-[62vh] w-full" />
        </div>

        <div className="space-y-3">
          <div className="rounded border border-zinc-800 bg-zinc-900 p-3 text-xs text-zinc-300 space-y-1">
            <p className="text-zinc-500 uppercase font-bold text-[11px]">Streaming</p>
            <p>cameraCell: {runtimeStats.cameraCell.x}:{runtimeStats.cameraCell.y}</p>
            <p>loadedChunks: {runtimeStats.loadedChunks}</p>
            <p>visibleChunks: {runtimeStats.visibleChunks}</p>
            <p>loadedTris(est): {runtimeStats.loadedTrisEstimate.toLocaleString('pt-BR')}</p>
            <p>loadedBytes(est): {Math.round(runtimeStats.loadedBytesEstimate / (1024 * 1024)).toLocaleString('pt-BR')} MB</p>
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
            <div className="max-h-[160px] overflow-y-auto space-y-1 pt-1 border-t border-zinc-800">
              {!viewerPlayers.length && <p className="text-zinc-500">Sem players no frame.</p>}
              {viewerPlayers.slice(0, 20).map((player) => (
                <p key={player.steamId} className="font-mono">
                  {player.name || player.steamId} [{player.alive === false ? 'dead' : 'alive'}]
                </p>
              ))}
            </div>
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
    </div>
  );
};

export default ServerView3D;

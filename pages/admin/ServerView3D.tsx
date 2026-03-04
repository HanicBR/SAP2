import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SAOPass } from 'three/examples/jsm/postprocessing/SAOPass.js';
import { Icons } from '../../components/Icon';
import { ApiService } from '../../services/api';
import {
  ServerViewerActionStatusResponse,
  ServerViewerActionType,
  ServerViewerStatePlayer,
  ServerViewerStateSnapshot,
  WorkshopManualEnqueueResponse,
  WorkshopQueueJob,
  WorkshopQueueSnapshotResponse,
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
    materialKind?: 'default' | 'tool' | 'sky' | 'water';
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
  playersTotalInFrame: number;
  playersRendered: number;
  playersCulled: number;
  playersFilteredOut: number;
  playerUpdateRateHz: number;
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

type ManifestProbe = {
  url: string;
  checkedAt: string;
  ok: boolean;
  httpStatus?: number;
  contentType?: string;
  preview?: string;
  error?: string;
};

type ViewerWsStatus = 'idle' | 'connecting' | 'connected' | 'subscribed' | 'error';
type ViewerRenderProfile = 'simple' | 'polished';

const VIEWER_STATE_STALE_SECONDS = 8;
const VIEWER_RECONNECT_BASE_MS = 1000;
const VIEWER_RECONNECT_MAX_MS = 15000;
const VIEWER_ACTION_STATUS_POLL_INTERVAL_MS = 1200;
const VIEWER_ACTION_STATUS_MAX_POLLS = 18;
const VIEWER_ACTION_REASON_MAX_LENGTH = 160;
const PLAYER_MARKER_HEIGHT = 30;
const PLAYER_MARKER_SMOOTH_RATE = 10;
const PLAYER_MARKER_SELECTED_SCALE = 1.45;
const PLAYER_MARKER_MAX_RENDER_DISTANCE = 9000;
const PLAYER_MARKER_MAX_RENDER_DISTANCE_SQ = PLAYER_MARKER_MAX_RENDER_DISTANCE * PLAYER_MARKER_MAX_RENDER_DISTANCE;
const PLAYER_MARKER_EXTRAPOLATION_MAX_MS = 250;
const PLAYER_MARKER_ROTATION_SMOOTH_RATE = 14;
const PLAYER_MARKER_LABEL_HEIGHT = 126;
const FOLLOW_CAMERA_DISTANCE = 520;
const FOLLOW_CAMERA_HEIGHT = 220;
const FOLLOW_CAMERA_SMOOTH_RATE = 6;
const CAMERA_MOVE_SPEED = 1800;
const CAMERA_MOVE_FAST_MULTIPLIER = 2.25;
const CAMERA_MOVE_SLOW_MULTIPLIER = 0.5;
const CAMERA_FREE_LOOK_SENSITIVITY = 0.0026;
const CAMERA_FREE_LOOK_MAX_UP_DOT = 0.985;
const CAMERA_TOUCH_LOOK_MULTIPLIER = 1.2;
const MOBILE_JOYSTICK_DEADZONE = 0.08;
const MODEL_CACHE_MAX_BYTES = 220 * 1024 * 1024;
const MODEL_CACHE_EVICT_GRACE_MS = 18000;
const MODEL_CACHE_SWEEP_INTERVAL_MS = 1800;
const VIEWER_POLISH_SAO_ENABLED = true;
const VIEWER_FOG_DENSITY = 0.000022;
const WATER_NORMAL_SCROLL_X = 0.012;
const WATER_NORMAL_SCROLL_Y = 0.007;
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

const normalizeMaterialKey = (raw: string): string => {
  const value = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/^\//, '')
    .replace(/^materials\//, '');
  if (value.endsWith('.vmt')) return value.slice(0, -4);
  if (value.endsWith('.vtf')) return value.slice(0, -4);
  return value;
};

const inferMaterialKind = (raw: string, kindHint?: string): 'default' | 'tool' | 'sky' | 'water' => {
  const hinted = String(kindHint || '').trim().toLowerCase();
  if (hinted === 'default' || hinted === 'tool' || hinted === 'sky' || hinted === 'water') {
    return hinted;
  }
  const key = normalizeMaterialKey(raw);
  if (!key) return 'default';
  if (key.startsWith('tools/') || key.startsWith('editor/')) return 'tool';
  if (key.includes('toolsskybox') || key.includes('skybox') || key.includes('/sky') || key.startsWith('sky')) return 'sky';
  if (key.includes('water') || key.includes('river') || key.includes('ocean') || key.includes('slime')) return 'water';
  return 'default';
};

const isSpecialMaterial = (raw: string, kindHint?: string): boolean => inferMaterialKind(raw, kindHint) !== 'default';
const isSkyMaterial = (raw: string, kindHint?: string): boolean => inferMaterialKind(raw, kindHint) === 'sky';
const isWaterMaterial = (raw: string, kindHint?: string): boolean => inferMaterialKind(raw, kindHint) === 'water';
const isToolMaterial = (raw: string, kindHint?: string): boolean => inferMaterialKind(raw, kindHint) === 'tool';

const shouldSuppressMaterialDiagnostic = (materialId: string, statusRaw: string): boolean => {
  const status = String(statusRaw || '').trim().toLowerCase();
  if (!status) return false;
  if (status.endsWith('_special')) return true;
  if (status === 'special_error' && isSpecialMaterial(materialId)) return true;
  if (
    isSpecialMaterial(materialId)
    && (status === 'missing_vmt' || status === 'missing_vtf' || status === 'no_basetexture')
  ) {
    return true;
  }
  return false;
};

const createSkyGradientTexture = (): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const fallback = new THREE.CanvasTexture(canvas);
    fallback.colorSpace = THREE.SRGBColorSpace;
    fallback.mapping = THREE.EquirectangularReflectionMapping;
    return fallback;
  }

  const skyGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  skyGrad.addColorStop(0.0, '#6f9fdb');
  skyGrad.addColorStop(0.42, '#87b0e6');
  skyGrad.addColorStop(0.68, '#a6c2e8');
  skyGrad.addColorStop(1.0, '#d8d0bf');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const sun = ctx.createRadialGradient(
    Math.floor(canvas.width * 0.77),
    Math.floor(canvas.height * 0.24),
    14,
    Math.floor(canvas.width * 0.77),
    Math.floor(canvas.height * 0.24),
    165,
  );
  sun.addColorStop(0.0, 'rgba(255, 250, 220, 0.95)');
  sun.addColorStop(0.35, 'rgba(255, 243, 190, 0.42)');
  sun.addColorStop(1.0, 'rgba(255, 243, 190, 0.0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
};

const createWaterNormalTexture = (): THREE.DataTexture => {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = (y * size + x) * 4;
      const nx = 128 + Math.floor((Math.random() - 0.5) * 34);
      const ny = 128 + Math.floor((Math.random() - 0.5) * 34);
      data[idx + 0] = Math.max(0, Math.min(255, nx));
      data[idx + 1] = Math.max(0, Math.min(255, ny));
      data[idx + 2] = 255;
      data[idx + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 6);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
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

const getViewerPlayerTeamKey = (entry: Pick<ServerViewerStatePlayer, 'teamId' | 'teamName'>): string => {
  const teamId = Number(entry.teamId);
  if (Number.isFinite(teamId)) return `id:${Math.floor(teamId)}`;
  const teamName = String(entry.teamName || '').trim();
  if (teamName) return `name:${teamName.toLowerCase()}`;
  return 'unknown';
};

const getViewerPlayerTeamLabel = (entry: Pick<ServerViewerStatePlayer, 'teamId' | 'teamName'>): string => {
  const teamId = Number(entry.teamId);
  const teamName = String(entry.teamName || '').trim();
  if (teamName && Number.isFinite(teamId)) return `${teamName} (#${Math.floor(teamId)})`;
  if (teamName) return teamName;
  if (Number.isFinite(teamId)) return `Team #${Math.floor(teamId)}`;
  return 'Sem time';
};

const matchViewerPlayerFilters = (
  entry: Pick<ServerViewerStatePlayer, 'alive' | 'teamId' | 'teamName'>,
  aliveFilter: 'all' | 'alive' | 'dead',
  teamFilter: string,
): boolean => {
  if (aliveFilter === 'alive' && entry.alive === false) return false;
  if (aliveFilter === 'dead' && entry.alive !== false) return false;
  if (teamFilter !== 'all' && getViewerPlayerTeamKey(entry) !== teamFilter) return false;
  return true;
};

const lerpAngleRad = (from: number, to: number, alpha: number): number => {
  const normAlpha = Math.max(0, Math.min(1, alpha));
  const rawDelta = to - from;
  const delta = ((rawDelta + Math.PI) % (Math.PI * 2) + (Math.PI * 2)) % (Math.PI * 2) - Math.PI;
  return from + delta * normAlpha;
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

const VIEWER_RENDER_PROFILE_STORAGE_KEY = 'backstabber_viewer3d_render_profile';
const VIEWER_MOVE_SPEED_STORAGE_KEY = 'backstabber_viewer3d_move_speed_factor';
const VIEWER_MOVE_SPEED_MIN = 0.4;
const VIEWER_MOVE_SPEED_MAX = 6;
const VIEWER_MOVE_SPEED_DEFAULT = 1.25;

const clampMoveSpeedFactor = (value: number): number =>
  Math.min(VIEWER_MOVE_SPEED_MAX, Math.max(VIEWER_MOVE_SPEED_MIN, value));

const detectMobileControlsPreferred = (): boolean => {
  if (typeof window === 'undefined') return false;
  const smallViewport = window.matchMedia('(max-width: 1024px)').matches;
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const hasTouch = Number(window.navigator.maxTouchPoints || 0) > 0;
  return smallViewport || coarsePointer || hasTouch;
};

const applyAnalogDeadzone = (value: number, deadzone: number): number => {
  const abs = Math.abs(value);
  if (abs <= deadzone) return 0;
  const scaled = (abs - deadzone) / (1 - deadzone);
  return Math.sign(value) * Math.min(1, Math.max(0, scaled));
};

const readInitialRenderProfile = (): ViewerRenderProfile => {
  if (typeof window === 'undefined') return 'simple';
  try {
    const raw = String(window.localStorage.getItem(VIEWER_RENDER_PROFILE_STORAGE_KEY) || '').trim().toLowerCase();
    if (raw === 'polished') return 'polished';
  } catch {
    // ignore storage errors
  }
  return 'simple';
};

const readInitialMoveSpeedFactor = (): number => {
  if (typeof window === 'undefined') return VIEWER_MOVE_SPEED_DEFAULT;
  try {
    const raw = Number(window.localStorage.getItem(VIEWER_MOVE_SPEED_STORAGE_KEY) || VIEWER_MOVE_SPEED_DEFAULT);
    if (Number.isFinite(raw)) return clampMoveSpeedFactor(raw);
  } catch {
    // ignore storage errors
  }
  return VIEWER_MOVE_SPEED_DEFAULT;
};

const ServerView3D: React.FC = () => {
  const { serverId } = useParams<{ serverId: string }>();
  const [searchParams] = useSearchParams();
  const mapName = useMemo(() => normalizeMapName(searchParams.get('map')), [searchParams]);
  const manifestUrl = useMemo(() => `/api/maps/${encodeURIComponent(mapName)}/manifest.json`, [mapName]);
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
    playersTotalInFrame: 0,
    playersRendered: 0,
    playersCulled: 0,
    playersFilteredOut: 0,
    playerUpdateRateHz: 0,
    cameraCell: { x: 0, y: 0 },
    firstActiveLoadMs: null,
  });
  const [streamingLogs, setStreamingLogs] = useState<string[]>([]);
  const [diagnostics, setDiagnostics] = useState<ViewerDiagnostic[]>([]);
  const [queueSnapshot, setQueueSnapshot] = useState<WorkshopQueueSnapshotResponse | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [queueLoading, setQueueLoading] = useState<boolean>(false);
  const [manualWorkshopId, setManualWorkshopId] = useState<string>('');
  const [manualEnqueueBusy, setManualEnqueueBusy] = useState<boolean>(false);
  const [manualEnqueueResult, setManualEnqueueResult] = useState<WorkshopManualEnqueueResponse | null>(null);
  const [manifestProbe, setManifestProbe] = useState<ManifestProbe | null>(null);
  const [renderProfile, setRenderProfile] = useState<ViewerRenderProfile>(() => readInitialRenderProfile());
  const [viewerSideTab, setViewerSideTab] = useState<'streaming' | 'players' | 'logs'>('streaming');
  const [showDevTools, setShowDevTools] = useState<boolean>(false);
  const [showViewerSettings, setShowViewerSettings] = useState<boolean>(false);
  const [showViewerHudLiveChip, setShowViewerHudLiveChip] = useState<boolean>(true);
  const [showViewerHudFpsChip, setShowViewerHudFpsChip] = useState<boolean>(true);
  const [showViewerHudSelectedPlayer, setShowViewerHudSelectedPlayer] = useState<boolean>(true);
  const [mobileControlsEnabled, setMobileControlsEnabled] = useState<boolean>(() => detectMobileControlsPreferred());
  const [mobileMoveKnob, setMobileMoveKnob] = useState<{ x: number; y: number; active: boolean }>({
    x: 0,
    y: 0,
    active: false,
  });
  const [mobileLookActive, setMobileLookActive] = useState<boolean>(false);
  const [mobileBoostEnabled, setMobileBoostEnabled] = useState<boolean>(false);
  const [mobileAscendPressed, setMobileAscendPressed] = useState<boolean>(false);
  const [mobileDescendPressed, setMobileDescendPressed] = useState<boolean>(false);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [moveSpeedFactor, setMoveSpeedFactor] = useState<number>(() => readInitialMoveSpeedFactor());
  const [playerAliveFilter, setPlayerAliveFilter] = useState<'all' | 'alive' | 'dead'>('all');
  const [playerTeamFilter, setPlayerTeamFilter] = useState<string>('all');
  const [showPlayerLabels, setShowPlayerLabels] = useState<boolean>(false);
  const [showPlayerHealthInLabel, setShowPlayerHealthInLabel] = useState<boolean>(false);
  const viewerStateRef = useRef<ServerViewerStateSnapshot | null>(null);
  const viewerSelectedSteamIdRef = useRef<string | null>(null);
  const viewerFollowSelectedRef = useRef<boolean>(false);
  const playerAliveFilterRef = useRef<'all' | 'alive' | 'dead'>('all');
  const playerTeamFilterRef = useRef<string>('all');
  const showPlayerLabelsRef = useRef<boolean>(false);
  const showPlayerHealthInLabelRef = useRef<boolean>(false);
  const moveSpeedFactorRef = useRef<number>(moveSpeedFactor);
  const viewerActionPollTokenRef = useRef<number>(0);
  const mobileMovePadRef = useRef<HTMLDivElement | null>(null);
  const mobileMovePointerIdRef = useRef<number | null>(null);
  const mobileLookPadPointerRef = useRef<{ pointerId: number | null; lastX: number; lastY: number }>({
    pointerId: null,
    lastX: 0,
    lastY: 0,
  });
  const mobileAscendPointerIdRef = useRef<number | null>(null);
  const mobileDescendPointerIdRef = useRef<number | null>(null);
  const mobileMoveInputRef = useRef<{ x: number; y: number; vertical: number; boost: boolean }>({
    x: 0,
    y: 0,
    vertical: 0,
    boost: false,
  });
  const applyViewerLookDeltaRef = useRef<(deltaX: number, deltaY: number) => void>(() => undefined);

  const viewerPlayers = useMemo(
    () =>
      [...(viewerState?.players || [])].sort((left, right) =>
        String(left.name || left.steamId || '')
          .toLowerCase()
          .localeCompare(String(right.name || right.steamId || '').toLowerCase()),
      ),
    [viewerState],
  );

  const viewerTeamOptions = useMemo(() => {
    const grouped = new Map<string, { value: string; label: string; count: number }>();
    for (const player of viewerPlayers) {
      const value = getViewerPlayerTeamKey(player);
      const label = getViewerPlayerTeamLabel(player);
      const current = grouped.get(value) || { value, label, count: 0 };
      current.count += 1;
      grouped.set(value, current);
    }
    return Array.from(grouped.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [viewerPlayers]);

  const filteredViewerPlayers = useMemo(
    () =>
      viewerPlayers.filter((entry) => matchViewerPlayerFilters(entry, playerAliveFilter, playerTeamFilter)),
    [playerAliveFilter, playerTeamFilter, viewerPlayers],
  );

  const selectedViewerPlayer = useMemo(
    () => filteredViewerPlayers.find((entry) => entry.steamId === viewerSelectedSteamId) || null,
    [filteredViewerPlayers, viewerSelectedSteamId],
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

  const mapQueueJobs = useMemo<WorkshopQueueJob[]>(
    () =>
      (queueSnapshot?.jobs || [])
        .filter((job) => String(job.mapName || '').trim().toLowerCase() === mapName.toLowerCase())
        .slice(0, 12),
    [mapName, queueSnapshot],
  );
  const viewerStreamingRows = useMemo(
    () => [
      { label: 'cameraCell', value: `${runtimeStats.cameraCell.x}:${runtimeStats.cameraCell.y}` },
      { label: 'loadedChunks', value: runtimeStats.loadedChunks.toLocaleString('pt-BR') },
      { label: 'visibleChunks', value: runtimeStats.visibleChunks.toLocaleString('pt-BR') },
      { label: 'loadedTris(est)', value: runtimeStats.loadedTrisEstimate.toLocaleString('pt-BR') },
      { label: 'loadedBytes(est)', value: `${Math.round(runtimeStats.loadedBytesEstimate / (1024 * 1024)).toLocaleString('pt-BR')} MB` },
      { label: 'textureCache', value: `${runtimeStats.textureCacheCount.toLocaleString('pt-BR')} texturas` },
      { label: 'textureCacheBytes', value: `${Math.round(runtimeStats.textureCacheBytesEstimate / (1024 * 1024)).toLocaleString('pt-BR')} MB` },
      { label: 'modelCache', value: `${runtimeStats.modelCacheCount.toLocaleString('pt-BR')} modelos` },
      { label: 'modelCacheBytes', value: `${Math.round(runtimeStats.modelCacheBytesEstimate / (1024 * 1024)).toLocaleString('pt-BR')} MB` },
      { label: 'playersRendered', value: `${runtimeStats.playersRendered}/${runtimeStats.playersTotalInFrame}` },
      { label: 'playersCulled', value: `${runtimeStats.playersCulled} | filtered: ${runtimeStats.playersFilteredOut}` },
      { label: 'playerUpdateRate', value: `${runtimeStats.playerUpdateRateHz.toFixed(1)} Hz` },
      { label: 'firstActiveLoadMs', value: runtimeStats.firstActiveLoadMs === null ? 'n/a' : runtimeStats.firstActiveLoadMs.toLocaleString('pt-BR') },
    ],
    [runtimeStats],
  );
  const viewerChunkVisibilityPct = useMemo(
    () => Math.max(8, Math.min(100, (runtimeStats.visibleChunks / Math.max(1, runtimeStats.loadedChunks || 1)) * 100)),
    [runtimeStats.loadedChunks, runtimeStats.visibleChunks],
  );
  const viewerFpsLabel = hasFreshViewerSnapshot ? '60 FPS' : '-- FPS';
  const moveSpeedUnitsPerSec = Math.round(CAMERA_MOVE_SPEED * moveSpeedFactor);

  const resetMobileMovePad = useCallback(() => {
    mobileMoveInputRef.current.x = 0;
    mobileMoveInputRef.current.y = 0;
    setMobileMoveKnob({ x: 0, y: 0, active: false });
  }, []);

  const updateMobileMoveFromClientPoint = useCallback((clientX: number, clientY: number) => {
    const pad = mobileMovePadRef.current;
    if (!pad) return;
    const rect = pad.getBoundingClientRect();
    const centerX = rect.left + rect.width * 0.5;
    const centerY = rect.top + rect.height * 0.5;
    const radius = Math.max(26, Math.min(rect.width, rect.height) * 0.36);

    let dx = clientX - centerX;
    let dy = clientY - centerY;
    const distance = Math.hypot(dx, dy);
    if (distance > radius) {
      const scale = radius / Math.max(distance, 1e-6);
      dx *= scale;
      dy *= scale;
    }

    const rawX = dx / radius;
    const rawY = dy / radius;
    mobileMoveInputRef.current.x = applyAnalogDeadzone(rawX, MOBILE_JOYSTICK_DEADZONE);
    mobileMoveInputRef.current.y = applyAnalogDeadzone(rawY, MOBILE_JOYSTICK_DEADZONE);
    setMobileMoveKnob({ x: rawX, y: rawY, active: true });
  }, []);

  const handleMobileMovePadPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!mobileControlsEnabled) return;
    if (mobileMovePointerIdRef.current !== null) return;
    event.preventDefault();
    mobileMovePointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateMobileMoveFromClientPoint(event.clientX, event.clientY);
  }, [mobileControlsEnabled, updateMobileMoveFromClientPoint]);

  const handleMobileMovePadPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (mobileMovePointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    updateMobileMoveFromClientPoint(event.clientX, event.clientY);
  }, [updateMobileMoveFromClientPoint]);

  const handleMobileMovePadPointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (mobileMovePointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // no-op
    }
    mobileMovePointerIdRef.current = null;
    resetMobileMovePad();
  }, [resetMobileMovePad]);

  const handleMobileLookPadPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!mobileControlsEnabled) return;
    if (mobileLookPadPointerRef.current.pointerId !== null) return;
    event.preventDefault();
    mobileLookPadPointerRef.current.pointerId = event.pointerId;
    mobileLookPadPointerRef.current.lastX = event.clientX;
    mobileLookPadPointerRef.current.lastY = event.clientY;
    setMobileLookActive(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [mobileControlsEnabled]);

  const handleMobileLookPadPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (mobileLookPadPointerRef.current.pointerId !== event.pointerId) return;
    event.preventDefault();
    const deltaX = event.clientX - mobileLookPadPointerRef.current.lastX;
    const deltaY = event.clientY - mobileLookPadPointerRef.current.lastY;
    mobileLookPadPointerRef.current.lastX = event.clientX;
    mobileLookPadPointerRef.current.lastY = event.clientY;
    if (Math.abs(deltaX) < 0.001 && Math.abs(deltaY) < 0.001) return;
    applyViewerLookDeltaRef.current(deltaX * CAMERA_TOUCH_LOOK_MULTIPLIER, deltaY * CAMERA_TOUCH_LOOK_MULTIPLIER);
  }, []);

  const handleMobileLookPadPointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (mobileLookPadPointerRef.current.pointerId !== event.pointerId) return;
    event.preventDefault();
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // no-op
    }
    mobileLookPadPointerRef.current.pointerId = null;
    setMobileLookActive(false);
  }, []);

  const handleMobileAscendPointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (!mobileControlsEnabled) return;
    if (mobileAscendPointerIdRef.current !== null) return;
    event.preventDefault();
    mobileAscendPointerIdRef.current = event.pointerId;
    setMobileAscendPressed(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [mobileControlsEnabled]);

  const handleMobileAscendPointerEnd = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (mobileAscendPointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // no-op
    }
    mobileAscendPointerIdRef.current = null;
    setMobileAscendPressed(false);
  }, []);

  const handleMobileDescendPointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (!mobileControlsEnabled) return;
    if (mobileDescendPointerIdRef.current !== null) return;
    event.preventDefault();
    mobileDescendPointerIdRef.current = event.pointerId;
    setMobileDescendPressed(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [mobileControlsEnabled]);

  const handleMobileDescendPointerEnd = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (mobileDescendPointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // no-op
    }
    mobileDescendPointerIdRef.current = null;
    setMobileDescendPressed(false);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const viewportQuery = window.matchMedia('(max-width: 1024px)');
    const coarseQuery = window.matchMedia('(pointer: coarse)');
    const sync = () => {
      const hasTouch = Number(window.navigator.maxTouchPoints || 0) > 0;
      setMobileControlsEnabled(viewportQuery.matches || coarseQuery.matches || hasTouch);
    };
    sync();

    const listen = (query: MediaQueryList) => {
      if (typeof query.addEventListener === 'function') {
        query.addEventListener('change', sync);
        return () => query.removeEventListener('change', sync);
      }
      query.addListener(sync);
      return () => query.removeListener(sync);
    };

    const unlistenViewport = listen(viewportQuery);
    const unlistenCoarse = listen(coarseQuery);
    return () => {
      unlistenViewport();
      unlistenCoarse();
    };
  }, []);

  useEffect(() => {
    mobileMoveInputRef.current.boost = mobileBoostEnabled;
  }, [mobileBoostEnabled]);

  useEffect(() => {
    const vertical = (mobileAscendPressed ? 1 : 0) + (mobileDescendPressed ? -1 : 0);
    mobileMoveInputRef.current.vertical = vertical;
  }, [mobileAscendPressed, mobileDescendPressed]);

  useEffect(() => {
    if (mobileControlsEnabled) return;
    mobileMovePointerIdRef.current = null;
    mobileLookPadPointerRef.current.pointerId = null;
    mobileAscendPointerIdRef.current = null;
    mobileDescendPointerIdRef.current = null;
    setMobileLookActive(false);
    setMobileBoostEnabled(false);
    setMobileAscendPressed(false);
    setMobileDescendPressed(false);
    resetMobileMovePad();
  }, [mobileControlsEnabled, resetMobileMovePad]);

  const handleShareViewer = useCallback(async () => {
    const basePath = serverId ? `/admin/servers/${serverId}/view3d` : '/admin/servers';
    const nextParams = new URLSearchParams();
    nextParams.set('map', mapName);
    if (viewerSelectedSteamId) nextParams.set('steamId', viewerSelectedSteamId);
    const shareUrl = `${window.location.origin}${basePath}?${nextParams.toString()}`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: 'Backstabber Web Viewer 3D',
          text: `Viewer do mapa ${mapName}`,
          url: shareUrl,
        });
        setShareFeedback('Compartilhado');
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        setShareFeedback('Link copiado');
      } else {
        throw new Error('share_unavailable');
      }
    } catch {
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(shareUrl);
          setShareFeedback('Link copiado');
          return;
        } catch {
          // fallback below
        }
      }
      setShareFeedback('Falha ao compartilhar');
    }
  }, [mapName, serverId, viewerSelectedSteamId]);

  useEffect(() => {
    if (!shareFeedback) return undefined;
    const timer = window.setTimeout(() => setShareFeedback(null), 1800);
    return () => window.clearTimeout(timer);
  }, [shareFeedback]);

  const loadQueueSnapshot = useCallback(
    async (silent = true) => {
      if (silent) {
        // keep UX smooth during background polling
      } else {
        setQueueLoading(true);
      }
      try {
        const snapshot = await ApiService.getWorkshopQueueSnapshot(240);
        setQueueSnapshot(snapshot);
        setQueueError(null);
      } catch (err: any) {
        setQueueError(String(err?.message || err));
      } finally {
        if (!silent) setQueueLoading(false);
      }
    },
    [],
  );

  const probeManifestWithDetails = useCallback(async (): Promise<Manifest> => {
    const checkedAt = new Date().toISOString();
    try {
      const response = await fetch(manifestUrl, { cache: 'no-store' });
      const contentType = String(response.headers.get('content-type') || '').trim();
      const text = await response.text();
      const compactPreview = String(text || '').replace(/\s+/g, ' ').slice(0, 220).trim();

      if (!response.ok) {
        const message = `manifest_http_${response.status}: ${manifestUrl}`;
        setManifestProbe({
          url: manifestUrl,
          checkedAt,
          ok: false,
          httpStatus: response.status,
          contentType,
          preview: compactPreview,
          error: message,
        });
        throw new Error(message);
      }

      try {
        const parsed = JSON.parse(text) as Manifest;
        setManifestProbe({
          url: manifestUrl,
          checkedAt,
          ok: true,
          httpStatus: response.status,
          contentType,
          preview: compactPreview,
        });
        return parsed;
      } catch (parseErr: any) {
        const message = `manifest_invalid_json: ${String(parseErr?.message || parseErr)}`;
        setManifestProbe({
          url: manifestUrl,
          checkedAt,
          ok: false,
          httpStatus: response.status,
          contentType,
          preview: compactPreview,
          error: message,
        });
        throw new Error(message);
      }
    } catch (err: any) {
      const message = String(err?.message || err);
      setManifestProbe((current) =>
        current && current.checkedAt === checkedAt
          ? current
          : {
              url: manifestUrl,
              checkedAt,
              ok: false,
              error: message,
            },
      );
      throw err;
    }
  }, [manifestUrl]);

  const enqueueManualWorkshopJob = useCallback(async () => {
    if (!mapName) return;
    setManualEnqueueBusy(true);
    setManualEnqueueResult(null);
    try {
      const payload = {
        mapName,
        ...(String(manualWorkshopId || '').trim() ? { workshopId: String(manualWorkshopId).trim() } : {}),
        ...(serverId ? { serverId } : {}),
      };
      const response = await ApiService.enqueueWorkshopJobManual(payload);
      setManualEnqueueResult(response);
      await loadQueueSnapshot(true);
    } catch (err: any) {
      setManualEnqueueResult({
        ok: false,
        queued: false,
        deduped: false,
        reason: 'request_failed',
        error: String(err?.message || err),
      });
    } finally {
      setManualEnqueueBusy(false);
    }
  }, [loadQueueSnapshot, manualWorkshopId, mapName, serverId]);

  useEffect(() => {
    void loadQueueSnapshot(false);
    const interval = window.setInterval(() => {
      void loadQueueSnapshot(true);
    }, 8000);
    return () => window.clearInterval(interval);
  }, [loadQueueSnapshot]);

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
    try {
      window.localStorage.setItem(VIEWER_RENDER_PROFILE_STORAGE_KEY, renderProfile);
    } catch {
      // ignore storage errors
    }
  }, [renderProfile]);

  useEffect(() => {
    const next = clampMoveSpeedFactor(moveSpeedFactor);
    moveSpeedFactorRef.current = next;
    try {
      window.localStorage.setItem(VIEWER_MOVE_SPEED_STORAGE_KEY, String(next));
    } catch {
      // ignore storage errors
    }
  }, [moveSpeedFactor]);

  useEffect(() => {
    playerAliveFilterRef.current = playerAliveFilter;
  }, [playerAliveFilter]);

  useEffect(() => {
    playerTeamFilterRef.current = playerTeamFilter;
  }, [playerTeamFilter]);

  useEffect(() => {
    showPlayerLabelsRef.current = showPlayerLabels;
  }, [showPlayerLabels]);

  useEffect(() => {
    showPlayerHealthInLabelRef.current = showPlayerHealthInLabel;
  }, [showPlayerHealthInLabel]);

  useEffect(() => {
    viewerSelectedSteamIdRef.current = viewerSelectedSteamId;
  }, [viewerSelectedSteamId]);

  useEffect(() => {
    viewerFollowSelectedRef.current = viewerFollowSelected;
  }, [viewerFollowSelected]);

  useEffect(() => {
    if (!filteredViewerPlayers.length) {
      setViewerSelectedSteamId(null);
      setViewerFollowSelected(false);
      return;
    }
    if (viewerSelectedSteamId && !filteredViewerPlayers.some((entry) => entry.steamId === viewerSelectedSteamId)) {
      setViewerSelectedSteamId(filteredViewerPlayers[0].steamId);
      setViewerFollowSelected(false);
    }
  }, [filteredViewerPlayers, viewerSelectedSteamId]);

  useEffect(() => {
    if (playerTeamFilter === 'all') return;
    if (!viewerTeamOptions.some((entry) => entry.value === playerTeamFilter)) {
      setPlayerTeamFilter('all');
    }
  }, [playerTeamFilter, viewerTeamOptions]);

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
    const polishEnabled = renderProfile === 'polished';

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
    renderer.toneMapping = polishEnabled ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    renderer.toneMappingExposure = polishEnabled ? 1.08 : 1;
    renderer.setClearColor(polishEnabled ? 0x0d1a2d : 0x09090b, 1);
    host.innerHTML = '';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = polishEnabled ? new THREE.FogExp2(0x90a5c5, VIEWER_FOG_DENSITY) : null;
    const camera = new THREE.PerspectiveCamera(65, host.clientWidth / Math.max(1, host.clientHeight), 1, 250000);
    let skyTexture: THREE.CanvasTexture | null = null;
    let pmrem: THREE.PMREMGenerator | null = null;
    let skyEnvironment: THREE.WebGLRenderTarget | null = null;
    if (polishEnabled) {
      skyTexture = createSkyGradientTexture();
      scene.background = skyTexture;
      pmrem = new THREE.PMREMGenerator(renderer);
      pmrem.compileEquirectangularShader();
      skyEnvironment = pmrem.fromEquirectangular(skyTexture);
      scene.environment = skyEnvironment.texture;

      const ambient = new THREE.HemisphereLight(0xb3d0ff, 0x252525, 1.12);
      const sun = new THREE.DirectionalLight(0xfff5dc, 1.2);
      sun.position.set(-0.42, 1.28, 0.31).multiplyScalar(6200);
      const fill = new THREE.DirectionalLight(0x8db5f3, 0.35);
      fill.position.set(0.64, 0.46, -0.52).multiplyScalar(4200);
      scene.add(ambient, sun, fill);
    } else {
      const ambient = new THREE.HemisphereLight(0x8aa2ff, 0x101010, 0.95);
      const dir = new THREE.DirectionalLight(0xffffff, 0.65);
      dir.position.set(0.5, 1.2, 0.3).multiplyScalar(5000);
      scene.add(ambient, dir);
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.rotateSpeed = 0.65;
    controls.zoomSpeed = 1;
    controls.panSpeed = 0.55;
    controls.mouseButtons = {
      LEFT: -1,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.PAN,
    };

    let composer: EffectComposer | null = null;
    let saoPass: SAOPass | null = null;
    if (polishEnabled) {
      composer = new EffectComposer(renderer);
      const renderPass = new RenderPass(scene, camera);
      composer.addPass(renderPass);
      try {
        saoPass = new SAOPass(scene, camera, false, true);
        saoPass.enabled = VIEWER_POLISH_SAO_ENABLED;
        saoPass.params.output = SAOPass.OUTPUT.Default;
        saoPass.params.saoBias = 0.35;
        saoPass.params.saoIntensity = 0.006;
        saoPass.params.saoScale = 1.0;
        saoPass.params.saoKernelRadius = 22;
        saoPass.params.saoMinResolution = 0;
        saoPass.params.saoBlur = true;
        saoPass.params.saoBlurRadius = 7;
        saoPass.params.saoBlurStdDev = 3;
        saoPass.params.saoBlurDepthCutoff = 0.01;
        composer.addPass(saoPass);
      } catch (saoErr: any) {
        appendLog(`sao indisponivel: ${String(saoErr?.message || saoErr)}`);
        saoPass = null;
      }
    }

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
      materialKind?: 'default' | 'tool' | 'sky' | 'water';
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
    const waterNormalTexture = polishEnabled ? createWaterNormalTexture() : null;
    let waterNormalPhase = 0;
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
      up: false,
      down: false,
      fast: false,
      slow: false,
    };
    const moveForward = new THREE.Vector3();
    const moveRight = new THREE.Vector3();
    const moveDelta = new THREE.Vector3();
    const moveUp = new THREE.Vector3(0, 1, 0);
    const playerBodyGeometry = new THREE.CylinderGeometry(12, 12, 56, 12);
    const playerHeadGeometry = new THREE.SphereGeometry(14, 12, 10);
    const playerDirGeometry = new THREE.ConeGeometry(8, 24, 10);
    const playerMarkers = new Map<string, {
      steamId: string;
      root: THREE.Group;
      pickMeshes: THREE.Object3D[];
      bodyMaterial: THREE.MeshStandardMaterial;
      headMaterial: THREE.MeshStandardMaterial;
      arrowMaterial: THREE.MeshStandardMaterial;
      labelSprite: THREE.Sprite | null;
      labelTexture: THREE.CanvasTexture | null;
      labelSignature: string;
      snapshotPosition: THREE.Vector3;
      renderPosition: THREE.Vector3;
      velocity: THREE.Vector3;
      snapshotAtMs: number;
      lastSeenAtMs: number;
      targetYawRad: number;
      renderYawRad: number;
      alive: boolean;
      teamKey: string;
      name: string;
      health: number | null;
    }>();
    const markerPredictedPosition = new THREE.Vector3();
    let lastSnapshotAppliedAtMs = 0;
    let playerUpdateRateHz = 0;
    let playerRenderTelemetry = {
      totalInFrame: 0,
      rendered: 0,
      culled: 0,
      filteredOut: 0,
    };
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    const pointerDown = { x: 0, y: 0 };
    let pointerDownAt = 0;
    const freeLook = {
      active: false,
      pointerId: -1,
      lastX: 0,
      lastY: 0,
    };
    const freeLookForward = new THREE.Vector3();
    const freeLookRightAxis = new THREE.Vector3();
    const freeLookForwardCandidate = new THREE.Vector3();
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
          if (!isSpecialMaterial(materialId)) {
            pushDiagnostic(
              'error',
              'texture_chain_failed',
              'texture',
              chainKey,
              `falha ao carregar textura para material=${materialId} em todos os formatos`,
              withRoots(materialRootsScanned, candidates),
            );
          }
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

    const getWorldMaterial = (materialIdRaw: string, placeholderFlag: boolean): THREE.Material => {
      const materialId = String(materialIdRaw || '__missing_material');
      const def = materialDefs.get(materialId);
      const materialKind = inferMaterialKind(materialId, def?.materialKind);
      const fallbackTextureUrl = def?.fallbackTextureUrl || def?.textureUrl;
      const primaryTextureUrl = ktx2RuntimeEnabled && def?.ktx2Url ? def.ktx2Url : fallbackTextureUrl;
      const shouldPlaceholder = placeholderFlag || !def || def.placeholder || !primaryTextureUrl;
      const status = String(def?.status || '').trim().toLowerCase();
      const suppressDiagnostic = shouldSuppressMaterialDiagnostic(materialId, status);
      if (shouldPlaceholder && !suppressDiagnostic) {
        const searchedIn = withRoots(materialRootsScanned, [
          def?.searchedVmt || (materialId ? `materials/${materialId}.vmt` : ''),
          def?.searchedVtf || (def?.resolvedBaseTexture ? `materials/${def.resolvedBaseTexture}.vtf` : ''),
          def?.sourcePath || '',
        ]);
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
        const hardErrorStatus = (
          status === 'missing_vmt'
          || status === 'missing_vtf'
          || status === 'vmt_parse_error'
          || status === 'vtf_decode_failed'
          || status === 'error'
        );
        const level = (!isSpecialMaterial(materialId) && (hardErrorStatus || !!def?.error)) ? 'error' : 'warn';
        pushDiagnostic(
          level,
          code,
          'material',
          materialId,
          message,
          searchedIn,
        );
      }

      if (polishEnabled && materialKind === 'sky') {
        return new THREE.MeshBasicMaterial({
          color: new THREE.Color(0x8aa9d7),
          side: THREE.BackSide,
          depthWrite: false,
          fog: false,
        });
      }

      const material: THREE.MeshStandardMaterial = (() => {
        if (!polishEnabled) {
          const baseColorSimple = shouldPlaceholder ? new THREE.Color(0x6b7280) : hashColor(materialId, 0.92);
          return new THREE.MeshStandardMaterial({
            color: baseColorSimple,
            metalness: 0.04,
            roughness: 0.94,
            side: THREE.DoubleSide,
          });
        }
        const baseColorPolish = shouldPlaceholder
          ? new THREE.Color(materialKind === 'water' ? 0x2a647f : 0x6b7280)
          : hashColor(materialId, materialKind === 'water' ? 0.86 : 0.92);
        if (materialKind === 'water') {
          return new THREE.MeshPhysicalMaterial({
            color: baseColorPolish,
            metalness: 0.02,
            roughness: 0.24,
            transmission: 0.14,
            thickness: 0.7,
            opacity: 0.84,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            envMapIntensity: 0.9,
            ...(waterNormalTexture ? { normalMap: waterNormalTexture } : {}),
            normalScale: new THREE.Vector2(0.35, 0.35),
            clearcoat: 0.28,
            clearcoatRoughness: 0.22,
          });
        }
        return new THREE.MeshStandardMaterial({
          color: baseColorPolish,
          metalness: 0.04,
          roughness: 0.94,
          side: THREE.DoubleSide,
          envMapIntensity: 0.34,
        });
      })();

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
            if (!isSpecialMaterial(materialId)) {
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

    const disposePlayerLabel = (marker: {
      labelSprite: THREE.Sprite | null;
      labelTexture: THREE.CanvasTexture | null;
      root: THREE.Group;
    }) => {
      if (marker.labelSprite) {
        marker.root.remove(marker.labelSprite);
        const spriteMaterial = marker.labelSprite.material as THREE.Material | undefined;
        spriteMaterial?.dispose();
      }
      marker.labelSprite = null;
      if (marker.labelTexture) marker.labelTexture.dispose();
      marker.labelTexture = null;
    };

    const markerMatchesActiveFilters = (marker: {
      alive: boolean;
      teamKey: string;
    }): boolean => {
      const aliveFilter = playerAliveFilterRef.current;
      if (aliveFilter === 'alive' && !marker.alive) return false;
      if (aliveFilter === 'dead' && marker.alive) return false;
      const teamFilter = playerTeamFilterRef.current;
      if (teamFilter !== 'all' && marker.teamKey !== teamFilter) return false;
      return true;
    };

    const updateMarkerLabel = (marker: {
      steamId: string;
      name: string;
      alive: boolean;
      health: number | null;
      root: THREE.Group;
      labelSignature: string;
      labelSprite: THREE.Sprite | null;
      labelTexture: THREE.CanvasTexture | null;
    }) => {
      if (!showPlayerLabelsRef.current) {
        if (marker.labelSignature !== '__off__') {
          marker.labelSignature = '__off__';
          disposePlayerLabel(marker);
        }
        return;
      }

      const nameText = (marker.name || marker.steamId).slice(0, 24);
      const hpText = showPlayerHealthInLabelRef.current
        ? `HP ${marker.health !== null ? Math.max(0, Math.floor(marker.health)) : '-'}${marker.alive ? '' : ' | MORTO'}`
        : '';
      const signature = `${nameText}|${hpText}`;
      if (signature === marker.labelSignature) return;

      marker.labelSignature = signature;
      disposePlayerLabel(marker);

      const canvas = document.createElement('canvas');
      const width = 320;
      const height = hpText ? 84 : 56;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = marker.alive ? 'rgba(10, 12, 20, 0.86)' : 'rgba(40, 18, 18, 0.9)';
      ctx.strokeStyle = marker.alive ? 'rgba(0, 255, 220, 0.68)' : 'rgba(255, 110, 110, 0.68)';
      ctx.lineWidth = 2;
      ctx.fillRect(8, 8, width - 16, height - 16);
      ctx.strokeRect(8, 8, width - 16, height - 16);

      ctx.font = 'bold 22px sans-serif';
      ctx.fillStyle = '#f4f8ff';
      ctx.textBaseline = 'top';
      ctx.fillText(nameText, 20, 18, width - 40);

      if (hpText) {
        ctx.font = 'bold 18px sans-serif';
        ctx.fillStyle = marker.alive ? '#a7f3d0' : '#fecaca';
        ctx.fillText(hpText, 20, 45, width - 40);
      }

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      texture.needsUpdate = true;

      const spriteMaterial = new THREE.SpriteMaterial({
        map: texture,
        depthWrite: false,
        transparent: true,
      });
      const sprite = new THREE.Sprite(spriteMaterial);
      const scale = 0.8;
      sprite.scale.set((width / 6) * scale, (height / 6) * scale, 1);
      sprite.position.set(0, PLAYER_MARKER_LABEL_HEIGHT, 0);
      sprite.renderOrder = 3;
      marker.root.add(sprite);
      marker.labelTexture = texture;
      marker.labelSprite = sprite;
    };

    const clearPlayerMarkers = () => {
      for (const marker of playerMarkers.values()) {
        playersRoot.remove(marker.root);
        disposePlayerLabel(marker);
        marker.bodyMaterial.dispose();
        marker.headMaterial.dispose();
        marker.arrowMaterial.dispose();
      }
      playerMarkers.clear();
    };

    const updateMarkerSelectionVisuals = () => {
      const selectedSteamId = viewerSelectedSteamIdRef.current;
      for (const marker of playerMarkers.values()) {
        const isSelected = !!selectedSteamId && marker.steamId === selectedSteamId;
        const emissive = isSelected ? 0xffffff : 0x000000;
        const emissiveIntensity = isSelected ? 0.22 : 0;
        marker.bodyMaterial.emissive.setHex(emissive);
        marker.bodyMaterial.emissiveIntensity = emissiveIntensity;
        marker.headMaterial.emissive.setHex(emissive);
        marker.headMaterial.emissiveIntensity = emissiveIntensity;
        marker.arrowMaterial.emissive.setHex(emissive);
        marker.arrowMaterial.emissiveIntensity = emissiveIntensity * 0.7;
        marker.bodyMaterial.opacity = marker.alive ? 0.96 : 0.42;
        marker.headMaterial.opacity = marker.alive ? 0.98 : 0.45;
        marker.arrowMaterial.opacity = marker.alive ? 0.94 : 0.4;
        marker.root.scale.setScalar(isSelected ? PLAYER_MARKER_SELECTED_SCALE : 1);
        marker.bodyMaterial.needsUpdate = true;
        marker.headMaterial.needsUpdate = true;
        marker.arrowMaterial.needsUpdate = true;
      }
    };

    const pickPlayerSteamIdAtClientPoint = (clientX: number, clientY: number): string | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      pointerNdc.x = ((clientX - rect.left) / width) * 2 - 1;
      pointerNdc.y = -(((clientY - rect.top) / height) * 2 - 1);
      raycaster.setFromCamera(pointerNdc, camera);

      const pickTargets: THREE.Object3D[] = [];
      for (const marker of playerMarkers.values()) {
        if (!marker.root.visible) continue;
        pickTargets.push(...marker.pickMeshes);
      }
      if (!pickTargets.length) return null;
      const hits = raycaster.intersectObjects(pickTargets, false);
      if (!hits.length) return null;
      const first = hits[0].object as THREE.Object3D & { userData?: { steamId?: string } };
      const steamId = String(first.userData?.steamId || '').trim();
      return steamId || null;
    };

    const retargetOrbitAtClientPoint = (clientX: number, clientY: number): boolean => {
      const rect = renderer.domElement.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      pointerNdc.x = ((clientX - rect.left) / width) * 2 - 1;
      pointerNdc.y = -(((clientY - rect.top) / height) * 2 - 1);
      raycaster.setFromCamera(pointerNdc, camera);

      const worldHits = raycaster.intersectObjects(chunkRoot.children, true);
      if (worldHits.length > 0) {
        controls.target.copy(worldHits[0].point);
        controls.update();
        return true;
      }

      const playerHits = raycaster.intersectObjects(playersRoot.children, true);
      if (playerHits.length > 0) {
        controls.target.copy(playerHits[0].point);
        controls.update();
        return true;
      }
      return false;
    };

    const stopFreeLook = (pointerId?: number) => {
      if (!freeLook.active) return;
      if (typeof pointerId === 'number' && pointerId !== freeLook.pointerId) return;
      if (freeLook.pointerId >= 0) {
        try {
          renderer.domElement.releasePointerCapture(freeLook.pointerId);
        } catch {
          // no-op
        }
      }
      freeLook.active = false;
      freeLook.pointerId = -1;
      controls.enabled = true;
      controls.update();
    };

    const applyViewerLookDelta = (deltaX: number, deltaY: number) => {
      if (Math.abs(deltaX) < 0.001 && Math.abs(deltaY) < 0.001) return;

      freeLookForward.copy(controls.target).sub(camera.position);
      const targetDistance = Math.max(120, freeLookForward.length());
      if (freeLookForward.lengthSq() < 1e-6) {
        freeLookForward.set(0, 0, -1).applyQuaternion(camera.quaternion);
      }
      freeLookForward.normalize();

      const yawDelta = -deltaX * CAMERA_FREE_LOOK_SENSITIVITY;
      const pitchDelta = -deltaY * CAMERA_FREE_LOOK_SENSITIVITY;
      if (Math.abs(yawDelta) > 1e-6) {
        freeLookForward.applyAxisAngle(moveUp, yawDelta).normalize();
      }

      if (Math.abs(pitchDelta) > 1e-6) {
        freeLookRightAxis.crossVectors(freeLookForward, moveUp);
        if (freeLookRightAxis.lengthSq() > 1e-8) {
          freeLookRightAxis.normalize();
          freeLookForwardCandidate.copy(freeLookForward).applyAxisAngle(freeLookRightAxis, pitchDelta).normalize();
          if (Math.abs(freeLookForwardCandidate.dot(moveUp)) <= CAMERA_FREE_LOOK_MAX_UP_DOT) {
            freeLookForward.copy(freeLookForwardCandidate);
          }
        }
      }

      controls.target.copy(camera.position).addScaledVector(freeLookForward, targetDistance);
      camera.lookAt(controls.target);
    };

    applyViewerLookDeltaRef.current = applyViewerLookDelta;

    const onCanvasPointerDown = (event: PointerEvent) => {
      if (event.button === 1) {
        event.preventDefault();
        retargetOrbitAtClientPoint(event.clientX, event.clientY);
        return;
      }
      if (event.button !== 0) return;
      event.preventDefault();
      pointerDown.x = event.clientX;
      pointerDown.y = event.clientY;
      pointerDownAt = performance.now();
      freeLook.active = true;
      freeLook.pointerId = event.pointerId;
      freeLook.lastX = event.clientX;
      freeLook.lastY = event.clientY;
      controls.enabled = false;
      try {
        renderer.domElement.setPointerCapture(event.pointerId);
      } catch {
        // no-op
      }
    };

    const onCanvasPointerMove = (event: PointerEvent) => {
      if (!freeLook.active || event.pointerId !== freeLook.pointerId) return;
      event.preventDefault();

      const deltaX = event.clientX - freeLook.lastX;
      const deltaY = event.clientY - freeLook.lastY;
      freeLook.lastX = event.clientX;
      freeLook.lastY = event.clientY;
      applyViewerLookDelta(deltaX, deltaY);
    };

    const onCanvasPointerUp = (event: PointerEvent) => {
      if (event.button !== 0) return;
      stopFreeLook(event.pointerId);
      const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
      const elapsed = performance.now() - pointerDownAt;
      if (moved > 8 || elapsed > 450) return;
      const pickedSteamId = pickPlayerSteamIdAtClientPoint(event.clientX, event.clientY);
      if (!pickedSteamId) return;
      setViewerSelectedSteamId(pickedSteamId);
    };

    const onCanvasPointerCancel = (event: PointerEvent) => {
      stopFreeLook(event.pointerId);
    };

    const onCanvasContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    const clearMovementKeys = () => {
      movementKeys.forward = false;
      movementKeys.backward = false;
      movementKeys.left = false;
      movementKeys.right = false;
      movementKeys.up = false;
      movementKeys.down = false;
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
        case 'KeyE':
        case 'PageUp':
        case 'Space':
          movementKeys.up = active;
          return true;
        case 'KeyQ':
        case 'PageDown':
        case 'KeyC':
          movementKeys.down = active;
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
        playerUpdateRateHz = 0;
        return;
      }

      const now = performance.now();
      if (lastSnapshotAppliedAtMs > 0) {
        const deltaMs = Math.max(1, now - lastSnapshotAppliedAtMs);
        playerUpdateRateHz = Math.min(64, 1000 / deltaMs);
      }
      lastSnapshotAppliedAtMs = now;
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
        const targetYawRad = THREE.MathUtils.degToRad(Number(player.eyeAngles?.yaw || 0));
        const alive = player.alive !== false;
        const teamKey = getViewerPlayerTeamKey(player);
        const playerName = String(player.name || '').trim();
        const health = Number.isFinite(Number(player.health)) ? Number(player.health) : null;
        const playerColor = new THREE.Color(getViewerMarkerColorHex(player));

        let marker = playerMarkers.get(steamId);
        if (!marker) {
          const bodyMaterial = new THREE.MeshStandardMaterial({
            color: playerColor.clone(),
            metalness: 0.02,
            roughness: 0.45,
            transparent: true,
            opacity: alive ? 0.96 : 0.42,
            depthWrite: alive,
          });
          const headMaterial = new THREE.MeshStandardMaterial({
            color: playerColor.clone().offsetHSL(0, -0.02, 0.08),
            metalness: 0.02,
            roughness: 0.36,
            transparent: true,
            opacity: alive ? 0.98 : 0.45,
            depthWrite: alive,
          });
          const arrowMaterial = new THREE.MeshStandardMaterial({
            color: playerColor.clone().offsetHSL(0, 0.04, 0.12),
            metalness: 0.04,
            roughness: 0.32,
            transparent: true,
            opacity: alive ? 0.94 : 0.4,
            depthWrite: alive,
          });

          const root = new THREE.Group();
          root.position.copy(sourcePos);
          root.rotation.y = targetYawRad;
          root.frustumCulled = true;

          const bodyMesh = new THREE.Mesh(playerBodyGeometry, bodyMaterial);
          bodyMesh.position.set(0, 32, 0);
          bodyMesh.userData = { ...bodyMesh.userData, steamId };
          const headMesh = new THREE.Mesh(playerHeadGeometry, headMaterial);
          headMesh.position.set(0, 68, 0);
          headMesh.userData = { ...headMesh.userData, steamId };
          const dirMesh = new THREE.Mesh(playerDirGeometry, arrowMaterial);
          dirMesh.position.set(0, 52, 24);
          dirMesh.rotation.x = Math.PI / 2;
          dirMesh.userData = { ...dirMesh.userData, steamId };

          root.add(bodyMesh);
          root.add(headMesh);
          root.add(dirMesh);
          playersRoot.add(root);

          marker = {
            steamId,
            root,
            pickMeshes: [bodyMesh, headMesh],
            bodyMaterial,
            headMaterial,
            arrowMaterial,
            labelSprite: null,
            labelTexture: null,
            labelSignature: '__init__',
            snapshotPosition: sourcePos.clone(),
            renderPosition: sourcePos.clone(),
            velocity: new THREE.Vector3(),
            snapshotAtMs: now,
            lastSeenAtMs: now,
            targetYawRad,
            renderYawRad: targetYawRad,
            alive,
            teamKey,
            name: playerName,
            health,
          };
          playerMarkers.set(steamId, marker);
        } else {
          const deltaSec = Math.max(0.001, (now - marker.snapshotAtMs) / 1000);
          const nextVelocity = sourcePos.clone().sub(marker.snapshotPosition).multiplyScalar(1 / deltaSec);
          marker.velocity.lerp(nextVelocity, 0.62);
          marker.snapshotPosition.copy(sourcePos);
          marker.snapshotAtMs = now;
          marker.lastSeenAtMs = now;
          marker.targetYawRad = targetYawRad;
          marker.alive = alive;
          marker.teamKey = teamKey;
          marker.name = playerName;
          marker.health = health;
          marker.bodyMaterial.color.copy(playerColor);
          marker.headMaterial.color.copy(playerColor).offsetHSL(0, -0.02, 0.08);
          marker.arrowMaterial.color.copy(playerColor).offsetHSL(0, 0.04, 0.12);
          marker.bodyMaterial.depthWrite = alive;
          marker.headMaterial.depthWrite = alive;
          marker.arrowMaterial.depthWrite = alive;
        }

        updateMarkerLabel(marker);
      }

      for (const [steamId, marker] of playerMarkers.entries()) {
        if (seen.has(steamId)) continue;
        playersRoot.remove(marker.root);
        disposePlayerLabel(marker);
        marker.bodyMaterial.dispose();
        marker.headMaterial.dispose();
        marker.arrowMaterial.dispose();
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
            const matId = String(meshData.materialId || meshData.material || '__missing_material');
            const matDef = materialDefs.get(matId);
            const matKind = inferMaterialKind(matId, matDef?.materialKind);
            if (polishEnabled && (matKind === 'sky' || matKind === 'tool')) {
              continue;
            }
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

            const worldMat = getWorldMaterial(matId, !!meshData.placeholderMaterial);
            const worldMesh = new THREE.Mesh(worldGeo, worldMat);
            worldMesh.frustumCulled = true;
            group.add(worldMesh);
          }
        } else {
          const worldFaces = Array.isArray(payload.world?.faces) ? payload.world?.faces : [];
          if (worldFaces.length > 0) {
            const positionList: number[] = [];
            const colorList: number[] = [];
            for (let i = 0; i < worldFaces.length; i += 1) {
              const face = worldFaces[i];
              if (polishEnabled && (isSkyMaterial(face.material) || isToolMaterial(face.material))) {
                continue;
              }
              const point = sourceToThree(face.position[0], face.position[1], face.position[2]);
              positionList.push(point.x, point.y, point.z);
              const color = face.placeholderMaterial ? new THREE.Color(0x6b7280) : hashColor(face.material || 'world-material');
              colorList.push(color.r, color.g, color.b);
            }

            if (positionList.length >= 3) {
              const worldGeo = new THREE.BufferGeometry();
              worldGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positionList), 3));
              worldGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colorList), 3));
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
        const loadedManifest = await probeManifestWithDetails();
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
                  ...(item.materialKind ? { materialKind: item.materialKind } : {}),
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
        const worldMinZ = Number(loadedManifest.map.worldBounds.min[2] || 0);
        const worldMaxX = Number(loadedManifest.map.worldBounds.max[0] || 0);
        const worldMaxY = Number(loadedManifest.map.worldBounds.max[1] || 0);
        const worldMaxZ = Number(loadedManifest.map.worldBounds.max[2] || 0);
        const worldCenterX = (worldMinX + worldMaxX) * 0.5;
        const worldCenterY = (worldMinY + worldMaxY) * 0.5;
        const worldCenterZ = (worldMinZ + worldMaxZ) * 0.5;
        const worldPlanarSpan = Math.max(2048, Math.abs(worldMaxX - worldMinX), Math.abs(worldMaxY - worldMinY));
        const worldHeightSpan = Math.max(512, Math.abs(worldMaxZ - worldMinZ));
        const worldOrbitOffset = Math.min(6400, Math.max(2400, worldPlanarSpan * 0.12));
        const worldCameraHeight = Math.min(9000, Math.max(1200, worldHeightSpan * 0.45));
        const worldCenter = sourceToThree(worldCenterX, worldCenterY, worldCenterZ);

        camera.position.set(
          worldCenter.x + worldOrbitOffset,
          worldCenter.y + worldCameraHeight,
          worldCenter.z + worldOrbitOffset,
        );
        controls.target.copy(worldCenter);
        controls.update();
        grid.position.y = worldMinZ;
        const gridScale = Math.max(1, worldPlanarSpan / 36000);
        grid.scale.set(gridScale, 1, gridScale);

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
            playersTotalInFrame: playerRenderTelemetry.totalInFrame,
            playersRendered: playerRenderTelemetry.rendered,
            playersCulled: playerRenderTelemetry.culled,
            playersFilteredOut: playerRenderTelemetry.filteredOut,
            playerUpdateRateHz: playerUpdateRateHz,
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
          composer?.setSize(width, height);
        };

        const animate = () => {
          if (cancelled) return;
          animationFrameId = window.requestAnimationFrame(animate);

          const now = performance.now();
          const dtSec = Math.min(0.15, Math.max(0, (now - lastFrameAtMs) / 1000));
          lastFrameAtMs = now;

          const smoothAlpha = 1 - Math.exp(-PLAYER_MARKER_SMOOTH_RATE * dtSec);
          const rotationAlpha = 1 - Math.exp(-PLAYER_MARKER_ROTATION_SMOOTH_RATE * dtSec);
          const selectedSteamId = viewerSelectedSteamIdRef.current || '';
          playerRenderTelemetry = {
            totalInFrame: viewerStateRef.current?.players?.length || playerMarkers.size,
            rendered: 0,
            culled: 0,
            filteredOut: 0,
          };

          for (const marker of playerMarkers.values()) {
            updateMarkerLabel(marker);
            const extrapolationSec = Math.min(
              PLAYER_MARKER_EXTRAPOLATION_MAX_MS / 1000,
              Math.max(0, (now - marker.snapshotAtMs) / 1000),
            );
            markerPredictedPosition.copy(marker.snapshotPosition).addScaledVector(marker.velocity, extrapolationSec);
            marker.renderPosition.lerp(markerPredictedPosition, smoothAlpha);
            marker.root.position.copy(marker.renderPosition);
            marker.renderYawRad = lerpAngleRad(marker.renderYawRad, marker.targetYawRad, rotationAlpha);
            marker.root.rotation.y = marker.renderYawRad;

            const passesFilter = markerMatchesActiveFilters(marker);
            if (!passesFilter) {
              marker.root.visible = false;
              playerRenderTelemetry.filteredOut += 1;
              continue;
            }
            const isSelected = !!selectedSteamId && marker.steamId === selectedSteamId;
            const distanceSq = camera.position.distanceToSquared(marker.renderPosition);
            if (!isSelected && distanceSq > PLAYER_MARKER_MAX_RENDER_DISTANCE_SQ) {
              marker.root.visible = false;
              playerRenderTelemetry.culled += 1;
              continue;
            }
            marker.root.visible = true;
            playerRenderTelemetry.rendered += 1;
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

          if (selectedSteamId !== lastSelectionVisualKey) {
            lastSelectionVisualKey = selectedSteamId;
            updateMarkerSelectionVisuals();
          }

          if (viewerFollowSelectedRef.current && selectedSteamId) {
            const selectedMarker = playerMarkers.get(selectedSteamId);
            if (selectedMarker) {
              followFocus.copy(selectedMarker.renderPosition);
              followFocus.y += 40;
              followForward.set(Math.cos(selectedMarker.renderYawRad), 0, Math.sin(selectedMarker.renderYawRad));
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
            const touchMove = mobileMoveInputRef.current;
            const moveForwardBack =
              (movementKeys.forward ? 1 : 0) + (movementKeys.backward ? -1 : 0) + -touchMove.y;
            const moveLeftRight =
              (movementKeys.right ? 1 : 0) + (movementKeys.left ? -1 : 0) + touchMove.x;
            const moveVertical =
              (movementKeys.up ? 1 : 0) + (movementKeys.down ? -1 : 0) + touchMove.vertical;
            if (
              Math.abs(moveForwardBack) > 0.001
              || Math.abs(moveLeftRight) > 0.001
              || Math.abs(moveVertical) > 0.001
            ) {
              // Free-fly movement: WASD follows camera pitch/yaw (noclip style).
              moveForward.set(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
              moveRight.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
              moveDelta.set(0, 0, 0);
              if (moveForwardBack !== 0) moveDelta.addScaledVector(moveForward, moveForwardBack);
              if (moveLeftRight !== 0) moveDelta.addScaledVector(moveRight, moveLeftRight);
              if (moveVertical !== 0) moveDelta.addScaledVector(moveUp, moveVertical);
              if (moveDelta.lengthSq() > 1e-8) {
                moveDelta.normalize();
                let speed = CAMERA_MOVE_SPEED * moveSpeedFactorRef.current;
                if (movementKeys.fast || touchMove.boost) speed *= CAMERA_MOVE_FAST_MULTIPLIER;
                if (movementKeys.slow) speed *= CAMERA_MOVE_SLOW_MULTIPLIER;
                const distance = speed * dtSec;
                camera.position.addScaledVector(moveDelta, distance);
                controls.target.addScaledVector(moveDelta, distance);
              }
            }
          }

          controls.update();
          if (polishEnabled && waterNormalTexture) {
            waterNormalPhase += dtSec;
            waterNormalTexture.offset.set(
              (waterNormalPhase * WATER_NORMAL_SCROLL_X) % 1,
              (waterNormalPhase * WATER_NORMAL_SCROLL_Y) % 1,
            );
          }
          if (composer) {
            composer.render();
          } else {
            renderer.render(scene, camera);
          }
          if (now - streamIntervalMs >= 300) {
            streamIntervalMs = now;
            updateStreaming();
          }
        };

        onResize();
        const onWindowBlur = () => {
          clearMovementKeys();
          stopFreeLook();
          resetMobileMovePad();
          setMobileLookActive(false);
          setMobileAscendPressed(false);
          setMobileDescendPressed(false);
        };
        window.addEventListener('resize', onResize);
        window.addEventListener('keydown', onWindowKeyDown);
        window.addEventListener('keyup', onWindowKeyUp);
        window.addEventListener('blur', onWindowBlur);
        renderer.domElement.addEventListener('pointerdown', onCanvasPointerDown);
        renderer.domElement.addEventListener('pointermove', onCanvasPointerMove);
        renderer.domElement.addEventListener('pointerup', onCanvasPointerUp);
        renderer.domElement.addEventListener('pointercancel', onCanvasPointerCancel);
        renderer.domElement.addEventListener('contextmenu', onCanvasContextMenu);
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
          polishEnabled
            ? `visual profile=polished sky=on water=on sao=${saoPass?.enabled ? 'on' : 'off'} fog=on`
            : 'visual profile=simple (legacy)',
        );
        appendLog(
          `chunk_count=${entries.length} active=${activeRadius * 2 + 1}x${activeRadius * 2 + 1} render=${renderRadius * 2 + 1}x${renderRadius * 2 + 1} prefetch=${prefetchRadius * 2 + 1}x${prefetchRadius * 2 + 1}`,
        );
        appendLog(`world_z_bounds=min:${Math.round(worldMinZ)} max:${Math.round(worldMaxZ)} center:${Math.round(worldCenterZ)}`);
        appendLog(`chunk_lod_bands: ring<=${activeRadius}=lod0 | ring<=${lod1Radius}=lod1 | ring<=${renderRadius}=lod2`);
        appendLog('controles: WASD voo livre | Q/E ou Space/C desce/sobe | LMB gira no proprio eixo | RMB pan | MMB redefine pivo no clique | Shift acelera | Ctrl reduz');

        return () => {
          window.removeEventListener('resize', onResize);
          window.removeEventListener('keydown', onWindowKeyDown);
          window.removeEventListener('keyup', onWindowKeyUp);
          window.removeEventListener('blur', onWindowBlur);
          clearMovementKeys();
          stopFreeLook();
          applyViewerLookDeltaRef.current = () => undefined;
          renderer.domElement.removeEventListener('pointerdown', onCanvasPointerDown);
          renderer.domElement.removeEventListener('pointermove', onCanvasPointerMove);
          renderer.domElement.removeEventListener('pointerup', onCanvasPointerUp);
          renderer.domElement.removeEventListener('pointercancel', onCanvasPointerCancel);
          renderer.domElement.removeEventListener('contextmenu', onCanvasContextMenu);
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
      applyViewerLookDeltaRef.current = () => undefined;
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
      playerBodyGeometry.dispose();
      playerHeadGeometry.dispose();
      playerDirGeometry.dispose();
      disposeTextureCache();
      disposeModelCache();
      try {
        ktx2Loader.dispose();
      } catch {
        // no-op
      }
      waterNormalTexture?.dispose();
      skyTexture?.dispose();
      skyEnvironment?.dispose();
      pmrem?.dispose();
      composer?.dispose();
      renderer.dispose();
      host.innerHTML = '';
    };
  }, [manifestUrl, probeManifestWithDetails, renderProfile]);

  return (
    <div className="space-y-4 pb-10 animate-fade-in">
      <div className="rounded-2xl border border-[#2d3850] bg-[#0b1221]/88 px-4 py-3 shadow-[0_18px_48px_rgba(0,0,0,0.35)] backdrop-blur">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <Link
              to={serverId ? `/admin/servers/${serverId}` : '/admin/servers'}
              className="mb-2 flex items-center text-sm font-bold uppercase text-zinc-500 hover:text-zinc-100"
            >
              <Icons.ArrowLeft className="w-4 h-4 mr-1" /> Voltar para servidor
            </Link>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl md:text-3xl font-black text-white uppercase tracking-tight">
                Web Viewer 3D <span className="font-bold text-xl md:text-2xl text-zinc-500">(MVP)</span>
              </h1>
              <span className="rounded-full border border-[#35415b] bg-[#141f34] px-3 py-1 text-[11px] text-zinc-300 font-mono">
                map={mapName}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-3 py-1 rounded-full border text-[11px] font-bold uppercase tracking-[0.1em] ${
              hasFreshViewerSnapshot
                ? 'bg-emerald-900/20 text-emerald-300 border-emerald-700'
                : 'bg-yellow-900/20 text-yellow-300 border-yellow-700'
            }`}>
              {hasFreshViewerSnapshot ? 'Viewer Online' : 'Viewer Aguardando Frame'}
            </span>
            <button
              type="button"
              onClick={() => setShowDevTools((current) => !current)}
              className={`px-3 py-1 rounded-full border text-[11px] font-bold uppercase tracking-[0.1em] ${
                showDevTools
                  ? 'border-cyan-700 bg-cyan-900/25 text-cyan-300'
                  : 'border-zinc-700 bg-zinc-900/70 text-zinc-300 hover:bg-zinc-800'
              }`}
              title="Mostrar/Ocultar blocos técnicos"
            >
              {showDevTools ? 'Dev/Debug ON' : 'Dev/Debug'}
            </button>
            <div className="rounded-xl border border-[#34415b] bg-[#121b2e] px-3 py-2 text-xs text-zinc-300 font-mono shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div>{status}</div>
              {manifest && <div>manifest v{manifest.version} | chunkSize={manifest.map.chunkSize}</div>}
              <div>viewerState: {viewerStatusBadge.label}</div>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-900/60 bg-red-950/20 px-3 py-2 text-sm text-red-300">
          Erro: {error}
          <div className="text-xs text-zinc-400 mt-1">Verifique se os artefatos existem em `public/maps/{mapName}/manifest.json`.</div>
        </div>
      )}

      <div className="rounded-xl border border-[#2f3b53] bg-gradient-to-r from-[#111a2b] via-[#151f31] to-[#111a2b] px-3 py-3 shadow-[0_8px_24px_rgba(0,0,0,0.25)]">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-zinc-200">
            <Icons.Keyboard className="w-4 h-4 text-cyan-300" />
            <span className="text-[11px] uppercase font-bold tracking-wide">Velocidade de voo</span>
          </div>
          <span className="text-[11px] font-mono text-zinc-300">
            {moveSpeedFactor.toFixed(2)}x | {moveSpeedUnitsPerSec.toLocaleString('pt-BR')} u/s
          </span>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <input
            type="range"
            min={VIEWER_MOVE_SPEED_MIN}
            max={VIEWER_MOVE_SPEED_MAX}
            step={0.05}
            value={moveSpeedFactor}
            onChange={(event) =>
              setMoveSpeedFactor(
                clampMoveSpeedFactor(Number(event.target.value || VIEWER_MOVE_SPEED_DEFAULT)),
              )
            }
            className="w-full accent-cyan-500"
          />
          <button
            type="button"
            onClick={() => setMoveSpeedFactor(VIEWER_MOVE_SPEED_DEFAULT)}
            className="px-2 py-1 rounded border border-[#3d4d6d] bg-[#1a263d] text-[10px] text-zinc-200 font-bold uppercase hover:bg-[#223250]"
          >
            Reset
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 lg:items-start gap-4">
        <div className="lg:col-span-3 self-start rounded-2xl border border-[#2f3b53] bg-[#060a12] overflow-hidden relative shadow-[0_22px_62px_rgba(0,0,0,0.45)]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_420px_at_50%_15%,rgba(56,189,248,0.08),transparent_58%)]" />
          <div className="pointer-events-none absolute inset-0 opacity-[0.18] [background:linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:36px_36px]" />
          <div ref={mountRef} className="relative z-[1] h-[min(62vh,760px)] min-h-[420px] w-full" />
          <div className="absolute top-3 right-3 z-[2] flex flex-col items-end gap-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowViewerSettings(true)}
                  className="p-2 bg-black/50 backdrop-blur-md border border-white/10 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-all"
                  title="Configurações do viewer"
                >
                  <Icons.Settings className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleShareViewer();
                  }}
                  className="p-2 bg-black/50 backdrop-blur-md border border-white/10 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-all"
                  title="Compartilhar viewer"
                >
                  <Icons.ExternalLink className="w-4 h-4" />
                </button>
              </div>
              {shareFeedback && (
                <div className="rounded border border-zinc-700 bg-black/65 px-2 py-1 text-[10px] font-mono text-zinc-200">
                  {shareFeedback}
                </div>
              )}
          </div>
          <div className="absolute bottom-3 left-3 z-[2] flex gap-2">
            {showViewerHudLiveChip && (
              <div className="px-3 py-1.5 bg-black/50 backdrop-blur-md border border-white/10 rounded-lg flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${hasFreshViewerSnapshot ? 'bg-emerald-400' : 'bg-yellow-400'}`} />
                <span className="text-xs font-mono text-white/90">{hasFreshViewerSnapshot ? 'LIVE FRAME' : 'STALE FRAME'}</span>
              </div>
            )}
            {showViewerHudFpsChip && (
              <div className="px-3 py-1.5 bg-black/50 backdrop-blur-md border border-white/10 rounded-lg text-xs font-mono text-zinc-300">
                {viewerFpsLabel}
              </div>
            )}
          </div>
          {showViewerHudSelectedPlayer && selectedViewerPlayer && (
            <div className="absolute left-3 bottom-14 z-[2] rounded-xl border border-cyan-800 bg-[#0b1322]/92 px-3 py-2 text-[11px] text-zinc-200 font-mono backdrop-blur max-w-[360px]">
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
          {mobileControlsEnabled && (
            <div className="pointer-events-none absolute inset-0 z-[3] lg:hidden">
              <div className="absolute inset-x-2 bottom-2 flex items-end justify-between gap-2">
                <div className="pointer-events-auto flex items-end gap-2">
                  <div
                    ref={mobileMovePadRef}
                    className="relative h-28 w-28 rounded-full border border-cyan-700/60 bg-[#0b1322]/70 shadow-[0_6px_20px_rgba(0,0,0,0.35)] backdrop-blur select-none touch-none"
                    onPointerDown={handleMobileMovePadPointerDown}
                    onPointerMove={handleMobileMovePadPointerMove}
                    onPointerUp={handleMobileMovePadPointerEnd}
                    onPointerCancel={handleMobileMovePadPointerEnd}
                  >
                    <div className="pointer-events-none absolute inset-3 rounded-full border border-cyan-500/30" />
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-200/70">
                      Move
                    </div>
                    <div
                      className={`pointer-events-none absolute left-1/2 top-1/2 h-11 w-11 -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-400/70 bg-cyan-500/35 shadow-[0_0_18px_rgba(34,211,238,0.35)] transition-colors ${
                        mobileMoveKnob.active ? 'border-cyan-300 bg-cyan-400/45' : ''
                      }`}
                      style={{
                        transform: `translate(calc(-50% + ${(mobileMoveKnob.x * 34).toFixed(1)}px), calc(-50% + ${(mobileMoveKnob.y * 34).toFixed(1)}px))`,
                      }}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <button
                      type="button"
                      className={`touch-none rounded-lg border px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${
                        mobileAscendPressed
                          ? 'border-emerald-500 bg-emerald-500/25 text-emerald-200'
                          : 'border-[#415272] bg-[#0f1829]/85 text-zinc-200'
                      }`}
                      onPointerDown={handleMobileAscendPointerDown}
                      onPointerUp={handleMobileAscendPointerEnd}
                      onPointerCancel={handleMobileAscendPointerEnd}
                      onPointerLeave={handleMobileAscendPointerEnd}
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      className={`touch-none rounded-lg border px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${
                        mobileDescendPressed
                          ? 'border-orange-500 bg-orange-500/25 text-orange-100'
                          : 'border-[#415272] bg-[#0f1829]/85 text-zinc-200'
                      }`}
                      onPointerDown={handleMobileDescendPointerDown}
                      onPointerUp={handleMobileDescendPointerEnd}
                      onPointerCancel={handleMobileDescendPointerEnd}
                      onPointerLeave={handleMobileDescendPointerEnd}
                    >
                      Down
                    </button>
                  </div>
                </div>

                <div className="pointer-events-auto flex items-end gap-2">
                  <button
                    type="button"
                    className={`touch-none rounded-lg border px-2 py-1.5 text-[10px] font-bold uppercase tracking-wide ${
                      mobileBoostEnabled
                        ? 'border-cyan-400 bg-cyan-500/25 text-cyan-100'
                        : 'border-[#415272] bg-[#0f1829]/85 text-zinc-200'
                    }`}
                    onClick={() => setMobileBoostEnabled((current) => !current)}
                  >
                    Boost
                  </button>
                  <div
                    className={`relative h-24 w-28 rounded-2xl border bg-[#0b1322]/70 shadow-[0_6px_20px_rgba(0,0,0,0.35)] backdrop-blur select-none touch-none ${
                      mobileLookActive ? 'border-cyan-400/80' : 'border-cyan-700/60'
                    }`}
                    onPointerDown={handleMobileLookPadPointerDown}
                    onPointerMove={handleMobileLookPadPointerMove}
                    onPointerUp={handleMobileLookPadPointerEnd}
                    onPointerCancel={handleMobileLookPadPointerEnd}
                  >
                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-bold uppercase tracking-[0.14em] text-cyan-200/70">
                      Look
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="self-start space-y-3">
          <div className="rounded-2xl border border-[#303d56] bg-[#101a2c]/92 p-3 text-xs text-zinc-300 space-y-2 shadow-[0_12px_30px_rgba(0,0,0,0.28)]">
            <div className="flex items-center justify-between gap-2">
              <p className="text-zinc-500 uppercase font-bold text-[11px] tracking-wide">System Status</p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setRenderProfile('simple')}
                  className={`px-2 py-1 rounded border text-[10px] font-bold uppercase transition-colors ${
                    renderProfile === 'simple'
                      ? 'border-emerald-700 bg-emerald-900/30 text-emerald-300'
                      : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                  }`}
                >
                  Simples
                </button>
                <button
                  type="button"
                  onClick={() => setRenderProfile('polished')}
                  className={`px-2 py-1 rounded border text-[10px] font-bold uppercase transition-colors ${
                    renderProfile === 'polished'
                      ? 'border-cyan-700 bg-cyan-900/30 text-cyan-300'
                      : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                  }`}
                >
                  Polish
                </button>
              </div>
            </div>
            <div className="space-y-1 text-[11px] font-mono text-zinc-400">
              <div className="flex items-center justify-between">
                <span>Chunks</span>
                <span className="text-zinc-200">{runtimeStats.loadedChunks}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Chunk Size</span>
                <span className="text-zinc-200">{manifest?.map.chunkSize || 'n/a'}</span>
              </div>
              <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden mt-2">
                <div
                  className="h-full bg-gradient-to-r from-red-500 via-emerald-400 to-cyan-400"
                  style={{ width: `${viewerChunkVisibilityPct}%` }}
                />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[#303d56] bg-[#101a2c]/92 overflow-hidden flex-1 min-h-[390px] shadow-[0_12px_30px_rgba(0,0,0,0.28)]">
            <div className="flex items-center border-b border-white/5 bg-[#161c2b]">
              <button
                type="button"
                onClick={() => setViewerSideTab('streaming')}
                className={`admin-tab ${viewerSideTab === 'streaming' ? 'is-active' : ''} flex-1 py-3 text-[11px] font-bold uppercase tracking-[0.1em]`}
              >
                Streaming
              </button>
              <button
                type="button"
                onClick={() => setViewerSideTab('players')}
                className={`admin-tab ${viewerSideTab === 'players' ? 'is-active' : ''} flex-1 py-3 text-[11px] font-bold uppercase tracking-[0.1em]`}
              >
                Players
              </button>
              <button
                type="button"
                onClick={() => setViewerSideTab('logs')}
                className={`admin-tab ${viewerSideTab === 'logs' ? 'is-active' : ''} flex-1 py-3 text-[11px] font-bold uppercase tracking-[0.1em]`}
              >
                Logs
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto admin-scrollbar bg-[#0c1220]">
              {viewerSideTab === 'streaming' && (
                <div className="divide-y divide-white/5">
                  {viewerStreamingRows.map((item) => (
                    <div key={item.label} className="flex items-center justify-between px-3 py-2.5 hover:bg-white/[0.02] transition-colors">
                      <span className="text-[11px] text-zinc-500 font-mono">{item.label}</span>
                      <span className="text-[11px] text-zinc-200 font-mono">{item.value}</span>
                    </div>
                  ))}
                </div>
              )}

              {viewerSideTab === 'players' && (
                <div className="p-3 text-xs text-zinc-300 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-zinc-400 uppercase font-bold text-[10px] tracking-[0.1em]">viewer_state</p>
              <span className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase ${viewerStatusBadge.className}`}>
                {viewerStatusBadge.label}
              </span>
            </div>
            <p>framePlayers: {viewerState?.playerCount ?? 0} | lista: {filteredViewerPlayers.length}</p>
            <p>frameAge: {Number.isFinite(viewerSnapshotAgeSeconds) ? `${viewerSnapshotAgeSeconds}s` : 'sem frame'}</p>
            <p>lastWsMsg: {viewerLastMessageAt ? new Date(viewerLastMessageAt).toLocaleTimeString('pt-BR') : 'n/a'}</p>
            <p>snapshotFresh: {hasFreshViewerSnapshot ? 'sim' : 'nao'}</p>
            {viewerWsError && <p className="text-red-300 break-words">wsError: {viewerWsError}</p>}

            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-zinc-800">
              <label className="text-[10px] text-zinc-500 uppercase font-bold">
                Estado
                <select
                  value={playerAliveFilter}
                  onChange={(event) => setPlayerAliveFilter(event.target.value as 'all' | 'alive' | 'dead')}
                  className="mt-1 w-full rounded border border-[#3a4968] bg-[#0f1829] px-2 py-1 text-[11px] text-zinc-100"
                >
                  <option value="all">Todos</option>
                  <option value="alive">Vivos</option>
                  <option value="dead">Mortos</option>
                </select>
              </label>
              <label className="text-[10px] text-zinc-500 uppercase font-bold">
                Time
                <select
                  value={playerTeamFilter}
                  onChange={(event) => setPlayerTeamFilter(event.target.value)}
                  className="mt-1 w-full rounded border border-[#3a4968] bg-[#0f1829] px-2 py-1 text-[11px] text-zinc-100"
                >
                  <option value="all">Todos</option>
                  {viewerTeamOptions.map((team) => (
                    <option key={team.value} value={team.value}>
                      {team.label} ({team.count})
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[10px] text-zinc-400">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={showPlayerLabels}
                  onChange={(event) => setShowPlayerLabels(event.target.checked)}
                  className="rounded border-zinc-700 bg-[#0f1829]"
                />
                Labels 3D
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={showPlayerHealthInLabel}
                  onChange={(event) => setShowPlayerHealthInLabel(event.target.checked)}
                  disabled={!showPlayerLabels}
                  className="rounded border-zinc-700 bg-[#0f1829] disabled:opacity-40"
                />
                HP no label
              </label>
            </div>

            <div className="max-h-[180px] overflow-y-auto admin-scrollbar space-y-2 pt-1 border-t border-zinc-800">
              {!filteredViewerPlayers.length && <p className="text-zinc-500">Sem players no filtro/frame.</p>}
              {filteredViewerPlayers.map((player) => (
                <button
                  key={player.steamId}
                  onClick={() => setViewerSelectedSteamId(player.steamId)}
                  className={`w-full text-left rounded border px-2 py-1.5 transition-colors ${
                    viewerSelectedSteamId === player.steamId
                      ? 'border-cyan-700 bg-cyan-900/20'
                      : 'border-zinc-800 bg-[#0b111d]/65 hover:bg-[#182337]'
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
                      : 'border-zinc-700 bg-[#11192a] text-zinc-300 hover:bg-[#182338]'
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
                  className="w-full rounded border border-[#3a4968] bg-[#0f1829] px-2 py-1.5 text-[11px] text-zinc-100 focus:outline-none focus:ring-2 focus:ring-cyan-700"
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
                  <div className="rounded border border-[#3a4864] bg-[#0f1829]/80 px-2 py-2 text-[10px] space-y-1">
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
              )}

              {viewerSideTab === 'logs' && (
                <div className="font-mono text-[10px] p-2 space-y-1 text-zinc-300">
                  {!streamingLogs.length && <p className="text-zinc-500">Sem logs ainda...</p>}
                  {streamingLogs.map((line, idx) => (
                    <div key={`${line}_${idx}`} className="rounded px-1 py-0.5 hover:bg-white/5 break-words">
                      {line}
                    </div>
                  ))}
                  <div className="text-zinc-500 animate-pulse">_</div>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                void loadQueueSnapshot(false);
                void probeManifestWithDetails().catch(() => undefined);
              }}
              className="flex items-center justify-center gap-2 p-3 rounded-xl border border-[#34435f] bg-[#111a2d] hover:bg-[#192742] hover:border-[#415378] transition-all group"
            >
              <Icons.RefreshCw className="w-4 h-4 text-zinc-500 group-hover:text-white transition-colors" />
              <span className="text-xs font-medium text-zinc-400 group-hover:text-white">Reload</span>
            </button>
            <button
              type="button"
              onClick={() => setViewerSideTab('logs')}
              className="flex items-center justify-center gap-2 p-3 rounded-xl border border-[#34435f] bg-[#111a2d] hover:bg-[#192742] hover:border-[#415378] transition-all group"
            >
              <Icons.Terminal className="w-4 h-4 text-zinc-500 group-hover:text-white transition-colors" />
              <span className="text-xs font-medium text-zinc-400 group-hover:text-white">Console</span>
            </button>
          </div>

          {showDevTools && (
            <div className="rounded-2xl border border-[#303d56] bg-[#101a2c]/92 p-3 text-xs text-zinc-300 space-y-2 shadow-[0_12px_30px_rgba(0,0,0,0.28)]">
            <div className="flex items-center justify-between gap-2">
              <p className="text-zinc-400 uppercase font-bold text-[11px] tracking-[0.1em]">Pipeline / Workshop</p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    void loadQueueSnapshot(false);
                  }}
                  className="px-2 py-1 rounded border border-[#3a4b69] bg-[#182338] text-[10px] uppercase font-bold text-zinc-200 hover:bg-[#22344f]"
                >
                  {queueLoading ? 'Atualizando...' : 'Atualizar'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void probeManifestWithDetails().catch(() => undefined);
                  }}
                  className="px-2 py-1 rounded border border-[#3a4b69] bg-[#182338] text-[10px] uppercase font-bold text-zinc-200 hover:bg-[#22344f]"
                >
                  Testar manifest
                </button>
              </div>
            </div>

            <p>map atual: <span className="font-mono">{mapName}</span></p>
            {queueSnapshot && (
              <>
                <p>worker: {queueSnapshot.config.enabled ? 'on' : 'off'} | conc={queueSnapshot.config.workerConcurrency} | active={queueSnapshot.worker.activeJobs}</p>
                <p>fila: pending={queueSnapshot.counts.pending} queued={queueSnapshot.counts.queued} running={queueSnapshot.counts.running} retry={queueSnapshot.counts.retry_wait}</p>
                <p>final: success={queueSnapshot.counts.success} failed={queueSnapshot.counts.failed} dropped={queueSnapshot.counts.dropped}</p>
              </>
            )}
            {queueError && <p className="text-red-300 break-words">queueError: {queueError}</p>}

            <div className="rounded border border-[#364561] bg-[#0c1321]/75 px-2 py-2 space-y-1">
              <p className="text-zinc-500 uppercase font-bold text-[10px]">Manifest probe</p>
              {!manifestProbe && <p className="text-zinc-500">Sem probe ainda.</p>}
              {manifestProbe && (
                <>
                  <p>ok: {manifestProbe.ok ? 'sim' : 'nao'}</p>
                  {manifestProbe.httpStatus !== undefined && <p>http: {manifestProbe.httpStatus}</p>}
                  {manifestProbe.contentType && <p className="break-all">content-type: {manifestProbe.contentType}</p>}
                  {manifestProbe.error && <p className="text-red-300 break-words">{manifestProbe.error}</p>}
                  {manifestProbe.preview && <p className="text-zinc-500 break-words">preview: {manifestProbe.preview}</p>}
                  {manifestProbe.checkedAt && (
                    <p className="text-zinc-500">
                      checked: {new Date(manifestProbe.checkedAt).toLocaleTimeString('pt-BR')}
                    </p>
                  )}
                </>
              )}
            </div>

            <div className="rounded border border-[#364561] bg-[#0c1321]/75 px-2 py-2 space-y-2">
              <p className="text-zinc-500 uppercase font-bold text-[10px]">Teste enqueue manual</p>
              <label className="block text-[10px] text-zinc-500 uppercase font-bold">
                workshopId (opcional)
              </label>
              <input
                type="text"
                value={manualWorkshopId}
                onChange={(event) => setManualWorkshopId(event.target.value)}
                placeholder="ex: 262714246040502603"
                className="w-full rounded border border-[#3a4968] bg-[#0f1829] px-2 py-1 text-[11px] text-zinc-100 font-mono"
              />
              <button
                type="button"
                onClick={() => {
                  void enqueueManualWorkshopJob();
                }}
                disabled={manualEnqueueBusy}
                className="w-full px-2 py-1.5 rounded border border-cyan-800 bg-cyan-900/20 text-cyan-300 text-[11px] font-bold uppercase disabled:opacity-50"
              >
                {manualEnqueueBusy ? 'Enfileirando...' : 'Enfileirar job de teste'}
              </button>
              {manualEnqueueResult && (
                <div className="rounded border border-[#364561] bg-[#0f1829]/75 px-2 py-1.5 text-[10px] font-mono space-y-0.5">
                  <p>ok={manualEnqueueResult.ok ? 'true' : 'false'} | queued={manualEnqueueResult.queued ? 'true' : 'false'} | deduped={manualEnqueueResult.deduped ? 'true' : 'false'}</p>
                  <p className="break-all">reason={manualEnqueueResult.reason}</p>
                  {manualEnqueueResult.error && <p className="text-red-300 break-words">{manualEnqueueResult.error}</p>}
                  {manualEnqueueResult.job && (
                    <p className="text-zinc-500 break-all">job={manualEnqueueResult.job.id} status={manualEnqueueResult.job.status}</p>
                  )}
                </div>
              )}
            </div>

            <div className="rounded border border-[#364561] bg-[#0c1321]/75 px-2 py-2 space-y-1">
              <p className="text-zinc-500 uppercase font-bold text-[10px]">
                Jobs do mapa atual ({mapQueueJobs.length})
              </p>
              {!mapQueueJobs.length && (
                <p className="text-zinc-500">
                  Nenhum job deste mapa na fila. Se o mapa trocou e nao existe manifest, enfileire manualmente.
                </p>
              )}
              <div className="max-h-[280px] overflow-y-auto admin-scrollbar space-y-1">
                {mapQueueJobs.map((job) => (
                  <div key={job.id} className="rounded border border-[#364561] bg-[#0f1829]/75 px-2 py-1.5">
                  <p className="font-mono break-all">{job.id}</p>
                  <p>
                    status={job.status} retry={job.retryCount}/{job.maxRetries}
                  </p>
                  <p className="text-zinc-500 break-all">wid={job.workshopId} source={job.source}/{job.resolutionSource}</p>
                  {job.lastError && <p className="text-red-300 break-words">err={job.lastError}</p>}
                  <p className="text-zinc-500">
                    next={new Date(job.nextRunAt).toLocaleTimeString('pt-BR')} | update={new Date(job.updatedAt).toLocaleTimeString('pt-BR')}
                  </p>
                  <p className="text-zinc-500 break-all">
                    reports: dl={job.reportSummary.download.status || (job.reportSummary.download.exists ? 'exists' : 'missing')} | ex={job.reportSummary.extract.status || (job.reportSummary.extract.exists ? 'exists' : 'missing')} | pr={job.reportSummary.process.status || (job.reportSummary.process.exists ? 'exists' : 'missing')}
                  </p>
                  {(job.reportSummary.process.sourceioEngineUsed || Number.isFinite(Number(job.reportSummary.process.materialsTotal)) || Number.isFinite(Number(job.reportSummary.process.modelsTotal))) && (
                    <p className="text-zinc-500 break-all">
                      process: engine={job.reportSummary.process.sourceioEngineUsed || 'n/a'} | materials={Number(job.reportSummary.process.materialsWithTexture || 0)}/{Number(job.reportSummary.process.materialsTotal || 0)} | models={Number(job.reportSummary.process.modelsExported || 0)}/{Number(job.reportSummary.process.modelsTotal || 0)} | warnings={Number(job.reportSummary.process.warningsCount || 0)}
                    </p>
                  )}
                  {(job.reportSummary.download.error || job.reportSummary.extract.error || job.reportSummary.process.error) && (
                    <div className="rounded border border-red-900/40 bg-red-950/20 px-2 py-1 mt-1 space-y-0.5">
                      {job.reportSummary.download.error && (
                        <p className="text-red-300 break-words">download: {job.reportSummary.download.error}</p>
                      )}
                      {job.reportSummary.extract.error && (
                        <p className="text-red-300 break-words">extract: {job.reportSummary.extract.error}</p>
                      )}
                      {job.reportSummary.process.error && (
                        <p className="text-red-300 break-words">process: {job.reportSummary.process.error}</p>
                      )}
                    </div>
                  )}
                  {Array.isArray(job.outputTail) && job.outputTail.length > 0 && (
                    <div className="mt-1 rounded border border-[#3d4e70] bg-[#0a1120]/90 px-2 py-1">
                      <p className="text-zinc-500 uppercase font-bold text-[9px] mb-1">output tail</p>
                      {job.outputTail.slice(-6).map((line, idx) => (
                        <p key={`${job.id}_tail_${idx}`} className="text-zinc-400 break-all">
                          {line}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
                ))}
              </div>
            </div>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-[#2f3b53] bg-[#0d1524]/88 p-3 shadow-[0_12px_30px_rgba(0,0,0,0.28)]">
        <div className="flex items-center gap-2 mb-3">
          <Icons.Book className="w-4 h-4 text-cyan-300" />
          <p className="text-zinc-300 uppercase font-bold text-[11px] tracking-[0.11em]">Tutorial de Controles</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 text-[11px]">
          <div className="rounded border border-[#364662] bg-[#111a2b]/80 px-3 py-2">
            <p className="text-zinc-200 font-semibold flex items-center gap-2">
              <Icons.Crosshair className="w-3.5 h-3.5 text-cyan-300" />
              Movimento Principal
            </p>
            <p className="text-zinc-400 mt-1">
              <span className="px-1.5 py-0.5 rounded bg-[#0e1626] border border-[#33415b] font-mono">WASD</span> voo livre seguindo a direcao da camera.
            </p>
          </div>
          <div className="rounded border border-[#364662] bg-[#111a2b]/80 px-3 py-2">
            <p className="text-zinc-200 font-semibold flex items-center gap-2">
              <Icons.Activity className="w-3.5 h-3.5 text-emerald-300" />
              Subir e Descer
            </p>
            <p className="text-zinc-400 mt-1">
              <span className="px-1.5 py-0.5 rounded bg-[#0e1626] border border-[#33415b] font-mono">Q/E</span> ou{' '}
              <span className="px-1.5 py-0.5 rounded bg-[#0e1626] border border-[#33415b] font-mono">Space/C</span> para altitude.
            </p>
          </div>
          <div className="rounded border border-[#364662] bg-[#111a2b]/80 px-3 py-2">
            <p className="text-zinc-200 font-semibold flex items-center gap-2">
              <Icons.Zap className="w-3.5 h-3.5 text-yellow-300" />
              Velocidade
            </p>
            <p className="text-zinc-400 mt-1">
              <span className="px-1.5 py-0.5 rounded bg-[#0e1626] border border-[#33415b] font-mono">Shift</span> acelera e{' '}
              <span className="px-1.5 py-0.5 rounded bg-[#0e1626] border border-[#33415b] font-mono">Ctrl</span> reduz.
            </p>
          </div>
          <div className="rounded border border-[#364662] bg-[#111a2b]/80 px-3 py-2">
            <p className="text-zinc-200 font-semibold flex items-center gap-2">
              <Icons.Settings className="w-3.5 h-3.5 text-cyan-300" />
              Rotacao da Camera
            </p>
            <p className="text-zinc-400 mt-1">
              Arraste com <span className="px-1.5 py-0.5 rounded bg-[#0e1626] border border-[#33415b] font-mono">Botao Esquerdo</span> para girar no proprio eixo.
            </p>
          </div>
          <div className="rounded border border-[#364662] bg-[#111a2b]/80 px-3 py-2">
            <p className="text-zinc-200 font-semibold flex items-center gap-2">
              <Icons.Crosshair className="w-3.5 h-3.5 text-purple-300" />
              Pivo por Clique
            </p>
            <p className="text-zinc-400 mt-1">
              Clique com <span className="px-1.5 py-0.5 rounded bg-[#0e1626] border border-[#33415b] font-mono">Botao do Meio</span> para mudar o pivo no ponto clicado.
            </p>
          </div>
          <div className="rounded border border-[#364662] bg-[#111a2b]/80 px-3 py-2">
            <p className="text-zinc-200 font-semibold flex items-center gap-2">
              <Icons.Search className="w-3.5 h-3.5 text-zinc-300" />
              Zoom e Pan
            </p>
            <p className="text-zinc-400 mt-1">
              <span className="px-1.5 py-0.5 rounded bg-[#0e1626] border border-[#33415b] font-mono">Scroll</span> aproxima/afasta e{' '}
              <span className="px-1.5 py-0.5 rounded bg-[#0e1626] border border-[#33415b] font-mono">Botao Direito</span> move lateralmente.
            </p>
          </div>
          <div className="rounded border border-[#364662] bg-[#111a2b]/80 px-3 py-2 lg:hidden">
            <p className="text-zinc-200 font-semibold flex items-center gap-2">
              <Icons.Crosshair className="w-3.5 h-3.5 text-cyan-300" />
              Mobile
            </p>
            <p className="text-zinc-400 mt-1">
              Joystick esquerdo move, LOOK gira camera, <span className="font-mono">UP/DOWN</span> controla altitude e{' '}
              <span className="font-mono">BOOST</span> acelera.
            </p>
          </div>
        </div>
      </div>

      {showDevTools && (
      <div className="rounded-2xl border border-[#2f3b53] bg-[#0d1524]/88 p-3 shadow-[0_12px_30px_rgba(0,0,0,0.28)]">
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-zinc-400 uppercase font-bold text-[11px] tracking-[0.1em]">Diagnostico de assets (missing/errors)</p>
          <span className="text-[10px] text-zinc-400 font-mono">entries={diagnostics.length}</span>
        </div>
        <div className="max-h-[280px] overflow-y-auto admin-scrollbar space-y-2 text-[11px] font-mono">
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
      )}

      {showViewerSettings && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/80"
            onClick={() => setShowViewerSettings(false)}
            aria-label="Fechar configurações"
          />
          <div className="relative w-full max-w-xl rounded-2xl border border-[#3b4864] bg-[#0e1626] p-4 shadow-[0_24px_64px_rgba(0,0,0,0.5)]">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-zinc-200">Viewer Settings</h3>
              <button
                type="button"
                onClick={() => setShowViewerSettings(false)}
                className="rounded border border-zinc-700 px-2 py-1 text-[10px] font-bold uppercase text-zinc-300 hover:bg-zinc-800"
              >
                Fechar
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <label className="flex items-center justify-between rounded border border-zinc-700 bg-zinc-900/50 px-3 py-2">
                <span className="text-zinc-300">Badge LIVE FRAME</span>
                <input
                  type="checkbox"
                  checked={showViewerHudLiveChip}
                  onChange={(event) => setShowViewerHudLiveChip(event.target.checked)}
                />
              </label>
              <label className="flex items-center justify-between rounded border border-zinc-700 bg-zinc-900/50 px-3 py-2">
                <span className="text-zinc-300">Badge FPS</span>
                <input
                  type="checkbox"
                  checked={showViewerHudFpsChip}
                  onChange={(event) => setShowViewerHudFpsChip(event.target.checked)}
                />
              </label>
              <label className="flex items-center justify-between rounded border border-zinc-700 bg-zinc-900/50 px-3 py-2">
                <span className="text-zinc-300">Painel player selecionado</span>
                <input
                  type="checkbox"
                  checked={showViewerHudSelectedPlayer}
                  onChange={(event) => setShowViewerHudSelectedPlayer(event.target.checked)}
                />
              </label>
              <label className="flex items-center justify-between rounded border border-zinc-700 bg-zinc-900/50 px-3 py-2">
                <span className="text-zinc-300">Labels 3D</span>
                <input
                  type="checkbox"
                  checked={showPlayerLabels}
                  onChange={(event) => setShowPlayerLabels(event.target.checked)}
                />
              </label>
              <label className="flex items-center justify-between rounded border border-zinc-700 bg-zinc-900/50 px-3 py-2">
                <span className="text-zinc-300">HP no label</span>
                <input
                  type="checkbox"
                  checked={showPlayerHealthInLabel}
                  onChange={(event) => setShowPlayerHealthInLabel(event.target.checked)}
                  disabled={!showPlayerLabels}
                />
              </label>
              <label className="flex items-center justify-between rounded border border-zinc-700 bg-zinc-900/50 px-3 py-2 sm:col-span-2">
                <span className="text-zinc-300">Controles mobile (joystick/look)</span>
                <input
                  type="checkbox"
                  checked={mobileControlsEnabled}
                  onChange={(event) => setMobileControlsEnabled(event.target.checked)}
                />
              </label>
              <label className="flex items-center justify-between rounded border border-zinc-700 bg-zinc-900/50 px-3 py-2 sm:col-span-2">
                <span className="text-zinc-300">Mostrar blocos Dev/Debug</span>
                <input
                  type="checkbox"
                  checked={showDevTools}
                  onChange={(event) => setShowDevTools(event.target.checked)}
                />
              </label>
            </div>

            <div className="mt-3 rounded border border-zinc-700 bg-zinc-900/40 p-2 text-[11px] text-zinc-400">
              Dica: o botão Share copia/compartilha um link direto para este viewer com o mapa atual.
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ServerView3D;

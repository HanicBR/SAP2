import type { IncomingMessage } from 'http';
import type { Server as HttpServer } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { prisma } from '../db/client';
import { UserRole } from '../domain';
import { findServerByApiKey } from './serverAuth';
import { ingestPlayerPulse, PlayerPulseIngestError } from './playerPulseIngest';
import { getPlayerPulseSettings } from './playtimePulse';
import {
  ackServerAction,
  claimServerActionsForWsDispatch,
  getServerActionHealthSummary,
  getServerActionRuntimeSnapshot,
  setServerActionEnqueueListener,
  type ServerAction,
} from './serverActions';
import { notifyMapObservedForWorkshop } from './workshopAutoDownload';

const WS_SERVERS_PATH = '/ws/servers';
const WS_ADMIN_VIEWER_PATH = '/ws/admin/viewer';
const MAX_PLAYER_STATE_PLAYERS = 256;
const MAX_PLAYER_STATE_PLAYER_NAME = 80;
const MAX_PLAYER_STATE_MAP_LENGTH = 96;
const MAX_VIEWER_TEAM_NAME_LENGTH = 64;
const MAX_SERVER_ACTIONS_PER_DISPATCH = 20;
const SERVER_ACTION_DISPATCH_TICK_MS = 2_000;
const WS_PRESENCE_TOUCH_MIN_MS = 10_000;
const WS_PRESENCE_TOUCH_FORCE_MS = 30_000;

type WsPresenceRecord = {
  lastTouchMs: number;
  playerCount?: number;
  map?: string;
};

type LiveStatePlayer = {
  steamId: string;
  name?: string;
};

type LiveServerPlayerState = {
  serverId: string;
  receivedAt: string;
  sentAt?: string;
  map?: string;
  playerCount: number;
  players: LiveStatePlayer[];
};

type ViewerStateVector3 = {
  x: number;
  y: number;
  z: number;
};

type ViewerStateAngles = {
  pitch: number;
  yaw: number;
  roll: number;
};

type ViewerStatePlayer = {
  steamId: string;
  name?: string;
  pos: ViewerStateVector3;
  eyeAngles: ViewerStateAngles;
  health?: number;
  armor?: number;
  teamId?: number;
  teamName?: string;
  alive?: boolean;
};

type LiveServerViewerState = {
  serverId: string;
  receivedAt: string;
  sentAt?: string;
  map?: string;
  playerCount: number;
  players: ViewerStatePlayer[];
};

type ConnectedServerSocket = {
  serverId: string;
  connectedAt: string;
  lastMessageAt: string;
  messagesReceived: number;
  invalidMessages: number;
  playerPulseMessages: number;
  playerStateMessages: number;
  viewerStateMessages: number;
  serverActionMessages: number;
  serverActionAckMessages: number;
  serverActionAckOk: number;
  serverActionAckFailed: number;
  playerPulseInserted: number;
  playerPulseDeduplicated: number;
  lastPulseAt?: string;
  lastStateAt?: string;
  lastStatePlayers?: number;
  lastViewerStateAt?: string;
  lastViewerPlayers?: number;
  lastActionSentAt?: string;
  lastActionId?: string;
  lastActionAckAt?: string;
  lastActionAckId?: string;
  lastActionAckError?: string;
  lastErrorAt?: string;
  lastErrorReason?: string;
  remoteAddress?: string;
  userAgent?: string;
  socket: WebSocket;
};

type UpgradeError = {
  statusCode: number;
  message: string;
};

type WsAuthUser = {
  id: string;
  username: string;
  email: string;
  role: UserRole;
};

type AdminViewerConnection = {
  connectedAt: string;
  lastMessageAt: string;
  messagesReceived: number;
  invalidMessages: number;
  subscribedServerId?: string;
  remoteAddress?: string;
  userAgent?: string;
  user: WsAuthUser;
  socket: WebSocket;
};

const connectedByServerId = new Map<string, ConnectedServerSocket>();
const liveStateByServerId = new Map<string, LiveServerPlayerState>();
const viewerStateByServerId = new Map<string, LiveServerViewerState>();
const wsPresenceByServerId = new Map<string, WsPresenceRecord>();
const adminViewerConnections = new Map<WebSocket, AdminViewerConnection>();

let initialized = false;
let wsServer: WebSocketServer | null = null;
let actionDispatchTimer: NodeJS.Timeout | null = null;

const nowIso = () => new Date().toISOString();
const getJwtSecret = () => process.env.JWT_SECRET || 'dev-secret-change-me';

const roleOrder = [UserRole.USER, UserRole.MODERATOR, UserRole.ADMIN, UserRole.SUPERADMIN];

const isRoleAtLeast = (role: UserRole, minRole: UserRole): boolean => {
  const userIndex = roleOrder.indexOf(role);
  const minIndex = roleOrder.indexOf(minRole);
  if (userIndex < 0 || minIndex < 0) return false;
  return userIndex >= minIndex;
};

const toOptionalString = (value: unknown): string | undefined => {
  const parsed = String(value ?? '').trim();
  return parsed || undefined;
};

const parseRequestUrl = (req: IncomingMessage): URL | undefined => {
  const rawUrl = toOptionalString(req.url);
  const host = toOptionalString(req.headers.host) || 'localhost';
  if (!rawUrl) return undefined;
  try {
    return new URL(rawUrl, `http://${host}`);
  } catch {
    return undefined;
  }
};

const parsePathName = (req: IncomingMessage): string | undefined => parseRequestUrl(req)?.pathname;

const pickClientIp = (req: IncomingMessage): string | undefined => {
  const forwarded = toOptionalString(req.headers['x-forwarded-for']);
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const remote = toOptionalString(req.socket?.remoteAddress);
  return remote;
};

const rejectUpgrade = (socket: Duplex, statusCode: number, reason: string) => {
  if (socket.destroyed) return;
  socket.write(
    `HTTP/1.1 ${statusCode} ${reason}\r\n` +
      'Connection: close\r\n' +
      'Content-Type: text/plain\r\n' +
      `Content-Length: ${Buffer.byteLength(reason)}\r\n\r\n` +
      reason,
  );
  socket.destroy();
};

const buildUpgradeError = (statusCode: number, message: string): UpgradeError => ({
  statusCode,
  message,
});

const toRawText = (raw: RawData): string => {
  if (typeof raw === 'string') return raw;
  if (Buffer.isBuffer(raw)) return raw.toString('utf8');
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
  return Buffer.from(raw).toString('utf8');
};

const parseJsonMessage = (raw: RawData): any | null => {
  const text = toRawText(raw);
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const parsePositiveInt = (value: unknown): number | undefined => {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed)) return undefined;
  if (parsed < 0) return undefined;
  return parsed;
};

const parseFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number.parseFloat(String(value ?? '').trim());
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
};

const sanitizeWsMap = (value: unknown): string | undefined => {
  const parsed = toOptionalString(value);
  if (!parsed) return undefined;
  return parsed.slice(0, MAX_PLAYER_STATE_MAP_LENGTH);
};

const touchServerPresenceFromWs = (
  serverId: string,
  update?: {
    playerCount?: number;
    map?: string;
  },
) => {
  const nowMs = Date.now();
  const current = wsPresenceByServerId.get(serverId);
  const nextPlayerCount =
    typeof update?.playerCount === 'number' && Number.isFinite(update.playerCount)
      ? Math.max(0, Math.min(1000, Math.floor(update.playerCount)))
      : undefined;
  const nextMap = sanitizeWsMap(update?.map);

  const playerCountChanged =
    nextPlayerCount !== undefined && nextPlayerCount !== current?.playerCount;
  const mapChanged = nextMap !== undefined && nextMap !== current?.map;
  const idleTooLong = !current || nowMs - current.lastTouchMs >= WS_PRESENCE_TOUCH_FORCE_MS;
  const touchedRecently = Boolean(current && nowMs - current.lastTouchMs < WS_PRESENCE_TOUCH_MIN_MS);

  if (!idleTooLong && !playerCountChanged && !mapChanged && touchedRecently) {
    return;
  }

  const data: any = {
    lastHeartbeat: new Date(nowMs),
    status: 'ONLINE',
  };
  if (nextPlayerCount !== undefined) {
    data.currentPlayers = nextPlayerCount;
  }
  if (nextMap) {
    data.currentMap = nextMap;
    notifyMapObservedForWorkshop({
      serverId,
      mapName: nextMap,
      source: 'viewer_state',
    });
  }

  const nextRecord: WsPresenceRecord = {
    lastTouchMs: nowMs,
  };
  const mergedPlayerCount =
    nextPlayerCount !== undefined ? nextPlayerCount : current?.playerCount;
  const mergedMap = nextMap !== undefined ? nextMap : current?.map;
  if (mergedPlayerCount !== undefined) {
    nextRecord.playerCount = mergedPlayerCount;
  }
  if (mergedMap !== undefined) {
    nextRecord.map = mergedMap;
  }
  wsPresenceByServerId.set(serverId, nextRecord);

  void prisma.gameServer
    .update({
      where: { id: serverId },
      data,
    })
    .catch((err: any) => {
      console.error('Server WS presence touch error', {
        serverId,
        error: err?.message || String(err),
      });
    });
};

const isTrackableSteamId = (value: unknown): value is string => {
  const raw = String(value || '').trim();
  if (!raw) return false;
  const upper = raw.toUpperCase();
  if (upper === 'BOT' || upper === 'CONSOLE' || upper === 'UNKNOWN' || upper === 'NULL') {
    return false;
  }
  return /^STEAM_[0-5]:[01]:\d+$/.test(raw);
};

const parseOptionalIsoDate = (value: unknown): string | undefined => {
  const raw = toOptionalString(value);
  if (!raw) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
};

const sanitizePlayerStatePayload = (input: unknown): Omit<LiveServerPlayerState, 'serverId' | 'receivedAt'> => {
  const body = (input && typeof input === 'object' ? input : {}) as any;
  const playersRaw = Array.isArray(body.players) ? body.players : [];

  const seenSteamId = new Set<string>();
  const players: LiveStatePlayer[] = [];
  playersRaw.forEach((raw: any) => {
    if (players.length >= MAX_PLAYER_STATE_PLAYERS) return;
    const steamId = String(raw?.steamId || '').trim();
    if (!isTrackableSteamId(steamId)) return;
    if (seenSteamId.has(steamId)) return;
    seenSteamId.add(steamId);

    const parsedName = toOptionalString(raw?.name);
    players.push({
      steamId,
      ...(parsedName ? { name: parsedName.slice(0, MAX_PLAYER_STATE_PLAYER_NAME) } : {}),
    });
  });

  const mapRaw = toOptionalString(body.map);
  const map = mapRaw ? mapRaw.slice(0, MAX_PLAYER_STATE_MAP_LENGTH) : undefined;
  const sentAt = parseOptionalIsoDate(body.sentAt);
  const parsedPlayerCount = parsePositiveInt(body.playerCount);
  const playerCount = Math.max(0, Math.min(1000, parsedPlayerCount ?? players.length));

  return {
    ...(sentAt ? { sentAt } : {}),
    ...(map ? { map } : {}),
    playerCount,
    players,
  };
};

const sanitizeViewerVector3 = (raw: any): ViewerStateVector3 => {
  const x = parseFiniteNumber(raw?.x);
  const y = parseFiniteNumber(raw?.y);
  const z = parseFiniteNumber(raw?.z);
  return {
    x: Number.isFinite(x) ? Number(x) : 0,
    y: Number.isFinite(y) ? Number(y) : 0,
    z: Number.isFinite(z) ? Number(z) : 0,
  };
};

const sanitizeViewerAngles = (raw: any): ViewerStateAngles => {
  const pitchRaw = parseFiniteNumber(raw?.pitch ?? raw?.p);
  const yawRaw = parseFiniteNumber(raw?.yaw ?? raw?.y);
  const rollRaw = parseFiniteNumber(raw?.roll ?? raw?.r);
  return {
    pitch: Number.isFinite(pitchRaw) ? Number(pitchRaw) : 0,
    yaw: Number.isFinite(yawRaw) ? Number(yawRaw) : 0,
    roll: Number.isFinite(rollRaw) ? Number(rollRaw) : 0,
  };
};

const sanitizeViewerStatePayload = (
  input: unknown,
): Omit<LiveServerViewerState, 'serverId' | 'receivedAt'> => {
  const body = (input && typeof input === 'object' ? input : {}) as any;
  const playersRaw = Array.isArray(body.players) ? body.players : [];

  const seenSteamId = new Set<string>();
  const players: ViewerStatePlayer[] = [];
  playersRaw.forEach((raw: any) => {
    if (players.length >= MAX_PLAYER_STATE_PLAYERS) return;
    const steamId = String(raw?.steamId || '').trim();
    if (!isTrackableSteamId(steamId)) return;
    if (seenSteamId.has(steamId)) return;
    seenSteamId.add(steamId);

    const parsedName = toOptionalString(raw?.name);
    const teamName = toOptionalString(raw?.teamName)?.slice(0, MAX_VIEWER_TEAM_NAME_LENGTH);
    const health = parsePositiveInt(raw?.health);
    const armor = parsePositiveInt(raw?.armor);
    const teamId = parsePositiveInt(raw?.teamId);
    const posRaw = raw?.pos ?? raw?.position ?? raw?.origin;
    const eyeAnglesRaw = raw?.eyeAngles ?? raw?.angles ?? raw?.ang;
    const alive = typeof raw?.alive === 'boolean' ? raw.alive : undefined;

    players.push({
      steamId,
      ...(parsedName ? { name: parsedName.slice(0, MAX_PLAYER_STATE_PLAYER_NAME) } : {}),
      pos: sanitizeViewerVector3(posRaw),
      eyeAngles: sanitizeViewerAngles(eyeAnglesRaw),
      ...(health !== undefined ? { health } : {}),
      ...(armor !== undefined ? { armor } : {}),
      ...(teamId !== undefined ? { teamId } : {}),
      ...(teamName ? { teamName } : {}),
      ...(alive !== undefined ? { alive } : {}),
    });
  });

  const mapRaw = toOptionalString(body.map);
  const map = mapRaw ? mapRaw.slice(0, MAX_PLAYER_STATE_MAP_LENGTH) : undefined;
  const sentAt = parseOptionalIsoDate(body.sentAt);
  const parsedPlayerCount = parsePositiveInt(body.playerCount);
  const playerCount = Math.max(0, Math.min(1000, parsedPlayerCount ?? players.length));

  return {
    ...(sentAt ? { sentAt } : {}),
    ...(map ? { map } : {}),
    playerCount,
    players,
  };
};

const mapViewerStateOutbound = (snapshot: LiveServerViewerState) => ({
  serverId: snapshot.serverId,
  receivedAt: snapshot.receivedAt,
  ...(snapshot.sentAt ? { sentAt: snapshot.sentAt } : {}),
  ...(snapshot.map ? { map: snapshot.map } : {}),
  playerCount: snapshot.playerCount,
  players: snapshot.players,
});

const trySend = (socket: WebSocket, payload: Record<string, unknown>) => {
  if (socket.readyState !== 1) return;
  socket.send(JSON.stringify(payload));
};

const broadcastViewerState = (snapshot: LiveServerViewerState) => {
  adminViewerConnections.forEach((connection) => {
    if (connection.subscribedServerId !== snapshot.serverId) return;
    trySend(connection.socket, {
      type: 'viewer_state',
      ...mapViewerStateOutbound(snapshot),
    });
  });
};

const detachSocketIfCurrent = (serverId: string, socket: WebSocket) => {
  const active = connectedByServerId.get(serverId);
  if (!active || active.socket !== socket) return;
  connectedByServerId.delete(serverId);
};

const markSocketError = (state: ConnectedServerSocket, reason: string) => {
  state.invalidMessages += 1;
  state.lastErrorAt = nowIso();
  state.lastErrorReason = reason;
};

const mapServerActionPayload = (action: ServerAction) => ({
  id: action.id,
  actionId: action.id,
  command: action.command,
  createdAt: action.createdAt,
  ...(action.metadata ? { metadata: action.metadata } : {}),
});

const dispatchPendingServerActions = (serverId: string, limit = MAX_SERVER_ACTIONS_PER_DISPATCH) => {
  const active = connectedByServerId.get(serverId);
  if (!active || active.socket.readyState !== 1) return 0;

  const pending = claimServerActionsForWsDispatch(serverId, limit);
  if (!pending.length) return 0;

  const sentAt = nowIso();
  pending.forEach((action) => {
    trySend(active.socket, {
      type: 'server_action',
      serverId,
      payload: mapServerActionPayload(action),
    });
    active.serverActionMessages += 1;
    active.lastActionSentAt = sentAt;
    active.lastActionId = action.id;
  });

  return pending.length;
};

const attachServerSocket = (
  socket: WebSocket,
  request: IncomingMessage,
  serverId: string,
) => {
  const previous = connectedByServerId.get(serverId);
  if (previous && previous.socket !== socket) {
    previous.socket.close(4000, 'Replaced by newer connection');
  }

  const connectedAt = nowIso();
  const remoteAddress = pickClientIp(request);
  const userAgent = toOptionalString(request.headers['user-agent']);
  const state: ConnectedServerSocket = {
    serverId,
    connectedAt,
    lastMessageAt: connectedAt,
    messagesReceived: 0,
    invalidMessages: 0,
    playerPulseMessages: 0,
    playerStateMessages: 0,
    viewerStateMessages: 0,
    serverActionMessages: 0,
    serverActionAckMessages: 0,
    serverActionAckOk: 0,
    serverActionAckFailed: 0,
    playerPulseInserted: 0,
    playerPulseDeduplicated: 0,
    socket,
    ...(remoteAddress ? { remoteAddress } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
  connectedByServerId.set(serverId, state);
  touchServerPresenceFromWs(serverId);

  socket.on('message', (buffer: RawData, isBinary: boolean) => {
    state.lastMessageAt = nowIso();
    state.messagesReceived += 1;

    if (isBinary) {
      markSocketError(state, 'binary_not_supported');
      trySend(socket, { type: 'error', reason: 'binary_not_supported' });
      return;
    }

    const parsed = parseJsonMessage(buffer);
    if (!parsed || typeof parsed !== 'object') {
      markSocketError(state, 'invalid_json');
      trySend(socket, { type: 'error', reason: 'invalid_json' });
      return;
    }

    const type = toOptionalString((parsed as any).type)?.toLowerCase();
    if (type === 'ping') {
      touchServerPresenceFromWs(serverId);
      trySend(socket, { type: 'pong', now: nowIso() });
      return;
    }

    if (type === 'player_pulse') {
      state.playerPulseMessages += 1;
      const payload = (parsed as any).payload ?? (parsed as any).data ?? parsed;
      const pulsePlayerCount = parsePositiveInt(payload?.playerCount);
      const pulseMap = sanitizeWsMap(payload?.map);
      touchServerPresenceFromWs(serverId, {
        ...(pulsePlayerCount !== undefined ? { playerCount: pulsePlayerCount } : {}),
        ...(pulseMap !== undefined ? { map: pulseMap } : {}),
      });

      void (async () => {
        try {
          const result = await ingestPlayerPulse(serverId, payload);
          state.lastPulseAt = nowIso();
          state.playerPulseInserted += result.inserted;
          state.playerPulseDeduplicated += result.deduplicated;
          trySend(socket, {
            type: 'player_pulse_ack',
            ...result,
          });
        } catch (err: any) {
          if (err instanceof PlayerPulseIngestError) {
            markSocketError(state, err.code);
            const disabledSource =
              err.code === 'player_pulse_disabled' ? getPlayerPulseSettings().source : undefined;
            trySend(socket, {
              type: 'player_pulse_ack',
              ok: false,
              error: err.code,
              ...(disabledSource ? { source: disabledSource } : {}),
            });
            return;
          }
          const message = toOptionalString(err?.message) || 'player_pulse_ingest_failed';
          markSocketError(state, message);
          console.error('Server WS player_pulse ingest error', {
            serverId,
            error: message,
          });
          trySend(socket, {
            type: 'player_pulse_ack',
            ok: false,
            error: 'player_pulse_ingest_failed',
          });
        }
      })();
      return;
    }

    if (type === 'player_state') {
      state.playerStateMessages += 1;
      const payload = (parsed as any).payload ?? (parsed as any).data ?? parsed;
      const sanitizedState = sanitizePlayerStatePayload(payload);
      const receivedAt = nowIso();
      const snapshot: LiveServerPlayerState = {
        serverId,
        receivedAt,
        ...sanitizedState,
      };
      liveStateByServerId.set(serverId, snapshot);
      state.lastStateAt = receivedAt;
      state.lastStatePlayers = snapshot.playerCount;
      touchServerPresenceFromWs(serverId, {
        playerCount: snapshot.playerCount,
        ...(snapshot.map !== undefined ? { map: snapshot.map } : {}),
      });

      trySend(socket, {
        type: 'player_state_ack',
        ok: true,
        serverId,
        receivedAt,
        playerCount: snapshot.playerCount,
        playersReceived: snapshot.players.length,
      });
      return;
    }

    if (type === 'viewer_state') {
      state.viewerStateMessages += 1;
      const payload = (parsed as any).payload ?? (parsed as any).data ?? parsed;
      const sanitizedState = sanitizeViewerStatePayload(payload);
      const receivedAt = nowIso();
      const snapshot: LiveServerViewerState = {
        serverId,
        receivedAt,
        ...sanitizedState,
      };
      viewerStateByServerId.set(serverId, snapshot);
      broadcastViewerState(snapshot);
      state.lastViewerStateAt = receivedAt;
      state.lastViewerPlayers = snapshot.playerCount;
      touchServerPresenceFromWs(serverId, {
        playerCount: snapshot.playerCount,
        ...(snapshot.map !== undefined ? { map: snapshot.map } : {}),
      });

      trySend(socket, {
        type: 'viewer_state_ack',
        ok: true,
        serverId,
        receivedAt,
        playerCount: snapshot.playerCount,
        playersReceived: snapshot.players.length,
      });
      return;
    }

    if (type === 'server_action_ack') {
      state.serverActionAckMessages += 1;
      const payload = (parsed as any).payload ?? (parsed as any).data ?? parsed;
      const actionId = toOptionalString(payload?.actionId || payload?.id);
      if (!actionId) {
        markSocketError(state, 'server_action_ack_missing_id');
        trySend(socket, { type: 'error', reason: 'server_action_ack_missing_id' });
        return;
      }

      const ackOk = payload?.ok !== false;
      const ackAt = nowIso();
      state.lastActionAckAt = ackAt;
      state.lastActionAckId = actionId;

      if (!ackOk) {
        const reason = toOptionalString(payload?.error || payload?.reason) || 'server_action_failed';
        state.serverActionAckFailed += 1;
        state.lastActionAckError = reason;
        ackServerAction(serverId, actionId, false, reason);
      } else {
        state.serverActionAckOk += 1;
        ackServerAction(serverId, actionId, true);
      }

      dispatchPendingServerActions(serverId);
      return;
    }

    markSocketError(state, 'unknown_message_type');
    trySend(socket, { type: 'error', reason: 'unknown_message_type' });
  });

  socket.on('pong', () => {
    state.lastMessageAt = nowIso();
    touchServerPresenceFromWs(serverId);
    dispatchPendingServerActions(serverId);
  });

  socket.on('close', () => {
    detachSocketIfCurrent(serverId, socket);
  });

  socket.on('error', (err: Error) => {
    markSocketError(state, toOptionalString(err?.message) || 'socket_error');
    console.error('Server WS socket error', {
      serverId,
      error: err?.message || String(err),
    });
  });

  trySend(socket, {
    type: 'connected',
    serverId,
    connectedAt,
    transport: 'websocket',
    fallback: 'http',
  });
  dispatchPendingServerActions(serverId);
}

const authenticateUpgrade = async (request: IncomingMessage) => {
  const apiKey = toOptionalString(request.headers['x-server-key']);
  if (!apiKey) {
    throw buildUpgradeError(401, 'Missing server API key');
  }

  const server = await findServerByApiKey(apiKey);
  if (!server) {
    throw buildUpgradeError(403, 'Invalid server key');
  }

  return server;
};

const readBearerTokenFromRequest = (request: IncomingMessage): string | undefined => {
  const authHeader = toOptionalString(request.headers.authorization);
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const tokenFromHeader = toOptionalString(authHeader.slice('Bearer '.length));
    if (tokenFromHeader) return tokenFromHeader;
  }

  const parsed = parseRequestUrl(request);
  const tokenFromQuery = toOptionalString(parsed?.searchParams.get('token') || undefined);
  if (tokenFromQuery) return tokenFromQuery;
  return undefined;
};

const authenticateAdminViewerUpgrade = async (request: IncomingMessage): Promise<WsAuthUser> => {
  const token = readBearerTokenFromRequest(request);
  if (!token) {
    throw buildUpgradeError(401, 'Missing authorization token');
  }

  let payload: WsAuthUser;
  try {
    payload = jwt.verify(token, getJwtSecret()) as WsAuthUser;
  } catch {
    throw buildUpgradeError(401, 'Invalid or expired token');
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.id },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
    },
  });
  if (!user) {
    throw buildUpgradeError(401, 'Invalid token (user not found)');
  }

  const role = user.role as UserRole;
  if (!isRoleAtLeast(role, UserRole.ADMIN)) {
    throw buildUpgradeError(403, 'Forbidden');
  }

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role,
  };
};

const attachAdminViewerSocket = (
  socket: WebSocket,
  request: IncomingMessage,
  user: WsAuthUser,
) => {
  const connectedAt = nowIso();
  const remoteAddress = pickClientIp(request);
  const userAgent = toOptionalString(request.headers['user-agent']);
  const state: AdminViewerConnection = {
    connectedAt,
    lastMessageAt: connectedAt,
    messagesReceived: 0,
    invalidMessages: 0,
    user,
    socket,
    ...(remoteAddress ? { remoteAddress } : {}),
    ...(userAgent ? { userAgent } : {}),
  };

  adminViewerConnections.set(socket, state);

  socket.on('message', (buffer: RawData, isBinary: boolean) => {
    state.lastMessageAt = nowIso();
    state.messagesReceived += 1;

    if (isBinary) {
      state.invalidMessages += 1;
      trySend(socket, { type: 'error', reason: 'binary_not_supported' });
      return;
    }

    const parsed = parseJsonMessage(buffer);
    if (!parsed || typeof parsed !== 'object') {
      state.invalidMessages += 1;
      trySend(socket, { type: 'error', reason: 'invalid_json' });
      return;
    }

    const type = toOptionalString((parsed as any).type)?.toLowerCase();
    if (type === 'ping') {
      trySend(socket, { type: 'pong', now: nowIso() });
      return;
    }

    if (type === 'subscribe') {
      const payload = (parsed as any).payload ?? (parsed as any).data ?? parsed;
      const serverId = toOptionalString(payload?.serverId || payload?.id);
      if (!serverId) {
        state.invalidMessages += 1;
        trySend(socket, { type: 'error', reason: 'subscribe_missing_server_id' });
        return;
      }
      state.subscribedServerId = serverId;
      trySend(socket, {
        type: 'subscribed',
        serverId,
        at: nowIso(),
      });

      const snapshot = viewerStateByServerId.get(serverId);
      if (snapshot) {
        trySend(socket, {
          type: 'viewer_state',
          initial: true,
          ...mapViewerStateOutbound(snapshot),
        });
      } else {
        trySend(socket, {
          type: 'viewer_state_unavailable',
          serverId,
          available: false,
        });
      }
      return;
    }

    if (type === 'unsubscribe') {
      const unsubscribedServerId = state.subscribedServerId;
      delete state.subscribedServerId;
      trySend(socket, {
        type: 'unsubscribed',
        ...(unsubscribedServerId ? { serverId: unsubscribedServerId } : {}),
        at: nowIso(),
      });
      return;
    }

    if (type === 'get_state') {
      const payload = (parsed as any).payload ?? (parsed as any).data ?? parsed;
      const serverId = toOptionalString(payload?.serverId || state.subscribedServerId);
      if (!serverId) {
        state.invalidMessages += 1;
        trySend(socket, { type: 'error', reason: 'get_state_missing_server_id' });
        return;
      }
      const snapshot = viewerStateByServerId.get(serverId);
      if (snapshot) {
        trySend(socket, {
          type: 'viewer_state',
          initial: true,
          ...mapViewerStateOutbound(snapshot),
        });
      } else {
        trySend(socket, {
          type: 'viewer_state_unavailable',
          serverId,
          available: false,
        });
      }
      return;
    }

    state.invalidMessages += 1;
    trySend(socket, { type: 'error', reason: 'unknown_message_type' });
  });

  socket.on('close', () => {
    adminViewerConnections.delete(socket);
  });

  socket.on('error', (err: Error) => {
    state.invalidMessages += 1;
    console.error('Admin viewer WS socket error', {
      userId: state.user.id,
      error: err?.message || String(err),
    });
  });

  trySend(socket, {
    type: 'connected',
    path: WS_ADMIN_VIEWER_PATH,
    transport: 'websocket',
    connectedAt,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
    },
  });
};

export const initializeServerWebSocket = (httpServer: HttpServer) => {
  if (initialized) return;
  initialized = true;
  wsServer = new WebSocketServer({ noServer: true });
  setServerActionEnqueueListener((serverId) => {
    dispatchPendingServerActions(serverId);
  });

  actionDispatchTimer = setInterval(() => {
    connectedByServerId.forEach((_state, serverId) => {
      dispatchPendingServerActions(serverId);
    });
  }, SERVER_ACTION_DISPATCH_TICK_MS);
  actionDispatchTimer.unref?.();

  httpServer.on('upgrade', (request, socket, head) => {
    const pathname = parsePathName(request);
    if (pathname !== WS_SERVERS_PATH && pathname !== WS_ADMIN_VIEWER_PATH) {
      rejectUpgrade(socket, 404, 'Not Found');
      return;
    }

    socket.on('error', (err: Error) => {
      console.error('Server WS upgrade socket error', err?.message || String(err));
    });

    void (async () => {
      try {
        if (!wsServer) {
          rejectUpgrade(socket, 503, 'WebSocket server unavailable');
          return;
        }

        if (pathname === WS_ADMIN_VIEWER_PATH) {
          const authenticatedAdmin = await authenticateAdminViewerUpgrade(request);
          wsServer.handleUpgrade(request, socket, head, (ws: WebSocket) => {
            attachAdminViewerSocket(ws, request, authenticatedAdmin);
          });
          return;
        }

        const authenticatedServer = await authenticateUpgrade(request);
        wsServer.handleUpgrade(request, socket, head, (ws: WebSocket) => {
          attachServerSocket(ws, request, authenticatedServer.id);
        });
      } catch (err: any) {
        const statusCode = Number(err?.statusCode);
        const message = toOptionalString(err?.message) || 'Upgrade rejected';
        if (Number.isFinite(statusCode) && statusCode >= 400 && statusCode < 600) {
          rejectUpgrade(socket, statusCode, message);
          return;
        }
        console.error('Server WS upgrade auth error', err?.message || err);
        rejectUpgrade(socket, 500, 'Internal Server Error');
      }
    })();
  });
};

export const getServerWsHealthSnapshot = () => {
  const nowMs = Date.now();
  const actionSummary = getServerActionHealthSummary();
  const viewerSubscribersByServerId = new Map<string, number>();
  let adminViewerInvalidMessagesTotal = 0;
  let adminViewerMessagesReceivedTotal = 0;
  adminViewerConnections.forEach((connection) => {
    adminViewerMessagesReceivedTotal += connection.messagesReceived;
    adminViewerInvalidMessagesTotal += connection.invalidMessages;
    const serverId = connection.subscribedServerId;
    if (!serverId) return;
    viewerSubscribersByServerId.set(serverId, (viewerSubscribersByServerId.get(serverId) || 0) + 1);
  });

  const servers = Array.from(connectedByServerId.values())
    .map((entry) => {
      const idleSeconds = Math.max(
        0,
        Math.floor((nowMs - new Date(entry.lastMessageAt).getTime()) / 1000),
      );
      const actionRuntime = getServerActionRuntimeSnapshot(entry.serverId);
      return {
        serverId: entry.serverId,
        connectedAt: entry.connectedAt,
        lastMessageAt: entry.lastMessageAt,
        idleSeconds,
        messagesReceived: entry.messagesReceived,
        invalidMessages: entry.invalidMessages,
        playerPulseMessages: entry.playerPulseMessages,
        playerStateMessages: entry.playerStateMessages,
        viewerStateMessages: entry.viewerStateMessages,
        serverActionMessages: entry.serverActionMessages,
        serverActionAckMessages: entry.serverActionAckMessages,
        serverActionAckOk: entry.serverActionAckOk,
        serverActionAckFailed: entry.serverActionAckFailed,
        playerPulseInserted: entry.playerPulseInserted,
        playerPulseDeduplicated: entry.playerPulseDeduplicated,
        actionQueue: actionRuntime.queueSize,
        actionPendingWsAck: actionRuntime.pendingWsAck,
        actionHttpEligible: actionRuntime.httpEligible,
        actionQueuedTotal: actionRuntime.queuedTotal,
        actionWsSentTotal: actionRuntime.wsSentTotal,
        actionWsAckedTotal: actionRuntime.wsAckedTotal,
        actionWsAckErrorTotal: actionRuntime.wsAckErrorTotal,
        actionWsRetryTotal: actionRuntime.wsRetryTotal,
        actionHttpPulledTotal: actionRuntime.httpPulledTotal,
        viewerSubscribers: viewerSubscribersByServerId.get(entry.serverId) || 0,
        ...(entry.lastPulseAt ? { lastPulseAt: entry.lastPulseAt } : {}),
        ...(entry.lastStateAt ? { lastStateAt: entry.lastStateAt } : {}),
        ...(entry.lastStatePlayers !== undefined ? { lastStatePlayers: entry.lastStatePlayers } : {}),
        ...(entry.lastViewerStateAt ? { lastViewerStateAt: entry.lastViewerStateAt } : {}),
        ...(entry.lastViewerPlayers !== undefined ? { lastViewerPlayers: entry.lastViewerPlayers } : {}),
        ...(entry.lastActionSentAt ? { lastActionSentAt: entry.lastActionSentAt } : {}),
        ...(entry.lastActionId ? { lastActionId: entry.lastActionId } : {}),
        ...(entry.lastActionAckAt ? { lastActionAckAt: entry.lastActionAckAt } : {}),
        ...(entry.lastActionAckId ? { lastActionAckId: entry.lastActionAckId } : {}),
        ...(entry.lastActionAckError ? { lastActionAckError: entry.lastActionAckError } : {}),
        ...(entry.lastErrorAt ? { lastErrorAt: entry.lastErrorAt } : {}),
        ...(entry.lastErrorReason ? { lastErrorReason: entry.lastErrorReason } : {}),
        ...(entry.remoteAddress ? { remoteAddress: entry.remoteAddress } : {}),
        ...(entry.userAgent ? { userAgent: entry.userAgent } : {}),
      };
    })
    .sort((left, right) => left.serverId.localeCompare(right.serverId));

  return {
    path: WS_SERVERS_PATH,
    adminViewerPath: WS_ADMIN_VIEWER_PATH,
    connectedServers: servers.length,
    serversWithLiveState: liveStateByServerId.size,
    serversWithViewerState: viewerStateByServerId.size,
    adminViewerConnected: adminViewerConnections.size,
    adminViewerSubscribed: Array.from(adminViewerConnections.values()).filter(
      (connection) => Boolean(connection.subscribedServerId),
    ).length,
    adminViewerMessagesReceivedTotal,
    adminViewerInvalidMessagesTotal,
    serverActions: actionSummary,
    now: nowIso(),
    servers,
  };
};

export const getServerWsLiveState = (serverId: string) => {
  const liveState = liveStateByServerId.get(serverId);
  if (!liveState) return null;

  const nowMs = Date.now();
  const receivedMs = new Date(liveState.receivedAt).getTime();
  const ageSeconds = Number.isFinite(receivedMs)
    ? Math.max(0, Math.floor((nowMs - receivedMs) / 1000))
    : undefined;
  const activeConnection = connectedByServerId.get(serverId);

  return {
    serverId,
    transport: 'websocket' as const,
    connected: Boolean(activeConnection),
    ...(activeConnection ? { wsConnectedAt: activeConnection.connectedAt } : {}),
    receivedAt: liveState.receivedAt,
    ...(ageSeconds !== undefined ? { ageSeconds } : {}),
    ...(liveState.sentAt ? { sentAt: liveState.sentAt } : {}),
    ...(liveState.map ? { map: liveState.map } : {}),
    playerCount: liveState.playerCount,
    players: liveState.players,
  };
};

export const getServerWsViewerState = (serverId: string) => {
  const viewerState = viewerStateByServerId.get(serverId);
  if (!viewerState) return null;

  const nowMs = Date.now();
  const receivedMs = new Date(viewerState.receivedAt).getTime();
  const ageSeconds = Number.isFinite(receivedMs)
    ? Math.max(0, Math.floor((nowMs - receivedMs) / 1000))
    : undefined;
  const activeConnection = connectedByServerId.get(serverId);

  return {
    serverId,
    transport: 'websocket' as const,
    connected: Boolean(activeConnection),
    ...(activeConnection ? { wsConnectedAt: activeConnection.connectedAt } : {}),
    receivedAt: viewerState.receivedAt,
    ...(ageSeconds !== undefined ? { ageSeconds } : {}),
    ...(viewerState.sentAt ? { sentAt: viewerState.sentAt } : {}),
    ...(viewerState.map ? { map: viewerState.map } : {}),
    playerCount: viewerState.playerCount,
    players: viewerState.players,
  };
};

export const getAllServerWsLiveState = () =>
  Array.from(liveStateByServerId.keys())
    .map((serverId) => getServerWsLiveState(serverId))
    .filter((entry): entry is NonNullable<ReturnType<typeof getServerWsLiveState>> => Boolean(entry))
    .sort((left, right) => left.serverId.localeCompare(right.serverId));

export const getAllServerWsViewerState = () =>
  Array.from(viewerStateByServerId.keys())
    .map((serverId) => getServerWsViewerState(serverId))
    .filter((entry): entry is NonNullable<ReturnType<typeof getServerWsViewerState>> => Boolean(entry))
    .sort((left, right) => left.serverId.localeCompare(right.serverId));

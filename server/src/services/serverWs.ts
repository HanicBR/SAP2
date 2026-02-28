import type { IncomingMessage } from 'http';
import type { Server as HttpServer } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { findServerByApiKey } from './serverAuth';
import { ingestPlayerPulse, PlayerPulseIngestError } from './playerPulseIngest';
import { getPlayerPulseSettings } from './playtimePulse';

const WS_SERVERS_PATH = '/ws/servers';
const MAX_PLAYER_STATE_PLAYERS = 256;
const MAX_PLAYER_STATE_PLAYER_NAME = 80;
const MAX_PLAYER_STATE_MAP_LENGTH = 96;

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

type ConnectedServerSocket = {
  serverId: string;
  connectedAt: string;
  lastMessageAt: string;
  messagesReceived: number;
  invalidMessages: number;
  playerPulseMessages: number;
  playerStateMessages: number;
  playerPulseInserted: number;
  playerPulseDeduplicated: number;
  lastPulseAt?: string;
  lastStateAt?: string;
  lastStatePlayers?: number;
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

const connectedByServerId = new Map<string, ConnectedServerSocket>();
const liveStateByServerId = new Map<string, LiveServerPlayerState>();

let initialized = false;
let wsServer: WebSocketServer | null = null;

const nowIso = () => new Date().toISOString();

const toOptionalString = (value: unknown): string | undefined => {
  const parsed = String(value ?? '').trim();
  return parsed || undefined;
};

const parsePathName = (req: IncomingMessage): string | undefined => {
  const rawUrl = toOptionalString(req.url);
  const host = toOptionalString(req.headers.host) || 'localhost';
  if (!rawUrl) return undefined;
  try {
    const parsed = new URL(rawUrl, `http://${host}`);
    return parsed.pathname;
  } catch {
    return undefined;
  }
};

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

const trySend = (socket: WebSocket, payload: Record<string, unknown>) => {
  if (socket.readyState !== 1) return;
  socket.send(JSON.stringify(payload));
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
    playerPulseInserted: 0,
    playerPulseDeduplicated: 0,
    socket,
    ...(remoteAddress ? { remoteAddress } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
  connectedByServerId.set(serverId, state);

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
      trySend(socket, { type: 'pong', now: nowIso() });
      return;
    }

    if (type === 'player_pulse') {
      state.playerPulseMessages += 1;
      const payload = (parsed as any).payload ?? (parsed as any).data ?? parsed;

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

    markSocketError(state, 'unknown_message_type');
    trySend(socket, { type: 'error', reason: 'unknown_message_type' });
  });

  socket.on('pong', () => {
    state.lastMessageAt = nowIso();
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

export const initializeServerWebSocket = (httpServer: HttpServer) => {
  if (initialized) return;
  initialized = true;
  wsServer = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    const pathname = parsePathName(request);
    if (pathname !== WS_SERVERS_PATH) {
      rejectUpgrade(socket, 404, 'Not Found');
      return;
    }

    socket.on('error', (err: Error) => {
      console.error('Server WS upgrade socket error', err?.message || String(err));
    });

    void (async () => {
      try {
        const authenticatedServer = await authenticateUpgrade(request);
        if (!wsServer) {
          rejectUpgrade(socket, 503, 'WebSocket server unavailable');
          return;
        }

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
  const servers = Array.from(connectedByServerId.values())
    .map((entry) => {
      const idleSeconds = Math.max(
        0,
        Math.floor((nowMs - new Date(entry.lastMessageAt).getTime()) / 1000),
      );
      return {
        serverId: entry.serverId,
        connectedAt: entry.connectedAt,
        lastMessageAt: entry.lastMessageAt,
        idleSeconds,
        messagesReceived: entry.messagesReceived,
        invalidMessages: entry.invalidMessages,
        playerPulseMessages: entry.playerPulseMessages,
        playerStateMessages: entry.playerStateMessages,
        playerPulseInserted: entry.playerPulseInserted,
        playerPulseDeduplicated: entry.playerPulseDeduplicated,
        ...(entry.lastPulseAt ? { lastPulseAt: entry.lastPulseAt } : {}),
        ...(entry.lastStateAt ? { lastStateAt: entry.lastStateAt } : {}),
        ...(entry.lastStatePlayers !== undefined ? { lastStatePlayers: entry.lastStatePlayers } : {}),
        ...(entry.lastErrorAt ? { lastErrorAt: entry.lastErrorAt } : {}),
        ...(entry.lastErrorReason ? { lastErrorReason: entry.lastErrorReason } : {}),
        ...(entry.remoteAddress ? { remoteAddress: entry.remoteAddress } : {}),
        ...(entry.userAgent ? { userAgent: entry.userAgent } : {}),
      };
    })
    .sort((left, right) => left.serverId.localeCompare(right.serverId));

  return {
    path: WS_SERVERS_PATH,
    connectedServers: servers.length,
    serversWithLiveState: liveStateByServerId.size,
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

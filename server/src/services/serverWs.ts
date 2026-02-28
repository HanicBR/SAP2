import type { IncomingMessage } from 'http';
import type { Server as HttpServer } from 'http';
import type { Duplex } from 'stream';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { findServerByApiKey } from './serverAuth';

const WS_SERVERS_PATH = '/ws/servers';

type ConnectedServerSocket = {
  serverId: string;
  connectedAt: string;
  lastMessageAt: string;
  remoteAddress?: string;
  userAgent?: string;
  socket: WebSocket;
};

type UpgradeError = {
  statusCode: number;
  message: string;
};

const connectedByServerId = new Map<string, ConnectedServerSocket>();

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

const trySend = (socket: WebSocket, payload: Record<string, unknown>) => {
  if (socket.readyState !== 1) return;
  socket.send(JSON.stringify(payload));
};

const detachSocketIfCurrent = (serverId: string, socket: WebSocket) => {
  const active = connectedByServerId.get(serverId);
  if (!active || active.socket !== socket) return;
  connectedByServerId.delete(serverId);
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
    socket,
    ...(remoteAddress ? { remoteAddress } : {}),
    ...(userAgent ? { userAgent } : {}),
  };
  connectedByServerId.set(serverId, state);

  socket.on('message', (buffer: RawData, isBinary: boolean) => {
    state.lastMessageAt = nowIso();

    if (isBinary) {
      trySend(socket, { type: 'error', reason: 'binary_not_supported' });
      return;
    }

    const parsed = parseJsonMessage(buffer);
    if (!parsed || typeof parsed !== 'object') {
      trySend(socket, { type: 'error', reason: 'invalid_json' });
      return;
    }

    const type = toOptionalString((parsed as any).type)?.toLowerCase();
    if (type === 'ping') {
      trySend(socket, { type: 'pong', now: nowIso() });
      return;
    }
  });

  socket.on('pong', () => {
    state.lastMessageAt = nowIso();
  });

  socket.on('close', () => {
    detachSocketIfCurrent(serverId, socket);
  });

  socket.on('error', (err: Error) => {
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
        ...(entry.remoteAddress ? { remoteAddress: entry.remoteAddress } : {}),
        ...(entry.userAgent ? { userAgent: entry.userAgent } : {}),
      };
    })
    .sort((left, right) => left.serverId.localeCompare(right.serverId));

  return {
    path: WS_SERVERS_PATH,
    connectedServers: servers.length,
    now: nowIso(),
    servers,
  };
};

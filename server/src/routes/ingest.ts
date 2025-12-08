import express, { Router } from 'express';
import { prisma } from '../db/client';
import { SiteConfig } from '../domain';
import { compareApiKey } from '../utils/apiKey';
import { normalizeEventsForServer, storeLogsAndUpdateProfiles } from '../utils/logIngest';

const router = Router();

// Alguns servidores (ex.: GMod HTTP) enviam o corpo como string sem Content-Length adequado.
// Forçamos um parser de texto aqui para sempre termos acesso ao corpo bruto.
router.use(express.text({ type: '*/*', limit: '2mb' }));

// In-memory stats for ignored logs (reset on server restart)
const ignoreStats = {
  tools: {} as Record<string, number>,
  commands: {} as Record<string, number>,
  rawText: {} as Record<string, number>,
};

const bumpStat = (bucket: Record<string, number>, key: string) => {
  const k = String(key);
  bucket[k] = (bucket[k] || 0) + 1;
};

// Simple ingestion endpoint for server-side log forwarding
// Expects header: X-Server-Key: <apiKey>
// Body: { events: [{ serverId?, gameMode, type, timestamp, steamId?, playerName?, rawText, metadata, sessionId?/serverSessionId?, sessionStart?, map?, serverName?, roundId?, roundNumber?, playerCount? }] }

const parseJsonBody = (raw: any): any => {
  if (raw == null) return undefined;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return raw;
};

router.post('/logs', async (req, res) => {
  const apiKey = req.header('x-server-key') || req.header('X-Server-Key');
  const parsedBody = parseJsonBody((req as any).body);

  let events: any[] | undefined;
  if (Array.isArray((parsedBody as any)?.events)) {
    events = (parsedBody as any).events;
  } else if (Array.isArray(parsedBody)) {
    events = parsedBody; // aceita array direto
  }

  if (!apiKey) {
    return res.status(401).json({ error: 'Missing server API key' });
  }

  if (!Array.isArray(events) || events.length === 0) {
    return res.status(400).json({
      error: 'No events to ingest',
      received: Array.isArray(events) ? events.length : 0,
      bodyType: typeof parsedBody,
      preview:
        typeof (req as any).body === 'string'
          ? String((req as any).body).slice(0, 200)
          : parsedBody
          ? JSON.stringify(parsedBody).slice(0, 200)
          : '',
    });
  }

  // Find server by apiKey hash
  const allServers = await prisma.gameServer.findMany({
    select: { id: true, apiKeyHash: true, mode: true, name: true },
  });
  const server = allServers.find((s) => s.apiKeyHash && compareApiKey(apiKey, s.apiKeyHash));
  if (!server) {
    return res.status(403).json({ error: 'Invalid server key' });
  }

  // Load site config for ignore rules (reserved for future use)
  const siteConfig = await prisma.siteConfig.findUnique({ where: { id: 1 } });
  const logsConfig = (siteConfig?.data as unknown as SiteConfig | undefined)?.logs;
  const ignoredTools = logsConfig?.ignoredTools || [];
  const ignoredCommands = logsConfig?.ignoredCommands || [];
  const rawTextFilters = logsConfig?.rawTextFilters || [];

  const cleanEvents = normalizeEventsForServer(events, {
    id: server.id,
    mode: server.mode as any,
    name: server.name,
  });

  if (!cleanEvents.length) {
    return res.status(400).json({ error: 'No valid events', received: events.length });
  }

  const result = await storeLogsAndUpdateProfiles(cleanEvents);
  return res.json({ ingested: result.ingested });
});

// Simple stats endpoint to inspect ignored logs (for admin UI)
router.get('/stats', async (_req, res) => {
  return res.json(ignoreStats);
});

export default router;


import { prisma } from '../db/client';
import {
  getPlayerPulseSettings,
  sanitizePlayerPulsePayload,
  resolvePulseTiming,
} from './playtimePulse';

export class PlayerPulseIngestError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message?: string) {
    super(message || code);
    this.name = 'PlayerPulseIngestError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface PlayerPulseIngestResult {
  ok: true;
  serverId: string;
  source: 'legacy' | 'hybrid' | 'pulse';
  acceptedPlayers: number;
  intervalSec: number;
  bucketSec: number;
  bucketStart: string;
  grantedSeconds: number;
  persisted: true;
  inserted: number;
  deduplicated: number;
}

const getPulseClient = () =>
  (prisma as any).playerPlaytimePulse as
    | {
        createMany: (args: any) => Promise<{ count: number }>;
      }
    | undefined;

export const ingestPlayerPulse = async (
  serverId: string,
  payloadInput: unknown,
): Promise<PlayerPulseIngestResult> => {
  const settings = getPlayerPulseSettings();
  if (!settings.enabled) {
    throw new PlayerPulseIngestError(503, 'player_pulse_disabled', 'Player pulse ingestion is disabled');
  }

  const payload = sanitizePlayerPulsePayload(payloadInput);
  if (!payload.players.length) {
    throw new PlayerPulseIngestError(400, 'players_required', 'Player pulse payload must include players');
  }

  const pulseClient = getPulseClient();
  if (!pulseClient) {
    throw new PlayerPulseIngestError(
      503,
      'player_pulse_storage_unavailable',
      'Player pulse storage is unavailable',
    );
  }

  const timing = resolvePulseTiming(payload, settings);
  const rows = payload.players.map((player) => ({
    serverId,
    steamId: player.steamId,
    bucketStart: timing.bucketStart,
    grantedSeconds: timing.grantedSeconds,
    playerName: player.name || null,
    map: payload.map || null,
    playerCount: payload.playerCount ?? null,
    sentAt: timing.sentAt,
    receivedAt: new Date(),
  }));

  const result = await pulseClient.createMany({
    data: rows,
    skipDuplicates: true,
  });

  const inserted = result?.count ?? 0;
  const deduplicated = Math.max(0, rows.length - inserted);

  return {
    ok: true,
    serverId,
    source: settings.source,
    acceptedPlayers: rows.length,
    intervalSec: timing.intervalSec,
    bucketSec: settings.bucketSec,
    bucketStart: timing.bucketStart.toISOString(),
    grantedSeconds: timing.grantedSeconds,
    persisted: true,
    inserted,
    deduplicated,
  };
};

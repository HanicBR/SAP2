export type PlaytimeSource = 'legacy' | 'hybrid' | 'pulse';

export interface PlayerPulseItem {
  steamId: string;
  name?: string;
}

export interface PlayerPulsePayload {
  sentAt?: string;
  intervalSec?: number;
  players: PlayerPulseItem[];
  map?: string;
  playerCount?: number;
}

export interface PlayerPulseSettings {
  enabled: boolean;
  source: PlaytimeSource;
  defaultIntervalSec: number;
}

const parseBoolEnv = (value: string | undefined, fallback = false): boolean => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!normalized) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
};

const parsePositiveIntEnv = (value: string | undefined, fallback: number, max: number): number => {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
};

const parsePlaytimeSourceEnv = (value: string | undefined): PlaytimeSource => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (normalized === 'pulse') return 'pulse';
  if (normalized === 'hybrid') return 'hybrid';
  return 'legacy';
};

export const getPlayerPulseSettings = (): PlayerPulseSettings => ({
  enabled: parseBoolEnv(process.env.PLAYER_PULSE_ENABLED, false),
  source: parsePlaytimeSourceEnv(process.env.PLAYTIME_SOURCE),
  defaultIntervalSec: parsePositiveIntEnv(process.env.PLAYER_PULSE_INTERVAL_SEC, 60, 300),
});

const isTrackableSteamId = (value: unknown): value is string => {
  const raw = String(value || '').trim();
  if (!raw) return false;
  const upper = raw.toUpperCase();
  if (upper === 'BOT' || upper === 'CONSOLE' || upper === 'UNKNOWN' || upper === 'NULL') return false;
  return /^STEAM_[0-5]:[01]:\d+$/.test(raw);
};

export const sanitizePlayerPulsePayload = (input: unknown): PlayerPulsePayload => {
  const body = (input && typeof input === 'object' ? input : {}) as any;
  const playersRaw = Array.isArray(body.players) ? body.players : [];
  const players: PlayerPulseItem[] = playersRaw
    .map((raw: any) => {
      const steamId = String(raw?.steamId || '').trim();
      if (!isTrackableSteamId(steamId)) return null;
      const nameRaw = String(raw?.name || '').trim();
      return {
        steamId,
        ...(nameRaw ? { name: nameRaw.slice(0, 80) } : {}),
      };
    })
    .filter((item: PlayerPulseItem | null): item is PlayerPulseItem => Boolean(item));

  const intervalSecRaw = Number.parseInt(String(body.intervalSec ?? ''), 10);
  const intervalSec =
    Number.isFinite(intervalSecRaw) && intervalSecRaw > 0
      ? Math.min(intervalSecRaw, 300)
      : undefined;

  const playerCountRaw = Number.parseInt(String(body.playerCount ?? ''), 10);
  const playerCount =
    Number.isFinite(playerCountRaw) && playerCountRaw >= 0
      ? Math.min(playerCountRaw, 1000)
      : undefined;

  const mapRaw = String(body.map || '').trim();
  const map = mapRaw ? mapRaw.slice(0, 96) : undefined;

  const sentAtRaw = String(body.sentAt || '').trim();
  const sentAt =
    sentAtRaw && !Number.isNaN(new Date(sentAtRaw).getTime())
      ? new Date(sentAtRaw).toISOString()
      : undefined;

  return {
    ...(sentAt ? { sentAt } : {}),
    ...(intervalSec ? { intervalSec } : {}),
    players,
    ...(map ? { map } : {}),
    ...(playerCount !== undefined ? { playerCount } : {}),
  };
};

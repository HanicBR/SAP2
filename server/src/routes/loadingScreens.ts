import { Router } from 'express';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import multer from 'multer';
import { prisma } from '../db/client';
import { UserRole } from '../domain';
import { authMiddleware, requireRole } from '../middleware/auth';
import { bootstrap } from '../bootstrap';
import { syncSteamProfileBySteamId64 } from '../services/steamProfile';
import {
  getLoadingTelemetryTokenTtlSec,
  isLoadingTelemetryTokenRequired,
  issueLoadingTelemetryToken,
} from '../services/loadingTelemetryAuth';

const router = Router();

type LoadingScreenMode = 'TTT' | 'SANDBOX' | 'MURDER' | 'CUSTOM';

type LoadingScreenVipEntry = {
  name: string;
  steamId?: string;
  avatarUrl?: string;
  vipPlan?: string;
};

type LoadingScreenHero = {
  badge: string;
  title: string;
  subtitle: string;
  descriptionLines: string[];
};

type LoadingScreenNotice = {
  title: string;
  lines: string[];
  ctaLabel?: string;
  ctaUrl?: string;
  qrImageUrl?: string;
};

type LoadingScreenProfile = {
  slug: string;
  name: string;
  mode: LoadingScreenMode;
  enabled: boolean;
  routePath: string;
  accentColor: string;
  backgroundImages: string[];
  musicTracks: string[];
  hero: LoadingScreenHero;
  notice: LoadingScreenNotice;
  rules: string[];
  vipTitle: string;
  vipPlayers: LoadingScreenVipEntry[];
  updatedAt: string;
};

type LoadingScreensStore = {
  profiles: LoadingScreenProfile[];
};

type SiteConfigJson = Record<string, unknown>;
type PublicLoadingProfileResponse = LoadingScreenProfile & {
  telemetry?: {
    required: boolean;
    tokenTtlSec?: number;
    token?: string;
  };
};

const MAX_LINE_LENGTH = 240;
const MAX_LONG_TEXT_LENGTH = 600;
const MAX_URL_LENGTH = 2048;
const MAX_BG_IMAGES = 16;
const MAX_TRACKS = 24;
const MAX_VIPS = 40;
const MAX_RULES = 12;
const MAX_PUBLIC_VIPS = 80;
const STEAM_ID64_BASE = BigInt('76561197960265728');

const parsePositiveIntEnv = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const LOADING_PUBLIC_CACHE_TTL_MS = parsePositiveIntEnv(
  process.env.LOADING_PUBLIC_CACHE_TTL_MS,
  30_000,
);
const LOADING_PUBLIC_MAX_AGE_SEC = Math.max(5, Math.floor(LOADING_PUBLIC_CACHE_TTL_MS / 1000));
const STEAM_REFRESH_CONCURRENCY = Math.min(
  8,
  parsePositiveIntEnv(process.env.LOADING_STEAM_REFRESH_CONCURRENCY, 2),
);
const STEAM_REFRESH_TIMEOUT_MS = parsePositiveIntEnv(
  process.env.LOADING_STEAM_REFRESH_TIMEOUT_MS,
  2_500,
);
const STEAM_SYNC_LOOKUP_MAX = Math.min(
  MAX_PUBLIC_VIPS,
  parsePositiveIntEnv(process.env.LOADING_STEAM_SYNC_LOOKUP_MAX, 12),
);
const STEAM_SYNC_XML_FALLBACK_MAX = Math.min(
  STEAM_SYNC_LOOKUP_MAX,
  parsePositiveIntEnv(process.env.LOADING_STEAM_SYNC_XML_FALLBACK_MAX, 4),
);

const maxLoadingMediaUploadMb = Math.max(1, Number(process.env.LOADING_MEDIA_UPLOAD_MAX_MB || 25));
const loadingMediaUploadDir =
  process.env.LOADING_MEDIA_UPLOAD_DIR || path.resolve(process.cwd(), 'uploads', 'loading-media');
const allowedLoadingMediaMimeTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/svg+xml',
  'audio/mpeg',
  'audio/mp3',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
  'audio/aac',
  'audio/flac',
]);

fs.mkdirSync(loadingMediaUploadDir, { recursive: true });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const trimTo = (value: unknown, maxLength: number, fallback: string): string => {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  return text.length <= maxLength ? text : text.slice(0, maxLength);
};

const sanitizeColor = (value: unknown, fallback: string): string => {
  const raw = String(value ?? '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : fallback;
};

const sanitizeUrl = (value: unknown): string | undefined => {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  if (raw.length > MAX_URL_LENGTH) return raw.slice(0, MAX_URL_LENGTH);
  return raw;
};

const toLines = (value: unknown, maxItems: number, fallback: string[]): string[] => {
  const source = Array.isArray(value)
    ? value
    : String(value ?? '')
        .split('\n')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);

  const lines: string[] = [];
  source.forEach((entry) => {
    const text = trimTo(entry, MAX_LONG_TEXT_LENGTH, '');
    if (!text) return;
    if (lines.length >= maxItems) return;
    lines.push(text);
  });

  return lines.length > 0 ? lines : fallback;
};

const sanitizeSlug = (value: unknown): string => {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return raw.slice(0, 64);
};

const parseMode = (value: unknown, fallback: LoadingScreenMode): LoadingScreenMode => {
  const raw = String(value ?? '')
    .trim()
    .toUpperCase();
  if (raw === 'TTT') return 'TTT';
  if (raw === 'SANDBOX') return 'SANDBOX';
  if (raw === 'MURDER') return 'MURDER';
  if (raw === 'CUSTOM') return 'CUSTOM';
  return fallback;
};

const parseBool = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
};

const normalizeVipPlanForTier = (value: unknown): string => {
  const raw = String(value || '').trim();
  if (!raw) return 'VIP';
  const upper = raw.toUpperCase();
  if (upper.includes('++')) return 'VIP++';
  if (upper.includes('+')) return 'VIP+';
  if (upper.includes('VIP')) return 'VIP';
  return raw.slice(0, 32);
};

const vipPlanTierWeight = (value: unknown): number => {
  const normalized = normalizeVipPlanForTier(value).toUpperCase();
  if (normalized === 'VIP++') return 3;
  if (normalized === 'VIP+') return 2;
  if (normalized === 'VIP') return 1;
  return 0;
};

const steam2To64 = (steamId: string): string | null => {
  const match = String(steamId || '')
    .trim()
    .match(/^STEAM_[0-5]:([01]):(\d+)$/i);
  if (!match) return null;
  const yRaw = match[1];
  const zRaw = match[2];
  if (!yRaw || !zRaw) return null;
  const y = BigInt(yRaw);
  const z = BigInt(zRaw);
  return (STEAM_ID64_BASE + z * BigInt(2) + y).toString();
};

type SteamSummary = {
  personaName?: string;
  avatarUrl?: string;
};

type PublicLoadingProfileCacheEntry = {
  expiresAt: number;
  payload: PublicLoadingProfileResponse;
};

const steamSummaryCache = new Map<string, { expiresAt: number; summary: SteamSummary }>();
const STEAM_SUMMARY_CACHE_TTL_MS = 10 * 60 * 1000;
const publicLoadingProfileCache = new Map<string, PublicLoadingProfileCacheEntry>();
const steamSummaryRefreshQueue: string[] = [];
const steamSummaryRefreshQueued = new Set<string>();
const steamSummaryRefreshInFlight = new Set<string>();
let steamSummaryRefreshWorkers = 0;

const withTimeout = async (url: string, timeoutMs: number): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'backstabber-api/loading-screens',
      },
    });
  } finally {
    clearTimeout(timer);
  }
};

const getCachedSteamSummariesById64 = (steamIds64: string[]): Map<string, SteamSummary> => {
  const result = new Map<string, SteamSummary>();
  if (steamIds64.length === 0) return result;

  const now = Date.now();
  const uniqueIds = uniqueStrings(steamIds64).filter((entry) => /^\d{17}$/.test(entry));
  uniqueIds.forEach((steamId64) => {
    const cached = steamSummaryCache.get(steamId64);
    if (cached && cached.expiresAt > now) {
      result.set(steamId64, cached.summary);
      return;
    }
    steamSummaryCache.delete(steamId64);
  });

  return result;
};

const fetchSteamSummariesSyncLimited = async (steamIds64: string[]): Promise<Map<string, SteamSummary>> => {
  const result = new Map<string, SteamSummary>();
  const ids = uniqueStrings(steamIds64).filter((entry) => /^\d{17}$/.test(entry));
  if (ids.length === 0) return result;

  const syncTargets = ids.slice(0, STEAM_SYNC_LOOKUP_MAX);
  if (syncTargets.length === 0) return result;

  const unresolved = new Set(syncTargets);
  const apiKey = String(process.env.STEAM_WEB_API_KEY || '').trim();

  if (apiKey) {
    try {
      const endpoint =
        `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${encodeURIComponent(apiKey)}` +
        `&steamids=${encodeURIComponent(syncTargets.join(','))}`;
      const response = await withTimeout(endpoint, STEAM_REFRESH_TIMEOUT_MS);
      if (response.ok) {
        const json = await response.json().catch(() => null);
        const players = Array.isArray(json?.response?.players) ? json.response.players : [];

        players.forEach((player: Record<string, unknown>) => {
          const steamId64 = String(player.steamid || '').trim();
          if (!/^\d{17}$/.test(steamId64)) return;
          const personaName = String(player.personaname || '').trim();
          const avatarUrl = toLighterAvatarUrl(String(player.avatarfull || '').trim());
          if (!personaName && !avatarUrl) return;

          const summary: SteamSummary = {
            ...(personaName ? { personaName } : {}),
            ...(avatarUrl ? { avatarUrl } : {}),
          };
          steamSummaryCache.set(steamId64, {
            expiresAt: Date.now() + STEAM_SUMMARY_CACHE_TTL_MS,
            summary,
          });
          result.set(steamId64, summary);
          unresolved.delete(steamId64);
        });
      }
    } catch {
      // keep fallback data only
    }
  }

  if (unresolved.size > 0) {
    const xmlFallbackTargets = [...unresolved].slice(0, STEAM_SYNC_XML_FALLBACK_MAX);
    for (const steamId64 of xmlFallbackTargets) {
      try {
        const profile = (await Promise.race([
          syncSteamProfileBySteamId64(steamId64),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), STEAM_REFRESH_TIMEOUT_MS)),
        ])) as
          | {
              personaName?: string;
              avatarUrl?: string;
            }
          | null;
        if (!profile) continue;

        const personaName = String(profile.personaName || '').trim();
        const avatarUrl = toLighterAvatarUrl(String(profile.avatarUrl || '').trim());
        if (!personaName && !avatarUrl) continue;

        const summary: SteamSummary = {
          ...(personaName ? { personaName } : {}),
          ...(avatarUrl ? { avatarUrl } : {}),
        };
        steamSummaryCache.set(steamId64, {
          expiresAt: Date.now() + STEAM_SUMMARY_CACHE_TTL_MS,
          summary,
        });
        result.set(steamId64, summary);
        unresolved.delete(steamId64);
      } catch {
        // keep fallback data only
      }
    }
  }

  return result;
};

const toLighterAvatarUrl = (value: string | undefined): string | undefined => {
  const sanitized = sanitizeUrl(value);
  if (!sanitized) return undefined;
  return sanitized.replace(/_full(\.(?:jpg|jpeg|png|webp))$/i, '_medium$1');
};

const runSteamSummaryRefreshWorkers = () => {
  while (
    steamSummaryRefreshWorkers < STEAM_REFRESH_CONCURRENCY &&
    steamSummaryRefreshQueue.length > 0
  ) {
    const steamId64 = steamSummaryRefreshQueue.shift();
    if (!steamId64) continue;
    steamSummaryRefreshQueued.delete(steamId64);
    steamSummaryRefreshWorkers += 1;
    steamSummaryRefreshInFlight.add(steamId64);

    void (async () => {
      try {
        const now = Date.now();
        const cached = steamSummaryCache.get(steamId64);
        if (cached && cached.expiresAt > now) return;

        const profile = (await Promise.race([
          syncSteamProfileBySteamId64(steamId64),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), STEAM_REFRESH_TIMEOUT_MS)),
        ])) as
          | {
              personaName?: string;
              avatarUrl?: string;
            }
          | null;
        if (!profile) return;

        const personaName = String(profile.personaName || '').trim();
        const avatarUrl = toLighterAvatarUrl(String(profile.avatarUrl || '').trim());
        if (!personaName && !avatarUrl) return;

        const summary: SteamSummary = {
          ...(personaName ? { personaName } : {}),
          ...(avatarUrl ? { avatarUrl } : {}),
        };
        steamSummaryCache.set(steamId64, {
          expiresAt: Date.now() + STEAM_SUMMARY_CACHE_TTL_MS,
          summary,
        });
        invalidatePublicLoadingProfileCache();
      } catch {
        // keep fallback data only
      } finally {
        steamSummaryRefreshInFlight.delete(steamId64);
        steamSummaryRefreshWorkers = Math.max(0, steamSummaryRefreshWorkers - 1);
        runSteamSummaryRefreshWorkers();
      }
    })();
  }
};

const enqueueSteamSummaryRefresh = (steamIds64: string[]) => {
  const ids = uniqueStrings(steamIds64).filter((entry) => /^\d{17}$/.test(entry));
  if (ids.length === 0) return;
  const now = Date.now();
  ids.forEach((steamId64) => {
    const cached = steamSummaryCache.get(steamId64);
    if (cached && cached.expiresAt > now) return;
    if (steamSummaryRefreshInFlight.has(steamId64)) return;
    if (steamSummaryRefreshQueued.has(steamId64)) return;
    steamSummaryRefreshQueued.add(steamId64);
    steamSummaryRefreshQueue.push(steamId64);
  });
  runSteamSummaryRefreshWorkers();
};

const uniqueStrings = (values: string[]): string[] => {
  const seen = new Set<string>();
  const next: string[] = [];
  values.forEach((value) => {
    const normalized = String(value || '').trim();
    if (!normalized) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    next.push(normalized);
  });
  return next;
};

const sanitizeVipPlayers = (value: unknown, fallback: LoadingScreenVipEntry[]): LoadingScreenVipEntry[] => {
  if (!Array.isArray(value)) return fallback;

  const next: LoadingScreenVipEntry[] = [];
  value.forEach((entry) => {
    if (!isRecord(entry)) return;
    if (next.length >= MAX_VIPS) return;

    const name = trimTo(entry.name, 80, '');
    if (!name) return;

    const steamId = trimTo(entry.steamId, 80, '');
    const avatarUrl = sanitizeUrl(entry.avatarUrl);
    const vipPlan = trimTo(entry.vipPlan, 32, '');

    const normalized: LoadingScreenVipEntry = {
      name,
      ...(steamId ? { steamId } : {}),
      ...(avatarUrl ? { avatarUrl } : {}),
      ...(vipPlan ? { vipPlan: normalizeVipPlanForTier(vipPlan) } : {}),
    };

    next.push(normalized);
  });

  return next.length > 0 ? next : fallback;
};

const mergeAndDedupeVipEntries = (
  primary: LoadingScreenVipEntry[],
  fallback: LoadingScreenVipEntry[],
): LoadingScreenVipEntry[] => {
  const next: LoadingScreenVipEntry[] = [];
  const seen = new Set<string>();

  const push = (entry: LoadingScreenVipEntry) => {
    if (next.length >= MAX_PUBLIC_VIPS) return;
    const name = trimTo(entry.name, 80, '');
    if (!name) return;
    const steamId = trimTo(entry.steamId, 80, '');
    const avatarUrl = sanitizeUrl(entry.avatarUrl);
    const vipPlan = trimTo(entry.vipPlan, 32, '');
    const key = steamId ? `steam:${steamId.toUpperCase()}` : `name:${name.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    next.push({
      name,
      ...(steamId ? { steamId } : {}),
      ...(avatarUrl ? { avatarUrl } : {}),
      ...(vipPlan ? { vipPlan: normalizeVipPlanForTier(vipPlan) } : {}),
    });
  };

  primary.forEach(push);
  fallback.forEach(push);

  return next.length > 0 ? next : fallback.slice(0, MAX_PUBLIC_VIPS);
};

const sanitizeSlugFromName = (name: string): string => {
  const generated = sanitizeSlug(name);
  return generated || `loading-${Date.now()}`;
};

const buildDefaultProfiles = (): LoadingScreenProfile[] => {
  const now = new Date().toISOString();
  return [
    {
      slug: 'tttloading',
      name: 'TTT Loading',
      mode: 'TTT',
      enabled: true,
      routePath: '/tttloading',
      accentColor: '#be1b3c',
      backgroundImages: ['https://i.imgur.com/HnZfcKR.jpeg'],
      musicTracks: ['https://raw.githubusercontent.com/HanicBR/backtttloading/main/assets/music/gtavicecity.ogg'],
      hero: {
        badge: 'TTT',
        title: 'Trouble in Terrorist Town',
        subtitle: 'Quem e o assassino?',
        descriptionLines: [
          'Em TTT, paranoia e informacao decidem a rodada.',
          'Traidores: eliminem todos sem serem descobertos.',
          'Inocentes e detetive: identifiquem e neutralizem os traidores.',
        ],
      },
      notice: {
        title: 'Crash ao entrar?',
        lines: [
          'Se travar na entrada, faltam mapas da colecao.',
          'Abra o link, inscreva-se na colecao e tente novamente.',
        ],
        ctaLabel: 'Abrir colecao de mapas',
        ctaUrl: 'https://bit.ly/mapasback',
        qrImageUrl: 'https://i.imgur.com/5873D1j.jpeg',
      },
      rules: [
        'Nao mate sem motivo.',
        'Nao ofenda outros jogadores.',
        'Nao abuse de props para atrapalhar a rodada.',
        'Use !discord para entrar no Discord da rede.',
      ],
      vipTitle: 'Destaques da comunidade',
      vipPlayers: [
        {
          name: 'Mr.B-O-M-B-A-S-T-I-C',
          vipPlan: 'VIP++',
          avatarUrl:
            'https://shared.akamai.steamstatic.com/community_assets/images/items/2181720/097978e42477d98190ed9e14e971c2b9976fc8d1.gif',
        },
        {
          name: 'Gatogames435',
          vipPlan: 'VIP+',
          avatarUrl:
            'https://shared.akamai.steamstatic.com/community_assets/images/items/2459330/11bbadea5154c316c883df0f3f1944395b3715b8.gif',
        },
      ],
      updatedAt: now,
    },
    {
      slug: 'sandboxloading',
      name: 'Sandbox Loading',
      mode: 'SANDBOX',
      enabled: true,
      routePath: '/sandboxloading',
      accentColor: '#be1b3c',
      backgroundImages: ['https://i.imgur.com/HnZfcKR.jpeg'],
      musicTracks: ['https://raw.githubusercontent.com/HanicBR/backtttloading/main/assets/music/gtavicecity.ogg'],
      hero: {
        badge: 'SANDBOX',
        title: 'Backstabber Sandbox',
        subtitle: 'Construa, teste e jogue com liberdade',
        descriptionLines: [
          'Use Toolgun e Physgun para criar sem limites.',
          'Teste addons, armas, NPCs e sistemas do servidor.',
          'Respeite outras construcoes e evite grief.',
        ],
      },
      notice: {
        title: 'Erro ao entrar?',
        lines: [
          'Reinicie o jogo e tente novamente.',
          'Se persistir, limpe garrysmod/cache/lua e reabra o jogo.',
        ],
      },
      rules: [
        'Nao destrua construcoes de outros jogadores.',
        'Nao ofenda outros jogadores.',
        'Nao abuse de entidades para causar lag.',
        'Use !steam para entrar no grupo Steam.',
      ],
      vipTitle: 'Jogadores em destaque',
      vipPlayers: [
        {
          name: 'Sheva',
          vipPlan: 'VIP++',
          avatarUrl: 'https://avatars.steamstatic.com/0650a97d7708b948a87e28c4b7c07ca9f268b073_full.jpg',
        },
        {
          name: 'chico tekito',
          vipPlan: 'VIP+',
          avatarUrl: 'https://avatars.fastly.steamstatic.com/75bb2a0541d607eaed4e09c8d1e68413a2cbb58a_full.jpg',
        },
      ],
      updatedAt: now,
    },
  ];
};

const DEFAULT_STORE: LoadingScreensStore = {
  profiles: buildDefaultProfiles(),
};

const normalizeProfile = (input: unknown, fallback?: LoadingScreenProfile): LoadingScreenProfile => {
  const base = fallback || clone(DEFAULT_STORE.profiles[0] as LoadingScreenProfile);
  const record = isRecord(input) ? input : {};

  const inferredName = trimTo(record.name, 80, base.name);
  const slug = sanitizeSlug(record.slug) || sanitizeSlug(base.slug) || sanitizeSlugFromName(inferredName);

  const backgroundImages = toLines(record.backgroundImages, MAX_BG_IMAGES, base.backgroundImages)
    .map((entry) => sanitizeUrl(entry))
    .filter((entry): entry is string => Boolean(entry));

  const musicTracks = toLines(record.musicTracks, MAX_TRACKS, base.musicTracks)
    .map((entry) => sanitizeUrl(entry))
    .filter((entry): entry is string => Boolean(entry));

  const heroRecord = isRecord(record.hero) ? record.hero : {};
  const noticeRecord = isRecord(record.notice) ? record.notice : {};

  const hero: LoadingScreenHero = {
    badge: trimTo(heroRecord.badge, 32, base.hero.badge),
    title: trimTo(heroRecord.title, 120, base.hero.title),
    subtitle: trimTo(heroRecord.subtitle, 160, base.hero.subtitle),
    descriptionLines: toLines(heroRecord.descriptionLines, 8, base.hero.descriptionLines),
  };

  const ctaLabel = trimTo(noticeRecord.ctaLabel, 80, '');
  const ctaUrl = sanitizeUrl(noticeRecord.ctaUrl);
  const qrImageUrl = sanitizeUrl(noticeRecord.qrImageUrl);

  const notice: LoadingScreenNotice = {
    title: trimTo(noticeRecord.title, 120, base.notice.title),
    lines: toLines(noticeRecord.lines, 8, base.notice.lines),
    ...(ctaLabel ? { ctaLabel } : {}),
    ...(ctaUrl ? { ctaUrl } : {}),
    ...(qrImageUrl ? { qrImageUrl } : {}),
  };

  const nowIso = new Date().toISOString();

  return {
    slug,
    name: inferredName,
    mode: parseMode(record.mode, base.mode),
    enabled: parseBool(record.enabled, base.enabled),
    routePath: `/${slug}`,
    accentColor: sanitizeColor(record.accentColor, base.accentColor),
    backgroundImages: backgroundImages.length > 0 ? backgroundImages : base.backgroundImages,
    musicTracks: musicTracks.length > 0 ? musicTracks : base.musicTracks,
    hero,
    notice,
    rules: toLines(record.rules, MAX_RULES, base.rules).map((item) => item.slice(0, MAX_LINE_LENGTH)),
    vipTitle: trimTo(record.vipTitle, 120, base.vipTitle),
    vipPlayers: sanitizeVipPlayers(record.vipPlayers, base.vipPlayers),
    updatedAt: trimTo(record.updatedAt, 40, nowIso),
  };
};

const dedupeProfiles = (profiles: LoadingScreenProfile[]): LoadingScreenProfile[] => {
  const seen = new Set<string>();
  const next: LoadingScreenProfile[] = [];

  profiles.forEach((profile) => {
    if (!profile.slug) return;
    if (seen.has(profile.slug)) return;
    seen.add(profile.slug);
    next.push(profile);
  });

  return next;
};

const normalizeStore = (raw: unknown): LoadingScreensStore => {
  if (!isRecord(raw)) {
    return clone(DEFAULT_STORE);
  }

  const maybeProfiles = Array.isArray(raw.profiles) ? raw.profiles : [];
  const defaultBySlug = new Map(DEFAULT_STORE.profiles.map((profile) => [profile.slug, profile]));

  const normalized = maybeProfiles
    .map((entry) => {
      const entryRecord = isRecord(entry) ? entry : {};
      const slug = sanitizeSlug(entryRecord.slug);
      const fallback = defaultBySlug.get(slug) || DEFAULT_STORE.profiles[0];
      return normalizeProfile(entry, fallback);
    })
    .filter((profile) => Boolean(profile.slug));

  const deduped = dedupeProfiles(normalized);
  if (deduped.length === 0) {
    return clone(DEFAULT_STORE);
  }

  return { profiles: deduped };
};

const loadStoreFromSiteConfig = (siteConfigData: unknown): LoadingScreensStore => {
  if (!isRecord(siteConfigData)) {
    return clone(DEFAULT_STORE);
  }
  const rawStore = siteConfigData.loadingScreens;
  return normalizeStore(rawStore);
};

const mergeStoreIntoSiteConfig = (siteConfigData: unknown, store: LoadingScreensStore): SiteConfigJson => {
  const base = isRecord(siteConfigData) ? { ...siteConfigData } : {};
  return {
    ...base,
    loadingScreens: {
      profiles: store.profiles,
    },
  };
};

const ensureSiteConfig = async () => {
  let siteConfig = await prisma.siteConfig.findUnique({ where: { id: 1 } });
  if (!siteConfig) {
    await bootstrap();
    siteConfig = await prisma.siteConfig.findUnique({ where: { id: 1 } });
  }
  if (!siteConfig) {
    throw new Error('Site config not initialized');
  }
  return siteConfig;
};

const loadingMediaStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, loadingMediaUploadDir),
  filename: (_req, file, cb) => {
    const safeOriginal = path.basename(file.originalname || '').toLowerCase();
    const originalExt = path.extname(safeOriginal).replace(/[^a-z0-9.]/g, '');
    const normalizedMime = String(file.mimetype || '').toLowerCase();
    const fallbackExt = normalizedMime.startsWith('audio/')
      ? '.ogg'
      : normalizedMime === 'image/png'
      ? '.png'
      : normalizedMime === 'image/webp'
      ? '.webp'
      : normalizedMime === 'image/gif'
      ? '.gif'
      : normalizedMime === 'image/svg+xml'
      ? '.svg'
      : '.jpg';
    const extension = originalExt || fallbackExt;
    const random = crypto.randomBytes(8).toString('hex');
    cb(null, `${Date.now()}_${random}${extension}`);
  },
});

const uploadLoadingMedia = multer({
  storage: loadingMediaStorage,
  limits: {
    fileSize: maxLoadingMediaUploadMb * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || '').toLowerCase();
    if (!allowedLoadingMediaMimeTypes.has(mime)) {
      return cb(new Error('INVALID_LOADING_MEDIA_TYPE'));
    }
    return cb(null, true);
  },
});

const buildSyncedVipPlayers = async (profile: LoadingScreenProfile): Promise<LoadingScreenVipEntry[]> => {
  const now = new Date();
  const mode = profile.mode;
  const modeFilterEnabled = mode === 'TTT' || mode === 'SANDBOX' || mode === 'MURDER';
  let modeServerIds: string[] = [];

  if (modeFilterEnabled) {
    const modeServers = await prisma.gameServer.findMany({
      where: { mode: mode as any },
      select: { id: true },
    });
    modeServerIds = uniqueStrings(modeServers.map((entry) => entry.id));
  }

  const where: any = {
    isVip: true,
    AND: [
      {
        OR: [{ vipExpiry: null }, { vipExpiry: { gt: now } }],
      },
    ],
  };

  if (modeFilterEnabled && modeServerIds.length > 0) {
    where.AND.push({
      OR: [{ vipServerIds: { isEmpty: true } }, { vipServerIds: { hasSome: modeServerIds } }],
    });
  }

  const activeRows = await prisma.playerProfile.findMany({
    where,
    orderBy: [{ firstSeen: 'asc' }, { lastSeen: 'desc' }],
    select: {
      steamId: true,
      name: true,
      avatarUrl: true,
      vipPlan: true,
      firstSeen: true,
    },
    take: MAX_PUBLIC_VIPS,
  });

  const sortedRows = [...activeRows].sort((a, b) => {
    const tierDiff = vipPlanTierWeight(b.vipPlan) - vipPlanTierWeight(a.vipPlan);
    if (tierDiff !== 0) return tierDiff;
    const aFirst = a.firstSeen?.getTime?.() || 0;
    const bFirst = b.firstSeen?.getTime?.() || 0;
    if (aFirst !== bFirst) return aFirst - bFirst;
    return String(a.steamId).localeCompare(String(b.steamId));
  });

  const steamId64BySteam2 = new Map<string, string>();
  const steamIds64: string[] = [];
  sortedRows.forEach((row) => {
    const steamId64 = steam2To64(row.steamId);
    if (!steamId64) return;
    steamId64BySteam2.set(row.steamId, steamId64);
    steamIds64.push(steamId64);
  });
  const steamSummariesBy64 = getCachedSteamSummariesById64(steamIds64);
  const initialMissingSteamIds64 = steamIds64.filter((steamId64) => !steamSummariesBy64.has(steamId64));
  if (initialMissingSteamIds64.length > 0) {
    const syncedSummaries = await fetchSteamSummariesSyncLimited(initialMissingSteamIds64);
    syncedSummaries.forEach((summary, steamId64) => steamSummariesBy64.set(steamId64, summary));
  }

  const remainingMissingSteamIds64 = steamIds64.filter((steamId64) => !steamSummariesBy64.has(steamId64));
  if (remainingMissingSteamIds64.length > 0) {
    enqueueSteamSummaryRefresh(remainingMissingSteamIds64);
  }

  const synced = sortedRows.map((row) => {
    const steamId64 = steamId64BySteam2.get(row.steamId);
    const steamSummary = steamId64 ? steamSummariesBy64.get(steamId64) : undefined;
    const candidateAvatar = toLighterAvatarUrl(steamSummary?.avatarUrl || row.avatarUrl || undefined);
    return {
      name: trimTo(steamSummary?.personaName || row.name, 80, row.steamId),
      steamId: row.steamId,
      ...(candidateAvatar ? { avatarUrl: candidateAvatar } : {}),
      vipPlan: normalizeVipPlanForTier(row.vipPlan),
    };
  });

  const manualFallback = sanitizeVipPlayers(profile.vipPlayers, []);
  return mergeAndDedupeVipEntries(synced, manualFallback);
};

const respondStore = (res: any, store: LoadingScreensStore, updatedAt: Date) => {
  return res.json({
    updatedAt: updatedAt.toISOString(),
    profiles: store.profiles,
  });
};

const setPublicLoadingResponseHeaders = (res: any) => {
  res.setHeader(
    'Cache-Control',
    `public, max-age=${LOADING_PUBLIC_MAX_AGE_SEC}, stale-while-revalidate=${Math.max(
      LOADING_PUBLIC_MAX_AGE_SEC,
      30,
    )}`,
  );
};

const pruneExpiredPublicLoadingProfileCache = () => {
  const now = Date.now();
  publicLoadingProfileCache.forEach((entry, key) => {
    if (entry.expiresAt <= now) {
      publicLoadingProfileCache.delete(key);
    }
  });
};

const invalidatePublicLoadingProfileCache = (slug?: string) => {
  if (!slug) {
    publicLoadingProfileCache.clear();
    return;
  }
  publicLoadingProfileCache.delete(slug);
};

router.post('/media-upload', authMiddleware, requireRole(UserRole.ADMIN), (req, res) => {
  uploadLoadingMedia.single('file')(req as any, res as any, (err: any) => {
    if (err) {
      if (err?.code === 'LIMIT_FILE_SIZE') {
        return res
          .status(413)
          .json({ error: `Loading media exceeds ${maxLoadingMediaUploadMb}MB limit` });
      }
      if (err?.message === 'INVALID_LOADING_MEDIA_TYPE') {
        return res
          .status(400)
          .json({ error: 'Unsupported media type. Use image or audio files' });
      }
      return res.status(400).json({ error: 'Failed to upload loading media' });
    }

    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      return res.status(400).json({ error: 'Missing file' });
    }

    return res.status(201).json({
      url: `/api/uploads/loading-media/${encodeURIComponent(file.filename)}`,
      filename: file.filename,
      size: file.size,
      mime: file.mimetype,
    });
  });
});

router.get('/', authMiddleware, requireRole(UserRole.ADMIN), async (_req, res) => {
  const siteConfig = await ensureSiteConfig();
  const store = loadStoreFromSiteConfig(siteConfig.data);
  return respondStore(res, store, siteConfig.updatedAt);
});

router.get('/public/:slug', async (req, res) => {
  const slug = sanitizeSlug(req.params.slug);
  if (!slug) {
    return res.status(400).json({ error: 'Invalid slug' });
  }

  pruneExpiredPublicLoadingProfileCache();
  const cached = publicLoadingProfileCache.get(slug);
  if (cached && cached.expiresAt > Date.now()) {
    setPublicLoadingResponseHeaders(res);
    return res.json(cached.payload);
  }

  const siteConfig = await ensureSiteConfig();
  const store = loadStoreFromSiteConfig(siteConfig.data);
  const profile = store.profiles.find((entry) => entry.slug === slug);

  if (!profile || profile.enabled !== true) {
    return res.status(404).json({ error: 'Loading screen not found' });
  }

  const syncedVipPlayers = await buildSyncedVipPlayers(profile);
  const telemetryToken = issueLoadingTelemetryToken(profile.slug);
  const telemetryRequired = isLoadingTelemetryTokenRequired();
  const telemetryTtlSec = getLoadingTelemetryTokenTtlSec();

  const payload: PublicLoadingProfileResponse = {
    ...profile,
    vipPlayers: syncedVipPlayers,
    telemetry: {
      required: telemetryRequired,
      tokenTtlSec: telemetryTtlSec,
      ...(telemetryToken ? { token: telemetryToken } : {}),
    },
  };
  publicLoadingProfileCache.set(slug, {
    expiresAt: Date.now() + LOADING_PUBLIC_CACHE_TTL_MS,
    payload,
  });
  setPublicLoadingResponseHeaders(res);
  return res.json(payload);
});

router.post('/', authMiddleware, requireRole(UserRole.ADMIN), async (req, res) => {
  const body = isRecord(req.body) ? req.body : {};
  const incomingSlug = sanitizeSlug(body.slug);
  if (!incomingSlug) {
    return res.status(400).json({ error: 'Slug is required' });
  }

  const siteConfig = await ensureSiteConfig();
  const store = loadStoreFromSiteConfig(siteConfig.data);
  const existing = store.profiles.find((entry) => entry.slug === incomingSlug);
  if (existing) {
    return res.status(409).json({ error: 'Slug already exists' });
  }

  const fallback = DEFAULT_STORE.profiles.find((entry) => entry.slug === incomingSlug) || DEFAULT_STORE.profiles[0];
  const nextProfile = normalizeProfile(
    {
      ...body,
      slug: incomingSlug,
      updatedAt: new Date().toISOString(),
    },
    fallback,
  );

  const nextStore: LoadingScreensStore = {
    profiles: dedupeProfiles([...store.profiles, nextProfile]),
  };

  const mergedData = mergeStoreIntoSiteConfig(siteConfig.data, nextStore);
  const updated = await prisma.siteConfig.update({
    where: { id: 1 },
    data: {
      data: mergedData as any,
    },
  });
  invalidatePublicLoadingProfileCache(nextProfile.slug);

  return res.status(201).json({
    updatedAt: updated.updatedAt.toISOString(),
    profile: nextProfile,
    profiles: nextStore.profiles,
  });
});

router.put('/:slug', authMiddleware, requireRole(UserRole.ADMIN), async (req, res) => {
  const slug = sanitizeSlug(req.params.slug);
  if (!slug) {
    return res.status(400).json({ error: 'Invalid slug' });
  }

  const body = isRecord(req.body) ? req.body : {};

  const siteConfig = await ensureSiteConfig();
  const store = loadStoreFromSiteConfig(siteConfig.data);
  const currentIndex = store.profiles.findIndex((entry) => entry.slug === slug);

  const fallback =
    (currentIndex >= 0 ? store.profiles[currentIndex] : undefined) ||
    DEFAULT_STORE.profiles.find((entry) => entry.slug === slug) ||
    DEFAULT_STORE.profiles[0];

  const nextProfile = normalizeProfile(
    {
      ...body,
      slug,
      routePath: `/${slug}`,
      updatedAt: new Date().toISOString(),
    },
    fallback,
  );

  const nextProfiles = [...store.profiles];
  if (currentIndex >= 0) {
    nextProfiles[currentIndex] = nextProfile;
  } else {
    nextProfiles.push(nextProfile);
  }

  const nextStore: LoadingScreensStore = {
    profiles: dedupeProfiles(nextProfiles),
  };

  const mergedData = mergeStoreIntoSiteConfig(siteConfig.data, nextStore);
  const updated = await prisma.siteConfig.update({
    where: { id: 1 },
    data: {
      data: mergedData as any,
    },
  });
  invalidatePublicLoadingProfileCache(slug);
  invalidatePublicLoadingProfileCache(nextProfile.slug);

  return res.json({
    updatedAt: updated.updatedAt.toISOString(),
    profile: nextProfile,
    profiles: nextStore.profiles,
  });
});

router.delete('/:slug', authMiddleware, requireRole(UserRole.ADMIN), async (req, res) => {
  const slug = sanitizeSlug(req.params.slug);
  if (!slug) {
    return res.status(400).json({ error: 'Invalid slug' });
  }

  const siteConfig = await ensureSiteConfig();
  const store = loadStoreFromSiteConfig(siteConfig.data);

  const nextProfiles = store.profiles.filter((entry) => entry.slug !== slug);
  if (nextProfiles.length === store.profiles.length) {
    return res.status(404).json({ error: 'Loading screen not found' });
  }

  if (nextProfiles.length === 0) {
    return res.status(400).json({ error: 'At least one loading screen must remain' });
  }

  const nextStore: LoadingScreensStore = {
    profiles: nextProfiles,
  };

  const mergedData = mergeStoreIntoSiteConfig(siteConfig.data, nextStore);
  const updated = await prisma.siteConfig.update({
    where: { id: 1 },
    data: {
      data: mergedData as any,
    },
  });
  invalidatePublicLoadingProfileCache(slug);

  return respondStore(res, nextStore, updated.updatedAt);
});

export default router;

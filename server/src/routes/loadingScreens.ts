import { Router } from 'express';
import { prisma } from '../db/client';
import { UserRole } from '../domain';
import { authMiddleware, requireRole } from '../middleware/auth';
import { bootstrap } from '../bootstrap';

const router = Router();

type LoadingScreenMode = 'TTT' | 'SANDBOX' | 'MURDER' | 'CUSTOM';

type LoadingScreenVipEntry = {
  name: string;
  steamId?: string;
  avatarUrl?: string;
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

const MAX_LINE_LENGTH = 240;
const MAX_LONG_TEXT_LENGTH = 600;
const MAX_URL_LENGTH = 2048;
const MAX_BG_IMAGES = 16;
const MAX_TRACKS = 24;
const MAX_VIPS = 40;
const MAX_RULES = 12;

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

    const normalized: LoadingScreenVipEntry = {
      name,
      ...(steamId ? { steamId } : {}),
      ...(avatarUrl ? { avatarUrl } : {}),
    };

    next.push(normalized);
  });

  return next.length > 0 ? next : fallback;
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
          avatarUrl:
            'https://shared.akamai.steamstatic.com/community_assets/images/items/2181720/097978e42477d98190ed9e14e971c2b9976fc8d1.gif',
        },
        {
          name: 'Gatogames435',
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
          avatarUrl: 'https://avatars.steamstatic.com/0650a97d7708b948a87e28c4b7c07ca9f268b073_full.jpg',
        },
        {
          name: 'chico tekito',
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

const respondStore = (res: any, store: LoadingScreensStore, updatedAt: Date) => {
  return res.json({
    updatedAt: updatedAt.toISOString(),
    profiles: store.profiles,
  });
};

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

  const siteConfig = await ensureSiteConfig();
  const store = loadStoreFromSiteConfig(siteConfig.data);
  const profile = store.profiles.find((entry) => entry.slug === slug);

  if (!profile || profile.enabled !== true) {
    return res.status(404).json({ error: 'Loading screen not found' });
  }

  return res.json(profile);
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

  return respondStore(res, nextStore, updated.updatedAt);
});

export default router;
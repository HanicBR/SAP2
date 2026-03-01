type SteamProfile = {
  steamId64: string;
  profileUrl: string;
  personaName?: string;
  avatarUrl?: string;
};

const STEAM_ID64_BASE = BigInt('76561197960265728');

const normalizeDigits = (value: string): string => String(value || '').replace(/[^\d]/g, '');

const isSteamId64 = (value: string): boolean => /^\d{17}$/.test(value);

const steam2To64 = (steamId: string): string | null => {
  const match = String(steamId || '').trim().match(/^STEAM_[0-5]:([01]):(\d+)$/i);
  if (!match) return null;
  const yRaw = match[1];
  const zRaw = match[2];
  if (!yRaw || !zRaw) return null;
  const y = BigInt(yRaw);
  const z = BigInt(zRaw);
  const id64 = STEAM_ID64_BASE + z * BigInt(2) + y;
  return id64.toString();
};

const withTimeout = async (url: string, init: RequestInit = {}, timeoutMs = 8_000): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'User-Agent': 'backstabber-api/steam-profile',
        ...(init.headers || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
};

const parseXmlTag = (xml: string, tag: string): string | undefined => {
  const cdata = xml.match(new RegExp(`<${tag}>\\s*<!\\[CDATA\\[(.*?)\\]\\]>\\s*</${tag}>`, 'i'));
  if (cdata && cdata[1]) return String(cdata[1]).trim();
  const plain = xml.match(new RegExp(`<${tag}>\\s*([^<]+?)\\s*</${tag}>`, 'i'));
  if (plain && plain[1]) return String(plain[1]).trim();
  return undefined;
};

const resolveVanityUrl = async (vanity: string): Promise<string | null> => {
  const apiKey = String(process.env.STEAM_WEB_API_KEY || '').trim();
  if (!apiKey || !vanity) return null;

  const endpoint =
    `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v0001/?key=${encodeURIComponent(apiKey)}` +
    `&vanityurl=${encodeURIComponent(vanity)}`;
  const response = await withTimeout(endpoint, {}, 8_000);
  if (!response.ok) return null;
  const json = await response.json().catch(() => null);
  const steamId = String(json?.response?.steamid || '').trim();
  if (!isSteamId64(steamId)) return null;
  return steamId;
};

const resolveInputToSteamId64 = async (rawInput: string): Promise<string> => {
  const input = String(rawInput || '').trim();
  if (!input) {
    throw new Error('Steam value is required');
  }

  const directDigits = normalizeDigits(input);
  if (isSteamId64(directDigits)) return directDigits;

  const steam2 = steam2To64(input.toUpperCase());
  if (steam2) return steam2;

  const profilesUrl = input.match(/steamcommunity\.com\/profiles\/(\d{17})/i);
  const profileId = profilesUrl?.[1];
  if (profileId && isSteamId64(profileId)) {
    return profileId;
  }

  const vanityUrl = input.match(/steamcommunity\.com\/id\/([^/?#]+)/i);
  if (vanityUrl && vanityUrl[1]) {
    const resolved = await resolveVanityUrl(vanityUrl[1]);
    if (resolved) return resolved;
    throw new Error('Could not resolve vanity Steam URL');
  }

  throw new Error('Unsupported Steam format');
};

const fetchSteamSummaryFromApi = async (steamId64: string): Promise<Partial<SteamProfile> | null> => {
  const apiKey = String(process.env.STEAM_WEB_API_KEY || '').trim();
  if (!apiKey) return null;

  const endpoint =
    `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${encodeURIComponent(apiKey)}` +
    `&steamids=${encodeURIComponent(steamId64)}`;
  const response = await withTimeout(endpoint, {}, 8_000);
  if (!response.ok) return null;

  const json = await response.json().catch(() => null);
  const player = json?.response?.players?.[0];
  if (!player) return null;

  const personaName = String(player.personaname || '').trim();
  const avatarUrl = String(player.avatarfull || '').trim();

  return {
    ...(personaName ? { personaName } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    profileUrl: `https://steamcommunity.com/profiles/${steamId64}`,
  };
};

const fetchSteamSummaryFromCommunityXml = async (
  steamId64: string,
): Promise<Partial<SteamProfile> | null> => {
  const endpoint = `https://steamcommunity.com/profiles/${steamId64}/?xml=1`;
  const response = await withTimeout(endpoint, {}, 8_000);
  if (!response.ok) return null;

  const xml = await response.text();
  const personaName = parseXmlTag(xml, 'steamID');
  const avatarUrl = parseXmlTag(xml, 'avatarFull');

  return {
    ...(personaName ? { personaName } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    profileUrl: `https://steamcommunity.com/profiles/${steamId64}`,
  };
};

export const resolveSteamProfile = async (input: string): Promise<SteamProfile> => {
  const steamId64 = await resolveInputToSteamId64(input);

  const fromApi = await fetchSteamSummaryFromApi(steamId64).catch(() => null);
  const fromXml = !fromApi ? await fetchSteamSummaryFromCommunityXml(steamId64).catch(() => null) : null;
  const summary = fromApi || fromXml || {};

  return {
    steamId64,
    profileUrl: summary.profileUrl || `https://steamcommunity.com/profiles/${steamId64}`,
    ...(summary.personaName ? { personaName: summary.personaName } : {}),
    ...(summary.avatarUrl ? { avatarUrl: summary.avatarUrl } : {}),
  };
};

export const syncSteamProfileBySteamId64 = async (steamId64: string): Promise<SteamProfile> => {
  if (!isSteamId64(steamId64)) {
    throw new Error('Invalid steamId64');
  }
  return resolveSteamProfile(steamId64);
};

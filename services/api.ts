

import { MOCK_SERVERS, MOCK_EVENTS, MOCK_STATS, VIP_PLANS, MOCK_SUSPICIOUS_GROUPS, MOCK_PLAYERS, MOCK_USERS, MOCK_TRANSACTIONS, generateServerAnalytics, DEFAULT_SITE_CONFIG } from '../constants';
import { GameServer, ServerEvent, DailyStats, VipPlan, SuspiciousGroup, Player, User, UserRole, LiveActivityItem, MapStats, FinancialStats, DashboardData, Transaction, TransactionProofUploadResult, TransactionType, ServerAnalytics, GameMode, ServerStatus, SiteConfig, PunishmentType, Punishment, LegacyImportSummary, LogsQueryParams, LogsQueryResponse, VipAdminItem, VipAdminListResponse, VipDispatchInfo, VipAutomationActionListResponse, VipAutomationActionStatus, VipReconcileResponse, VipAutomationConfig, PlayerIpHistoryResponseV2, RelatedAccountsResponseV2, SuspiciousGroupV2, DuplicateConfidence, SuspicionLevel, ServerLiveStateResponse, ServerWsLiveStateListResponse, PlayerAliasHistoryResponse, LoadingScreenProfile, LoadingScreensResponse, LoadingMediaUploadResult, LoadingTelemetryRange, LoadingTelemetrySlugsResponse, LoadingTelemetrySummaryResponse } from '../types';

// Utility to simulate network delay (used as fallback)
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// API base URL (when backend is enabled)
const API_BASE_URL: string | undefined =
  typeof import.meta !== 'undefined'
    ? (import.meta as any).env?.VITE_API_BASE_URL
    : undefined;

const hasApi = !!API_BASE_URL;

const getAuthToken = (): string | null => {
  try {
    return localStorage.getItem('backstabber_token');
  } catch {
    return null;
  }
};

const getStoredUsername = (): string | null => {
  try {
    const raw = localStorage.getItem('backstabber_user');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { username?: string };
    const username = String(parsed?.username || '').trim();
    return username || null;
  } catch {
    return null;
  }
};

const apiFetch = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  if (!hasApi || !API_BASE_URL) {
    throw new Error('API base URL not configured');
  }

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const token = getAuthToken();
  if (token) {
    (headers as any).Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const data = await response.json();
      if (data && typeof data.error === 'string') {
        message = data.error;
      }
    } catch {
      // ignore parse error, keep default message
    }
    if (response.status === 401 && /token/i.test(message)) {
      try {
        localStorage.removeItem('backstabber_token');
        localStorage.removeItem('backstabber_user');
      } catch {
        // ignore storage errors
      }
      throw new Error('Sessão expirada. Faça login novamente.');
    }
    throw new Error(message);
  }

  // Handles empty/204 responses gracefully
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  if (!text) {
    return undefined as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    // If it is plain text, return as any
    return text as unknown as T;
  }
};

const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Falha ao ler arquivo local'));
    reader.readAsDataURL(file);
  });

// Mock Databases in Memory (fallback when backend is not available)
let usersDb = [...MOCK_USERS];
let transactionsDb = [...MOCK_TRANSACTIONS];
let playersDb = [...MOCK_PLAYERS];
let serversDb = [...MOCK_SERVERS];
// Site Config with LocalStorage Persistence Simulation
let siteConfigDb: SiteConfig = (() => {
  try {
    const saved = localStorage.getItem('backstabber_site_config');
    return saved ? JSON.parse(saved) : { ...DEFAULT_SITE_CONFIG };
  } catch {
    return { ...DEFAULT_SITE_CONFIG };
  }
})();

const DEFAULT_LOADING_PROFILES: LoadingScreenProfile[] = [
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
        'Inocentes e detetive: identifiquem os traidores.',
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
    updatedAt: new Date().toISOString(),
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
    updatedAt: new Date().toISOString(),
  },
];

let loadingScreensDb: LoadingScreenProfile[] = (() => {
  try {
    const raw = localStorage.getItem('backstabber_loading_screens');
    if (!raw) return [...DEFAULT_LOADING_PROFILES];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_LOADING_PROFILES];
    const items = parsed.filter((entry) => entry && typeof entry === 'object');
    return items.length > 0 ? (items as LoadingScreenProfile[]) : [...DEFAULT_LOADING_PROFILES];
  } catch {
    return [...DEFAULT_LOADING_PROFILES];
  }
})();

const toConfidenceFromLegacy = (level?: string): DuplicateConfidence =>
  String(level || '').toUpperCase() === 'HIGH' ? 'HIGH' : 'MEDIUM';

const toSuspiciousGroupV2FromLegacy = (group: SuspiciousGroup): SuspiciousGroupV2 => {
  const normalizedLevel = String(group.level || '').toUpperCase();
  const isHigh = normalizedLevel === 'HIGH';
  const reasonCode = isHigh ? 'SAME_IP' : 'SAME_SUBNET';
  return {
    id: group.id,
    level: isHigh ? 'HIGH' : 'MODERATE',
    confidence: isHigh ? 'HIGH' : 'MEDIUM',
    reasonCode,
    reasonLabel: isHigh ? 'Mesmo IP exato' : 'Mesma sub-rede /24',
    commonIpOrSubnet: group.commonIpOrSubnet,
    location: group.location,
    lastActivity: group.lastActivity,
    players: group.players,
  };
};

const toLegacyGroupFromV2 = (group: SuspiciousGroupV2): SuspiciousGroup => ({
  id: group.id,
  level: group.level === 'HIGH' ? SuspicionLevel.HIGH : SuspicionLevel.MODERATE,
  commonIpOrSubnet: group.commonIpOrSubnet,
  location: group.location,
  lastActivity: group.lastActivity,
  players: group.players,
});

const normalizeLoadingSlug = (value: string): string =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);

const persistLoadingScreensDb = (): void => {
  try {
    localStorage.setItem('backstabber_loading_screens', JSON.stringify(loadingScreensDb));
  } catch {
    // ignore storage errors
  }
};

export const ApiService = {
  // Public Data
  getServers: async (): Promise<GameServer[]> => {
    if (hasApi) {
      try {
        const servers = await apiFetch<GameServer[]>('/servers');
        return servers;
      } catch (error) {
        console.error('API getServers failed, falling back to mock getServers:', error);
      }
    }

    await delay(500);
    return [...serversDb];
  },

  getServerById: async (id: string): Promise<GameServer | undefined> => {
     if (hasApi) {
       try {
         const server = await apiFetch<GameServer>(`/servers/${id}`);
         return server;
       } catch (error) {
         console.error('API getServerById failed, falling back to mock getServerById:', error);
       }
     }

     await delay(300);
     return serversDb.find(s => s.id === id);
  },

  getServersLiveState: async (): Promise<ServerWsLiveStateListResponse> => {
    if (hasApi) {
      try {
        return await apiFetch<ServerWsLiveStateListResponse>('/servers/ws/live-state');
      } catch (error) {
        console.error('API getServersLiveState failed, returning empty live-state list:', error);
      }
    }

    await delay(100);
    return {
      now: new Date().toISOString(),
      total: 0,
      items: [],
    };
  },

  getServerLiveState: async (serverId: string): Promise<ServerLiveStateResponse> => {
    if (hasApi) {
      try {
        return await apiFetch<ServerLiveStateResponse>(`/servers/${serverId}/live-state`);
      } catch (error) {
        console.error('API getServerLiveState failed, returning unavailable live-state fallback:', error);
      }
    }

    await delay(100);
    const mockServer = serversDb.find((item) => item.id === serverId);
    return {
      serverId,
      available: false,
      transport: 'websocket',
      fallback: {
        status: 'UNKNOWN',
        currentPlayers: mockServer?.currentPlayers || 0,
        maxPlayers: mockServer?.maxPlayers || 0,
        ...(mockServer?.currentMap ? { currentMap: mockServer.currentMap } : {}),
        ...(mockServer?.lastHeartbeat ? { lastHeartbeat: mockServer.lastHeartbeat } : {}),
      },
    };
  },

  createServer: async (data: { name: string, ip: string, port: number, mode: GameMode, maxPlayers: number }): Promise<GameServer> => {
    if (!hasApi) {
      throw new Error('API base URL not configured');
    }
    return apiFetch<GameServer>('/servers', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  updateServerIp: async (serverId: string, ip: string): Promise<GameServer> => {
    if (!hasApi) {
      await delay(200);
      const idx = serversDb.findIndex((s) => s.id === serverId);
      if (idx === -1) {
        throw new Error('Servidor nÃ£o encontrado');
      }
      serversDb[idx] = { ...serversDb[idx], ip };
      return serversDb[idx];
    }

    return apiFetch<GameServer>(`/servers/${serverId}`, {
      method: 'PATCH',
      body: JSON.stringify({ ip }),
    });
  },

  getServerAnalytics: async (serverId: string, range: '24h' | '7d' | '30d'): Promise<ServerAnalytics> => {
    if (hasApi) {
      try {
        const analytics = await apiFetch<ServerAnalytics>(`/servers/${serverId}/analytics?range=${range}`);
        return analytics;
      } catch (error) {
        console.error('API getServerAnalytics failed, falling back to mock analytics:', error);
      }
    }

    await delay(600);
    return generateServerAnalytics(range === '24h' ? 24 : range === '7d' ? 7 : 30);
  },

  getVipPlans: async (): Promise<VipPlan[]> => {
    await delay(300);
    return [...VIP_PLANS];
  },

  // Auth System
  login: async (emailOrUser: string, password: string): Promise<User | null> => {
    if (!hasApi) {
      throw new Error('API base URL not configured');
    }

    const result = await apiFetch<{ user: User; token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ emailOrUser, password }),
    });
    localStorage.setItem('backstabber_token', result.token);
    localStorage.setItem('backstabber_user', JSON.stringify(result.user));
    return result.user;
  },

  register: async (username: string, email: string, password: string): Promise<User> => {
    if (!hasApi) {
      throw new Error('API base URL not configured');
    }

    const result = await apiFetch<{ user: User; token: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    });
    localStorage.setItem('backstabber_token', result.token);
    localStorage.setItem('backstabber_user', JSON.stringify(result.user));
    return result.user;
  },

  getCurrentUser: async (): Promise<User> => {
    if (!hasApi) {
      throw new Error('API base URL not configured');
    }

    const result = await apiFetch<{ user: User }>('/auth/me');
    localStorage.setItem('backstabber_user', JSON.stringify(result.user));
    return result.user;
  },
  
  createUser: async (username: string, email: string, password: string, role: UserRole): Promise<User> => {
    if (hasApi) {
      try {
        const created = await apiFetch<User>('/users', {
          method: 'POST',
          body: JSON.stringify({ username, email, password, role }),
        });
        return created;
      } catch (error) {
        console.error('API createUser failed, falling back to mock createUser:', error);
      }
    }

    // Fallback mock implementation
    await delay(500);
    const newUser: User = {
      id: `u_${Date.now()}`,
      username,
      email,
      role,
      createdAt: new Date().toISOString(),
      avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`
    };
    usersDb.push(newUser);
    return newUser;
  },

  getUsers: async (): Promise<User[]> => {
    if (hasApi) {
      try {
        const users = await apiFetch<User[]>('/users');
        return users;
      } catch (error) {
        console.error('API getUsers failed, falling back to mock getUsers:', error);
      }
    }

    await delay(400);
    return [...usersDb];
  },

  updateUserRole: async (userId: string, newRole: UserRole): Promise<User | null> => {
    if (hasApi) {
      try {
        const updated = await apiFetch<User>(`/users/${userId}/role`, {
          method: 'PATCH',
          body: JSON.stringify({ role: newRole }),
        });
        return updated;
      } catch (error) {
        console.error('API updateUserRole failed, falling back to mock updateUserRole:', error);
      }
    }

    await delay(400);
    const index = usersDb.findIndex(u => u.id === userId);
    if (index !== -1) {
      usersDb[index] = { ...usersDb[index], role: newRole };
      return usersDb[index];
    }
    return null;
  },

  updateUser: async (
    userId: string,
    data: { username?: string; email?: string; role?: UserRole; password?: string },
  ): Promise<User> => {
    if (!hasApi) throw new Error('API base URL not configured');
    return apiFetch<User>(`/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  deleteUser: async (userId: string): Promise<void> => {
    if (!hasApi) throw new Error('API base URL not configured');
    await apiFetch<void>(`/users/${userId}`, { method: 'DELETE' });
  },

  linkUserSteam: async (userId: string, steam: string): Promise<User> => {
    if (!hasApi) throw new Error('API base URL not configured');
    return apiFetch<User>(`/users/${userId}/steam-link`, {
      method: 'POST',
      body: JSON.stringify({ steam }),
    });
  },

  syncUserSteam: async (userId: string): Promise<User> => {
    if (!hasApi) throw new Error('API base URL not configured');
    return apiFetch<User>(`/users/${userId}/steam-sync`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  unlinkUserSteam: async (userId: string): Promise<User> => {
    if (!hasApi) throw new Error('API base URL not configured');
    return apiFetch<User>(`/users/${userId}/steam-link`, {
      method: 'DELETE',
    });
  },

  changePassword: async (currentPassword: string, newPassword: string): Promise<User> => {
    if (!hasApi) throw new Error('API base URL not configured');
    const result = await apiFetch<{ user: User }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    return result.user;
  },

  // --- SITE CONFIGURATION ---
  getSiteConfig: async (): Promise<SiteConfig> => {
    if (hasApi) {
      try {
        const config = await apiFetch<SiteConfig>('/site-config');
        siteConfigDb = config;
        try {
          localStorage.setItem('backstabber_site_config', JSON.stringify(config));
        } catch {
          // ignore storage errors
        }
        return config;
      } catch (error) {
        console.error('API getSiteConfig failed, falling back to local config:', error);
      }
    }

    await delay(200); // Fast load
    return { ...siteConfigDb };
  },

  updateSiteConfig: async (config: SiteConfig): Promise<SiteConfig> => {
    if (hasApi) {
      try {
        const updated = await apiFetch<SiteConfig>('/site-config', {
          method: 'PUT',
          body: JSON.stringify(config),
        });
        siteConfigDb = updated;
        try {
          localStorage.setItem('backstabber_site_config', JSON.stringify(updated));
        } catch {
          // ignore storage errors
        }
        return updated;
      } catch (error) {
        console.error('API updateSiteConfig failed, falling back to local update:', error);
      }
    }

    await delay(500);
    siteConfigDb = config;
    try {
      localStorage.setItem('backstabber_site_config', JSON.stringify(config));
    } catch {
      // ignore storage errors
    }
    return config;
  },

  uploadLoadingMedia: async (file: File): Promise<LoadingMediaUploadResult> => {
    if (hasApi && API_BASE_URL) {
      const formData = new FormData();
      formData.append('file', file);

      const headers: HeadersInit = {};
      const token = getAuthToken();
      if (token) {
        (headers as any).Authorization = `Bearer ${token}`;
      }

      const response = await fetch(`${API_BASE_URL}/loading-screens/media-upload`, {
        method: 'POST',
        headers,
        body: formData,
      });

      if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
          const body = await response.json();
          if (body && typeof body.error === 'string') {
            message = body.error;
          }
        } catch {
          // ignore parse error
        }
        throw new Error(message);
      }

      return (await response.json()) as LoadingMediaUploadResult;
    }

    const dataUrl = await fileToDataUrl(file);
    return {
      url: dataUrl,
      filename: file.name,
      size: file.size,
      mime: file.type || 'application/octet-stream',
    };
  },

  getLoadingScreens: async (): Promise<LoadingScreensResponse> => {
    if (hasApi) {
      try {
        return await apiFetch<LoadingScreensResponse>('/loading-screens');
      } catch (error) {
        console.error('API getLoadingScreens failed, falling back to local store:', error);
      }
    }

    await delay(120);
    return {
      updatedAt: new Date().toISOString(),
      profiles: [...loadingScreensDb],
    };
  },

  createLoadingScreen: async (profile: LoadingScreenProfile): Promise<LoadingScreensResponse> => {
    const safeSlug = normalizeLoadingSlug(profile.slug);
    if (!safeSlug) {
      throw new Error('Slug invalido');
    }

    const payload: LoadingScreenProfile = {
      ...profile,
      slug: safeSlug,
      routePath: `/${safeSlug}`,
      updatedAt: new Date().toISOString(),
    };

    if (hasApi) {
      try {
        const result = await apiFetch<LoadingScreensResponse>(`/loading-screens`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        return result;
      } catch (error) {
        console.error('API createLoadingScreen failed, falling back to local store:', error);
      }
    }

    await delay(150);
    if (loadingScreensDb.some((entry) => entry.slug === safeSlug)) {
      throw new Error('Slug ja existe');
    }
    loadingScreensDb = [...loadingScreensDb, payload];
    persistLoadingScreensDb();
    return {
      updatedAt: new Date().toISOString(),
      profiles: [...loadingScreensDb],
    };
  },

  updateLoadingScreen: async (
    slug: string,
    profile: LoadingScreenProfile,
  ): Promise<LoadingScreensResponse> => {
    const safeSlug = normalizeLoadingSlug(slug || profile.slug);
    if (!safeSlug) {
      throw new Error('Slug invalido');
    }

    const payload: LoadingScreenProfile = {
      ...profile,
      slug: safeSlug,
      routePath: `/${safeSlug}`,
      updatedAt: new Date().toISOString(),
    };

    if (hasApi) {
      try {
        return await apiFetch<LoadingScreensResponse>(`/loading-screens/${safeSlug}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      } catch (error) {
        console.error('API updateLoadingScreen failed, falling back to local store:', error);
      }
    }

    await delay(150);
    const idx = loadingScreensDb.findIndex((entry) => entry.slug === safeSlug);
    if (idx === -1) {
      loadingScreensDb = [...loadingScreensDb, payload];
    } else {
      const next = [...loadingScreensDb];
      next[idx] = payload;
      loadingScreensDb = next;
    }
    persistLoadingScreensDb();
    return {
      updatedAt: new Date().toISOString(),
      profiles: [...loadingScreensDb],
    };
  },

  deleteLoadingScreen: async (slug: string): Promise<LoadingScreensResponse> => {
    const safeSlug = normalizeLoadingSlug(slug);
    if (!safeSlug) {
      throw new Error('Slug invalido');
    }

    if (hasApi) {
      try {
        return await apiFetch<LoadingScreensResponse>(`/loading-screens/${safeSlug}`, {
          method: 'DELETE',
        });
      } catch (error) {
        console.error('API deleteLoadingScreen failed, falling back to local store:', error);
      }
    }

    await delay(150);
    const next = loadingScreensDb.filter((entry) => entry.slug !== safeSlug);
    if (next.length === loadingScreensDb.length) {
      throw new Error('Loading screen nao encontrada');
    }
    if (next.length === 0) {
      throw new Error('Mantenha ao menos 1 loading screen');
    }
    loadingScreensDb = next;
    persistLoadingScreensDb();
    return {
      updatedAt: new Date().toISOString(),
      profiles: [...loadingScreensDb],
    };
  },

  getLoadingTelemetrySlugs: async (
    range: LoadingTelemetryRange,
  ): Promise<LoadingTelemetrySlugsResponse> => {
    const safeRange: LoadingTelemetryRange =
      range === '24h' || range === '30d' ? range : '7d';

    if (hasApi) {
      try {
        return await apiFetch<LoadingTelemetrySlugsResponse>(
          `/loading-telemetry/admin/slugs?range=${encodeURIComponent(safeRange)}`,
        );
      } catch (error) {
        console.error('API getLoadingTelemetrySlugs failed, falling back to local mock:', error);
      }
    }

    await delay(80);
    const now = new Date();
    const windowMs =
      safeRange === '24h'
        ? 24 * 60 * 60 * 1000
        : safeRange === '30d'
        ? 30 * 24 * 60 * 60 * 1000
        : 7 * 24 * 60 * 60 * 1000;
    const from = new Date(now.getTime() - windowMs);

    return {
      range: safeRange,
      window: {
        from: from.toISOString(),
        to: now.toISOString(),
      },
      totalSessionsScanned: 0,
      truncated: false,
      items: loadingScreensDb.map((entry) => ({
        slug: entry.slug,
        sessions: 0,
        completed: 0,
        abandoned: 0,
        completionRatePct: 0,
        lastStartedAt: null,
      })),
    };
  },

  getLoadingTelemetrySummary: async (params: {
    range: LoadingTelemetryRange;
    slug?: string;
  }): Promise<LoadingTelemetrySummaryResponse> => {
    const safeRange: LoadingTelemetryRange =
      params.range === '24h' || params.range === '30d' ? params.range : '7d';
    const safeSlug = String(params.slug || '')
      .trim()
      .toLowerCase();

    if (hasApi) {
      try {
        const search = new URLSearchParams();
        search.set('range', safeRange);
        if (safeSlug) search.set('slug', safeSlug);
        return await apiFetch<LoadingTelemetrySummaryResponse>(
          `/loading-telemetry/admin/summary?${search.toString()}`,
        );
      } catch (error) {
        console.error('API getLoadingTelemetrySummary failed, falling back to local mock:', error);
      }
    }

    await delay(120);
    const now = new Date();
    const windowMs =
      safeRange === '24h'
        ? 24 * 60 * 60 * 1000
        : safeRange === '30d'
        ? 30 * 24 * 60 * 60 * 1000
        : 7 * 24 * 60 * 60 * 1000;
    const from = new Date(now.getTime() - windowMs);
    const bucketCount = safeRange === '24h' ? 24 : safeRange === '30d' ? 30 : 7;
    const timeline = Array.from({ length: bucketCount }).map((_, idx) => {
      const startMs = from.getTime() + Math.floor((windowMs / bucketCount) * idx);
      const endMs =
        idx === bucketCount - 1
          ? now.getTime()
          : from.getTime() + Math.floor((windowMs / bucketCount) * (idx + 1));
      return {
        from: new Date(startMs).toISOString(),
        to: new Date(endMs).toISOString(),
        label:
          safeRange === '24h'
            ? new Date(startMs).toISOString().slice(11, 16)
            : new Date(startMs).toISOString().slice(5, 10),
        sessions: 0,
        completed: 0,
        abandoned: 0,
        avgDurationMs: 0,
        p95DurationMs: 0,
      };
    });

    return {
      generatedAt: now.toISOString(),
      range: safeRange,
      window: {
        from: from.toISOString(),
        to: now.toISOString(),
      },
      slug: safeSlug || null,
      limits: {
        maxSessions: 0,
        maxEvents: 0,
        maxTrackedFiles: 0,
        maxStepDurationMs: 0,
      },
      totals: {
        sessions: 0,
        completed: 0,
        abandoned: 0,
        completionRatePct: 0,
        eventsAnalyzed: 0,
        sessionsWithDuration: 0,
        avgDurationMs: 0,
        p50DurationMs: 0,
        p95DurationMs: 0,
      },
      statusBreakdown: [],
      stageDurations: [],
      slowFiles: [],
      sources: [],
      timeline,
      truncated: {
        sessions: false,
        events: false,
      },
    };
  },

  getIngestStats: async (): Promise<{ tools: Record<string, number>; commands: Record<string, number>; rawText: Record<string, number> }> => {
    if (hasApi) {
      try {
        const stats = await apiFetch<{ tools: Record<string, number>; commands: Record<string, number>; rawText: Record<string, number> }>('/ingest/stats');
        return stats;
      } catch (error) {
        console.error('API getIngestStats failed:', error);
      }
    }
    return { tools: {}, commands: {}, rawText: {} };
  },

  // Admin / Analytics Data
  getDashboardStats: async (): Promise<DashboardData> => {
    if (hasApi) {
      try {
        const data = await apiFetch<DashboardData>('/dashboard');
        return data;
      } catch (error) {
        console.error('API getDashboardStats failed, falling back to mock dashboard:', error);
      }
    }

    await delay(600);
    
    // Mock Map Stats Grouped by Mode
    const mapStats: Record<string, MapStats[]> = {
      'TTT': [
        { name: 'ttt_rooftops_2016', playCount: 150, percentage: 40 },
        { name: 'ttt_minecraft_b5', playCount: 85, percentage: 25 },
        { name: 'ttt_67thway_v3', playCount: 60, percentage: 15 },
        { name: 'Outros', playCount: 50, percentage: 20 },
      ],
      'Murder': [
         { name: 'mu_resort', playCount: 64, percentage: 45 },
         { name: 'mu_clue', playCount: 40, percentage: 30 },
         { name: 'md_house', playCount: 30, percentage: 25 },
      ],
      'Sandbox': [
         { name: 'gm_construct', playCount: 42, percentage: 60 },
         { name: 'gm_flatgrass', playCount: 28, percentage: 40 },
      ]
    };

    // Mock Live Feed
    const liveActivity: LiveActivityItem[] = [
      { id: '1', message: 'Player "DarkKiller" comprou VIP++ (Mensal)', type: 'SUCCESS', timestamp: new Date().toISOString(), serverName: 'Web Store' },
      { id: '2', message: 'Servidor TTT #1 reiniciado automaticamente', type: 'INFO', timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString(), serverName: 'TTT #1' },
      { id: '3', message: 'Admin "Mod_Joao" baniu "Troll123" (Mass RDM)', type: 'WARNING', timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString(), serverName: 'TTT #1' },
      { id: '4', message: 'Novo recorde de players: 32/32', type: 'INFO', timestamp: new Date(Date.now() - 1000 * 60 * 45).toISOString(), serverName: 'Murder #1' },
      { id: '5', message: 'Erro de Lua detectado no hook "PlayerSpawn"', type: 'ERROR', timestamp: new Date(Date.now() - 1000 * 60 * 60).toISOString(), serverName: 'Sandbox #1' },
    ];

    // Mock Financial Stats
    const financialStats: FinancialStats = {
      revenueToday: 145.00,
      revenueMonth: 3250.00,
      transactionsToday: 4
    };

    return {
      generatedAt: new Date().toISOString(),
      uniquePlayers24h: 1420,
      totalConnections: 3500,
      roundsPlayed: 450,
      activeBans: 12,
      chartData: MOCK_STATS,
      mapStats,
      liveActivity,
      financialStats,
      opsHealth: {
        totalServers: serversDb.length,
        onlineServers: serversDb.filter((server) => server.status === ServerStatus.ONLINE).length,
        offlineServers: serversDb.filter((server) => server.status === ServerStatus.OFFLINE).length,
        maintenanceServers: serversDb.filter((server) => server.status === ServerStatus.MAINTENANCE).length,
        currentPlayers: serversDb.reduce((acc, server) => acc + Number(server.currentPlayers || 0), 0),
        maxPlayers: serversDb.reduce((acc, server) => acc + Number(server.maxPlayers || 0), 0),
        wsConnectedServers: 0,
        wsLiveStateServers: 0,
        wsInvalidMessages: 0,
        wsAckErrors: 0,
        actionQueueSize: 0,
      },
      highlights: {
        logs24h: 0,
        punishments24h: 0,
        deactivations24h: 0,
        activeMutes: 0,
        activeGags: 0,
        topEventTypes24h: [],
      },
    };
  },

  importLegacyLogs: async (payload: {
    serverId: string;
    content: string;
    formatHint?: 'AUTO' | 'ULX' | 'TAGGED';
    defaultGameMode?: GameMode;
    timezoneOffsetMinutes?: number;
    baseDate?: string;
    dryRun?: boolean;
  }): Promise<LegacyImportSummary> => {
    if (!hasApi) {
      throw new Error('API base URL not configured');
    }

    return apiFetch<LegacyImportSummary>('/admin/legacy-logs/import', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  getEventsQuery: async (query: LogsQueryParams = {}): Promise<LogsQueryResponse> => {
    const normalized: LogsQueryParams = { ...query };
    if (normalized.mode === 'ALL') delete normalized.mode;
    if (normalized.actorType === 'ALL') delete normalized.actorType;

    if (hasApi) {
      const params = new URLSearchParams();
      if (normalized.search) params.set('search', normalized.search);
      if (normalized.serverId) params.set('serverId', normalized.serverId);
      if (normalized.type) params.set('type', normalized.type);
      if (normalized.mode) params.set('mode', String(normalized.mode));
      if (normalized.from) params.set('from', normalized.from);
      if (normalized.to) params.set('to', normalized.to);
      if (normalized.actorType) params.set('actorType', normalized.actorType);
      if (normalized.target) params.set('target', normalized.target);
      if (typeof normalized.limit === 'number' && Number.isFinite(normalized.limit) && normalized.limit > 0) {
        params.set('limit', String(Math.floor(normalized.limit)));
      }
      if (typeof normalized.page === 'number' && Number.isFinite(normalized.page) && normalized.page > 0) {
        params.set('page', String(Math.floor(normalized.page)));
      }
      if (normalized.cursor) {
        params.set('cursor', normalized.cursor);
      }

      const suffix = params.toString() ? `?${params.toString()}` : '';
      return await apiFetch<LogsQueryResponse>(`/logs/query${suffix}`);
    }

    await delay(250);

    const limit = Math.max(1, Math.min(200, Math.floor(normalized.limit || 20)));
    const page = Math.max(1, Math.floor(normalized.page || 1));
    const lowerSearch = (normalized.search || '').toLowerCase();
    const lowerTarget = (normalized.target || '').toLowerCase();
    const lowerActor = (normalized.actorType || '').toLowerCase();

    let events = [...MOCK_EVENTS];
    if (lowerSearch) {
      events = events.filter((e) => {
        const m: any = e.metadata || {};
        const searchable = [
          e.playerName,
          e.steamId,
          e.rawText,
          m.message,
          m.command,
          m.reason,
          m.targetName,
          m.targetSteamId,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return searchable.includes(lowerSearch);
      });
    }
    if (normalized.serverId) {
      events = events.filter((e) => e.serverId === normalized.serverId);
    }
    if (normalized.type) {
      events = events.filter((e) => e.type === normalized.type);
    }
    if (normalized.mode && normalized.mode !== 'ALL') {
      const modeRaw = String(normalized.mode).toLowerCase();
      const modeNormalized = modeRaw === 'sandbox' ? GameMode.SANDBOX : modeRaw === 'murder' ? GameMode.MURDER : GameMode.TTT;
      events = events.filter((e) => e.gameMode === modeNormalized);
    }
    if (lowerActor) {
      events = events.filter((e) => String((e.metadata as any)?.actorType || '').toLowerCase() === lowerActor);
    }
    if (lowerTarget) {
      events = events.filter((e) => {
        const m: any = e.metadata || {};
        return (
          String(m.targetName || '').toLowerCase().includes(lowerTarget) ||
          String(m.targetSteamId || '').toLowerCase().includes(lowerTarget) ||
          String(e.rawText || '').toLowerCase().includes(lowerTarget)
        );
      });
    }

    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (normalized.cursor) {
      const startIndex = events.findIndex((e) => e.id === normalized.cursor);
      const start = startIndex >= 0 ? startIndex + 1 : 0;
      const sliced = events.slice(start, start + limit + 1);
      const hasMore = sliced.length > limit;
      const items = hasMore ? sliced.slice(0, limit) : sliced;
      return {
        mode: 'cursor',
        limit,
        hasMore,
        nextCursor: hasMore ? items[items.length - 1]?.id || null : null,
        items,
      };
    }

    const total = events.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * limit;
    const items = events.slice(start, start + limit);

    return {
      mode: 'page',
      page: safePage,
      limit,
      total,
      totalPages,
      hasMore: safePage < totalPages,
      nextCursor: items.length ? items[items.length - 1].id : null,
      items,
    };
  },

  getEvents: async (
    filter?:
      | string
      | {
          search?: string;
          serverId?: string;
          type?: string;
          from?: string;
          to?: string;
          limit?: number;
        },
  ): Promise<ServerEvent[]> => {
    const query = typeof filter === 'string' ? { search: filter } : filter || {};
    const response = await ApiService.getEventsQuery({
      ...query,
      limit: query.limit ?? 1000,
      page: 1,
    });
    return response.items;
  },

  getPlayerLogs: async (
    steamId: string,
    query?: { scope?: 'actor' | 'target' | 'all'; page?: number; limit?: number },
  ): Promise<LogsQueryResponse> => {
    const normalized = query || {};

    if (hasApi) {
      const params = new URLSearchParams();
      if (normalized.scope) params.set('scope', normalized.scope);
      if (typeof normalized.limit === 'number' && Number.isFinite(normalized.limit) && normalized.limit > 0) {
        params.set('limit', String(Math.floor(normalized.limit)));
      }
      if (typeof normalized.page === 'number' && Number.isFinite(normalized.page) && normalized.page > 0) {
        params.set('page', String(Math.floor(normalized.page)));
      }
      const suffix = params.toString() ? `?${params.toString()}` : '';
      return await apiFetch<LogsQueryResponse>(`/players/${steamId}/logs${suffix}`);
    }

    await delay(250);

    const limit = Math.max(1, Math.min(200, Math.floor(normalized.limit || 50)));
    const page = Math.max(1, Math.floor(normalized.page || 1));
    const scope = normalized.scope || 'all';
    const sid = String(steamId || '').trim();

    const events = [...MOCK_EVENTS];
    const matchesActor = (e: any) =>
      e.steamId === sid || String(e?.metadata?.attackerSteamId || '') === sid;
    const matchesTarget = (e: any) =>
      String(e?.metadata?.targetSteamId || '') === sid || String(e?.metadata?.victimSteamId || '') === sid;

    const filtered = events
      .filter((e: any) => {
        if (scope === 'actor') return matchesActor(e);
        if (scope === 'target') return matchesTarget(e);
        return matchesActor(e) || matchesTarget(e);
      })
      .sort((a, b) => {
        const t = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
        if (t !== 0) return t;
        return String(b.id).localeCompare(String(a.id));
      });

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * limit;
    const items = filtered.slice(start, start + limit);

    return {
      mode: 'page',
      page: safePage,
      limit,
      total,
      totalPages,
      hasMore: safePage < totalPages,
      nextCursor: items.length ? items[items.length - 1].id : null,
      items,
    };
  },

  getPlayers: async (search?: string, serverFilter?: string, vipFilter?: boolean): Promise<Player[]> => {
    if (hasApi) {
      const params = new URLSearchParams();
      if (search) params.append('search', search);
      if (serverFilter) params.append('serverId', serverFilter);
      if (vipFilter !== undefined) params.append('isVip', String(vipFilter));
      const players = await apiFetch<Player[]>(`/players?${params.toString()}`);
      return players;
    }

    await delay(500);
    let players = [...playersDb];

    if (search) {
      const lowerSearch = search.toLowerCase();
      players = players.filter(p => 
        p.name.toLowerCase().includes(lowerSearch) || 
        p.steamId.includes(lowerSearch)
      );
    }

    if (serverFilter) {
      players = players.filter(p => p.serverStats && p.serverStats[serverFilter]);
    }

    if (vipFilter !== undefined) {
      players = players.filter(p => p.isVip === vipFilter);
    }

    return players;
  },

  getVips: async (query?: {
    search?: string;
    status?: 'ALL' | 'ACTIVE' | 'EXPIRED';
    expiringInDays?: number;
    limit?: number;
  }): Promise<VipAdminListResponse> => {
    const normalized = query || {};
    if (hasApi) {
      const params = new URLSearchParams();
      if (normalized.search) params.set('search', normalized.search);
      if (normalized.status) params.set('status', normalized.status);
      if (typeof normalized.expiringInDays === 'number') {
        params.set('expiringInDays', String(normalized.expiringInDays));
      }
      if (typeof normalized.limit === 'number') {
        params.set('limit', String(normalized.limit));
      }
      const suffix = params.toString() ? `?${params.toString()}` : '';
      return apiFetch<VipAdminListResponse>(`/vips${suffix}`);
    }

    await delay(250);
    const now = Date.now();
    const status = (normalized.status || 'ALL').toUpperCase();
    const expiringCutoffMs =
      typeof normalized.expiringInDays === 'number' && normalized.expiringInDays > 0
        ? now + normalized.expiringInDays * 24 * 60 * 60 * 1000
        : 0;

    const items: VipAdminItem[] = [...playersDb]
      .filter((player) => player.isVip || !!player.vipExpiry)
      .filter((player) => {
        if (!normalized.search) return true;
        const q = normalized.search.toLowerCase();
        return player.name.toLowerCase().includes(q) || player.steamId.toLowerCase().includes(q);
      })
      .map((player) => {
        const expiryMs = player.vipExpiry ? new Date(player.vipExpiry).getTime() : 0;
        const expired = !!expiryMs && expiryMs <= now;
        const vipServerIds = Array.isArray((player as any).vipServerIds)
          ? ((player as any).vipServerIds as string[]).filter((entry) => String(entry || '').trim().length > 0)
          : [];
        const vipServerNames = vipServerIds
          .map((id) => serversDb.find((server) => server.id === id)?.name)
          .filter((name): name is string => Boolean(name));
        return {
          steamId: player.steamId,
          name: player.name,
          avatarUrl: player.avatarUrl,
          isVip: player.isVip,
          vipPlan: player.vipPlan,
          vipExpiry: player.vipExpiry,
          lastSeen: player.lastSeen,
          vipStatus: player.isVip ? (expired ? 'EXPIRED' : 'ACTIVE') : 'INACTIVE',
          vipServerIds,
          vipServerNames,
        };
      })
      .filter((item) => {
        if (status === 'ACTIVE') return item.isVip && item.vipStatus === 'ACTIVE';
        if (status === 'EXPIRED') return item.isVip && item.vipStatus === 'EXPIRED';
        return true;
      })
      .filter((item) => {
        if (!expiringCutoffMs || !item.vipExpiry) return true;
        const expiryMs = new Date(item.vipExpiry).getTime();
        return expiryMs > now && expiryMs <= expiringCutoffMs;
      })
      .sort((a, b) => {
        const aExpiry = a.vipExpiry ? new Date(a.vipExpiry).getTime() : Number.MAX_SAFE_INTEGER;
        const bExpiry = b.vipExpiry ? new Date(b.vipExpiry).getTime() : Number.MAX_SAFE_INTEGER;
        return aExpiry - bExpiry;
      });

    const limit = Math.max(1, Math.min(500, Math.floor(normalized.limit || 100)));
    return {
      items: items.slice(0, limit),
      total: items.length,
    };
  },

  getVipAutomationConfig: async (): Promise<VipAutomationConfig> => {
    if (hasApi) {
      return apiFetch<VipAutomationConfig>('/vips/automation-config');
    }

    await delay(100);
    const local = siteConfigDb.vipAutomation;
    return {
      enabled: local?.enabled === true,
      sandboxServerId: local?.sandboxServerId,
      grantTemplate: local?.grantTemplate || '',
      revokeTemplate: local?.revokeTemplate || '',
      source: 'site_config',
    };
  },

  updateVipAutomationConfig: async (data: {
    enabled: boolean;
    sandboxServerId?: string;
    grantTemplate: string;
    revokeTemplate: string;
  }): Promise<VipAutomationConfig> => {
    if (hasApi) {
      return apiFetch<VipAutomationConfig>('/vips/automation-config', {
        method: 'PUT',
        body: JSON.stringify(data),
      });
    }

    await delay(100);
    siteConfigDb = {
      ...siteConfigDb,
      vipAutomation: {
        enabled: data.enabled,
        ...(String(data.sandboxServerId || '').trim()
          ? { sandboxServerId: String(data.sandboxServerId || '').trim() }
          : {}),
        grantTemplate: String(data.grantTemplate || ''),
        revokeTemplate: String(data.revokeTemplate || ''),
      },
    };
    try {
      localStorage.setItem('backstabber_site_config', JSON.stringify(siteConfigDb));
    } catch {
      // ignore storage errors
    }
    return {
      ...siteConfigDb.vipAutomation,
      source: 'site_config',
    };
  },

  getVipAutomationActions: async (query?: {
    status?: 'ALL' | VipAutomationActionStatus;
    steamId?: string;
    limit?: number;
  }): Promise<VipAutomationActionListResponse> => {
    const normalized = query || {};
    if (hasApi) {
      const params = new URLSearchParams();
      if (normalized.status) params.set('status', normalized.status);
      if (normalized.steamId) params.set('steamId', normalized.steamId);
      if (typeof normalized.limit === 'number') params.set('limit', String(normalized.limit));
      const suffix = params.toString() ? `?${params.toString()}` : '';
      return apiFetch<VipAutomationActionListResponse>(`/vips/actions${suffix}`);
    }

    await delay(150);
    return {
      items: [],
      total: 0,
    };
  },

  retryVipAutomationAction: async (
    actionId: string,
    serverId?: string,
  ): Promise<{ id: string; dispatch: VipDispatchInfo }> => {
    if (hasApi) {
      return apiFetch(`/vips/actions/${actionId}/retry`, {
        method: 'POST',
        body: JSON.stringify(serverId ? { serverId } : {}),
      });
    }

    await delay(150);
    return {
      id: actionId,
      dispatch: {
        queued: false,
        skipped: true,
        reason: 'mock_mode',
      },
    };
  },

  reconcileExpiredVips: async (data?: {
    dryRun?: boolean;
    enqueue?: boolean;
    limit?: number;
    serverId?: string;
  }): Promise<VipReconcileResponse> => {
    if (hasApi) {
      return apiFetch<VipReconcileResponse>(`/vips/reconcile-expired`, {
        method: 'POST',
        body: JSON.stringify(data || {}),
      });
    }

    await delay(150);
    return {
      dryRun: !!data?.dryRun,
      limit: Math.max(1, Math.min(500, Math.floor(data?.limit || 100))),
      now: new Date().toISOString(),
      expiredCount: 0,
      updatedCount: 0,
      updateFailures: 0,
      dispatchQueuedCount: 0,
      dispatchNotQueuedCount: 0,
      items: [],
    };
  },

  grantVip: async (data: {
    steamId: string;
    name?: string;
    vipPlan: string;
    vipDurationDays?: number;
    vipExpiry?: string;
    enqueue?: boolean;
    serverId?: string;
    vipServerIds?: string[];
  }): Promise<VipAdminItem & { dispatch?: VipDispatchInfo }> => {
    if (hasApi) {
      return apiFetch(`/vips/grant`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
    }

    await delay(200);
    const steamId = String(data.steamId || '').trim();
    const plan = String(data.vipPlan || '').trim();
    const name = String(data.name || '').trim();
    const durationDays = Math.max(1, Math.floor(data.vipDurationDays || 30));
    const parsedVipServerIds = Array.isArray(data.vipServerIds)
      ? Array.from(
          new Set(
            data.vipServerIds
              .map((entry) => String(entry || '').trim())
              .filter(Boolean),
          ),
        )
      : [];
    const expiry = data.vipExpiry
      ? new Date(data.vipExpiry)
      : new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

    const idx = playersDb.findIndex((p) => p.steamId === steamId);
    if (idx === -1) {
      playersDb.push({
        steamId,
        name: name || steamId,
        avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(steamId)}`,
        lastSeen: new Date().toISOString(),
        firstSeen: new Date().toISOString(),
        totalConnections: 0,
        playTimeHours: 0,
        isVip: true,
        vipPlan: plan,
        vipExpiry: expiry.toISOString(),
        ...(parsedVipServerIds.length > 0 ? { vipServerIds: parsedVipServerIds } : {}),
      });
    } else {
      playersDb[idx] = {
        ...playersDb[idx],
        name: name || playersDb[idx].name,
        isVip: true,
        vipPlan: plan,
        vipExpiry: expiry.toISOString(),
        vipServerIds: parsedVipServerIds,
      };
    }

    const player = playersDb.find((p) => p.steamId === steamId)!;
    const vipServerIds = Array.isArray((player as any).vipServerIds)
      ? ((player as any).vipServerIds as string[])
      : [];
    const vipServerNames = vipServerIds
      .map((id) => serversDb.find((server) => server.id === id)?.name)
      .filter((name): name is string => Boolean(name));
    return {
      steamId: player.steamId,
      name: player.name,
      avatarUrl: player.avatarUrl,
      isVip: player.isVip,
      vipPlan: player.vipPlan,
      vipExpiry: player.vipExpiry,
      vipStatus: 'ACTIVE',
      vipServerIds,
      vipServerNames,
      dispatch: { queued: false, skipped: true, reason: 'mock_mode' },
    };
  },

  extendVip: async (data: {
    steamId: string;
    vipPlan?: string;
    vipDurationDays?: number;
    enqueue?: boolean;
    serverId?: string;
    vipServerIds?: string[];
  }): Promise<VipAdminItem & { dispatch?: VipDispatchInfo }> => {
    if (hasApi) {
      return apiFetch(`/vips/extend`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
    }

    await delay(200);
    const steamId = String(data.steamId || '').trim();
    const player = playersDb.find((p) => p.steamId === steamId);
    if (!player) {
      throw new Error('Player not found');
    }

    const now = Date.now();
    const currentExpiry = player.vipExpiry ? new Date(player.vipExpiry).getTime() : now;
    const baseMs = currentExpiry > now ? currentExpiry : now;
    const days = Math.max(1, Math.floor(data.vipDurationDays || 30));
    const nextExpiry = new Date(baseMs + days * 24 * 60 * 60 * 1000).toISOString();
    const parsedVipServerIds = Array.isArray(data.vipServerIds)
      ? Array.from(
          new Set(
            data.vipServerIds
              .map((entry) => String(entry || '').trim())
              .filter(Boolean),
          ),
        )
      : undefined;

    player.isVip = true;
    player.vipPlan = data.vipPlan || player.vipPlan || 'VIP';
    player.vipExpiry = nextExpiry;
    if (parsedVipServerIds !== undefined) {
      (player as any).vipServerIds = parsedVipServerIds;
    }

    const vipServerIds = Array.isArray((player as any).vipServerIds)
      ? ((player as any).vipServerIds as string[])
      : [];
    const vipServerNames = vipServerIds
      .map((id) => serversDb.find((server) => server.id === id)?.name)
      .filter((name): name is string => Boolean(name));

    return {
      steamId: player.steamId,
      name: player.name,
      avatarUrl: player.avatarUrl,
      isVip: player.isVip,
      vipPlan: player.vipPlan,
      vipExpiry: player.vipExpiry,
      vipStatus: 'ACTIVE',
      vipServerIds,
      vipServerNames,
      dispatch: { queued: false, skipped: true, reason: 'mock_mode' },
    };
  },

  revokeVip: async (data: {
    steamId: string;
    enqueue?: boolean;
    serverId?: string;
    reason?: string;
  }): Promise<VipAdminItem & { dispatch?: VipDispatchInfo }> => {
    if (hasApi) {
      return apiFetch(`/vips/revoke`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
    }

    await delay(200);
    const steamId = String(data.steamId || '').trim();
    const player = playersDb.find((p) => p.steamId === steamId);
    if (!player) {
      throw new Error('Player not found');
    }

    player.isVip = false;
    player.vipPlan = undefined;
    player.vipExpiry = undefined;

    return {
      steamId: player.steamId,
      name: player.name,
      avatarUrl: player.avatarUrl,
      isVip: player.isVip,
      vipPlan: player.vipPlan,
      vipExpiry: player.vipExpiry,
      vipStatus: 'INACTIVE',
      vipServerIds: Array.isArray((player as any).vipServerIds)
        ? ((player as any).vipServerIds as string[])
        : [],
      dispatch: { queued: false, skipped: true, reason: 'mock_mode' },
    };
  },

  getPlayerBySteamId: async (
    steamId: string,
    options?: { activityWindowDays?: 7 | 14 | 30 | 90 },
  ): Promise<Player | null> => {
    if (hasApi) {
      const params = new URLSearchParams();
      if (options?.activityWindowDays) {
        params.set('activityWindowDays', String(options.activityWindowDays));
      }
      const suffix = params.toString() ? `?${params.toString()}` : '';
      const player = await apiFetch<Player>(`/players/${steamId}${suffix}`);
      return player;
    }

    await delay(400);
    const player = playersDb.find(p => p.steamId === steamId);
    return player || null;
  },

  getPlayerAliases: async (steamId: string, limit = 50): Promise<PlayerAliasHistoryResponse> => {
    if (hasApi) {
      const params = new URLSearchParams();
      if (Number.isFinite(limit) && limit > 0) params.set('limit', String(Math.floor(limit)));
      const suffix = params.toString() ? `?${params.toString()}` : '';
      return apiFetch<PlayerAliasHistoryResponse>(`/players/${steamId}/aliases${suffix}`);
    }

    await delay(100);
    return {
      steamId,
      total: 0,
      items: [],
    };
  },

  getPlayerPunishments: async (
    steamId: string,
    page = 1,
    limit = 20,
  ): Promise<{
    mode: 'page';
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
    items: Punishment[];
  }> => {
    if (hasApi) {
      const params = new URLSearchParams();
      params.set('page', String(Math.max(1, page)));
      params.set('limit', String(Math.max(1, Math.min(100, limit))));
      return apiFetch(`/players/${steamId}/punishments?${params.toString()}`);
    }

    await delay(200);
    const player = playersDb.find((p) => p.steamId === steamId);
    const allItems = [...(player?.punishments || [])].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
    const safeLimit = Math.max(1, Math.min(100, limit));
    const total = allItems.length;
    const totalPages = Math.max(1, Math.ceil(total / safeLimit));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * safeLimit;
    const end = start + safeLimit;
    return {
      mode: 'page',
      page: safePage,
      limit: safeLimit,
      total,
      totalPages,
      hasMore: safePage < totalPages,
      items: allItems.slice(start, end),
    };
  },

  getSuspiciousAccounts: async (): Promise<SuspiciousGroup[]> => {
    if (hasApi) {
      const data = await apiFetch<SuspiciousGroup[]>('/suspicious');
      return data;
    }
    await delay(700);
    return [...MOCK_SUSPICIOUS_GROUPS];
  },

  getSuspiciousAccountsV2: async (query?: {
    limit?: number;
    maxRows?: number;
  }): Promise<SuspiciousGroupV2[]> => {
    const normalized = query || {};

    if (hasApi) {
      try {
        const params = new URLSearchParams();
        if (typeof normalized.limit === 'number' && normalized.limit > 0) {
          params.set('limit', String(Math.floor(normalized.limit)));
        }
        if (typeof normalized.maxRows === 'number' && normalized.maxRows > 0) {
          params.set('maxRows', String(Math.floor(normalized.maxRows)));
        }
        const suffix = params.toString() ? `?${params.toString()}` : '';
        return await apiFetch<SuspiciousGroupV2[]>(`/suspicious/v2${suffix}`);
      } catch (error) {
        console.error('API getSuspiciousAccountsV2 failed, fallback to legacy suspicious:', error);
        const legacy = await ApiService.getSuspiciousAccounts();
        return legacy.map(toSuspiciousGroupV2FromLegacy);
      }
    }

    await delay(700);
    return [...MOCK_SUSPICIOUS_GROUPS].map(toSuspiciousGroupV2FromLegacy);
  },

  getPlayerRelatedAccounts: async (steamId: string): Promise<SuspiciousGroup | null> => {
    if (hasApi) {
      return await apiFetch<SuspiciousGroup | null>(`/players/${steamId}/related-accounts`);
    }
    await delay(200);
    const groups = await ApiService.getSuspiciousAccounts();
    const match = groups.find((g) => g.players.some((p) => p.steamId === steamId));
    return match || null;
  },

  getPlayerIpHistoryV2: async (
    steamId: string,
    options?: { limit?: number },
  ): Promise<PlayerIpHistoryResponseV2> => {
    if (hasApi) {
      try {
        const params = new URLSearchParams();
        if (typeof options?.limit === 'number' && options.limit > 0) {
          params.set('limit', String(Math.floor(options.limit)));
        }
        const suffix = params.toString() ? `?${params.toString()}` : '';
        return await apiFetch<PlayerIpHistoryResponseV2>(`/players/${steamId}/ip-history-v2${suffix}`);
      } catch (error) {
        console.error('API getPlayerIpHistoryV2 failed, returning empty history:', error);
      }
    }

    await delay(120);
    return {
      steamId,
      total: 0,
      items: [],
    };
  },

  getPlayerRelatedAccountsV2: async (
    steamId: string,
    options?: { limit?: number },
  ): Promise<RelatedAccountsResponseV2 | null> => {
    if (hasApi) {
      try {
        const params = new URLSearchParams();
        if (typeof options?.limit === 'number' && options.limit > 0) {
          params.set('limit', String(Math.floor(options.limit)));
        }
        const suffix = params.toString() ? `?${params.toString()}` : '';
        return await apiFetch<RelatedAccountsResponseV2 | null>(
          `/players/${steamId}/related-accounts-v2${suffix}`,
        );
      } catch (error) {
        console.error('API getPlayerRelatedAccountsV2 failed, fallback to legacy related:', error);
      }
    }

    const legacy = await ApiService.getPlayerRelatedAccounts(steamId);
    if (!legacy) return null;
    const relatedPlayers = legacy.players.filter((player) => player.steamId !== steamId);
    return {
      steamId,
      analyzedAt: new Date().toISOString(),
      total: relatedPlayers.length,
      items: relatedPlayers.map((player) => ({
        player,
        confidence: toConfidenceFromLegacy(legacy.level),
        reasons: [
          {
            code: String(legacy.level || '').toUpperCase() === 'HIGH' ? 'SAME_IP' : 'SAME_SUBNET',
            confidence: toConfidenceFromLegacy(legacy.level),
            label:
              String(legacy.level || '').toUpperCase() === 'HIGH'
                ? 'Mesmo IP exato'
                : 'Mesma sub-rede /24',
            evidence: [legacy.commonIpOrSubnet],
          },
        ],
      })),
    };
  },

  regenerateApiKey: async (serverId: string): Promise<string> => {
    if (!hasApi) {
      throw new Error('API base URL not configured');
    }
    const result = await apiFetch<{ apiKey: string }>(`/servers/${serverId}/regenerate-key`, {
      method: 'POST',
    });
    if (!result?.apiKey) {
      throw new Error('API did not return a new key');
    }
    return result.apiKey;
  },

  addPlayerNote: async (steamId: string, content: string, staffName?: string): Promise<void> => {
    if (hasApi) {
      const parsedStaff = String(staffName || '').trim() || undefined;
      await apiFetch(`/players/${steamId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ content, staffName: parsedStaff }),
      });
      return;
    }

    await delay(300);
    const player = playersDb.find(p => p.steamId === steamId);
    if (player) {
      if (!player.notes) player.notes = [];
      const resolvedStaffName = String(staffName || '').trim() || getStoredUsername() || 'Sistema';
      player.notes.unshift({
        id: `note_${Date.now()}`,
        content,
        staffName: resolvedStaffName,
        date: new Date().toISOString()
      });
    }
  },

  updatePlayerNote: async (steamId: string, noteId: string, content: string): Promise<void> => {
    if (hasApi) {
      await apiFetch(`/players/${steamId}/notes/${noteId}`, {
        method: 'PATCH',
        body: JSON.stringify({ content }),
      });
      return;
    }

    await delay(200);
    const player = playersDb.find((p) => p.steamId === steamId);
    if (player && player.notes) {
      const idx = player.notes.findIndex((n) => n.id === noteId);
      if (idx !== -1) {
        player.notes[idx] = {
          ...player.notes[idx],
          content,
        };
      }
    }
  },

  deletePlayerNote: async (steamId: string, noteId: string): Promise<void> => {
    if (hasApi) {
      await apiFetch(`/players/${steamId}/notes/${noteId}`, {
        method: 'DELETE',
      });
      return;
    }

    await delay(200);
    const player = playersDb.find((p) => p.steamId === steamId);
    if (player && player.notes) {
      player.notes = player.notes.filter((n) => n.id !== noteId);
    }
  },

  createPunishment: async (
    steamId: string,
    data: { type: PunishmentType; reason: string; duration?: string; active?: boolean; staffName?: string },
  ): Promise<void> => {
    if (hasApi) {
      await apiFetch(`/players/${steamId}/punishments`, {
        method: 'POST',
        body: JSON.stringify(data),
      });
      return;
    }

    await delay(200);
    const player = playersDb.find((p) => p.steamId === steamId);
    if (player) {
      if (!player.punishments) player.punishments = [];
      player.punishments.unshift({
        id: `pun_${Date.now()}`,
        type: data.type,
        reason: data.reason,
        staffName: data.staffName || 'Sistema',
        date: new Date().toISOString(),
        duration: data.duration,
        active: data.type === PunishmentType.BAN || data.type === PunishmentType.MUTE || data.type === PunishmentType.GAG,
        status:
          data.type === PunishmentType.KICK || data.type === PunishmentType.WARN ? 'EXECUTED' : 'ACTIVE',
      });
    }
  },

  deactivatePunishment: async (
    steamId: string,
    punishmentId: string,
    reason?: string,
  ): Promise<void> => {
    if (hasApi) {
      await apiFetch(`/players/${steamId}/punishments/${punishmentId}/deactivate`, {
        method: 'PATCH',
        body: JSON.stringify({ reason }),
      });
      return;
    }

    await delay(200);
    const player = playersDb.find((p) => p.steamId === steamId);
    if (player?.punishments) {
      const idx = player.punishments.findIndex((p) => p.id === punishmentId);
      if (idx !== -1) {
        player.punishments[idx] = {
          ...player.punishments[idx],
          active: false,
          status: 'REVOKED',
          deactivationReason: reason,
          deactivatedAt: new Date().toISOString(),
        };
      }
    }
  },

  // --- FINANCIAL MODULE ---
  
  getTransactions: async (): Promise<Transaction[]> => {
    if (hasApi) {
      try {
        const txs = await apiFetch<Transaction[]>('/transactions');
        return txs;
      } catch (error) {
        console.error('API getTransactions failed, falling back to mock getTransactions:', error);
      }
    }

    await delay(500);
    return [...transactionsDb].sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  },

  uploadTransactionProof: async (file: File): Promise<TransactionProofUploadResult> => {
    if (hasApi && API_BASE_URL) {
      const formData = new FormData();
      formData.append('file', file);

      const headers: HeadersInit = {};
      const token = getAuthToken();
      if (token) {
        (headers as any).Authorization = `Bearer ${token}`;
      }

      const response = await fetch(`${API_BASE_URL}/transactions/proof-upload`, {
        method: 'POST',
        headers,
        body: formData,
      });

      if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
          const body = await response.json();
          if (body && typeof body.error === 'string') {
            message = body.error;
          }
        } catch {
          // ignore parse error
        }
        throw new Error(message);
      }

      return (await response.json()) as TransactionProofUploadResult;
    }

    const dataUrl = await fileToDataUrl(file);
    return {
      url: dataUrl,
      filename: file.name,
      size: file.size,
      mime: file.type || 'image/*',
    };
  },

  createTransaction: async (
    data: Omit<Transaction, 'id' | 'createdBy' | 'createdAt' | 'createdByName'> & {
      createdBy?: string;
    },
  ): Promise<Transaction> => {
    if (hasApi) {
      try {
        const created = await apiFetch<Transaction>('/transactions', {
          method: 'POST',
          body: JSON.stringify(data),
        });
        return created;
      } catch (error) {
        console.error('API createTransaction failed, falling back to mock createTransaction:', error);
      }
    }

    await delay(600);
    const newTx: Transaction = {
      ...data,
      id: `tx_${Date.now()}`,
      createdBy: data.createdBy || getStoredUsername() || 'system',
      createdByName: getStoredUsername() || undefined,
      createdAt: new Date().toISOString(),
    };
    transactionsDb.unshift(newTx);

    // SIDE EFFECT: If it's a VIP sale, update the player in our mock DB
    if (newTx.type === TransactionType.INCOME && newTx.relatedSteamId && newTx.vipPlan) {
       const playerIndex = playersDb.findIndex(p => p.steamId === newTx.relatedSteamId);
       
       const expiryDate = new Date();
       expiryDate.setDate(expiryDate.getDate() + (newTx.vipDurationDays || 30));

       if (playerIndex !== -1) {
          // Update existing player
          playersDb[playerIndex] = {
             ...playersDb[playerIndex],
             isVip: true,
             vipPlan: newTx.vipPlan as any,
             vipExpiry: expiryDate.toISOString()
          };
       } else {
          // Create new stub player
          const newPlayer: Player = {
             steamId: newTx.relatedSteamId,
             name: newTx.relatedPlayerName || 'Unknown Player',
             avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${newTx.relatedSteamId}`,
             lastSeen: new Date().toISOString(),
             firstSeen: new Date().toISOString(),
             totalConnections: 1,
             playTimeHours: 0,
             isVip: true,
             vipPlan: newTx.vipPlan as any,
             vipExpiry: expiryDate.toISOString()
          };
          playersDb.push(newPlayer);
       }
    }

    return newTx;
  },

  updateTransaction: async (id: string, data: Partial<Omit<Transaction, 'id'>>): Promise<Transaction> => {
    if (hasApi) {
      try {
        const updated = await apiFetch<Transaction>(`/transactions/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(data),
        });
        return updated;
      } catch (error) {
        console.error('API updateTransaction failed, falling back to mock updateTransaction:', error);
      }
    }
    await delay(500);
    const idx = transactionsDb.findIndex(t => t.id === id);
    if (idx !== -1) {
      transactionsDb[idx] = { ...transactionsDb[idx], ...data } as Transaction;
      return transactionsDb[idx];
    }
    throw new Error('Transaction not found');
  },

  deleteTransaction: async (id: string): Promise<void> => {
    if (hasApi) {
      try {
        await apiFetch<void>(`/transactions/${id}`, { method: 'DELETE' });
        return;
      } catch (error) {
        console.error('API deleteTransaction failed, falling back to mock deleteTransaction:', error);
      }
    }
    await delay(300);
    transactionsDb = transactionsDb.filter(t => t.id !== id);
  }
};

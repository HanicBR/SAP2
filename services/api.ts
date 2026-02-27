

import { MOCK_SERVERS, MOCK_EVENTS, MOCK_STATS, VIP_PLANS, MOCK_SUSPICIOUS_GROUPS, MOCK_PLAYERS, MOCK_USERS, MOCK_TRANSACTIONS, generateServerAnalytics, DEFAULT_SITE_CONFIG } from '../constants';
import { GameServer, ServerEvent, DailyStats, VipPlan, SuspiciousGroup, Player, User, UserRole, LiveActivityItem, MapStats, FinancialStats, DashboardData, Transaction, TransactionType, ServerAnalytics, GameMode, ServerStatus, SiteConfig, PunishmentType, LegacyImportSummary, LogsQueryParams, LogsQueryResponse } from '../types';

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

  createServer: async (data: { name: string, ip: string, port: number, mode: GameMode, maxPlayers: number }): Promise<GameServer> => {
    if (!hasApi) {
      throw new Error('API base URL not configured');
    }
    return apiFetch<GameServer>('/servers', {
      method: 'POST',
      body: JSON.stringify(data),
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
      { id: '1', message: 'Player "DarkKiller" comprou VIP Ouro (Mensal)', type: 'SUCCESS', timestamp: new Date().toISOString(), serverName: 'Web Store' },
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
      uniquePlayers24h: 1420,
      totalConnections: 3500,
      roundsPlayed: 450,
      activeBans: 12,
      chartData: MOCK_STATS,
      mapStats,
      liveActivity,
      financialStats
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
      try {
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
      } catch (error) {
        console.error('API getEventsQuery failed, falling back to mock getEventsQuery:', error);
      }
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
      try {
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
      } catch (error) {
        console.error('API getPlayerLogs failed, falling back to mock getPlayerLogs:', error);
      }
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
      try {
        const params = new URLSearchParams();
        if (search) params.append('search', search);
        if (serverFilter) params.append('serverId', serverFilter);
        if (vipFilter !== undefined) params.append('isVip', String(vipFilter));
        const players = await apiFetch<Player[]>(`/players?${params.toString()}`);
        return players;
      } catch (error) {
        console.error('API getPlayers failed, falling back to mock getPlayers:', error);
      }
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

  getPlayerBySteamId: async (steamId: string): Promise<Player | null> => {
    if (hasApi) {
      try {
        const player = await apiFetch<Player>(`/players/${steamId}`);
        return player;
      } catch (error) {
        console.error('API getPlayerBySteamId failed, falling back to mock getPlayerBySteamId:', error);
      }
    }

    await delay(400);
    const player = playersDb.find(p => p.steamId === steamId);
    return player || null;
  },

  getSuspiciousAccounts: async (): Promise<SuspiciousGroup[]> => {
    if (hasApi) {
      try {
        const data = await apiFetch<SuspiciousGroup[]>('/suspicious');
        return data;
      } catch (error) {
        console.error('API getSuspiciousAccounts failed, falling back to mock getSuspiciousAccounts:', error);
      }
    }
    await delay(700);
    return [...MOCK_SUSPICIOUS_GROUPS];
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

  addPlayerNote: async (steamId: string, content: string, staffName: string): Promise<void> => {
    if (hasApi) {
      try {
        await apiFetch(`/players/${steamId}/notes`, {
          method: 'POST',
          body: JSON.stringify({ content, staffName }),
        });
        return;
      } catch (error) {
        console.error('API addPlayerNote failed, falling back to mock addPlayerNote:', error);
      }
    }

    await delay(300);
    const player = playersDb.find(p => p.steamId === steamId);
    if (player) {
      if (!player.notes) player.notes = [];
      player.notes.unshift({
        id: `note_${Date.now()}`,
        content,
        staffName,
        date: new Date().toISOString()
      });
    }
  },

  updatePlayerNote: async (steamId: string, noteId: string, content: string): Promise<void> => {
    if (hasApi) {
      try {
        await apiFetch(`/players/${steamId}/notes/${noteId}`, {
          method: 'PATCH',
          body: JSON.stringify({ content }),
        });
        return;
      } catch (error) {
        console.error('API updatePlayerNote failed, falling back to mock updatePlayerNote:', error);
      }
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
      try {
        await apiFetch(`/players/${steamId}/notes/${noteId}`, {
          method: 'DELETE',
        });
        return;
      } catch (error) {
        console.error('API deletePlayerNote failed, falling back to mock deletePlayerNote:', error);
      }
    }

    await delay(200);
    const player = playersDb.find((p) => p.steamId === steamId);
    if (player && player.notes) {
      player.notes = player.notes.filter((n) => n.id !== noteId);
    }
  },

  createPunishment: async (
    steamId: string,
    data: { type: PunishmentType; reason: string; duration?: string; active?: boolean; staffName: string },
  ): Promise<void> => {
    if (hasApi) {
      try {
        await apiFetch(`/players/${steamId}/punishments`, {
          method: 'POST',
          body: JSON.stringify(data),
        });
        return;
      } catch (error) {
        console.error('API createPunishment failed, falling back to mock createPunishment:', error);
      }
    }

    await delay(200);
    const player = playersDb.find((p) => p.steamId === steamId);
    if (player) {
      if (!player.punishments) player.punishments = [];
      player.punishments.unshift({
        id: `pun_${Date.now()}`,
        type: data.type,
        reason: data.reason,
        staffName: data.staffName,
        date: new Date().toISOString(),
        duration: data.duration,
        active: data.active ?? true,
      });
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

  createTransaction: async (data: Omit<Transaction, 'id'>): Promise<Transaction> => {
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
      id: `tx_${Date.now()}`
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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiService } from '../../services/api';
import { GameServer, Player, ServerWsLiveStateItem } from '../../types';
import { MOCK_SUSPICIOUS_GROUPS } from '../../constants';
import { Icons } from '../../components/Icon';
import { Pagination } from '../../components/Pagination';

const LIVE_STATE_MAX_AGE_SECONDS = 30;
const PLAYERS_REFRESH_MS = 30_000;
const LIVE_STATE_REFRESH_MS = 10_000;
const ITEMS_PER_PAGE = 12;

type PresenceFilter = 'all' | 'online' | 'offline';
type SortField = 'name' | 'presence' | 'vip' | 'punishments' | 'playtime' | 'lastSeen';

type PlayerLivePresence = {
  serverId: string;
  map?: string;
  ageSeconds: number;
  playerCount: number;
};

type PlayerRow = Player & {
  isOnline: boolean;
  presence?: PlayerLivePresence;
  punishmentCount: number;
  suspicious: boolean;
};

const mapLiveStateToPlayers = (items: ServerWsLiveStateItem[]): Record<string, PlayerLivePresence> => {
  const mapped: Record<string, PlayerLivePresence> = {};

  items.forEach((snapshot) => {
    const ageSeconds = Number(snapshot.ageSeconds ?? 0);
    if (!snapshot.connected) return;
    if (!Number.isFinite(ageSeconds) || ageSeconds > LIVE_STATE_MAX_AGE_SECONDS) return;

    (snapshot.players || []).forEach((entry) => {
      const steamId = String(entry?.steamId || '').trim();
      if (!steamId) return;
      mapped[steamId] = {
        serverId: snapshot.serverId,
        ageSeconds,
        playerCount: Number(snapshot.playerCount || 0),
        ...(snapshot.map ? { map: snapshot.map } : {}),
      };
    });
  });

  return mapped;
};

const formatDate = (value?: string): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('pt-BR');
};

const formatDateTime = (value?: string): string => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('pt-BR');
};

const formatPlaytime = (hours?: number): string => {
  const safe = Number(hours || 0);
  return `${safe.toFixed(1)}h`;
};

const getVipBadge = (player: Player) => {
  if (!player.isVip) {
    return (
      <span className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-zinc-400">
        Free
      </span>
    );
  }

  const plan = String(player.vipPlan || 'VIP');
  const style =
    plan.includes('VIP++')
      ? 'border-yellow-700 bg-yellow-900/20 text-yellow-300'
      : plan.includes('VIP+')
      ? 'border-zinc-500 bg-zinc-700/30 text-zinc-200'
      : plan.toLowerCase().includes('ultimate')
      ? 'border-fuchsia-700 bg-fuchsia-900/20 text-fuchsia-300'
      : 'border-orange-700 bg-orange-900/20 text-orange-300';

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${style}`}>
      {plan}
    </span>
  );
};

const getReputationBadge = (punishmentCount: number) => {
  if (punishmentCount === 0) {
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-900/40 bg-emerald-900/10 px-2 py-0.5 text-[11px] font-bold text-emerald-300">
        Limpo
      </span>
    );
  }

  if (punishmentCount <= 2) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-900/40 bg-amber-900/10 px-2 py-0.5 text-[11px] font-bold text-amber-300">
        <Icons.AlertTriangle className="h-3 w-3" />
        Leve ({punishmentCount})
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-red-900/40 bg-red-900/10 px-2 py-0.5 text-[11px] font-bold text-red-300">
      <Icons.Gavel className="h-3 w-3" />
      Alto ({punishmentCount})
    </span>
  );
};

const Players: React.FC = () => {
  const [players, setPlayers] = useState<Player[]>([]);
  const [servers, setServers] = useState<GameServer[]>([]);
  const [livePresenceBySteamId, setLivePresenceBySteamId] = useState<Record<string, PlayerLivePresence>>({});

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [vipFilter, setVipFilter] = useState<boolean | undefined>(undefined);
  const [serverFilter, setServerFilter] = useState('');
  const [presenceFilter, setPresenceFilter] = useState<PresenceFilter>('all');
  const [sortBy, setSortBy] = useState<SortField>('lastSeen');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);

  const suspiciousSteamIds = useMemo(() => {
    const ids = new Set<string>();
    MOCK_SUSPICIOUS_GROUPS.forEach((group) => {
      group.players.forEach((entry) => ids.add(entry.steamId));
    });
    return ids;
  }, []);

  const serverNameById = useMemo(() => {
    const mapped: Record<string, string> = {};
    servers.forEach((server) => {
      mapped[server.id] = server.name.split('[')[0]?.trim() || server.name;
    });
    return mapped;
  }, [servers]);

  const loadServers = useCallback(async () => {
    try {
      const items = await ApiService.getServers();
      setServers(items);
    } catch {
      setServers([]);
    }
  }, []);

  const loadPlayers = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setLoading(true);

      try {
        const items = await ApiService.getPlayers(search, serverFilter, vipFilter);
        setPlayers(items);
        setError(null);
        setLastSyncAt(new Date().toISOString());
      } catch {
        setError('Nao foi possivel carregar jogadores agora. Tentando novamente no proximo ciclo.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [search, serverFilter, vipFilter],
  );

  const loadLiveState = useCallback(async () => {
    try {
      const liveState = await ApiService.getServersLiveState();
      setLivePresenceBySteamId(mapLiveStateToPlayers(liveState.items || []));
    } catch {
      setLivePresenceBySteamId({});
    }
  }, []);

  useEffect(() => {
    void loadServers();
  }, [loadServers]);

  useEffect(() => {
    void loadPlayers(false);
  }, [loadPlayers]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void loadPlayers(true);
    }, PLAYERS_REFRESH_MS);

    return () => window.clearInterval(intervalId);
  }, [loadPlayers]);

  useEffect(() => {
    void loadLiveState();

    const intervalId = window.setInterval(() => {
      void loadLiveState();
    }, LIVE_STATE_REFRESH_MS);

    return () => window.clearInterval(intervalId);
  }, [loadLiveState]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, serverFilter, vipFilter, presenceFilter, sortBy, sortDir]);

  const playerRows = useMemo<PlayerRow[]>(() => {
    return players.map((player) => {
      const presence = livePresenceBySteamId[player.steamId];
      return {
        ...player,
        isOnline: Boolean(presence),
        ...(presence ? { presence } : {}),
        punishmentCount: player.punishments?.length || 0,
        suspicious: suspiciousSteamIds.has(player.steamId),
      };
    });
  }, [players, livePresenceBySteamId, suspiciousSteamIds]);

  const filteredRows = useMemo(() => {
    if (presenceFilter === 'all') return playerRows;
    if (presenceFilter === 'online') return playerRows.filter((item) => item.isOnline);
    return playerRows.filter((item) => !item.isOnline);
  }, [playerRows, presenceFilter]);

  const sortedRows = useMemo(() => {
    const sorted = [...filteredRows].sort((left, right) => {
      switch (sortBy) {
        case 'name':
          return String(left.name || '').localeCompare(String(right.name || ''));
        case 'presence':
          return Number(left.isOnline) - Number(right.isOnline);
        case 'vip':
          return Number(left.isVip) - Number(right.isVip);
        case 'punishments':
          return left.punishmentCount - right.punishmentCount;
        case 'playtime':
          return Number(left.playTimeHours || 0) - Number(right.playTimeHours || 0);
        case 'lastSeen':
          return new Date(left.lastSeen).getTime() - new Date(right.lastSeen).getTime();
        default:
          return 0;
      }
    });

    return sortDir === 'asc' ? sorted : sorted.reverse();
  }, [filteredRows, sortBy, sortDir]);

  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return sortedRows.slice(start, start + ITEMS_PER_PAGE);
  }, [sortedRows, currentPage]);

  const stats = useMemo(() => {
    const total = filteredRows.length;
    const online = filteredRows.filter((item) => item.isOnline).length;
    const vip = filteredRows.filter((item) => item.isVip).length;
    const punished = filteredRows.filter((item) => item.punishmentCount > 0).length;
    return { total, online, vip, punished };
  }, [filteredRows]);

  const sortIndicator = (field: SortField): string => {
    if (sortBy !== field) return '';
    return sortDir === 'asc' ? '^' : 'v';
  };

  const toggleSort = (field: SortField) => {
    if (sortBy !== field) {
      setSortBy(field);
      setSortDir(field === 'name' ? 'asc' : 'desc');
      return;
    }
    setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
  };

  const applySearch = (event: React.FormEvent) => {
    event.preventDefault();
    setSearch(searchInput.trim());
  };

  const clearFilters = () => {
    setSearchInput('');
    setSearch('');
    setVipFilter(undefined);
    setServerFilter('');
    setPresenceFilter('all');
    setSortBy('lastSeen');
    setSortDir('desc');
  };

  const refreshNow = () => {
    void loadPlayers(true);
    void loadLiveState();
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard can fail in non-secure contexts
    }
  };

  return (
    <div className="animate-fade-in space-y-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="flex items-center text-2xl font-bold text-white">
            <Icons.UserGroup className="mr-3 h-6 w-6 text-red-500" />
            Jogadores
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Presenca ao vivo via WS (janela de {LIVE_STATE_MAX_AGE_SECONDS}s).
            {lastSyncAt ? ` Ultima atualizacao: ${formatDateTime(lastSyncAt)}.` : ''}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refreshNow}
            className="inline-flex items-center gap-2 rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-bold uppercase tracking-wider text-zinc-200 transition-colors hover:bg-zinc-800"
            disabled={refreshing}
          >
            <Icons.RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
          <button
            type="button"
            onClick={clearFilters}
            className="rounded border border-zinc-700 px-3 py-2 text-xs font-bold uppercase tracking-wider text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
          >
            Limpar filtros
          </button>
        </div>
      </div>

      <div className="rounded border border-zinc-800 bg-zinc-900 p-4">
        <form onSubmit={applySearch} className="grid gap-3 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-zinc-500">
              Buscar jogador
            </label>
            <div className="relative">
              <input
                type="text"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Nome ou SteamID"
                className="w-full rounded border border-zinc-700 bg-zinc-950 py-2 pl-10 pr-3 text-sm text-zinc-100 placeholder-zinc-500 focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600"
              />
              <Icons.Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-500" />
            </div>
          </div>

          <div className="lg:col-span-2">
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-zinc-500">Servidor</label>
            <select
              value={serverFilter}
              onChange={(event) => setServerFilter(event.target.value)}
              className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600"
            >
              <option value="">Todos</option>
              {servers.map((server) => (
                <option key={server.id} value={server.id}>
                  {server.name}
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-2">
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-zinc-500">Plano</label>
            <select
              value={vipFilter === undefined ? 'all' : String(vipFilter)}
              onChange={(event) =>
                setVipFilter(event.target.value === 'all' ? undefined : event.target.value === 'true')
              }
              className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600"
            >
              <option value="all">Todos</option>
              <option value="true">Apenas VIP</option>
              <option value="false">Apenas Free</option>
            </select>
          </div>

          <div className="lg:col-span-2">
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-zinc-500">Presenca</label>
            <select
              value={presenceFilter}
              onChange={(event) => setPresenceFilter(event.target.value as PresenceFilter)}
              className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600"
            >
              <option value="all">Todos</option>
              <option value="online">Online</option>
              <option value="offline">Offline</option>
            </select>
          </div>

          <div className="lg:col-span-1 lg:flex lg:items-end">
            <button
              type="submit"
              className="w-full rounded border border-red-800 bg-red-900/20 px-3 py-2 text-xs font-bold uppercase tracking-wider text-red-300 transition-colors hover:bg-red-900/30"
            >
              Buscar
            </button>
          </div>
        </form>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded border border-zinc-800 bg-zinc-900 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Jogadores</p>
          <p className="mt-1 text-2xl font-black text-white">{stats.total}</p>
        </div>
        <div className="rounded border border-emerald-900/30 bg-emerald-900/10 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-300">Online agora</p>
          <p className="mt-1 text-2xl font-black text-emerald-200">{stats.online}</p>
        </div>
        <div className="rounded border border-amber-900/30 bg-amber-900/10 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-amber-300">VIP</p>
          <p className="mt-1 text-2xl font-black text-amber-200">{stats.vip}</p>
        </div>
        <div className="rounded border border-red-900/30 bg-red-900/10 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-red-300">Com punicoes</p>
          <p className="mt-1 text-2xl font-black text-red-200">{stats.punished}</p>
        </div>
      </div>

      {error ? (
        <div className="rounded border border-red-900/40 bg-red-900/10 px-3 py-2 text-sm text-red-300">{error}</div>
      ) : null}

      <div className="rounded border border-zinc-800 bg-zinc-900 shadow-sm">
        <div className="border-b border-zinc-800 px-4 py-3 text-xs text-zinc-500">
          Ordenando por <span className="font-bold text-zinc-300">{sortBy}</span> ({sortDir}).
        </div>

        {loading ? (
          <div className="px-4 py-10 text-center text-zinc-500">Carregando jogadores...</div>
        ) : sortedRows.length === 0 ? (
          <div className="px-4 py-10 text-center text-zinc-500">Nenhum jogador encontrado com os filtros atuais.</div>
        ) : (
          <>
            <div className="space-y-3 p-3 lg:hidden">
              {paginatedRows.map((player) => {
                const avatarUrl =
                  player.avatarUrl ||
                  `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(player.steamId)}`;
                const serverName = player.presence ? serverNameById[player.presence.serverId] || player.presence.serverId : '';

                return (
                  <div key={player.steamId} className="rounded border border-zinc-800 bg-zinc-950/40 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="relative h-10 w-10 shrink-0">
                          <img src={avatarUrl} alt={player.name} className="h-10 w-10 rounded-full border border-zinc-700 object-cover" />
                          {player.suspicious ? (
                            <span
                              className="absolute -right-1 -top-1 block h-3 w-3 rounded-full bg-red-500 ring-2 ring-zinc-900"
                              title="Suspeita de conta duplicada"
                            />
                          ) : null}
                        </div>
                        <div className="min-w-0">
                          <Link to={`/admin/players/${player.steamId}`} className="block truncate text-sm font-bold text-white">
                            {player.name}
                          </Link>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(player.steamId)}
                            className="truncate font-mono text-[11px] text-zinc-500 hover:text-zinc-300"
                            title="Copiar SteamID"
                          >
                            {player.steamId}
                          </button>
                        </div>
                      </div>

                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${
                          player.isOnline
                            ? 'border-emerald-700 bg-emerald-900/20 text-emerald-300'
                            : 'border-zinc-700 bg-zinc-800 text-zinc-400'
                        }`}
                      >
                        {player.isOnline ? 'Online' : 'Offline'}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-400">
                      <div>
                        <p className="text-zinc-500">Tempo</p>
                        <p className="font-bold text-zinc-200">{formatPlaytime(player.playTimeHours)}</p>
                      </div>
                      <div>
                        <p className="text-zinc-500">Ultimo acesso</p>
                        <p className="font-bold text-zinc-200">{formatDate(player.lastSeen)}</p>
                      </div>
                      <div>
                        <p className="text-zinc-500">Reputacao</p>
                        <div className="mt-1">{getReputationBadge(player.punishmentCount)}</div>
                      </div>
                      <div>
                        <p className="text-zinc-500">Plano</p>
                        <div className="mt-1">{getVipBadge(player)}</div>
                      </div>
                    </div>

                    <div className="mt-3 text-[11px] text-zinc-500">
                      {player.isOnline && player.presence ? (
                        <span>
                          WS: {serverName}
                          {player.presence.map ? ` | ${player.presence.map}` : ''}
                          {` | ${Math.max(0, Math.floor(player.presence.ageSeconds))}s`}
                        </span>
                      ) : (
                        <span>Fora do snapshot WS ativo.</span>
                      )}
                    </div>

                    <div className="mt-3 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => copyToClipboard(player.name)}
                        className="rounded border border-zinc-700 px-2 py-1 text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
                        title="Copiar nome"
                      >
                        <Icons.Copy className="h-4 w-4" />
                      </button>
                      <Link
                        to={`/admin/players/${player.steamId}`}
                        className="inline-flex items-center gap-1 rounded border border-cyan-900/50 bg-cyan-900/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-cyan-300 transition-colors hover:border-cyan-700 hover:text-cyan-200"
                      >
                        <Icons.Eye className="h-3.5 w-3.5" />
                        Perfil
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="hidden overflow-x-auto lg:block">
              <table className="min-w-full divide-y divide-zinc-800">
                <thead className="bg-zinc-950/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                      <button type="button" onClick={() => toggleSort('name')} className="inline-flex items-center gap-1 hover:text-zinc-300">
                        Jogador {sortIndicator('name')}
                      </button>
                    </th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                      <button type="button" onClick={() => toggleSort('presence')} className="inline-flex items-center gap-1 hover:text-zinc-300">
                        Online/offline {sortIndicator('presence')}
                      </button>
                    </th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                      <button type="button" onClick={() => toggleSort('vip')} className="inline-flex items-center gap-1 hover:text-zinc-300">
                        VIP {sortIndicator('vip')}
                      </button>
                    </th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                      <button
                        type="button"
                        onClick={() => toggleSort('punishments')}
                        className="inline-flex items-center gap-1 hover:text-zinc-300"
                      >
                        Reputacao {sortIndicator('punishments')}
                      </button>
                    </th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                      <button type="button" onClick={() => toggleSort('playtime')} className="inline-flex items-center gap-1 hover:text-zinc-300">
                        Playtime {sortIndicator('playtime')}
                      </button>
                    </th>
                    <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                      <button type="button" onClick={() => toggleSort('lastSeen')} className="inline-flex items-center gap-1 hover:text-zinc-300">
                        Ultimo acesso {sortIndicator('lastSeen')}
                      </button>
                    </th>
                    <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wider text-zinc-500">Acoes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {paginatedRows.map((player) => {
                    const avatarUrl =
                      player.avatarUrl ||
                      `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(player.steamId)}`;
                    const serverName = player.presence ? serverNameById[player.presence.serverId] || player.presence.serverId : '-';

                    return (
                      <tr key={player.steamId} className="transition-colors hover:bg-zinc-800/40">
                        <td className="whitespace-nowrap px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="relative h-10 w-10 shrink-0">
                              <img src={avatarUrl} alt={player.name} className="h-10 w-10 rounded-full border border-zinc-700 object-cover" />
                              {player.suspicious ? (
                                <span
                                  className="absolute -right-1 -top-1 block h-3 w-3 rounded-full bg-red-500 ring-2 ring-zinc-900"
                                  title="Suspeita de conta duplicada"
                                />
                              ) : null}
                            </div>
                            <div>
                              <Link to={`/admin/players/${player.steamId}`} className="text-sm font-bold text-white hover:text-red-400">
                                {player.name}
                              </Link>
                              <button
                                type="button"
                                onClick={() => copyToClipboard(player.steamId)}
                                className="block font-mono text-[11px] text-zinc-500 hover:text-zinc-300"
                                title="Copiar SteamID"
                              >
                                {player.steamId}
                              </button>
                            </div>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                              player.isOnline
                                ? 'border-emerald-700 bg-emerald-900/20 text-emerald-300'
                                : 'border-zinc-700 bg-zinc-800 text-zinc-400'
                            }`}
                          >
                            {player.isOnline ? 'Online' : 'Offline'}
                          </span>
                          <div className="mt-1 text-[11px] text-zinc-500">
                            {player.isOnline && player.presence ? (
                              <>
                                {serverName}
                                {player.presence.map ? ` | ${player.presence.map}` : ''}
                              </>
                            ) : (
                              'Sem snapshot WS ativo'
                            )}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">{getVipBadge(player)}</td>
                        <td className="whitespace-nowrap px-4 py-3">{getReputationBadge(player.punishmentCount)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-zinc-200">
                          {formatPlaytime(player.playTimeHours)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-zinc-400">{formatDate(player.lastSeen)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => copyToClipboard(player.name)}
                              className="rounded border border-zinc-700 px-2 py-1 text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
                              title="Copiar nome"
                            >
                              <Icons.Copy className="h-4 w-4" />
                            </button>
                            <Link
                              to={`/admin/players/${player.steamId}`}
                              className="inline-flex items-center gap-1 rounded border border-cyan-900/50 bg-cyan-900/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-cyan-300 transition-colors hover:border-cyan-700 hover:text-cyan-200"
                            >
                              <Icons.Eye className="h-3.5 w-3.5" />
                              Perfil
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <Pagination
          currentPage={currentPage}
          totalItems={sortedRows.length}
          itemsPerPage={ITEMS_PER_PAGE}
          onPageChange={setCurrentPage}
        />
      </div>
    </div>
  );
};

export default Players;

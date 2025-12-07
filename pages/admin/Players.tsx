
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiService } from '../../services/api';
import { Player, GameServer } from '../../types';
import { MOCK_SUSPICIOUS_GROUPS } from '../../constants';
import { Icons } from '../../components/Icon';
import { Pagination } from '../../components/Pagination';

const Players: React.FC = () => {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [vipFilter, setVipFilter] = useState<boolean | undefined>(undefined);
  const [serverFilter, setServerFilter] = useState('');
  const [servers, setServers] = useState<GameServer[]>([]);
  const [sortBy, setSortBy] = useState<null | 'name' | 'reputation' | 'playtime' | 'lastSeen' | 'status'>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  
  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    loadData();
    ApiService.getServers().then(setServers);
  }, []);

  const loadData = () => {
    setLoading(true);
    ApiService.getPlayers(search, serverFilter, vipFilter).then(data => {
      setPlayers(data);
      setLoading(false);
      setCurrentPage(1); // Reset to page 1 on new filter/load
    });
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    loadData();
  };

  const isSuspicious = (steamId: string) => {
    return MOCK_SUSPICIOUS_GROUPS.some(g => g.players.some(p => p.steamId === steamId));
  };

  const getReputationBadge = (player: Player) => {
    const count = player.punishments?.length || 0;
    if (count === 0) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-green-900/20 text-green-400 border border-green-900/30">
          Sem punições
        </span>
      );
    } else if (count <= 2) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-yellow-900/20 text-yellow-500 border border-yellow-900/30">
          <Icons.AlertTriangle className="w-3 h-3 mr-1" />
          Histórico leve
        </span>
      );
    } else {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-900/20 text-red-500 border border-red-900/30">
          <Icons.Gavel className="w-3 h-3 mr-1" />
          Histórico pesado
        </span>
      );
    }
  };

  const toggleSort = (field: typeof sortBy) => {
    if (sortBy !== field) {
      setSortBy(field);
      setSortDir('asc');
      setCurrentPage(1);
      return;
    }
    if (sortDir === 'asc') {
      setSortDir('desc');
    } else {
      setSortBy(null);
      setSortDir('asc');
    }
    setCurrentPage(1);
  };

  const sortedPlayers = useMemo(() => {
    if (!sortBy) return players;
    const sorted = [...players].sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'reputation': {
          const pa = a.punishments?.length || 0;
          const pb = b.punishments?.length || 0;
          return pa - pb;
        }
        case 'playtime':
          return (a.playTimeHours || 0) - (b.playTimeHours || 0);
        case 'lastSeen':
          return new Date(a.lastSeen).getTime() - new Date(b.lastSeen).getTime();
        case 'status':
          return Number(a.isVip) - Number(b.isVip);
        default:
          return 0;
      }
    });
    return sortDir === 'asc' ? sorted : sorted.reverse();
  }, [players, sortBy, sortDir]);

  // Pagination Logic
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentPlayers = sortedPlayers.slice(indexOfFirstItem, indexOfLastItem);

  const sortIndicator = (field: typeof sortBy) => {
    if (sortBy !== field) return null;
    return sortDir === 'asc' ? '^' : 'v';
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore clipboard errors in non-secure contexts
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h1 className="text-2xl font-bold text-white flex items-center">
          <Icons.UserGroup className="w-6 h-6 mr-3 text-red-500" />
          Gerenciar Jogadores
        </h1>
        
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
          {/* Server Filter */}
          <select 
            className="bg-zinc-900 border border-zinc-700 text-zinc-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-red-600"
            value={serverFilter}
            onChange={(e) => setServerFilter(e.target.value)}
          >
            <option value="">Todos os Servidores</option>
            {servers.map(s => <option key={s.id} value={s.id}>{s.name.split(' ')[1]} ({s.mode})</option>)}
          </select>

          {/* VIP Filter */}
          <select 
            className="bg-zinc-900 border border-zinc-700 text-zinc-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-red-600"
            value={vipFilter === undefined ? 'all' : vipFilter.toString()}
            onChange={(e) => setVipFilter(e.target.value === 'all' ? undefined : e.target.value === 'true')}
          >
            <option value="all">Todos (VIP/Non-VIP)</option>
            <option value="true">Apenas VIPs</option>
            <option value="false">Apenas Grátis</option>
          </select>

          {/* Search Input */}
          <div className="relative">
            <input
              type="text"
              className="w-full sm:w-64 pl-10 pr-3 py-2 border border-zinc-700 rounded bg-zinc-900 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-red-600 focus:border-red-600 text-sm transition-colors"
              placeholder="Nick ou SteamID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
             <button type="submit" className="absolute left-0 top-0 bottom-0 pl-3 flex items-center text-zinc-500 hover:text-white">
               <Icons.Search className="h-4 w-4" />
             </button>
          </div>
        </form>
      </div>

      <div className="bg-zinc-900 rounded border border-zinc-800 overflow-hidden shadow-sm flex flex-col">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-800">
            <thead className="bg-zinc-950/50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-zinc-500 uppercase tracking-wider cursor-pointer select-none" onClick={() => toggleSort('name')}>
                  Jogador {sortIndicator('name')}
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-zinc-500 uppercase tracking-wider cursor-pointer select-none" onClick={() => toggleSort('reputation')}>
                  Reputação {sortIndicator('reputation')}
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-zinc-500 uppercase tracking-wider cursor-pointer select-none" onClick={() => toggleSort('playtime')}>
                  Tempo Jogado {sortIndicator('playtime')}
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-zinc-500 uppercase tracking-wider cursor-pointer select-none" onClick={() => toggleSort('lastSeen')}>
                  Último Acesso {sortIndicator('lastSeen')}
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-bold text-zinc-500 uppercase tracking-wider cursor-pointer select-none" onClick={() => toggleSort('status')}>
                  Status {sortIndicator('status')}
                </th>
                <th scope="col" className="px-6 py-3 text-right text-xs font-bold text-zinc-500 uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800 bg-zinc-900">
              {loading ? (
                <tr><td colSpan={6} className="px-6 py-4 text-center text-zinc-500">Carregando lista de jogadores...</td></tr>
              ) : players.length === 0 ? (
                 <tr><td colSpan={6} className="px-6 py-4 text-center text-zinc-500">Nenhum jogador encontrado.</td></tr>
              ) : (
                currentPlayers.map((player) => (
                  <tr key={player.steamId} className="hover:bg-zinc-800/50 transition-colors group">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-10 w-10 relative">
                          <img className="h-10 w-10 rounded-full border border-zinc-700" src={player.avatarUrl} alt="" />
                          {isSuspicious(player.steamId) && (
                            <span className="absolute -top-1 -right-1 block h-3 w-3 rounded-full bg-red-500 ring-2 ring-zinc-900" title="Suspeita de conta duplicada"></span>
                          )}
                        </div>
                        <div className="ml-4">
                          <Link to={`/admin/players/${player.steamId}`} className="text-sm font-bold text-white group-hover:text-red-500 transition-colors block">
                            {player.name}
                          </Link>
                          <div className="text-xs text-zinc-500 font-mono">{player.steamId}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getReputationBadge(player)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-300">
                      {player.playTimeHours}h
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-400">
                      {new Date(player.lastSeen).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                       {player.isVip ? (
                          <span className={`px-2 inline-flex text-xs leading-5 font-bold rounded-full border bg-opacity-20 ${
                             player.vipPlan?.includes('Ouro') ? 'bg-yellow-500 text-yellow-500 border-yellow-500' :
                             player.vipPlan?.includes('Prata') ? 'bg-zinc-400 text-zinc-300 border-zinc-400' :
                             'bg-orange-600 text-orange-400 border-orange-600'
                          }`}>
                            {player.vipPlan}
                          </span>
                       ) : (
                          <span className="px-2 inline-flex text-xs leading-5 font-bold rounded-full bg-zinc-800 text-zinc-500 border border-zinc-700">Free</span>
                       )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => copyToClipboard(player.name)}
                          className="px-2 py-1 border border-zinc-700 rounded text-zinc-300 hover:text-white hover:border-zinc-500"
                          title="Copiar nome"
                        >
                          <Icons.Copy className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => copyToClipboard(player.steamId)}
                          className="px-2 py-1 border border-zinc-700 rounded text-zinc-300 hover:text-white hover:border-zinc-500"
                          title="Copiar SteamID"
                        >
                          <Icons.Key className="w-4 h-4" />
                        </button>
                        <Link 
                           to={`/admin/players/${player.steamId}`}
                           className="text-cyan-400 hover:text-cyan-300 font-bold uppercase text-xs border border-cyan-900/50 bg-cyan-900/10 px-3 py-1 rounded transition-colors"
                        >
                           Ver Perfil
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        
        {/* Pagination Component */}
        <Pagination 
          currentPage={currentPage}
          totalItems={players.length}
          itemsPerPage={itemsPerPage}
          onPageChange={setCurrentPage}
        />
      </div>
    </div>
  );
};

export default Players;

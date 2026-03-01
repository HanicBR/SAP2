
import React, { useEffect, useState, useCallback, useMemo, memo } from 'react';
import { ApiService } from '../../services/api';
import { GameServer, GameMode, ServerStatus, ServerWsLiveStateItem, User, UserRole } from '../../types';
import { Icons } from '../../components/Icon';
import { Link } from 'react-router-dom';

const LIVE_STATE_MAX_AGE_SECONDS = 30;

type ServerLivePresentation = {
  status: ServerStatus;
  players: number;
  maxPlayers: number;
  map?: string;
  lastSignal?: string;
  sourceLabel: 'LIVE (WS)' | 'WS stale' | 'Fallback';
  sourceClass: string;
  sourceDescription: string;
};

const getStatusBadgeClass = (status: ServerStatus) => {
  if (status === ServerStatus.ONLINE) return 'bg-green-900/20 text-green-400 border-green-900/30';
  if (status === ServerStatus.MAINTENANCE) return 'bg-yellow-900/20 text-yellow-300 border-yellow-900/30';
  return 'bg-red-900/20 text-red-400 border-red-900/30';
};

const getStatusLabel = (status: ServerStatus) => {
  if (status === ServerStatus.ONLINE) return 'online';
  if (status === ServerStatus.MAINTENANCE) return 'maintenance';
  return 'offline';
};

const getServerLivePresentation = (
  server: GameServer,
  snapshot?: ServerWsLiveStateItem,
): ServerLivePresentation => {
  const ageSeconds = Number(snapshot?.ageSeconds ?? Number.POSITIVE_INFINITY);
  const hasFreshWs = Boolean(
    snapshot &&
      snapshot.connected &&
      Number.isFinite(ageSeconds) &&
      ageSeconds <= LIVE_STATE_MAX_AGE_SECONDS,
  );

  if (hasFreshWs && snapshot) {
    return {
      status: ServerStatus.ONLINE,
      players: Number(snapshot.playerCount || 0),
      maxPlayers: server.maxPlayers,
      ...(snapshot.map ? { map: snapshot.map } : {}),
      lastSignal: snapshot.receivedAt,
      sourceLabel: 'LIVE (WS)',
      sourceClass: 'bg-emerald-900/20 text-emerald-300 border-emerald-700',
      sourceDescription: `Snapshot WS ${Math.max(0, Math.floor(ageSeconds))}s`,
    };
  }

  if (snapshot) {
    return {
      status: server.status,
      players: server.currentPlayers,
      maxPlayers: server.maxPlayers,
      ...(server.currentMap ? { map: server.currentMap } : {}),
      lastSignal: server.lastHeartbeat || snapshot.receivedAt,
      sourceLabel: 'WS stale',
      sourceClass: 'bg-yellow-900/20 text-yellow-300 border-yellow-700',
      sourceDescription: `Snapshot WS antigo (${Math.max(0, Math.floor(ageSeconds))}s), fallback heartbeat/pulse`,
    };
  }

  return {
    status: server.status,
    players: server.currentPlayers,
    maxPlayers: server.maxPlayers,
    ...(server.currentMap ? { map: server.currentMap } : {}),
    ...(server.lastHeartbeat ? { lastSignal: server.lastHeartbeat } : {}),
    sourceLabel: 'Fallback',
    sourceClass: 'bg-zinc-800 text-zinc-400 border-zinc-700',
    sourceDescription: 'Sem snapshot WS, usando heartbeat/pulse',
  };
};

// --- SUB-COMPONENT: SERVER CARD (Memoized) ---
const ServerCard = memo(({
  server,
  liveState,
  isSuperAdmin,
  plainKey,
  onRegenerateKey,
  onEditIp,
}: {
  server: GameServer;
  liveState?: ServerWsLiveStateItem;
  isSuperAdmin: boolean;
  plainKey?: string;
  onRegenerateKey: (id: string) => void;
  onEditIp: (server: GameServer) => void;
}) => {
  const display = getServerLivePresentation(server, liveState);
  return (
    <div className="bg-zinc-900 rounded border border-zinc-800 p-6 shadow-sm hover:border-zinc-700 transition-colors">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          
          <div className="flex-1">
            <div className="flex items-center gap-3 flex-wrap">
                <h3 className="text-xl font-bold text-white">{server.name}</h3>
                <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider border ${getStatusBadgeClass(display.status)}`}>
                  {getStatusLabel(display.status)}
                </span>
                <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider border ${display.sourceClass}`}>
                  {display.sourceLabel}
                </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-sm text-zinc-400">
                <span className="bg-zinc-950 px-2 py-1 rounded border border-zinc-800 font-mono text-xs">ID: {server.id}</span>
                <span className="flex items-center"><Icons.Activity className="w-3 h-3 mr-1 text-zinc-600" /> {server.ip}:{server.port}</span>
                <span className="flex items-center"><Icons.Crown className="w-3 h-3 mr-1 text-zinc-600" /> {server.mode}</span>
                <span className="flex items-center"><Icons.Activity className="w-3 h-3 mr-1 text-zinc-600" /> {display.sourceDescription}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-xs text-zinc-500">
                <span className="flex items-center">
                  <Icons.Users className="w-3 h-3 mr-1 text-zinc-600" />
                  Jogadores: <span className="ml-1 font-mono text-zinc-200">{display.players}/{display.maxPlayers}</span>
                </span>
                {display.map && (
                  <span className="flex items-center">
                    <Icons.Map className="w-3 h-3 mr-1 text-zinc-600" />
                    Mapa: <span className="ml-1 text-zinc-200">{display.map}</span>
                  </span>
                )}
                {display.lastSignal && (
                  <span className="flex items-center">
                    <Icons.Clock className="w-3 h-3 mr-1 text-zinc-600" />
                    Último sinal: <span className="ml-1 text-zinc-300">
                      {new Date(display.lastSignal).toLocaleTimeString('pt-BR')}
                    </span>
                  </span>
                )}
            </div>
          </div>

          <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-center flex-1 justify-end">
            <Link 
                to={`/admin/servers/${server.id}`} 
                className="bg-zinc-100 hover:bg-white text-zinc-900 px-4 py-3 rounded text-sm font-bold uppercase tracking-wider flex items-center justify-center transition-colors shadow-sm"
            >
                <Icons.Activity className="w-4 h-4 mr-2" />
                Entrar / Detalhes
            </Link>

            {isSuperAdmin && (
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => onEditIp(server)}
                      className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-xs text-zinc-200 transition-colors uppercase tracking-wider font-bold flex items-center justify-center"
                      title="Editar IP/host do servidor"
                    >
                      <Icons.Edit className="w-3 h-3 mr-1.5" />
                      Editar IP
                    </button>
                    <div className="bg-zinc-950 p-3 rounded border border-zinc-800 flex items-center gap-2">
                      <code className="bg-black px-2 py-1 rounded text-xs font-mono text-zinc-300 border border-zinc-800 break-all">
                          {plainKey || 'Gere para visualizar'}
                      </code>
                      <div className="flex items-center gap-1">
                        <button 
                            onClick={() => onRegenerateKey(server.id)}
                            className="p-1.5 bg-zinc-800 hover:bg-red-900/20 hover:text-red-400 border border-zinc-700 rounded text-xs text-zinc-300 transition-colors"
                            title="Gerar nova chave"
                        >
                            <Icons.Key className="w-3 h-3" />
                        </button>
                        <button
                            onClick={() => plainKey && navigator.clipboard.writeText(plainKey)}
                            disabled={!plainKey}
                            className="p-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-xs text-zinc-300 transition-colors disabled:opacity-40"
                            title={plainKey ? 'Copiar chave' : 'Gere para visualizar'}
                        >
                            <Icons.Copy className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                </div>
            )}
          </div>

      </div>
    </div>
  );
});

// --- SUB-COMPONENT: CREATE MODAL (Memoized & Isolated State) ---
const CreateServerModal = memo(({ onClose, onSuccess }: { onClose: () => void, onSuccess: (created: GameServer) => void }) => {
  const [formData, setFormData] = useState({
      name: '',
      ip: '',
      port: 27015,
      mode: GameMode.TTT,
      maxPlayers: 32
  });
  const [creating, setCreating] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
        const created = await ApiService.createServer(formData);
        onSuccess(created);
    } catch (error) {
        alert("Erro ao criar servidor");
    } finally {
        setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 bg-black/80 transition-opacity" aria-hidden="true" onClick={onClose}></div>
        <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>

        <div className="inline-block align-bottom bg-zinc-900 rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full border border-zinc-800 animate-fade-in">
          <form onSubmit={handleSubmit}>
              <div className="bg-zinc-900 px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                  <h3 className="text-lg leading-6 font-bold text-white uppercase mb-4" id="modal-title">
                      Cadastrar Novo Servidor
                  </h3>
                  <div className="space-y-4">
                      <div>
                          <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Nome do Servidor</label>
                          <input 
                              type="text" 
                              required
                              className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm focus:outline-none focus:border-red-500"
                              value={formData.name}
                              onChange={(e) => setFormData({...formData, name: e.target.value})}
                              placeholder="Ex: Backstabber TTT #2 [Fun]"
                          />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                          <div>
                              <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">IP / Hostname</label>
                              <input 
                                  type="text" 
                                  required
                                  className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm focus:outline-none focus:border-red-500"
                                  value={formData.ip}
                                  onChange={(e) => setFormData({...formData, ip: e.target.value})}
                                  placeholder="192.168.1.1"
                              />
                          </div>
                          <div>
                              <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Porta</label>
                              <input 
                                  type="number" 
                                  required
                                  className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm focus:outline-none focus:border-red-500"
                                  value={formData.port}
                                  onChange={(e) => setFormData({...formData, port: parseInt(e.target.value)})}
                                  placeholder="27015"
                              />
                          </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                          <div>
                              <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Modo de Jogo</label>
                              <select 
                                  className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm focus:outline-none focus:border-red-500"
                                  value={formData.mode}
                                  onChange={(e) => setFormData({...formData, mode: e.target.value as GameMode})}
                              >
                                  <option value={GameMode.TTT}>TTT (Trouble in Terrorist Town)</option>
                                  <option value={GameMode.MURDER}>Murder</option>
                                  <option value={GameMode.SANDBOX}>Sandbox</option>
                              </select>
                          </div>
                          <div>
                              <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Max Slots</label>
                              <input 
                                  type="number" 
                                  required
                                  className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-white text-sm focus:outline-none focus:border-red-500"
                                  value={formData.maxPlayers}
                                  onChange={(e) => setFormData({...formData, maxPlayers: parseInt(e.target.value)})}
                                  placeholder="32"
                              />
                          </div>
                      </div>
                  </div>
              </div>
              <div className="bg-zinc-800/50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse border-t border-zinc-800">
                  <button 
                      type="submit" 
                      disabled={creating}
                      className="w-full inline-flex justify-center rounded border border-transparent shadow-sm px-4 py-2 bg-red-700 text-base font-bold text-white hover:bg-red-600 focus:outline-none sm:ml-3 sm:w-auto sm:text-sm uppercase tracking-wider disabled:opacity-50"
                  >
                      {creating ? 'Criando...' : 'Confirmar'}
                  </button>
                  <button 
                      type="button" 
                      className="mt-3 w-full inline-flex justify-center rounded border border-zinc-600 shadow-sm px-4 py-2 bg-transparent text-base font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                      onClick={onClose}
                  >
                      Cancelar
                  </button>
              </div>
          </form>
        </div>
      </div>
    </div>
  );
});

// --- MAIN PAGE COMPONENT ---
const Servers: React.FC = () => {
  const [servers, setServers] = useState<GameServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [plainKeys, setPlainKeys] = useState<Record<string, string>>(() => {
    try {
      const stored = localStorage.getItem('backstabber_server_keys');
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  const [liveStateByServerId, setLiveStateByServerId] = useState<Record<string, ServerWsLiveStateItem>>({});

  // Persiste as chaves em localStorage para que continuem visíveis após recarregar
  useEffect(() => {
    try {
      localStorage.setItem('backstabber_server_keys', JSON.stringify(plainKeys));
    } catch {
      // ignore storage errors
    }
  }, [plainKeys]);

  const loadServers = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await ApiService.getServers();
      setServers(data);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const loadLiveState = useCallback(async () => {
    try {
      const response = await ApiService.getServersLiveState();
      const mapped: Record<string, ServerWsLiveStateItem> = {};
      (response.items || []).forEach((item) => {
        if (!item?.serverId) return;
        mapped[item.serverId] = item;
      });
      setLiveStateByServerId(mapped);
    } catch {
      setLiveStateByServerId({});
    }
  }, []);

  useEffect(() => {
    const userStr = localStorage.getItem('backstabber_user');
    if (userStr) setCurrentUser(JSON.parse(userStr));

    void loadServers(false);
    void loadLiveState();

    const serversInterval = window.setInterval(() => {
      void loadServers(true);
    }, 20000);
    const liveStateInterval = window.setInterval(() => {
      void loadLiveState();
    }, 10000);

    return () => {
      window.clearInterval(serversInterval);
      window.clearInterval(liveStateInterval);
    };
  }, [loadServers, loadLiveState]);

  const handleRegenerateKey = useCallback(async (serverId: string) => {
    if(!window.confirm("ATENÇÃO: Gerar uma nova chave API fará com que o servidor perca a conexão. Continuar?")) return;
    
    try {
      const newKey = await ApiService.regenerateApiKey(serverId);
      setPlainKeys(prev => ({ ...prev, [serverId]: newKey }));
      void loadServers(true);
      alert(`Nova chave gerada:\n${newKey}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao regenerar chave';
      alert(`Erro ao regenerar chave API: ${message}`);
      if (/sessão expirada/i.test(message)) {
        window.location.assign('/admin/login');
      }
    }
  }, [loadServers]);

  const handleCreateSuccess = useCallback((created: GameServer) => {
      setIsCreateModalOpen(false);
      if (created?.id && created.apiKey) {
        setPlainKeys(prev => ({ ...prev, [created.id]: created.apiKey! }));
      }
      void loadServers(true);
  }, [loadServers]);

  const handleEditServerIp = useCallback(async (server: GameServer) => {
    const nextValue = window.prompt(`Novo IP/hostname para ${server.name}:`, server.ip);
    if (nextValue === null) return;
    const trimmed = nextValue.trim();
    if (!trimmed) {
      alert('IP/hostname invÃ¡lido.');
      return;
    }

    try {
      await ApiService.updateServerIp(server.id, trimmed);
      void loadServers(true);
      alert('IP do servidor atualizado.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao atualizar IP do servidor';
      alert(`Erro: ${message}`);
    }
  }, [loadServers]);

  const isSuperAdmin = currentUser?.role === UserRole.SUPERADMIN;
  const liveStateSummary = useMemo(() => {
    let live = 0;
    let stale = 0;
    let fallback = 0;

    servers.forEach((server) => {
      const display = getServerLivePresentation(server, liveStateByServerId[server.id]);
      if (display.sourceLabel === 'LIVE (WS)') {
        live += 1;
        return;
      }
      if (display.sourceLabel === 'WS stale') {
        stale += 1;
        return;
      }
      fallback += 1;
    });

    return {
      total: servers.length,
      live,
      stale,
      fallback,
    };
  }, [servers, liveStateByServerId]);

  return (
    <div className="space-y-6 animate-fade-in relative">
       <div className="flex justify-between items-center">
         <h1 className="text-2xl font-bold text-white">Gerenciamento de Servidores</h1>
         {isSuperAdmin && (
            <button 
                onClick={() => setIsCreateModalOpen(true)}
                className="bg-red-700 hover:bg-red-600 text-white px-4 py-2 rounded text-sm font-bold uppercase tracking-wider flex items-center shadow-lg shadow-red-900/20"
            >
                <Icons.Server className="w-4 h-4 mr-2" />
                Adicionar Servidor
            </button>
         )}
       </div>

       <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="bg-zinc-900 border border-zinc-800 rounded p-3">
            <p className="text-[11px] uppercase font-bold text-zinc-500">Total</p>
            <p className="text-lg font-black text-zinc-100">{liveStateSummary.total}</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded p-3">
            <p className="text-[11px] uppercase font-bold text-zinc-500">LIVE (WS)</p>
            <p className="text-lg font-black text-emerald-300">{liveStateSummary.live}</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded p-3">
            <p className="text-[11px] uppercase font-bold text-zinc-500">WS stale</p>
            <p className="text-lg font-black text-yellow-300">{liveStateSummary.stale}</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded p-3">
            <p className="text-[11px] uppercase font-bold text-zinc-500">Fallback</p>
            <p className="text-lg font-black text-zinc-300">{liveStateSummary.fallback}</p>
          </div>
       </div>

       <div className="grid gap-6">
          {loading ? (
             <p className="text-zinc-500">Carregando servidores...</p>
          ) : servers.length === 0 ? (
             <p className="text-zinc-500">Nenhum servidor cadastrado.</p>
          ) : (
            servers.map(server => (
              <ServerCard 
                  key={server.id} 
                  server={server} 
                  liveState={liveStateByServerId[server.id]}
                  isSuperAdmin={isSuperAdmin} 
                  onRegenerateKey={handleRegenerateKey}
                  onEditIp={handleEditServerIp}
                  plainKey={plainKeys[server.id]}
               />
            ))
          )}
       </div>

       {isCreateModalOpen && (
          <CreateServerModal 
              onClose={() => setIsCreateModalOpen(false)} 
              onSuccess={handleCreateSuccess} 
          />
       )}
    </div>
  );
};

export default Servers;

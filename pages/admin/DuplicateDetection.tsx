
import React, { useEffect, useRef, useState } from 'react';
import { ApiService } from '../../services/api';
import { SuspiciousGroup, SuspicionLevel, Player } from '../../types';
import { Icons } from '../../components/Icon';
import { MapContainer, TileLayer, Circle, CircleMarker, Popup } from 'react-leaflet';
import { Pagination } from '../../components/Pagination';

const DuplicateDetection: React.FC = () => {
  const [groups, setGroups] = useState<SuspiciousGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const mapRefs = useRef<Record<string, any>>({});
  const [refreshing, setRefreshing] = useState(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5; // Groups are tall, so show fewer

  useEffect(() => {
    loadData();
  }, []);

  const loadData = () => {
    setLoading(true);
    ApiService.getSuspiciousAccounts().then(data => {
      setGroups(data);
      setLoading(false);
    });
  };

  const toggleExpand = (id: string) => {
    setExpandedGroup(expandedGroup === id ? null : id);
  };

  // Ensure leaflet map recalculates size when expanded
  useEffect(() => {
    if (expandedGroup && mapRefs.current[expandedGroup]) {
      const map = mapRefs.current[expandedGroup];
      const kick = () => {
        try {
          map.invalidateSize();
        } catch {
          /* ignore */
        }
      };
      setTimeout(kick, 50);
      setTimeout(kick, 250);
    }
  }, [expandedGroup]);

  const getLevelBadge = (level: SuspicionLevel) => {
    if (level === SuspicionLevel.HIGH) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-900/30 text-red-500 border border-red-900/50 uppercase tracking-wide">
          <Icons.Shield className="w-3 h-3 mr-1" />
          Forte (Mesmo IP)
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-yellow-900/30 text-yellow-500 border border-yellow-900/50 uppercase tracking-wide">
        <Icons.Activity className="w-3 h-3 mr-1" />
        Moderada (Subnet/Cidade)
      </span>
    );
  };

  // Slice Logic
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentGroups = groups.slice(indexOfFirstItem, indexOfLastItem);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center">
            <Icons.Fingerprint className="w-6 h-6 mr-3 text-red-500" />
            Detecção de Contas Duplicadas
          </h1>
          <p className="text-zinc-500 text-sm mt-1">
            Análise automática baseada em IP e Geolocalização.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <div className="bg-red-900/10 border border-red-900/20 px-4 py-2 rounded flex items-center">
             <Icons.Shield className="w-4 h-4 text-red-500 mr-2" />
             <span className="text-xs text-red-400 font-bold uppercase">Área Sensível: Acesso restrito à Staff</span>
          </div>
          <button
            onClick={() => { setRefreshing(true); loadData(); setTimeout(() => setRefreshing(false), 400); setExpandedGroup(null); }}
            className="bg-zinc-800 hover:bg-zinc-700 text-white px-3 py-2 rounded text-xs font-bold uppercase tracking-wider flex items-center border border-zinc-700"
            disabled={loading || refreshing}
          >
            <Icons.RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Atualizar
          </button>
        </div>
      </div>

      <div className="bg-zinc-900 rounded border border-zinc-800 overflow-hidden shadow-sm flex flex-col">
        {loading ? (
          <div className="p-8 text-center text-zinc-500">Carregando análise de rede...</div>
        ) : groups.length === 0 ? (
          <div className="p-8 text-center text-zinc-500">Nenhuma atividade suspeita detectada recentemente.</div>
        ) : (
          <>
            <div className="divide-y divide-zinc-800">
              {currentGroups.map((group) => (
                <div key={group.id} className="bg-zinc-900 hover:bg-zinc-800/30 transition-colors">
                  <div 
                    className="p-6 cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    onClick={() => toggleExpand(group.id)}
                  >
                    <div className="flex items-start sm:items-center gap-4">
                      <div className={`p-3 rounded-full ${group.level === SuspicionLevel.HIGH ? 'bg-red-500/10 text-red-500' : 'bg-yellow-500/10 text-yellow-500'}`}>
                          <Icons.Fingerprint className="w-6 h-6" />
                      </div>
                      <div>
                          <div className="flex items-center gap-3 mb-1">
                            {getLevelBadge(group.level)}
                            <span className="text-zinc-500 text-xs font-mono bg-black/50 px-2 py-0.5 rounded border border-zinc-800">
                              {group.commonIpOrSubnet}
                            </span>
                          </div>
                          <h3 className="text-white font-bold text-lg">
                            {group.players.length} Contas Associadas
                            <span className="text-zinc-500 font-normal text-sm ml-2">em {group.location}</span>
                          </h3>
                          <p className="text-zinc-500 text-xs mt-1">
                            Última atividade: {new Date(group.lastActivity).toLocaleString()}
                          </p>
                      </div>
                    </div>
                    
                    <div className="flex items-center text-zinc-400 text-sm font-bold uppercase tracking-wider group-hover:text-white transition-colors">
                      {expandedGroup === group.id ? 'Ocultar Detalhes' : 'Ver Detalhes'}
                      <Icons.List className="w-4 h-4 ml-2" />
                    </div>
                  </div>

                  {expandedGroup === group.id && (
                    <div className="bg-black/20 border-t border-zinc-800 p-6 animate-fade-in">
                      <h4 className="text-zinc-400 text-xs font-bold uppercase tracking-wider mb-4">Jogadores neste grupo</h4>
                      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
                          {/* Player List */}
                          <div className="space-y-4">
                            {group.players.map((player) => (
                                <div key={player.steamId} className="bg-zinc-950 p-4 rounded border border-zinc-800 flex items-start justify-between group/card hover:border-zinc-600 transition-colors">
                                  <div>
                                      <div className="flex items-center gap-2 mb-1">
                                        <span className="text-white font-bold">{player.name}</span>
                                        {player.isVip && <Icons.Crown className="w-3 h-3 text-yellow-500" />}
                                      </div>
                                      <code className="text-xs text-zinc-600 block mb-2 font-mono select-all">{player.steamId}</code>
                                      
                                      <div className="space-y-1">
                                        <div className="flex items-center text-xs text-zinc-500">
                                            <span className="w-20 font-bold text-zinc-600 uppercase">IP:</span> 
                                            <span className="font-mono text-cyan-500">{player.ip}</span>
                                        </div>
                                        <div className="flex items-center text-xs text-zinc-500">
                                            <span className="w-20 font-bold text-zinc-600 uppercase">Local:</span> 
                                            <span>{player.geo?.city}, {player.geo?.state} - {player.geo?.country}</span>
                                        </div>
                                        <div className="flex items-center text-xs text-zinc-500">
                                            <span className="w-20 font-bold text-zinc-600 uppercase">Conexões:</span> 
                                            <span>{player.totalConnections}</span>
                                        </div>
                                      </div>
                                  </div>
                                  <div className="h-full flex flex-col justify-end">
                                      <button className="text-xs text-red-500 hover:text-red-400 font-bold uppercase bg-red-900/10 hover:bg-red-900/20 px-2 py-1 rounded transition-colors">
                                        Banir
                                      </button>
                                  </div>
                                </div>
                            ))}
                          </div>
                          
                          {/* Map Visualization */}
                          <div className="h-[400px] bg-zinc-950 rounded border border-zinc-800 overflow-hidden relative">
                            {group.players[0].geo?.lat && group.players[0].geo?.lng ? (
                                <MapContainer 
                                  center={[group.players[0].geo.lat, group.players[0].geo.lng]} 
                                  zoom={13} 
                                  style={{ height: '100%', width: '100%' }}
                                  whenCreated={(map) => {
                                    mapRefs.current[group.id] = map;
                                    const kick = () => {
                                      try { map.invalidateSize(); } catch { /* ignore */ }
                                    };
                                    setTimeout(kick, 50);
                                    setTimeout(kick, 250);
                                  }}
                                >
                                  {/* Dark Theme Tiles */}
                                  <TileLayer
                                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                                      url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                                  />
                                  {group.players.map((player) => {
                                      if (!player.geo?.lat || !player.geo?.lng) return null;
                                      const isHighRisk = group.level === SuspicionLevel.HIGH;
                                      return (
                                        <React.Fragment key={`map-${player.steamId}`}>
                                            <CircleMarker 
                                              center={[player.geo.lat, player.geo.lng]}
                                              radius={8}
                                              pathOptions={{ 
                                                  color: isHighRisk ? '#ef4444' : '#eab308', 
                                                  fillColor: isHighRisk ? '#ef4444' : '#eab308', 
                                                  fillOpacity: 0.7 
                                              }}
                                            >
                                              <Popup className="bg-zinc-900 text-zinc-900">
                                                  <div className="text-sm font-bold">{player.name}</div>
                                                  <div className="text-xs">{player.ip}</div>
                                              </Popup>
                                            </CircleMarker>
                                            {/* Proximity Radius Ring */}
                                            <Circle 
                                              center={[player.geo.lat, player.geo.lng]}
                                              radius={500} // 500 meters radius
                                              pathOptions={{
                                                  color: isHighRisk ? '#ef4444' : '#eab308',
                                                  fillColor: isHighRisk ? '#ef4444' : '#eab308',
                                                  fillOpacity: 0.1,
                                                  weight: 1
                                              }}
                                            />
                                        </React.Fragment>
                                      );
                                  })}
                                </MapContainer>
                            ) : (
                                <div className="flex items-center justify-center h-full text-zinc-500">
                                  Dados de GPS indisponíveis para este grupo.
                                </div>
                            )}
                            <div className="absolute top-2 right-2 bg-black/80 p-2 rounded text-xs text-zinc-400 z-[1000] border border-zinc-800">
                                <div className="flex items-center gap-2 mb-1">
                                  <div className="w-3 h-3 rounded-full bg-red-500"></div> 
                                  <span>Alvo Principal</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="w-3 h-3 rounded-full bg-red-500/30 border border-red-500"></div> 
                                  <span>Raio de Proximidade (500m)</span>
                                </div>
                            </div>
                          </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {/* Pagination Component */}
            <Pagination 
              currentPage={currentPage}
              totalItems={groups.length}
              itemsPerPage={itemsPerPage}
              onPageChange={setCurrentPage}
            />
          </>
        )}
      </div>
    </div>
  );
};

export default DuplicateDetection;

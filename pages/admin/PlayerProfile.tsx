


import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ApiService } from '../../services/api';
import { Player, ServerEvent, GameServer, SuspiciousGroup } from '../../types';
import { Icons } from '../../components/Icon';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, 
  AreaChart, Area 
} from 'recharts';

const PlayerProfile: React.FC = () => {
  const { steamId } = useParams<{ steamId: string }>();
  const [player, setPlayer] = useState<Player | null>(null);
  const [logs, setLogs] = useState<ServerEvent[]>([]);
  const [servers, setServers] = useState<GameServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [suspiciousGroup, setSuspiciousGroup] = useState<SuspiciousGroup | null>(null);
  
  // Note state
  const [newNote, setNewNote] = useState('');
  const [submittingNote, setSubmittingNote] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteContent, setEditingNoteContent] = useState('');
  const [showPunishmentForm, setShowPunishmentForm] = useState(false);
  const [punishmentType, setPunishmentType] = useState<'BAN' | 'MUTE' | 'GAG' | 'KICK' | 'WARN'>('WARN');
  const [punishmentReason, setPunishmentReason] = useState('');
  const [punishmentDuration, setPunishmentDuration] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      if (!steamId) return;
      setLoading(true);
      
      try {
        const [playerData, allServers] = await Promise.all([
          ApiService.getPlayerBySteamId(steamId),
          ApiService.getServers()
        ]);

        setPlayer(playerData);
        setServers(allServers);

        if (playerData) {
          const [playerLogs, suspiciousGroups] = await Promise.all([
            ApiService.getEvents(playerData.steamId),
            ApiService.getSuspiciousAccounts().catch(() => null)
          ]);

          setLogs(playerLogs);

          if (suspiciousGroups) {
            const group = suspiciousGroups.find(g =>
              g.players.some(p => p.steamId === playerData.steamId)
            );
            setSuspiciousGroup(group || null);
          } else {
            setSuspiciousGroup(null);
          }
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [steamId]);

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if(!newNote.trim() || !player) return;

    setSubmittingNote(true);
    // In a real app we'd get the current admin user
    await ApiService.addPlayerNote(player.steamId, newNote, 'AdminUser');
    
    // Refresh player data to see the note
    const updatedPlayer = await ApiService.getPlayerBySteamId(player.steamId);
    setPlayer(updatedPlayer);
    
    setNewNote('');
    setSubmittingNote(false);
  };

  const startEditNote = (noteId: string, current: string) => {
    setEditingNoteId(noteId);
    setEditingNoteContent(current);
  };

  const cancelEditNote = () => {
    setEditingNoteId(null);
    setEditingNoteContent('');
  };

  const handleSaveEditNote = async (noteId: string) => {
    if (!player || !editingNoteContent.trim()) return;
    await ApiService.updatePlayerNote(player.steamId, noteId, editingNoteContent.trim());
    const updatedPlayer = await ApiService.getPlayerBySteamId(player.steamId);
    setPlayer(updatedPlayer);
    cancelEditNote();
  };

  const handleDeleteNote = async (noteId: string) => {
    if (!player) return;
    if (!window.confirm('Tem certeza que deseja remover esta nota?')) return;

    await ApiService.deletePlayerNote(player.steamId, noteId);
    const updatedPlayer = await ApiService.getPlayerBySteamId(player.steamId);
    setPlayer(updatedPlayer);
  };

  const handleApplyPunishment = async () => {
    if (!player) return;

    const typeInput = window.prompt(
      'Tipo de punição (BAN, MUTE, GAG, KICK, WARN):',
      'WARN',
    );
    if (!typeInput) return;
    const type = typeInput.toUpperCase();
    if (!['BAN', 'MUTE', 'GAG', 'KICK', 'WARN'].includes(type)) {
      alert('Tipo de punição inválido.');
      return;
    }

    const reason = window.prompt('Motivo da punição:');
    if (!reason || !reason.trim()) return;

    const durationInput = window.prompt(
      'Duração (ex: "3 dias", "Permanente") – opcional:',
    );
    const duration = durationInput && durationInput.trim() ? durationInput.trim() : undefined;

    try {
      await ApiService.createPunishment(player.steamId, {
        type: type as any,
        reason: reason.trim(),
        duration,
        active: true,
        // Em produção, pegaria o nome do admin logado
        staffName: 'AdminUser',
      });
      const updatedPlayer = await ApiService.getPlayerBySteamId(player.steamId);
      setPlayer(updatedPlayer);
    } catch {
      alert('Erro ao aplicar punição.');
    }
  };

  const getServerName = (id: string) => {
    const srv = servers.find(s => s.id === id);
    return srv ? srv.name.split('[')[0].trim() : id;
  };

  // Helper to determine peak playtime
  const getPeakPlaytime = () => {
    if (!logs || logs.length === 0) return "Sem dados suficientes";
    
    // Bucket logs by hour
    const hourCounts = new Array(24).fill(0);
    logs.forEach(log => {
      const hour = new Date(log.timestamp).getHours();
      hourCounts[hour]++;
    });

    // Find the max index
    let maxHour = 0;
    let maxCount = 0;
    hourCounts.forEach((count, i) => {
      if (count > maxCount) {
        maxCount = count;
        maxHour = i;
      }
    });

    // Categorize
    if (maxHour >= 6 && maxHour < 12) return `Manhã (${maxHour}h - ${maxHour+2}h)`;
    if (maxHour >= 12 && maxHour < 18) return `Tarde (${maxHour}h - ${maxHour+2}h)`;
    if (maxHour >= 18 && maxHour <= 23) return `Noite (${maxHour}h - ${maxHour+2}h)`;
    return `Madrugada (${maxHour}h - ${maxHour+2}h)`;
  };

  const getRankColor = (rank: string) => {
     if (rank.includes('Global') || rank.includes('Lenda')) return 'text-red-500 from-red-900/40';
     if (rank.includes('Mestre') || rank.includes('Diamante')) return 'text-cyan-400 from-cyan-900/40';
     if (rank.includes('Platina')) return 'text-purple-400 from-purple-900/40';
     if (rank.includes('Ouro')) return 'text-yellow-500 from-yellow-900/40';
     if (rank.includes('Prata')) return 'text-zinc-300 from-zinc-800/40';
     return 'text-orange-600 from-orange-900/40';
  };

  const handleCopySteamId = () => {
    if (!player) return;

    try {
      if (navigator && 'clipboard' in navigator) {
        navigator.clipboard.writeText(player.steamId).catch(() => {
          window.prompt('SteamID do jogador:', player.steamId);
        });
      } else {
        window.prompt('SteamID do jogador:', player.steamId);
      }
    } catch {
      window.prompt('SteamID do jogador:', player.steamId);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-zinc-500">Carregando perfil...</div>;
  }

  if (!player) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-xl text-white font-bold mb-4">Jogador não encontrado</h2>
        <Link to="/admin/players" className="text-cyan-400 hover:text-cyan-300">Voltar para a lista</Link>
      </div>
    );
  }

  // Prepare chart data for Server Activity
  const chartData = player.serverStats 
    ? Object.entries(player.serverStats).map(([sid, stats]: [string, any]) => ({
        name: getServerName(sid),
        hours: stats.playTimeHours,
        connections: stats.connections
      }))
    : [];

  const suspicious = !!suspiciousGroup;

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Header / Navigation */}
      <div>
        <Link to="/admin/players" className="text-sm text-zinc-500 hover:text-white mb-4 inline-flex items-center">
          <Icons.Menu className="w-4 h-4 mr-1 rotate-180" /> Voltar para Jogadores
        </Link>
      </div>

      {/* Main Profile Header */}
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 sm:p-8 shadow-xl relative overflow-hidden">
         <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-red-700 to-zinc-800"></div>
         
         <div className="flex flex-col md:flex-row items-center md:items-start gap-8 relative z-10">
            {/* Avatar Section */}
            <div className="relative">
              <img 
                src={player.avatarUrl} 
                alt={player.name} 
                className="w-32 h-32 rounded-full border-4 border-zinc-800 shadow-2xl" 
              />
              {suspicious && (
                 <div className="absolute -top-2 -right-2 bg-red-600 text-white p-2 rounded-full shadow-lg border-2 border-zinc-900" title="Conta Suspeita">
                    <Icons.Shield className="w-6 h-6" />
                 </div>
              )}
            </div>

            {/* Info Section */}
            <div className="flex-1 text-center md:text-left">
               <div className="flex flex-col md:flex-row items-center gap-4 mb-2">
                 <h1 className="text-4xl font-black text-white tracking-tight">{player.name}</h1>
                 {player.isVip && (
                    <span className={`px-3 py-1 rounded-full text-sm font-bold uppercase tracking-wider border ${
                       player.vipPlan?.includes('Ouro') ? 'bg-yellow-900/20 text-yellow-500 border-yellow-600' : 
                       'bg-zinc-800 text-zinc-400 border-zinc-600'
                    }`}>
                       VIP {player.vipPlan}
                    </span>
                 )}
               </div>
               
               <div className="flex flex-col md:flex-row items-center gap-4 text-zinc-400 font-mono text-sm mb-6">
                 <div className="bg-zinc-950 px-3 py-1.5 rounded border border-zinc-800 flex items-center gap-2">
                    <span className="select-all">{player.steamId}</span>
                 </div>
                 {suspicious && (
                    <Link to="/admin/duplicates" className="text-red-500 hover:text-red-400 font-bold uppercase flex items-center text-xs">
                       <Icons.Fingerprint className="w-4 h-4 mr-1" /> Ver detalhes de duplicidade
                    </Link>
                 )}
               </div>

               <div className="flex flex-wrap justify-center md:justify-start gap-3">
                  <button
                    onClick={handleCopySteamId}
                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded text-sm font-bold uppercase transition-colors border border-zinc-700"
                  >
                     Copiar SteamID
                  </button>
                  <button className="px-4 py-2 bg-red-900/20 hover:bg-red-900/40 text-red-500 rounded text-sm font-bold uppercase transition-colors border border-red-900/50 flex items-center">
                     <Icons.Gavel className="w-4 h-4 mr-2" />
                     Aplicar Punição
                  </button>
               </div>
            </div>
         </div>
      </div>

      {/* General Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
         <div className="bg-zinc-900 p-5 rounded border border-zinc-800">
            <p className="text-xs text-zinc-500 uppercase font-bold mb-1">Tempo Total</p>
            <p className="text-2xl font-mono text-white">{player.playTimeHours}h</p>
         </div>
         <div className="bg-zinc-900 p-5 rounded border border-zinc-800">
            <p className="text-xs text-zinc-500 uppercase font-bold mb-1">Total Conexões</p>
            <p className="text-2xl font-mono text-white">{player.totalConnections}</p>
         </div>
         <div className="bg-zinc-900 p-5 rounded border border-zinc-800">
            <p className="text-xs text-zinc-500 uppercase font-bold mb-1">Primeiro Acesso</p>
            <p className="text-lg text-zinc-300">{new Date(player.firstSeen).toLocaleDateString()}</p>
         </div>
         <div className="bg-zinc-900 p-5 rounded border border-zinc-800 relative overflow-hidden">
            <Icons.Clock className="absolute right-4 top-4 w-12 h-12 text-zinc-800" />
            <p className="text-xs text-zinc-500 uppercase font-bold mb-1">Horário Frequente</p>
            <p className="text-lg text-white font-bold">{getPeakPlaytime()}</p>
         </div>
      </div>

      {/* GAME MODE SPECIFIC STATS */}
      {player.gameModeStats && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* TTT Stats Card */}
          <div className="bg-zinc-900 border border-zinc-800 rounded overflow-hidden flex flex-col">
            <div className="bg-red-900/20 p-4 border-b border-red-900/30 flex items-center justify-between">
              <h3 className="text-white font-bold uppercase">Estatísticas TTT</h3>
              {player.gameModeStats.ttt && (
                <span className="text-xs text-red-400 font-bold bg-red-900/30 px-2 py-1 rounded">
                   WR: {((player.gameModeStats.ttt.roundsWon / Math.max(1, player.gameModeStats.ttt.roundsPlayed)) * 100).toFixed(1)}%
                </span>
              )}
            </div>
            
            <div className="p-6 flex-1">
               {player.gameModeStats.ttt ? (
                 <>
                   {/* Rank & Points Section */}
                   <div className="flex items-center justify-between mb-8 bg-zinc-950/50 p-4 rounded border border-zinc-800/50 relative overflow-hidden">
                      <div className={`absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b ${getRankColor(player.gameModeStats.ttt.rank)}`}></div>
                      <div>
                         <p className="text-xs text-zinc-500 uppercase font-bold mb-1">Patente Atual</p>
                         <p className={`text-2xl font-black uppercase ${getRankColor(player.gameModeStats.ttt.rank).split(' ')[0]}`}>
                            {player.gameModeStats.ttt.rank}
                         </p>
                      </div>
                      <div className="text-right">
                         <p className="text-xs text-zinc-500 uppercase font-bold mb-1">Pontos Totais</p>
                         <p className="text-2xl text-white font-mono font-bold tracking-tight">
                            {player.gameModeStats.ttt.points.toLocaleString()}
                         </p>
                      </div>
                   </div>

                   <div className="flex justify-between mb-6 text-center">
                      <div>
                         <p className="text-xs text-zinc-500 uppercase font-bold">Rounds</p>
                         <p className="text-xl text-white font-mono">{player.gameModeStats.ttt.roundsPlayed}</p>
                      </div>
                      <div>
                         <p className="text-xs text-zinc-500 uppercase font-bold">Kills</p>
                         <p className="text-xl text-white font-mono">{player.gameModeStats.ttt.kills}</p>
                      </div>
                      <div>
                         <p className="text-xs text-zinc-500 uppercase font-bold">Deaths</p>
                         <p className="text-xl text-white font-mono">{player.gameModeStats.ttt.deaths}</p>
                      </div>
                      <div>
                         <p className="text-xs text-zinc-500 uppercase font-bold">K/D</p>
                         <p className={`text-xl font-mono font-bold ${player.gameModeStats.ttt.kills / Math.max(1, player.gameModeStats.ttt.deaths) > 1 ? 'text-green-500' : 'text-red-500'}`}>
                            {(player.gameModeStats.ttt.kills / Math.max(1, player.gameModeStats.ttt.deaths)).toFixed(2)}
                         </p>
                      </div>
                   </div>
                   
                   <div className="space-y-4">
                      {/* Traitor Stats */}
                      <div>
                         <div className="flex justify-between text-xs mb-1">
                            <span className="text-red-500 font-bold uppercase">Traitor</span>
                            <span className="text-zinc-400">{player.gameModeStats.ttt.traitorWins} vitórias / {player.gameModeStats.ttt.traitorRounds} rounds</span>
                         </div>
                         <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
                            <div 
                               className="bg-red-600 h-full" 
                               style={{ width: `${(player.gameModeStats.ttt.traitorWins / Math.max(1, player.gameModeStats.ttt.traitorRounds)) * 100}%` }}
                            ></div>
                         </div>
                      </div>
                      {/* Detective Stats */}
                      <div>
                         <div className="flex justify-between text-xs mb-1">
                            <span className="text-blue-500 font-bold uppercase">Detective</span>
                            <span className="text-zinc-400">{player.gameModeStats.ttt.detectiveWins} vitórias / {player.gameModeStats.ttt.detectiveRounds} rounds</span>
                         </div>
                         <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
                            <div 
                               className="bg-blue-600 h-full" 
                               style={{ width: `${(player.gameModeStats.ttt.detectiveWins / Math.max(1, player.gameModeStats.ttt.detectiveRounds)) * 100}%` }}
                            ></div>
                         </div>
                      </div>
                      {/* Innocent Stats */}
                      <div>
                         <div className="flex justify-between text-xs mb-1">
                            <span className="text-green-500 font-bold uppercase">Innocent</span>
                            <span className="text-zinc-400">{player.gameModeStats.ttt.innocentWins} vitórias / {player.gameModeStats.ttt.innocentRounds} rounds</span>
                         </div>
                         <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
                            <div 
                               className="bg-green-600 h-full" 
                               style={{ width: `${(player.gameModeStats.ttt.innocentWins / Math.max(1, player.gameModeStats.ttt.innocentRounds)) * 100}%` }}
                            ></div>
                         </div>
                      </div>
                   </div>
                 </>
               ) : (
                 <div className="flex flex-col items-center justify-center h-full min-h-[250px] text-zinc-600 opacity-60">
                    <Icons.Ghost className="w-16 h-16 mb-4" />
                    <p className="text-sm font-bold uppercase">Nunca jogou TTT</p>
                 </div>
               )}
            </div>
          </div>

          {/* Murder & Sandbox Stats (Stacked) */}
          <div className="flex flex-col gap-6">
            <div className="bg-zinc-900 border border-zinc-800 rounded overflow-hidden flex flex-col flex-1">
                <div className="bg-purple-900/20 p-4 border-b border-purple-900/30">
                  <h3 className="text-white font-bold uppercase">Estatísticas Murder</h3>
                </div>
                <div className="p-6 flex-1">
                  {player.gameModeStats.murder ? (
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-zinc-950 p-3 rounded border border-zinc-800 text-center">
                          <p className="text-xs text-zinc-500 uppercase">Murderer Wins</p>
                          <p className="text-xl text-red-500 font-black">{player.gameModeStats.murder.murdererWins}</p>
                        </div>
                        <div className="bg-zinc-950 p-3 rounded border border-zinc-800 text-center">
                          <p className="text-xs text-zinc-500 uppercase">Bystander Wins</p>
                          <p className="text-xl text-blue-500 font-black">{player.gameModeStats.murder.bystanderWins}</p>
                        </div>
                        <div className="col-span-2 text-center mt-4">
                          <p className="text-zinc-400 text-sm">
                              Jogou como Murderer em <span className="text-white font-bold">{((player.gameModeStats.murder.murdererRounds / Math.max(1, player.gameModeStats.murder.roundsPlayed)) * 100).toFixed(1)}%</span> das partidas
                          </p>
                        </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full min-h-[150px] text-zinc-600 opacity-60">
                      <Icons.Ghost className="w-12 h-12 mb-3" />
                      <p className="text-sm font-bold uppercase">Nunca jogou Murder</p>
                    </div>
                  )}
                </div>
            </div>
            
            <div className="bg-zinc-900 border border-zinc-800 rounded overflow-hidden flex flex-col flex-1">
                <div className="bg-blue-900/20 p-4 border-b border-blue-900/30">
                  <h3 className="text-white font-bold uppercase">Estatísticas Sandbox</h3>
                </div>
                <div className="p-6 flex-1">
                  {player.gameModeStats.sandbox ? (
                    <div className="flex justify-between items-center">
                      <div>
                          <p className="text-2xl text-white font-mono font-bold">{player.gameModeStats.sandbox.propsSpawned}</p>
                          <p className="text-xs text-zinc-500 uppercase">Props Spawnados</p>
                      </div>
                      <div className="text-right">
                          <p className="text-xl text-white font-mono font-bold">
                            {(player.gameModeStats.sandbox.totalPlayTimeHours / Math.max(1, player.gameModeStats.sandbox.totalSessions)).toFixed(1)}h
                          </p>
                          <p className="text-xs text-zinc-500 uppercase">Média p/ Sessão</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full min-h-[100px] text-zinc-600 opacity-60">
                      <Icons.Box className="w-12 h-12 mb-3" />
                      <p className="text-sm font-bold uppercase">Nunca jogou Sandbox</p>
                    </div>
                  )}
                </div>
            </div>
          </div>

        </div>
      )}

      {/* Activity Timeline */}
      {player.activityHistory && (
         <div className="bg-zinc-900 border border-zinc-800 rounded overflow-hidden p-6">
            <h3 className="text-sm font-bold text-zinc-300 uppercase mb-6 flex items-center">
               <Icons.Activity className="w-4 h-4 mr-2" /> Atividade Recente (Últimos 14 dias)
            </h3>
            <div className="h-64 w-full">
               <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={player.activityHistory}>
                     <defs>
                        <linearGradient id="colorHours" x1="0" y1="0" x2="0" y2="1">
                           <stop offset="5%" stopColor="#b91c1c" stopOpacity={0.8}/>
                           <stop offset="95%" stopColor="#b91c1c" stopOpacity={0}/>
                        </linearGradient>
                     </defs>
                     <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                     <XAxis dataKey="date" stroke="#71717a" tick={{fontSize: 10}} />
                     <YAxis stroke="#71717a" tick={{fontSize: 12}} />
                     <Tooltip 
                        contentStyle={{ backgroundColor: '#09090b', border: '1px solid #3f3f46', color: '#f4f4f5' }}
                     />
                     <Area type="monotone" dataKey="hoursPlayed" stroke="#b91c1c" fillOpacity={1} fill="url(#colorHours)" />
                  </AreaChart>
               </ResponsiveContainer>
            </div>
         </div>
      )}

      {/* Moderation Section */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        
        {/* Left Column: Notes & Linked Accounts */}
        <div className="space-y-6">
          
          {/* Linked Accounts */}
          {suspiciousGroup ? (
            <div className="bg-red-900/10 border border-red-900/30 rounded overflow-hidden">
               <div className="p-4 bg-red-900/20 border-b border-red-900/30 flex justify-between items-center">
                  <h3 className="text-sm font-bold text-red-400 uppercase flex items-center">
                     <Icons.Fingerprint className="w-4 h-4 mr-2" /> Contas Relacionadas
                  </h3>
                  <Link to="/admin/duplicates" className="text-xs text-red-500 hover:text-red-300 font-bold uppercase">Ver Rede</Link>
               </div>
               <div className="p-4">
                  <p className="text-xs text-zinc-400 mb-3">
                     Este jogador compartilha {suspiciousGroup.level === 'HIGH' ? 'o mesmo IP' : 'a mesma rede/local'} com:
                  </p>
                  <div className="space-y-2">
                     {suspiciousGroup.players.filter(p => p.steamId !== player.steamId).map(p => (
                        <Link key={p.steamId} to={`/admin/players/${p.steamId}`} className="block bg-zinc-900/50 p-2 rounded border border-red-900/20 hover:bg-red-900/20 transition-colors flex items-center justify-between">
                           <div className="flex items-center">
                              <img src={p.avatarUrl} className="w-6 h-6 rounded-full mr-2" alt="" />
                              <span className="text-sm text-zinc-200 font-bold">{p.name}</span>
                           </div>
                           <span className="text-[10px] font-mono text-zinc-500">{p.steamId}</span>
                        </Link>
                     ))}
                  </div>
               </div>
            </div>
          ) : (
             <div className="bg-zinc-900 border border-zinc-800 rounded p-4 flex items-center justify-center text-zinc-500 text-sm">
                <Icons.Check className="w-4 h-4 mr-2" /> Nenhuma conta duplicada detectada.
             </div>
          )}

          {/* Staff Notes */}
          <div className="bg-zinc-900 border border-zinc-800 rounded overflow-hidden flex flex-col h-[400px]">
             <div className="p-4 border-b border-zinc-800 bg-zinc-950/30">
                <h3 className="text-sm font-bold text-zinc-300 uppercase flex items-center">
                   <Icons.FileText className="w-4 h-4 mr-2" /> Notas da Staff
                </h3>
             </div>
             <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-zinc-950/50">
               {player.notes && player.notes.length > 0 ? (
                  player.notes.map(note => (
                      <div key={note.id} className="bg-yellow-100 text-yellow-900 p-3 rounded shadow-sm relative group">
                         <div className="text-xs font-bold mb-1 flex justify-between items-center">
                            <span>{note.staffName}</span>
                            <span className="flex items-center gap-2">
                              <span className="opacity-70">{new Date(note.date).toLocaleDateString()}</span>
                              <button
                                type="button"
                                onClick={() => startEditNote(note.id, note.content)}
                                className="opacity-0 group-hover:opacity-100 text-[10px] uppercase font-bold text-zinc-700 hover:text-zinc-900 transition-opacity"
                              >
                                Editar
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteNote(note.id)}
                                className="opacity-0 group-hover:opacity-100 text-[10px] uppercase font-bold text-red-600 hover:text-red-800 transition-opacity"
                              >
                                Remover
                              </button>
                            </span>
                         </div>
                         {editingNoteId === note.id ? (
                           <div className="space-y-2 mt-1">
                             <textarea
                               className="w-full bg-yellow-50 border border-yellow-300 rounded p-2 text-xs text-yellow-900 focus:outline-none focus:border-yellow-500 resize-none"
                               rows={3}
                               value={editingNoteContent}
                               onChange={(e) => setEditingNoteContent(e.target.value)}
                             />
                             <div className="flex justify-end gap-2">
                               <button
                                 type="button"
                                 onClick={cancelEditNote}
                                 className="text-[10px] uppercase font-bold text-zinc-600 hover:text-zinc-800"
                               >
                                 Cancelar
                               </button>
                               <button
                                 type="button"
                                 onClick={() => handleSaveEditNote(note.id)}
                                 disabled={!editingNoteContent.trim()}
                                 className="text-[10px] uppercase font-bold bg-yellow-500 hover:bg-yellow-600 text-yellow-950 px-2 py-1 rounded disabled:opacity-50"
                               >
                                 Salvar
                               </button>
                             </div>
                           </div>
                         ) : (
                           <p className="text-sm leading-snug">{note.content}</p>
                         )}
                      </div>
                   ))
                ) : (
                   <p className="text-center text-zinc-600 text-sm italic py-4">Nenhuma nota registrada.</p>
                )}
             </div>
             <div className="p-4 border-t border-zinc-800 bg-zinc-900">
                <form onSubmit={handleAddNote}>
                   <textarea 
                      className="w-full bg-zinc-950 border border-zinc-700 rounded p-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-500 resize-none"
                      rows={2}
                      placeholder="Adicionar nota interna..."
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                   ></textarea>
                   <button 
                      type="submit" 
                      disabled={submittingNote || !newNote.trim()}
                      className="mt-2 w-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold uppercase py-2 rounded transition-colors disabled:opacity-50"
                   >
                      {submittingNote ? 'Salvando...' : 'Adicionar Nota'}
                   </button>
                </form>
             </div>
          </div>
        </div>

        {/* Middle/Right: Punishment History */}
        <div className="xl:col-span-2">
           <div className="bg-zinc-900 border border-zinc-800 rounded overflow-hidden">
              <div className="p-4 border-b border-zinc-800 bg-zinc-950/30 flex justify-between items-center">
                 <h3 className="text-sm font-bold text-zinc-300 uppercase flex items-center">
                    <Icons.Gavel className="w-4 h-4 mr-2" /> Histórico de Punições
                 </h3>
                 <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                    (player.punishments?.length || 0) > 0 ? 'bg-red-900/20 text-red-500' : 'bg-green-900/20 text-green-500'
                 }`}>
                    {player.punishments?.length || 0} Registros
                 </span>
              </div>
              <div className="overflow-x-auto">
                 <table className="min-w-full divide-y divide-zinc-800">
                    <thead className="bg-zinc-950/50">
                       <tr>
                          <th className="px-4 py-3 text-left text-xs font-bold text-zinc-500 uppercase">Tipo</th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-zinc-500 uppercase">Motivo</th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-zinc-500 uppercase">Staff</th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-zinc-500 uppercase">Data</th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-zinc-500 uppercase">Duração</th>
                          <th className="px-4 py-3 text-left text-xs font-bold text-zinc-500 uppercase">Status</th>
                       </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800 bg-zinc-900">
                       {player.punishments && player.punishments.length > 0 ? (
                          player.punishments.map(punishment => (
                             <tr key={punishment.id} className="hover:bg-zinc-800/50">
                                <td className="px-4 py-3 whitespace-nowrap">
                                   <span className={`text-xs font-bold px-2 py-0.5 rounded border ${
                                      punishment.type === 'BAN' ? 'bg-red-900/20 text-red-500 border-red-900/30' :
                                      punishment.type === 'WARN' ? 'bg-yellow-900/20 text-yellow-500 border-yellow-900/30' :
                                      'bg-zinc-800 text-zinc-400 border-zinc-700'
                                   }`}>
                                      {punishment.type}
                                   </span>
                                </td>
                                <td className="px-4 py-3 text-sm text-zinc-300">{punishment.reason}</td>
                                <td className="px-4 py-3 text-sm text-zinc-400">{punishment.staffName}</td>
                                <td className="px-4 py-3 text-sm text-zinc-500 font-mono text-xs">{new Date(punishment.date).toLocaleDateString()}</td>
                                <td className="px-4 py-3 text-sm text-zinc-400">{punishment.duration || '-'}</td>
                                <td className="px-4 py-3 whitespace-nowrap">
                                   {punishment.active ? (
                                      <span className="text-red-500 text-xs font-bold uppercase">Ativo</span>
                                   ) : (
                                      <span className="text-zinc-600 text-xs font-bold uppercase">Expirado</span>
                                   )}
                                </td>
                             </tr>
                          ))
                       ) : (
                          <tr><td colSpan={6} className="px-6 py-8 text-center text-zinc-500 italic">Nenhuma punição registrada.</td></tr>
                       )}
                    </tbody>
                 </table>
              </div>
           </div>
           
           {/* Chart below punishments */}
           <div className="mt-6 bg-zinc-900 p-6 rounded border border-zinc-800">
              <h3 className="text-sm font-bold text-zinc-300 uppercase mb-6 flex items-center">
                 <Icons.Activity className="w-4 h-4 mr-2" /> Tempo por Servidor (Horas)
              </h3>
              <div className="h-48 w-full">
                 <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                       <CartesianGrid strokeDasharray="3 3" stroke="#27272a" horizontal={false} />
                       <XAxis type="number" stroke="#71717a" />
                       <YAxis dataKey="name" type="category" width={150} stroke="#a1a1aa" tick={{fontSize: 12}} />
                       <Tooltip 
                          contentStyle={{ backgroundColor: '#09090b', border: '1px solid #3f3f46', color: '#f4f4f5' }}
                          cursor={{fill: '#27272a'}}
                       />
                       <Bar dataKey="hours" fill="#b91c1c" radius={[0, 4, 4, 0]} barSize={20}>
                          {chartData.map((entry, index) => (
                             <Cell key={`cell-${index}`} fill={index % 2 === 0 ? '#b91c1c' : '#ef4444'} />
                          ))}
                       </Bar>
                    </BarChart>
                 </ResponsiveContainer>
              </div>
           </div>
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-zinc-900 rounded border border-zinc-800 overflow-hidden">
         <div className="p-6 border-b border-zinc-800 flex justify-between items-center">
            <h3 className="text-lg font-bold text-white flex items-center">
               <Icons.List className="w-5 h-5 mr-2 text-zinc-500" /> Logs Recentes
            </h3>
            <Link to="/admin/logs" className="text-xs text-zinc-500 hover:text-white uppercase font-bold">
               Ver todos os logs
            </Link>
         </div>
         <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-800">
               <thead className="bg-zinc-950/50">
                  <tr>
                     <th className="px-6 py-3 text-left text-xs font-bold text-zinc-500 uppercase">Data/Hora</th>
                     <th className="px-6 py-3 text-left text-xs font-bold text-zinc-500 uppercase">Servidor</th>
                     <th className="px-6 py-3 text-left text-xs font-bold text-zinc-500 uppercase">Evento</th>
                     <th className="px-6 py-3 text-left text-xs font-bold text-zinc-500 uppercase">Detalhes</th>
                  </tr>
               </thead>
               <tbody className="divide-y divide-zinc-800 bg-zinc-900">
                  {logs.length === 0 ? (
                     <tr><td colSpan={4} className="px-6 py-8 text-center text-zinc-500 italic">Nenhum log recente encontrado.</td></tr>
                  ) : (
                     logs.map((log) => (
                        <tr key={log.id} className="hover:bg-zinc-800/50 transition-colors">
                           <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-400 font-mono">
                              {new Date(log.timestamp).toLocaleString()}
                           </td>
                           <td className="px-6 py-4 whitespace-nowrap text-sm text-zinc-300">
                              {log.serverId}
                           </td>
                           <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-white">
                              {log.type}
                           </td>
                           <td className="px-6 py-4 text-sm text-zinc-400 max-w-md truncate">
                              {log.rawText}
                           </td>
                        </tr>
                     ))
                  )}
               </tbody>
            </table>
         </div>
      </div>
    </div>
  );
};

export default PlayerProfile;

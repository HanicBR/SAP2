
import React, { useEffect, useState, memo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ApiService } from '../../services/api';
import { GameServer, ServerAnalytics } from '../../types';
import { Icons } from '../../components/Icon';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell
} from 'recharts';

// --- OPTIMIZED SUB-COMPONENTS ---

const KPICard = memo(({ title, value, subText, icon: Icon, colorClass }: { title: string, value: string, subText: string, icon: any, colorClass: string }) => (
  <div className="bg-zinc-900 p-6 rounded border border-zinc-800 relative overflow-hidden group">
      <div className="relative z-10">
        <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{title}</p>
        <p className={`text-4xl font-black mt-1 font-mono ${colorClass}`}>
            {value}
        </p>
        <p className="text-xs text-zinc-500 mt-2">{subText}</p>
      </div>
      <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:scale-110 transition-transform duration-500">
        <Icon className={`w-16 h-16 ${colorClass}`} />
      </div>
  </div>
));

const PlaytimeChart = memo(({ data }: { data: any[] }) => (
  <div className="bg-zinc-900 p-6 rounded border border-zinc-800">
      <h3 className="text-sm font-bold text-white uppercase mb-6 flex items-center">
        <Icons.BarChart className="w-4 h-4 mr-2 text-zinc-500" /> Volume de Horas Jogadas
      </h3>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
              <XAxis dataKey="date" stroke="#71717a" tick={{fontSize: 10}} />
              <YAxis stroke="#71717a" tick={{fontSize: 12}} />
              <Tooltip 
                  cursor={{fill: '#27272a'}}
                  contentStyle={{ backgroundColor: '#09090b', border: '1px solid #3f3f46', color: '#f4f4f5' }}
              />
              <Bar dataKey="hours" fill="#b91c1c" radius={[4, 4, 0, 0]}>
                  {data.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={index % 2 === 0 ? '#b91c1c' : '#991b1b'} />
                  ))}
              </Bar>
            </BarChart>
        </ResponsiveContainer>
      </div>
  </div>
));

const PlayerCountChart = memo(({ data }: { data: any[] }) => (
  <div className="bg-zinc-900 p-6 rounded border border-zinc-800">
      <h3 className="text-sm font-bold text-white uppercase mb-6 flex items-center">
        <Icons.Activity className="w-4 h-4 mr-2 text-zinc-500" /> Média de Jogadores Simultâneos
      </h3>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
              <XAxis dataKey="date" stroke="#71717a" tick={{fontSize: 10}} />
              <YAxis stroke="#71717a" tick={{fontSize: 12}} />
              <Tooltip 
                  contentStyle={{ backgroundColor: '#09090b', border: '1px solid #3f3f46', color: '#f4f4f5' }}
              />
              <Line type="monotone" dataKey="count" stroke="#06b6d4" strokeWidth={3} dot={{r: 4, fill: '#06b6d4'}} activeDot={{r: 6, stroke: '#fff'}} />
            </LineChart>
        </ResponsiveContainer>
      </div>
  </div>
));

const TopPlayersList = memo(({ players, range }: { players: any[], range: string }) => (
  <div className="bg-zinc-900 rounded border border-zinc-800 flex flex-col h-full">
    <div className="p-4 border-b border-zinc-800 bg-zinc-950/30">
        <h3 className="text-sm font-bold text-zinc-300 uppercase flex items-center">
          <Icons.Trophy className="w-4 h-4 mr-2 text-yellow-500" /> Top Jogadores ({range})
        </h3>
    </div>
    <div className="flex-1 overflow-y-auto p-2">
        {players.map((player, idx) => (
          <div key={player.steamId} className="flex items-center p-3 hover:bg-zinc-800/50 rounded transition-colors border-b border-zinc-800/50 last:border-0 group">
              <div className="flex-shrink-0 w-8 text-center font-black text-zinc-600 group-hover:text-white transition-colors">#{idx + 1}</div>
              <img src={player.avatarUrl} className="w-10 h-10 rounded-full bg-zinc-800 mx-3" alt="" />
              <div className="flex-1 min-w-0">
                <Link to={`/admin/players/${player.steamId}`} className="text-sm font-bold text-white hover:text-cyan-400 truncate block">
                    {player.name}
                </Link>
                <p className="text-xs text-zinc-500 font-mono">{player.steamId}</p>
              </div>
              <div className="text-right">
                <span className="block text-sm font-black text-zinc-200">{player.hours}h</span>
                <span className="text-[10px] text-zinc-500 uppercase font-bold">Jogado</span>
              </div>
          </div>
        ))}
    </div>
    <div className="p-4 border-t border-zinc-800 bg-zinc-950/30 text-center">
        <Link to="/admin/players" className="text-xs text-zinc-500 hover:text-white uppercase font-bold">Ver todos os jogadores</Link>
    </div>
  </div>
));

// --- MAIN PAGE COMPONENT ---

const ServerDetails: React.FC = () => {
  const { serverId } = useParams<{ serverId: string }>();
  const [server, setServer] = useState<GameServer | null>(null);
  const [analytics, setAnalytics] = useState<ServerAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<'24h' | '7d' | '30d'>('7d');

  useEffect(() => {
    const loadData = async () => {
      if (!serverId) return;
      setLoading(true);
      
      const serverData = await ApiService.getServerById(serverId);
      if (serverData) {
          setServer(serverData);
          const analyticsData = await ApiService.getServerAnalytics(serverId, range);
          setAnalytics(analyticsData);
      }
      setLoading(false);
    };
    loadData();
  }, [serverId, range]);

  if (loading) return <div className="p-8 text-zinc-500">Carregando detalhes do servidor...</div>;
  if (!server || !analytics) return <div className="p-8 text-zinc-500">Servidor não encontrado.</div>;

  return (
    <div className="space-y-8 animate-fade-in pb-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
           <Link to="/admin/servers" className="text-zinc-500 hover:text-white text-sm font-bold uppercase flex items-center mb-2">
              <Icons.ArrowLeft className="w-4 h-4 mr-1" /> Voltar para Lista
           </Link>
           <h1 className="text-3xl font-black text-white uppercase italic tracking-tight">{server.name}</h1>
           <div className="flex items-center gap-3 mt-2 text-sm text-zinc-400 font-mono">
              <span className="bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">{server.ip}:{server.port}</span>
              <span>{server.mode}</span>
           </div>
        </div>
        
        {/* Date Range Selector */}
        <div className="bg-zinc-900 p-1 rounded border border-zinc-800 flex">
           {['24h', '7d', '30d'].map((r) => (
              <button
                 key={r}
                 onClick={() => setRange(r as any)}
                 className={`px-4 py-2 rounded text-xs font-bold uppercase tracking-wider transition-all ${
                    range === r 
                       ? 'bg-zinc-100 text-zinc-900 shadow-sm' 
                       : 'text-zinc-500 hover:text-white hover:bg-zinc-800'
                 }`}
              >
                 {r === '24h' ? 'Últimas 24h' : r === '7d' ? '7 Dias' : '30 Dias'}
              </button>
           ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
         <KPICard 
            title="Tempo Total Jogado (Soma)" 
            value={`${analytics.totalPlayTimeHours.toLocaleString()}h`}
            subText="Horas jogadas por todos players neste período"
            icon={Icons.Clock}
            colorClass="text-white"
         />
         <KPICard 
            title="Novos Jogadores" 
            value={`+${analytics.newPlayers}`}
            subText="Jogadores que entraram pela primeira vez"
            icon={Icons.UserGroup}
            colorClass="text-green-500"
         />
         <KPICard 
            title="Pico de Jogadores" 
            value={`${analytics.peakPlayers} / ${server.maxPlayers}`}
            subText="Máximo simultâneo neste período"
            icon={Icons.Activity}
            colorClass="text-cyan-500"
         />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
         {/* Charts Column */}
         <div className="lg:col-span-2 space-y-8">
            <PlaytimeChart data={analytics.playTimeTrend} />
            <PlayerCountChart data={analytics.playerCountTrend} />
         </div>

         {/* Top Players List */}
         <TopPlayersList players={analytics.topPlayers} range={range} />
      </div>
    </div>
  );
};

export default ServerDetails;

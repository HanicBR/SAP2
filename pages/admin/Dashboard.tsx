import React, { useEffect, useState, memo } from 'react';
import { ApiService } from '../../services/api';
import { DailyStats, GameServer, ServerStatus, LiveActivityItem, FinancialStats, DashboardData } from '../../types';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend
} from 'recharts';
import { Icons } from '../../components/Icon';

const COLORS = ['#b91c1c', '#ea580c', '#eab308', '#0284c7', '#4b5563'];

// --- OPTIMIZED SUB-COMPONENTS ---

// 1. Tooltip moved outside to prevent recreation on render
const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-zinc-950 border border-zinc-800 p-3 rounded shadow-xl">
        <p className="font-bold text-white mb-1">{data.name}</p>
        <p className="text-sm text-zinc-400">
           {data.playCount} partidas 
           <span className="ml-1 text-xs font-bold text-zinc-600">({data.percentage}%)</span>
        </p>
      </div>
    );
  }
  return null;
};

// 2. Memoized Stat Cards to prevent re-render when charts update
const StatCard = memo(({ title, value, icon: Icon, colorClass, subValue, subLabel }: { title: string, value: string | number, icon: any, colorClass: string, subValue?: string, subLabel?: React.ReactNode }) => (
  <div className="bg-zinc-900 p-6 rounded border border-zinc-800 shadow-sm relative overflow-hidden group">
    <div className="flex items-center justify-between relative z-10">
      <div>
        <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{title}</p>
        <p className="text-3xl font-black text-white mt-1">{value}</p>
        {subLabel && <p className="text-xs mt-1">{subLabel}</p>}
      </div>
      <div className={`p-3 rounded-full border bg-opacity-10 ${colorClass.replace('text-', 'bg-').replace('text-', 'border-')} ${colorClass}`}>
         <Icon />
      </div>
    </div>
  </div>
));

// 3. Memoized Revenue Card
const RevenueCard = memo(({ revenueMonth, revenueToday }: { revenueMonth: number, revenueToday: number }) => (
  <div className="bg-gradient-to-br from-zinc-900 to-zinc-950 p-6 rounded border border-zinc-800 shadow-sm relative overflow-hidden group hover:border-green-900/50 transition-colors">
    <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
       <Icons.Activity className="w-16 h-16 text-green-500" />
    </div>
    <div className="flex items-center justify-between relative z-10">
      <div>
        <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Faturamento (Mês)</p>
        <p className="text-3xl font-black text-white mt-1 flex items-baseline gap-1">
           <span className="text-lg text-zinc-500">R$</span>
           {revenueMonth.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
        </p>
        <p className="text-xs text-green-500 font-bold mt-1">
           + R$ {revenueToday.toFixed(2)} hoje
        </p>
      </div>
      <div className="p-3 bg-green-500/10 rounded-full text-green-500 border border-green-500/20">
         <span className="text-xl font-bold">$</span>
      </div>
    </div>
  </div>
));

// 4. Memoized Charts Section
const ChartsSection = memo(({ chartData, mapStats, selectedMapMode, onMapModeChange }: { chartData: DailyStats[], mapStats: any, selectedMapMode: string, onMapModeChange: (mode: string) => void }) => (
  <div className="lg:col-span-2 space-y-6">
    {/* Player Activity Chart */}
    <div className="bg-zinc-900 p-6 rounded border border-zinc-800">
      <h3 className="text-lg font-bold text-white mb-6 flex items-center">
        <Icons.BarChart className="w-5 h-5 mr-2 text-zinc-500" /> Atividade de Jogadores (7 dias)
      </h3>
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
            <XAxis dataKey="date" stroke="#71717a" tick={{fontSize: 12}} />
            <YAxis stroke="#71717a" tick={{fontSize: 12}} />
            <Tooltip 
              contentStyle={{ backgroundColor: '#09090b', border: '1px solid #3f3f46', color: '#f4f4f5' }}
              itemStyle={{ color: '#e4e4e7' }}
            />
            <Line type="monotone" dataKey="players" stroke="#b91c1c" strokeWidth={3} dot={{r: 4, fill: '#b91c1c'}} activeDot={{r: 6, stroke: '#fff'}} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>

    {/* Map Distribution Chart */}
    <div className="bg-zinc-900 p-6 rounded border border-zinc-800">
       <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
         <h3 className="text-lg font-bold text-white flex items-center">
           <Icons.Box className="w-5 h-5 mr-2 text-zinc-500" /> Mapas Mais Jogados
         </h3>
         
         {/* Mode Selector Tabs */}
         <div className="flex bg-zinc-950 p-1 rounded border border-zinc-800">
           {Object.keys(mapStats).map(mode => (
             <button
               key={mode}
               onClick={() => onMapModeChange(mode)}
               className={`px-3 py-1 text-xs font-bold uppercase rounded transition-colors ${
                 selectedMapMode === mode 
                   ? 'bg-zinc-800 text-white shadow-sm' 
                   : 'text-zinc-500 hover:text-zinc-300'
               }`}
             >
               {mode}
             </button>
           ))}
         </div>
       </div>

       <div className="h-64 w-full flex flex-col sm:flex-row items-center justify-center">
          <ResponsiveContainer width="100%" height="100%">
             <PieChart>
                <Pie
                  data={mapStats[selectedMapMode] || []}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="playCount"
                >
                  {(mapStats[selectedMapMode] || []).map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="rgba(0,0,0,0)" />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend 
                   verticalAlign="middle" 
                   align="right"
                   layout="vertical" 
                   iconSize={10}
                   wrapperStyle={{ fontSize: '12px', color: '#a1a1aa' }}
                />
             </PieChart>
          </ResponsiveContainer>
       </div>
    </div>
  </div>
));

// 5. Memoized Server List
const ServerList = memo(({ servers }: { servers: GameServer[] }) => (
  <div className="bg-zinc-900 p-6 rounded border border-zinc-800">
    <h3 className="text-lg font-bold text-white mb-6 flex items-center">
      <Icons.Server className="w-5 h-5 mr-2 text-zinc-500" /> Status dos Servidores
    </h3>
    <div className="space-y-4">
      {servers.map(server => (
        <div key={server.id} className="p-4 bg-zinc-950/50 rounded border border-zinc-800 hover:border-zinc-700 transition-colors">
            <div className="flex justify-between items-start mb-2">
              <span className="font-bold text-zinc-200 truncate pr-2 text-sm" title={server.name}>{server.name}</span>
              <span className={`inline-block w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${server.status === ServerStatus.ONLINE ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-500'}`}></span>
            </div>
            <div className="flex justify-between items-end">
              <span className="text-xs text-zinc-500 uppercase font-bold tracking-wider">{server.mode}</span>
              <div className="text-right">
                <span className="text-xl font-bold text-white">{server.currentPlayers}</span>
                <span className="text-xs text-zinc-600">/{server.maxPlayers}</span>
              </div>
            </div>
            <div className="mt-2 w-full bg-zinc-800 h-1 rounded-full overflow-hidden">
              <div 
                  className={`h-full rounded-full transition-all duration-1000 ${server.currentPlayers > 0 ? 'bg-red-600' : 'bg-zinc-700'}`} 
                  style={{ width: `${(server.currentPlayers / server.maxPlayers) * 100}%` }}
              ></div>
            </div>
        </div>
      ))}
    </div>
  </div>
));

// 6. Memoized Activity Feed
const ActivityFeed = memo(({ activity }: { activity: LiveActivityItem[] }) => (
  <div className="bg-zinc-900 p-6 rounded border border-zinc-800 h-96 flex flex-col">
     <h3 className="text-lg font-bold text-white mb-4 flex items-center">
        <Icons.Activity className="w-5 h-5 mr-2 text-red-500 animate-pulse" /> Live Feed
     </h3>
     <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar">
        {activity.map((item) => (
           <div key={item.id} className="p-3 rounded bg-zinc-950/50 border border-zinc-800/50 text-sm hover:bg-zinc-950 transition-colors">
              <div className="flex justify-between items-center mb-1">
                 <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase ${
                    item.type === 'SUCCESS' ? 'bg-green-900/20 text-green-500 border-green-900/30' :
                    item.type === 'WARNING' ? 'bg-red-900/20 text-red-500 border-red-900/30' :
                    item.type === 'ERROR' ? 'bg-orange-900/20 text-orange-500 border-orange-900/30' :
                    'bg-blue-900/20 text-blue-500 border-blue-900/30'
                 }`}>
                    {item.serverName}
                 </span>
                 <span className="text-[10px] text-zinc-600 font-mono">
                    {new Date(item.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                 </span>
              </div>
              <p className="text-zinc-300 leading-snug">{item.message}</p>
           </div>
        ))}
     </div>
  </div>
));

// --- MAIN COMPONENT ---

const Dashboard: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [servers, setServers] = useState<GameServer[]>([]);
  const [loading, setLoading] = useState(true);
  
  // State for Map Stats Tabs
  const [selectedMapMode, setSelectedMapMode] = useState('TTT');

  useEffect(() => {
    Promise.all([
      ApiService.getDashboardStats(),
      ApiService.getServers()
    ]).then(([statsData, serversData]) => {
      setData(statsData);
      setServers(serversData);
      setLoading(false);
    });
  }, []);

  if (loading || !data) {
    return <div className="text-zinc-400 p-8">Carregando dashboard...</div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-white">Visão Geral</h1>
        <div className="text-sm text-zinc-400 bg-zinc-900 border border-zinc-800 px-3 py-1 rounded">
           Última atualização: <span className="text-white font-mono">{new Date().toLocaleTimeString()}</span>
        </div>
      </div>
      
      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <RevenueCard 
          revenueMonth={data.financialStats.revenueMonth} 
          revenueToday={data.financialStats.revenueToday} 
        />
        <StatCard 
          title="Jogadores (24h)" 
          value={data.uniquePlayers24h} 
          icon={Icons.Users} 
          colorClass="text-cyan-500" 
        />
        <StatCard 
          title="Total Conexões" 
          value={data.totalConnections} 
          icon={Icons.Activity} 
          colorClass="text-blue-500" 
        />
        <StatCard 
          title="Bans Ativos" 
          value={data.activeBans} 
          icon={Icons.Shield} 
          colorClass="text-red-500" 
        />
      </div>

      {/* Main Content Split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Charts */}
        <ChartsSection 
          chartData={data.chartData} 
          mapStats={data.mapStats} 
          selectedMapMode={selectedMapMode} 
          onMapModeChange={setSelectedMapMode}
        />

        {/* Right Column: Server Status & Live Feed */}
        <div className="space-y-6">
          <ServerList servers={servers} />
          <ActivityFeed activity={data.liveActivity} />
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
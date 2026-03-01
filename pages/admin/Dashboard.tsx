import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ApiService } from '../../services/api';
import { DashboardData, GameServer, ServerStatus, UserRole } from '../../types';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { Icons } from '../../components/Icon';
import { canViewDashboardFinancial } from '../../utils/adminAccess';

const MAP_COLORS = ['#ef4444', '#f97316', '#eab308', '#06b6d4', '#3b82f6', '#6b7280'];
const REFRESH_INTERVAL_MS = 20_000;

type FeedTone = 'INFO' | 'WARNING' | 'SUCCESS' | 'ERROR';

const toneClass = (tone: FeedTone) => {
  if (tone === 'SUCCESS') return 'text-green-400 border-green-900/40 bg-green-900/10';
  if (tone === 'WARNING') return 'text-amber-300 border-amber-900/40 bg-amber-900/10';
  if (tone === 'ERROR') return 'text-red-400 border-red-900/40 bg-red-900/10';
  return 'text-cyan-300 border-cyan-900/40 bg-cyan-900/10';
};

const statusClass = (status: ServerStatus) => {
  if (status === ServerStatus.ONLINE) return 'bg-green-900/20 text-green-400 border-green-900/30';
  if (status === ServerStatus.MAINTENANCE) return 'bg-yellow-900/20 text-yellow-300 border-yellow-900/30';
  return 'bg-red-900/20 text-red-400 border-red-900/30';
};

const statusLabel = (status: ServerStatus) => {
  if (status === ServerStatus.ONLINE) return 'online';
  if (status === ServerStatus.MAINTENANCE) return 'maintenance';
  return 'offline';
};

const StatCard = memo(
  ({
    title,
    value,
    icon: Icon,
    className,
    subtitle,
  }: {
    title: string;
    value: string | number;
    icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
    className: string;
    subtitle?: string;
  }) => (
    <div className="bg-zinc-900 border border-zinc-800 rounded p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-zinc-500 font-bold">{title}</p>
          <p className="text-2xl font-black text-white mt-1">{value}</p>
          {subtitle ? <p className="text-xs text-zinc-500 mt-1">{subtitle}</p> : null}
        </div>
        <div className={`p-2 rounded border ${className}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
    </div>
  ),
);

const ServerList = memo(({ servers }: { servers: GameServer[] }) => (
  <div className="bg-zinc-900 p-4 rounded border border-zinc-800">
    <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-300 mb-4 flex items-center gap-2">
      <Icons.Server className="w-4 h-4 text-zinc-500" />
      Servidores
    </h3>
    <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
      {servers.map((server) => (
        <div key={server.id} className="bg-zinc-950/70 border border-zinc-800 rounded p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-bold text-zinc-200 truncate" title={server.name}>
              {server.name}
            </span>
            <span className={`px-2 py-0.5 rounded text-[10px] uppercase border font-bold ${statusClass(server.status)}`}>
              {statusLabel(server.status)}
            </span>
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
            <span>{server.mode}</span>
            <span className="font-mono text-zinc-300">
              {server.currentPlayers}/{server.maxPlayers}
            </span>
          </div>
          <div className="mt-1 h-1.5 bg-zinc-800 rounded overflow-hidden">
            <div
              className="h-full bg-red-600"
              style={{ width: `${Math.min(100, (server.currentPlayers / Math.max(1, server.maxPlayers)) * 100)}%` }}
            />
          </div>
          {server.currentMap ? (
            <p className="mt-2 text-[11px] text-zinc-500 truncate">Mapa: {server.currentMap}</p>
          ) : null}
        </div>
      ))}
      {servers.length === 0 ? (
        <div className="text-xs text-zinc-500 italic">Nenhum servidor cadastrado.</div>
      ) : null}
    </div>
  </div>
));

const ActivityFeed = memo(({ items }: { items: DashboardData['liveActivity'] }) => (
  <div className="bg-zinc-900 p-4 rounded border border-zinc-800">
    <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-300 mb-4 flex items-center gap-2">
      <Icons.Activity className="w-4 h-4 text-red-500" />
      Feed Ao Vivo
    </h3>
    <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
      {items.map((item) => (
        <div key={item.id} className={`border rounded p-3 ${toneClass(item.type)}`}>
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[10px] uppercase tracking-wider font-bold">{item.serverName || 'Sistema'}</span>
            <span className="text-[10px] text-zinc-500 font-mono">
              {new Date(item.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <p className="text-xs text-zinc-300 leading-snug">{item.message}</p>
        </div>
      ))}
      {items.length === 0 ? (
        <div className="text-xs text-zinc-500 italic">Sem atividade recente.</div>
      ) : null}
    </div>
  </div>
));

const Dashboard: React.FC = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [servers, setServers] = useState<GameServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedMapMode, setSelectedMapMode] = useState('TTT');
  const [currentRole, setCurrentRole] = useState<UserRole | null>(null);

  const loadDashboard = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const [dashboard, serverList] = await Promise.all([
        ApiService.getDashboardStats(),
        ApiService.getServers(),
      ]);
      setData(dashboard);
      setServers(serverList);

      if (!dashboard.mapStats[selectedMapMode]) {
        const firstMode = Object.keys(dashboard.mapStats || {})[0];
        if (firstMode) setSelectedMapMode(firstMode);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [selectedMapMode]);

  useEffect(() => {
    const rawUser = localStorage.getItem('backstabber_user');
    if (!rawUser) {
      setCurrentRole(null);
      return;
    }
    try {
      const parsed = JSON.parse(rawUser) as { role?: UserRole };
      setCurrentRole(parsed.role || null);
    } catch {
      setCurrentRole(null);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
    const interval = window.setInterval(() => {
      void loadDashboard(true);
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [loadDashboard]);

  const sortedServers = useMemo(() => {
    return [...servers].sort((left, right) => {
      const leftOnline = left.status === ServerStatus.ONLINE ? 1 : 0;
      const rightOnline = right.status === ServerStatus.ONLINE ? 1 : 0;
      if (leftOnline !== rightOnline) return rightOnline - leftOnline;
      return String(left.name || '').localeCompare(String(right.name || ''));
    });
  }, [servers]);

  if (loading || !data) {
    return <div className="text-zinc-400 p-6">Carregando dashboard...</div>;
  }

  const mapModes = Object.keys(data.mapStats || {});
  const selectedMapData = data.mapStats[selectedMapMode] || [];
  const occupancyPct =
    data.opsHealth.maxPlayers > 0
      ? Math.round((data.opsHealth.currentPlayers / data.opsHealth.maxPlayers) * 100)
      : 0;
  const showFinancial = canViewDashboardFinancial(currentRole);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="text-sm text-zinc-500">
            Atualizado em {new Date(data.generatedAt).toLocaleString('pt-BR')}
          </p>
        </div>
        <button
          onClick={() => void loadDashboard()}
          className="inline-flex items-center gap-2 px-3 py-2 rounded border border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 text-xs font-bold uppercase tracking-wider"
          disabled={refreshing}
        >
          <Icons.RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <StatCard
          title="Servidores Online"
          value={`${data.opsHealth.onlineServers}/${data.opsHealth.totalServers}`}
          icon={Icons.Server}
          className="text-emerald-400 border-emerald-900/40 bg-emerald-900/10"
          subtitle={`${data.opsHealth.maintenanceServers} em manutenção`}
        />
        <StatCard
          title="Slots Ocupados"
          value={`${data.opsHealth.currentPlayers}/${data.opsHealth.maxPlayers}`}
          icon={Icons.Users}
          className="text-cyan-400 border-cyan-900/40 bg-cyan-900/10"
          subtitle={`${occupancyPct}% de ocupação`}
        />
        <StatCard
          title="WS Conectados"
          value={data.opsHealth.wsConnectedServers}
          icon={Icons.Activity}
          className="text-blue-400 border-blue-900/40 bg-blue-900/10"
          subtitle={`${data.opsHealth.wsLiveStateServers} com live-state`}
        />
        <StatCard
          title="Jogadores Únicos (24h)"
          value={data.uniquePlayers24h}
          icon={Icons.UserGroup}
          className="text-fuchsia-400 border-fuchsia-900/40 bg-fuchsia-900/10"
          subtitle={`${data.highlights.logs24h} logs nas últimas 24h`}
        />
        <StatCard
          title="Conexões (30d)"
          value={data.totalConnections}
          icon={Icons.Link2}
          className="text-amber-300 border-amber-900/40 bg-amber-900/10"
          subtitle={`${data.roundsPlayed} rounds encerradas`}
        />
        <StatCard
          title="Fila de Ações"
          value={data.opsHealth.actionQueueSize}
          icon={Icons.Terminal}
          className="text-zinc-300 border-zinc-700 bg-zinc-800/40"
          subtitle={`ACK errors WS: ${data.opsHealth.wsAckErrors}`}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-6">
          <div className="bg-zinc-900 p-4 rounded border border-zinc-800">
            <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-300 mb-4 flex items-center gap-2">
              <Icons.BarChart className="w-4 h-4 text-zinc-500" />
              Tendência (7 dias)
            </h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="date" stroke="#71717a" tick={{ fontSize: 12 }} />
                  <YAxis stroke="#71717a" tick={{ fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#09090b', border: '1px solid #3f3f46' }}
                    labelStyle={{ color: '#d4d4d8' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="players"
                    name="Jogadores únicos"
                    stroke="#06b6d4"
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="rounds"
                    name="Rounds"
                    stroke="#ef4444"
                    strokeWidth={2.2}
                    dot={{ r: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-zinc-900 p-4 rounded border border-zinc-800">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-300 flex items-center gap-2">
                <Icons.Map className="w-4 h-4 text-zinc-500" />
                Mapas Mais Jogados (30d)
              </h3>
              <div className="flex bg-zinc-950 border border-zinc-800 rounded p-1">
                {mapModes.map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setSelectedMapMode(mode)}
                    className={`px-2.5 py-1 text-[11px] font-bold uppercase rounded ${
                      selectedMapMode === mode
                        ? 'bg-zinc-800 text-zinc-100'
                        : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-64">
              {selectedMapData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={selectedMapData}
                      dataKey="playCount"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={58}
                      outerRadius={86}
                      paddingAngle={3}
                    >
                      {selectedMapData.map((_entry, idx) => (
                        <Cell key={`map-${idx}`} fill={MAP_COLORS[idx % MAP_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: any, _name: any, payload: any) => [
                        `${value} ciclos`,
                        payload?.payload?.name || 'Mapa',
                      ]}
                      contentStyle={{ backgroundColor: '#09090b', border: '1px solid #3f3f46' }}
                      itemStyle={{ color: '#e4e4e7' }}
                      labelStyle={{ color: '#d4d4d8' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-zinc-500 italic">
                  Sem dados de mapa para este modo.
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-zinc-900 p-4 rounded border border-zinc-800">
              <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-300 mb-3">
                Moderação (24h)
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-zinc-400">
                  <span>Punições aplicadas</span>
                  <span className="text-zinc-100 font-bold">{data.highlights.punishments24h}</span>
                </div>
                <div className="flex justify-between text-zinc-400">
                  <span>Punições desativadas</span>
                  <span className="text-zinc-100 font-bold">{data.highlights.deactivations24h}</span>
                </div>
                <div className="flex justify-between text-zinc-400">
                  <span>Bans ativas</span>
                  <span className="text-red-300 font-bold">{data.activeBans}</span>
                </div>
                <div className="flex justify-between text-zinc-400">
                  <span>Mutes ativas</span>
                  <span className="text-amber-200 font-bold">{data.highlights.activeMutes}</span>
                </div>
                <div className="flex justify-between text-zinc-400">
                  <span>Gags ativas</span>
                  <span className="text-amber-200 font-bold">{data.highlights.activeGags}</span>
                </div>
              </div>
            </div>

            <div className="bg-zinc-900 p-4 rounded border border-zinc-800">
              <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-300 mb-3">
                Top Eventos (24h)
              </h3>
              <div className="space-y-2">
                {data.highlights.topEventTypes24h.map((item) => (
                  <div key={item.type} className="flex items-center justify-between text-sm">
                    <span className="text-zinc-400">{item.type}</span>
                    <span className="text-zinc-100 font-bold">{item.count}</span>
                  </div>
                ))}
                {data.highlights.topEventTypes24h.length === 0 ? (
                  <div className="text-xs text-zinc-500 italic">Sem eventos no período.</div>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {showFinancial ? (
            <div className="bg-zinc-900 p-4 rounded border border-zinc-800">
              <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-300 mb-3 flex items-center gap-2">
                <Icons.DollarSign className="w-4 h-4 text-emerald-400" />
                Financeiro
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-zinc-400">
                  <span>Receita liquida hoje</span>
                  <span className="text-zinc-100 font-bold">
                    R$ {data.financialStats.revenueToday.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between text-zinc-400">
                  <span>Receita liquida mes</span>
                  <span className="text-zinc-100 font-bold">
                    R$ {data.financialStats.revenueMonth.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between text-zinc-400">
                  <span>Transacoes hoje</span>
                  <span className="text-zinc-100 font-bold">{data.financialStats.transactionsToday}</span>
                </div>
                <div className="flex justify-between text-zinc-400">
                  <span>Mensagens WS invalidas</span>
                  <span className="text-zinc-100 font-bold">{data.opsHealth.wsInvalidMessages}</span>
                </div>
              </div>
            </div>
          ) : null}

          <ServerList servers={sortedServers} />
          <ActivityFeed items={data.liveActivity} />
        </div>
      </div>
    </div>
  );
};

export default Dashboard;

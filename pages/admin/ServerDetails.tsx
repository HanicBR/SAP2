import React, { useCallback, useEffect, useMemo, useState, memo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ApiService } from '../../services/api';
import { GameServer, ServerAnalytics, ServerStatus } from '../../types';
import { Icons } from '../../components/Icon';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from 'recharts';

type RangeKey = '24h' | '7d' | '30d';

const KPICard = memo(
  ({
    title,
    value,
    subText,
    icon: Icon,
    colorClass,
  }: {
    title: string;
    value: string;
    subText: string;
    icon: any;
    colorClass: string;
  }) => (
    <div className="bg-zinc-900 p-6 rounded border border-zinc-800 relative overflow-hidden group">
      <div className="relative z-10">
        <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{title}</p>
        <p className={`text-4xl font-black mt-1 font-mono ${colorClass}`}>{value}</p>
        <p className="text-xs text-zinc-500 mt-2">{subText}</p>
      </div>
      <div className="absolute right-0 top-0 p-4 opacity-10 group-hover:scale-110 transition-transform duration-500">
        <Icon className={`w-16 h-16 ${colorClass}`} />
      </div>
    </div>
  ),
);

const PlaytimeChart = memo(({ data }: { data: { date: string; hours: number }[] }) => (
  <div className="bg-zinc-900 p-6 rounded border border-zinc-800">
    <h3 className="text-sm font-bold text-white uppercase mb-6 flex items-center">
      <Icons.BarChart className="w-4 h-4 mr-2 text-zinc-500" /> Horas Jogadas no Período
    </h3>
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
          <XAxis dataKey="date" stroke="#71717a" tick={{ fontSize: 10 }} />
          <YAxis stroke="#71717a" tick={{ fontSize: 12 }} />
          <Tooltip
            cursor={{ fill: '#27272a' }}
            formatter={(value: number) => [`${value}h`, 'Horas']}
            contentStyle={{ backgroundColor: '#09090b', border: '1px solid #3f3f46', color: '#f4f4f5' }}
          />
          <Bar dataKey="hours" fill="#b91c1c" radius={[4, 4, 0, 0]}>
            {data.map((entry, index) => (
              <Cell key={`${entry.date}_${index}`} fill={index % 2 === 0 ? '#b91c1c' : '#991b1b'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  </div>
));

const PlayerCountChart = memo(({ data }: { data: { date: string; count: number }[] }) => (
  <div className="bg-zinc-900 p-6 rounded border border-zinc-800">
    <h3 className="text-sm font-bold text-white uppercase mb-6 flex items-center">
      <Icons.Activity className="w-4 h-4 mr-2 text-zinc-500" /> Média de Jogadores Simultâneos
    </h3>
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
          <XAxis dataKey="date" stroke="#71717a" tick={{ fontSize: 10 }} />
          <YAxis stroke="#71717a" tick={{ fontSize: 12 }} />
          <Tooltip
            formatter={(value: number) => [`${value}`, 'Jogadores']}
            contentStyle={{ backgroundColor: '#09090b', border: '1px solid #3f3f46', color: '#f4f4f5' }}
          />
          <Line
            type="monotone"
            dataKey="count"
            stroke="#06b6d4"
            strokeWidth={3}
            dot={{ r: 3, fill: '#06b6d4' }}
            activeDot={{ r: 5, stroke: '#fff' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  </div>
));

const TopPlayersList = memo(({ players, range }: { players: ServerAnalytics['topPlayers']; range: RangeKey }) => (
  <div className="bg-zinc-900 rounded border border-zinc-800 flex flex-col h-full">
    <div className="p-4 border-b border-zinc-800 bg-zinc-950/30">
      <h3 className="text-sm font-bold text-zinc-300 uppercase flex items-center">
        <Icons.Trophy className="w-4 h-4 mr-2 text-yellow-500" /> Top Jogadores ({range})
      </h3>
    </div>
    <div className="flex-1 overflow-y-auto p-2">
      {!players.length && (
        <p className="text-zinc-500 text-sm p-3">Sem dados de jogadores nesse período.</p>
      )}
      {players.map((player, idx) => (
        <div
          key={player.steamId}
          className="flex items-center p-3 hover:bg-zinc-800/50 rounded transition-colors border-b border-zinc-800/50 last:border-0 group"
        >
          <div className="flex-shrink-0 w-8 text-center font-black text-zinc-600 group-hover:text-white transition-colors">
            #{idx + 1}
          </div>
          <img src={player.avatarUrl} className="w-10 h-10 rounded-full bg-zinc-800 mx-3" alt="" />
          <div className="flex-1 min-w-0">
            <Link to={`/admin/players/${player.steamId}`} className="text-sm font-bold text-white hover:text-cyan-400 truncate block">
              {player.name}
            </Link>
            <p className="text-xs text-zinc-500 font-mono">{player.steamId}</p>
          </div>
          <div className="text-right">
            <span className="block text-sm font-black text-zinc-200">{player.hours.toLocaleString('pt-BR')}h</span>
            <span className="text-[10px] text-zinc-500 uppercase font-bold">Jogado</span>
          </div>
        </div>
      ))}
    </div>
    <div className="p-4 border-t border-zinc-800 bg-zinc-950/30 text-center">
      <Link to="/admin/players" className="text-xs text-zinc-500 hover:text-white uppercase font-bold">
        Ver todos os jogadores
      </Link>
    </div>
  </div>
));

const statusText = (status: ServerStatus): string => {
  if (status === ServerStatus.ONLINE) return 'Online';
  if (status === ServerStatus.MAINTENANCE) return 'Manutenção';
  return 'Offline';
};

const statusClass = (status: ServerStatus): string => {
  if (status === ServerStatus.ONLINE) return 'bg-green-900/30 text-green-300 border-green-800';
  if (status === ServerStatus.MAINTENANCE) return 'bg-yellow-900/30 text-yellow-300 border-yellow-800';
  return 'bg-red-900/30 text-red-300 border-red-800';
};

const playtimeSourceLabel = (source?: 'legacy' | 'pulse') => {
  if (source === 'pulse') return 'Pulso';
  return 'Legado';
};

const playtimeDecisionLabel = (reason?: string) => {
  const normalized = String(reason || '').trim().toLowerCase();
  if (normalized === 'pulse_forced') return 'Modo pulse ativo';
  if (normalized === 'hybrid_coverage_ok') return 'Hibrido com cobertura suficiente';
  if (normalized === 'hybrid_coverage_below_threshold') return 'Hibrido com cobertura abaixo do minimo';
  if (normalized === 'hybrid_no_pulse_data') return 'Hibrido sem dados de pulso';
  if (normalized === 'pulse_no_data_fallback') return 'Pulse sem dados, usando legado';
  if (normalized === 'pulse_query_error_fallback') return 'Erro ao ler pulso, fallback legado';
  if (normalized === 'legacy_forced') return 'Modo legado ativo';
  return normalized ? normalized : 'Nao informado';
};

const ServerDetails: React.FC = () => {
  const { serverId } = useParams<{ serverId: string }>();
  const [server, setServer] = useState<GameServer | null>(null);
  const [analytics, setAnalytics] = useState<ServerAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [range, setRange] = useState<RangeKey>('7d');

  const loadData = useCallback(
    async (silent = false) => {
      if (!serverId) return;
      if (silent) setRefreshing(true);
      else setLoading(true);

      try {
        const [serverData, analyticsData] = await Promise.all([
          ApiService.getServerById(serverId),
          ApiService.getServerAnalytics(serverId, range),
        ]);
        if (serverData) setServer(serverData);
        setAnalytics(analyticsData);
      } finally {
        if (silent) setRefreshing(false);
        else setLoading(false);
      }
    },
    [serverId, range],
  );

  useEffect(() => {
    void loadData(false);
    const interval = window.setInterval(() => {
      void loadData(true);
    }, 20000);
    return () => window.clearInterval(interval);
  }, [loadData]);

  const currentState = useMemo(() => analytics?.currentState, [analytics]);
  const displayPlayers = currentState?.currentPlayers ?? server?.currentPlayers ?? 0;
  const displayMaxPlayers = currentState?.maxPlayers ?? server?.maxPlayers ?? 0;
  const displayMap = currentState?.currentMap || server?.currentMap || 'Desconhecido';
  const displayStatus = currentState?.status ?? server?.status ?? ServerStatus.OFFLINE;
  const displayLastHeartbeat = currentState?.lastHeartbeat || server?.lastHeartbeat;
  const playtimeDiagnostics = analytics.playtimeDiagnostics;
  const playtimeSource = playtimeSourceLabel(analytics.playtimeSource);
  const playtimeDecision = playtimeDecisionLabel(playtimeDiagnostics?.decisionReason);
  const pulseCoveragePct = Number(analytics.pulseCoveragePct || 0);
  const pulseVsLegacyHours = Number(playtimeDiagnostics?.diffHours || 0);
  const pulseVsLegacyPct = Number(playtimeDiagnostics?.diffPct || 0);

  if (loading) return <div className="p-8 text-zinc-500">Carregando detalhes do servidor...</div>;
  if (!server || !analytics) return <div className="p-8 text-zinc-500">Servidor não encontrado.</div>;

  return (
    <div className="space-y-8 animate-fade-in pb-10">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <Link to="/admin/servers" className="text-zinc-500 hover:text-white text-sm font-bold uppercase flex items-center mb-2">
            <Icons.ArrowLeft className="w-4 h-4 mr-1" /> Voltar para Lista
          </Link>
          <h1 className="text-3xl font-black text-white uppercase italic tracking-tight">{server.name}</h1>
          <div className="flex items-center gap-3 mt-2 text-sm text-zinc-400 font-mono flex-wrap">
            <span className="bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">{server.ip}:{server.port}</span>
            <span>{server.mode}</span>
            <span className={`px-2 py-0.5 rounded border text-xs font-bold uppercase ${statusClass(displayStatus)}`}>
              {statusText(displayStatus)}
            </span>
            {refreshing && <span className="text-zinc-500 text-xs">Atualizando...</span>}
          </div>
        </div>

        <div className="bg-zinc-900 p-1 rounded border border-zinc-800 flex">
          {(['24h', '7d', '30d'] as RangeKey[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-4 py-2 rounded text-xs font-bold uppercase tracking-wider transition-all ${
                range === r ? 'bg-zinc-100 text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-white hover:bg-zinc-800'
              }`}
            >
              {r === '24h' ? 'Últimas 24h' : r === '7d' ? '7 Dias' : '30 Dias'}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-zinc-900 rounded border border-zinc-800 p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-zinc-500 uppercase text-xs font-bold">Mapa Atual</p>
            <p className="text-white font-semibold">{displayMap}</p>
          </div>
          <div>
            <p className="text-zinc-500 uppercase text-xs font-bold">Slots</p>
            <p className="text-white font-semibold">{displayPlayers}/{displayMaxPlayers}</p>
          </div>
          <div>
            <p className="text-zinc-500 uppercase text-xs font-bold">Sessões</p>
            <p className="text-white font-semibold">{analytics.totalSessions.toLocaleString('pt-BR')}</p>
          </div>
          <div>
            <p className="text-zinc-500 uppercase text-xs font-bold">Último Sinal</p>
            <p className="text-white font-semibold">
              {displayLastHeartbeat ? new Date(displayLastHeartbeat).toLocaleString('pt-BR') : 'Sem heartbeat'}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-zinc-900 rounded border border-zinc-800 p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-zinc-500 uppercase text-xs font-bold">Fonte do Playtime</p>
            <p className="text-white font-semibold">{playtimeSource}</p>
          </div>
          <div>
            <p className="text-zinc-500 uppercase text-xs font-bold">Cobertura Pulse</p>
            <p className="text-white font-semibold">{pulseCoveragePct.toLocaleString('pt-BR')}%</p>
          </div>
          <div>
            <p className="text-zinc-500 uppercase text-xs font-bold">Comparativo Pulse x Legado</p>
            <p className="text-white font-semibold">
              {playtimeDiagnostics?.pulseHours === undefined
                ? 'Sem dados de pulse'
                : `${pulseVsLegacyHours.toLocaleString('pt-BR')}h (${pulseVsLegacyPct.toLocaleString('pt-BR')}%)`}
            </p>
          </div>
          <div>
            <p className="text-zinc-500 uppercase text-xs font-bold">Decisao da Fonte</p>
            <p className="text-white font-semibold">{playtimeDecision}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <KPICard
          title="Tempo Total Jogado"
          value={`${analytics.totalPlayTimeHours.toLocaleString('pt-BR')}h`}
          subText="Soma de horas jogadas por todos os players"
          icon={Icons.Clock}
          colorClass="text-white"
        />
        <KPICard
          title="Jogadores Únicos"
          value={(analytics.uniquePlayers ?? 0).toLocaleString('pt-BR')}
          subText="Contas únicas com atividade no período"
          icon={Icons.UserGroup}
          colorClass="text-cyan-400"
        />
        <KPICard
          title="Novos Jogadores"
          value={`+${analytics.newPlayers.toLocaleString('pt-BR')}`}
          subText="Primeiro CONNECT neste servidor durante o período"
          icon={Icons.Users}
          colorClass="text-green-500"
        />
        <KPICard
          title="Pico de Jogadores"
          value={`${analytics.peakPlayers.toLocaleString('pt-BR')} / ${displayMaxPlayers.toLocaleString('pt-BR')}`}
          subText="Maior simultâneo observado no período"
          icon={Icons.Activity}
          colorClass="text-yellow-500"
        />
        <KPICard
          title="Sessão Média"
          value={`${(analytics.avgSessionMinutes ?? 0).toLocaleString('pt-BR')} min`}
          subText="Média de duração das sessões fechadas/ativas"
          icon={Icons.Calendar}
          colorClass="text-purple-400"
        />
        <KPICard
          title="Sessão Mediana"
          value={`${(analytics.medianSessionMinutes ?? 0).toLocaleString('pt-BR')} min`}
          subText="Valor central para reduzir impacto de extremos"
          icon={Icons.BarChart}
          colorClass="text-red-400"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <PlaytimeChart data={analytics.playTimeTrend} />
          <PlayerCountChart data={analytics.playerCountTrend} />
        </div>
        <TopPlayersList players={analytics.topPlayers} range={range} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-zinc-900 rounded border border-zinc-800">
          <div className="p-4 border-b border-zinc-800 bg-zinc-950/30">
            <h3 className="text-sm font-bold text-zinc-300 uppercase flex items-center">
              <Icons.Map className="w-4 h-4 mr-2 text-zinc-500" /> Mapas Mais Jogados
            </h3>
          </div>
          <div className="p-3 space-y-2">
            {!analytics.topMaps?.length && <p className="text-zinc-500 text-sm">Sem dados de mapa no período.</p>}
            {analytics.topMaps?.map((item) => (
              <div key={item.name} className="flex items-center justify-between bg-zinc-950/40 border border-zinc-800 rounded px-3 py-2">
                <div>
                  <p className="text-white text-sm font-semibold">{item.name}</p>
                  <p className="text-zinc-500 text-xs">{item.count} ciclos detectados</p>
                </div>
                <span className="text-cyan-300 text-sm font-bold">{item.percentage.toLocaleString('pt-BR')}%</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-zinc-900 rounded border border-zinc-800">
          <div className="p-4 border-b border-zinc-800 bg-zinc-950/30">
            <h3 className="text-sm font-bold text-zinc-300 uppercase flex items-center">
              <Icons.List className="w-4 h-4 mr-2 text-zinc-500" /> Distribuição de Eventos
            </h3>
          </div>
          <div className="p-3 space-y-2">
            {!analytics.eventBreakdown?.length && <p className="text-zinc-500 text-sm">Sem eventos no período.</p>}
            {analytics.eventBreakdown?.slice(0, 8).map((item) => (
              <div key={item.type} className="flex items-center justify-between bg-zinc-950/40 border border-zinc-800 rounded px-3 py-2">
                <span className="text-zinc-200 text-sm font-mono">{item.type}</span>
                <span className="text-zinc-100 text-sm font-bold">{item.count.toLocaleString('pt-BR')}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ServerDetails;

import { DashboardData, ServerAnalytics } from '../domain';

const baseChartData = (): DashboardData['chartData'] => ([
  { date: 'D-6', players: 180, rounds: 320 },
  { date: 'D-5', players: 200, rounds: 350 },
  { date: 'D-4', players: 220, rounds: 370 },
  { date: 'D-3', players: 210, rounds: 360 },
  { date: 'D-2', players: 230, rounds: 390 },
  { date: 'D-1', players: 240, rounds: 400 },
  { date: 'Hoje', players: 260, rounds: 420 },
]);

export const dashboardData: DashboardData = {
  uniquePlayers24h: 1420,
  totalConnections: 3500,
  roundsPlayed: 450,
  activeBans: 12,
  chartData: baseChartData(),
  mapStats: {
    TTT: [
      { name: 'ttt_rooftops_2016', playCount: 150, percentage: 40 },
      { name: 'ttt_minecraft_b5', playCount: 85, percentage: 25 },
      { name: 'ttt_67thway_v3', playCount: 60, percentage: 15 },
      { name: 'Outros', playCount: 50, percentage: 20 },
    ],
    Murder: [
      { name: 'mu_resort', playCount: 64, percentage: 45 },
      { name: 'mu_clue', playCount: 40, percentage: 30 },
      { name: 'md_house', playCount: 30, percentage: 25 },
    ],
    Sandbox: [
      { name: 'gm_construct', playCount: 42, percentage: 60 },
      { name: 'gm_flatgrass', playCount: 28, percentage: 40 },
    ],
  },
  liveActivity: [
    { id: '1', message: 'Player "DarkKiller" comprou VIP Ouro (Mensal)', type: 'SUCCESS', timestamp: new Date().toISOString(), serverName: 'Web Store' },
    { id: '2', message: 'Servidor TTT #1 reiniciado automaticamente', type: 'INFO', timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString(), serverName: 'TTT #1' },
    { id: '3', message: 'Admin "Mod_Joao" baniu "Troll123" (Mass RDM)', type: 'WARNING', timestamp: new Date(Date.now() - 1000 * 60 * 15).toISOString(), serverName: 'TTT #1' },
    { id: '4', message: 'Novo recorde de players: 32/32', type: 'INFO', timestamp: new Date(Date.now() - 1000 * 60 * 45).toISOString(), serverName: 'Murder #1' },
    { id: '5', message: 'Erro de Lua detectado no hook "PlayerSpawn"', type: 'ERROR', timestamp: new Date(Date.now() - 1000 * 60 * 60).toISOString(), serverName: 'Sandbox #1' },
  ],
  financialStats: {
    revenueToday: 145.0,
    revenueMonth: 3250.0,
    transactionsToday: 4,
  },
};

const randomBetween = (min: number, max: number) => Math.round(Math.random() * (max - min) + min);

export type AnalyticsRange = '24h' | '7d' | '30d';

export const generateServerAnalytics = (range: AnalyticsRange): ServerAnalytics => {
  const points = range === '24h' ? 24 : range === '7d' ? 7 : 30;

  const playTimeTrend = Array.from({ length: points }).map((_, idx) => ({
    date: `P${idx + 1}`,
    hours: randomBetween(10, 60),
  }));

  const playerCountTrend = Array.from({ length: points }).map((_, idx) => ({
    date: `P${idx + 1}`,
    count: randomBetween(8, 32),
  }));

  return {
    totalPlayTimeHours: playTimeTrend.reduce((acc, cur) => acc + cur.hours, 0),
    totalSessions: randomBetween(200, 600),
    newPlayers: randomBetween(20, 80),
    peakPlayers: Math.max(...playerCountTrend.map(p => p.count)),
    playTimeTrend,
    playerCountTrend,
    topPlayers: [
      { steamId: 'STEAM_0:1:12345', name: 'TopFrag', avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=TopFrag', hours: randomBetween(20, 60) },
      { steamId: 'STEAM_0:1:54321', name: 'Support', avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Support', hours: randomBetween(15, 40) },
      { steamId: 'STEAM_0:1:99999', name: 'Newbie', avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Newbie', hours: randomBetween(10, 30) },
    ],
  };
};




import { GameMode, GameServer, ServerStatus, LogEntry, LogType, DailyStats, SuspiciousGroup, SuspicionLevel, Player, PunishmentType, ActivityHistoryItem, User, UserRole, Transaction, TransactionType, TransactionCategory, ServerAnalytics, SiteConfig } from './types';

export const APP_NAME = "Backstabber Brasil";

// --- DEFAULT SITE CONFIGURATION ---
export const DEFAULT_SITE_CONFIG: SiteConfig = {
  general: {
    siteName: "Backstabber",
    primaryColor: "#dc2626", // red-600
  },
  social: {
    discordUrl: "https://discord.gg/example",
    steamGroupUrl: "https://steamcommunity.com/groups/example",
  },
  home: {
    heroTitle: "Backstabber",
    heroTitleHighlight: "Brasil",
    // Broken down into colorable segments
    heroSubtitleSegments: [
        { text: "Não confie em ninguém. A melhor rede de ", color: "#a1a1aa" }, // Zinc-400
        { text: "TTT", color: "#ef4444" }, // Red-500
        { text: " e ", color: "#a1a1aa" },
        { text: "Murder", color: "#a855f7" }, // Purple-500
        { text: " do Brasil.", color: "#a1a1aa" },
    ],
    heroButtonText: "Entrar no Discord",
    heroBackgroundUrl: "https://picsum.photos/1920/1080?grayscale",
    feature1Title: "Anti-Cheat Robusto",
    feature1Desc: "Ambiente justo. Nossa staff e sistemas automáticos garantem que trapaceiros sejam banidos permanentemente.",
    feature2Title: "Sistema de Ranks",
    feature2Desc: "Suba de nível jogando. Desbloqueie skins, trails e itens cosméticos exclusivos na nossa loja Pointshop.",
    feature3Title: "Baixa Latência",
    feature3Desc: "Servidores hospedados no Brasil. Ping baixo e tickrate otimizado para garantir que seu tiro conte.",
  },
  vip: {
    promoTextPrefix: "Compre mais meses e pague",
    promoTextHighlight: "BEM",
    promoTextSuffix: "menos!",
    plans: [
        {
            id: 'vip_bronze',
            name: 'VIP Bronze',
            price: 10.00,
            color: '#ea580c', // Orange
            benefits: {
                [GameMode.TTT]: ['Tag [VIP] no chat', 'Slot reservado', 'Skin exclusiva básica', 'Pequeno bônus de points'],
                [GameMode.SANDBOX]: ['Tag [VIP] no chat', 'Slot reservado', 'Limite de props +20%', 'Skins extras'],
                [GameMode.MURDER]: ['Tag [VIP] no chat', 'Slot reservado', 'Skins exclusivas', 'Cor do nome']
            }
        },
        {
            id: 'vip_silver',
            name: 'VIP Prata',
            price: 15.00,
            color: '#94a3b8', // Zinc/Silver
            benefits: {
                [GameMode.TTT]: ['Tudo do Bronze', '2x Points', 'Comando !votemap', 'Destaque no Scoreboard'],
                [GameMode.SANDBOX]: ['Tudo do Bronze', 'Limite de props +50%', 'Ferramentas extras', 'Trails visuais'],
                [GameMode.MURDER]: ['Tudo do Bronze', 'Trails personalizados', 'Comando !votemap', 'Bônus de XP']
            }
        },
        {
            id: 'vip_gold',
            name: 'VIP Ouro',
            price: 20.00,
            color: '#eab308', // Yellow/Gold
            benefits: {
                [GameMode.TTT]: ['Tudo do Prata', 'Imunidade a VoteKick', 'Skins Raras', 'Trail personalizado', 'Join Message'],
                [GameMode.SANDBOX]: ['Tudo do Prata', 'Limite máximo seguro', 'Ferramentas avançadas', 'Destaque total'],
                [GameMode.MURDER]: ['Tudo do Prata', 'Skins Murderer/Bystander', 'Emotes (/dance)', 'Destaque visual']
            }
        }
    ]
  }
};

// Mock Servers
export const MOCK_SERVERS: GameServer[] = [
  {
    id: 'srv_ttt_01',
    name: 'Backstabber TTT #1 [PT-BR]',
    ip: '192.168.1.10',
    port: 27015,
    mode: GameMode.TTT,
    status: ServerStatus.ONLINE,
    currentPlayers: 24,
    maxPlayers: 32,
    apiKey: 'sk_live_ttt1_xyz123'
  },
  {
    id: 'srv_murder_01',
    name: 'Backstabber Murder - Mansion Only',
    ip: '192.168.1.11',
    port: 27016,
    mode: GameMode.MURDER,
    status: ServerStatus.ONLINE,
    currentPlayers: 12,
    maxPlayers: 24,
    apiKey: 'sk_live_murder1_abc456'
  },
  {
    id: 'srv_sandbox_01',
    name: 'Backstabber Sandbox Build/Fun',
    ip: '192.168.1.12',
    port: 27017,
    mode: GameMode.SANDBOX,
    status: ServerStatus.OFFLINE,
    currentPlayers: 0,
    maxPlayers: 64,
    apiKey: 'sk_live_sand1_dfg789'
  }
];

// Mock Users
export const MOCK_USERS: User[] = [
  {
    id: 'u_admin_std',
    username: 'admin',
    email: 'admin@backstabber.com',
    role: UserRole.SUPERADMIN,
    createdAt: new Date('2024-01-01').toISOString(),
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=admin_std'
  },
  {
    id: 'u_1',
    username: 'DonoSupremo',
    email: 'dono@backstabber.com',
    role: UserRole.SUPERADMIN,
    createdAt: new Date('2024-01-01').toISOString(),
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Dono'
  },
  {
    id: 'u_2',
    username: 'AdminGeral',
    email: 'admin@backstabber.com',
    role: UserRole.ADMIN,
    createdAt: new Date('2024-02-15').toISOString(),
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Admin'
  },
  {
    id: 'u_3',
    username: 'JogadorComum',
    email: 'player@gmail.com',
    role: UserRole.USER,
    createdAt: new Date('2024-05-20').toISOString(),
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=Player'
  }
];

// Mock VIP Plans - REMOVED, now in Config
export const VIP_PLANS: any[] = []; 

// Dynamic Benefits Mapping - REMOVED, now in Config
export const VIP_BENEFITS_BY_MODE: Record<GameMode, Record<string, string[]>> = {
  [GameMode.TTT]: {},
  [GameMode.SANDBOX]: {},
  [GameMode.MURDER]: {}
};

// --- MOCK TRANSACTIONS ---

export const MOCK_TRANSACTIONS: Transaction[] = [
  {
    id: 'tx_1',
    date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 1).toISOString(),
    amount: 145.00,
    type: TransactionType.EXPENSE,
    category: TransactionCategory.SERVER_HOSTING,
    description: 'Pagamento Mensal Dedicado OVH',
    proofUrl: 'https://fakeimg.pl/300x400/202020/eae0d0/?text=Recibo+OVH',
    createdBy: 'u_1'
  },
  {
    id: 'tx_2',
    date: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    amount: 20.00,
    type: TransactionType.INCOME,
    category: TransactionCategory.VIP_SALE,
    description: 'Venda VIP Ouro - Mensal',
    relatedSteamId: 'STEAM_0:1:55443322',
    relatedPlayerName: 'TrollMaster69',
    vipPlan: 'VIP Ouro',
    vipDurationDays: 30,
    proofUrl: 'https://fakeimg.pl/300x400/202020/eae0d0/?text=Comprovante+PIX',
    createdBy: 'u_admin'
  },
  {
    id: 'tx_3',
    date: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
    amount: 60.00,
    type: TransactionType.INCOME,
    category: TransactionCategory.VIP_SALE,
    description: 'Venda VIP Ultimate - Mensal',
    relatedSteamId: 'STEAM_0:0:55667788',
    relatedPlayerName: 'NoobSlayer',
    vipPlan: 'VIP Ultimate',
    vipDurationDays: 30,
    createdBy: 'u_1'
  },
  {
    id: 'tx_4',
    date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5).toISOString(),
    amount: 50.00,
    type: TransactionType.EXPENSE,
    category: TransactionCategory.DEV_PLUGIN,
    description: 'Compra Addon TTT Traitor Tester',
    proofUrl: 'https://fakeimg.pl/300x400/202020/eae0d0/?text=GmodStore',
    createdBy: 'u_1'
  }
];

// --- MOCK COMPLEX LOGS ---

const generateTTTRound = (roundId: string, startTime: number): LogEntry[] => {
  const events: LogEntry[] = [];
  let t = startTime;

  // Round Start
  events.push({
    id: `log_${t}`, serverId: 'srv_ttt_01', gameMode: GameMode.TTT, type: LogType.ROUND_START, timestamp: new Date(t).toISOString(), rawText: 'Round proper has begun...',
    metadata: { roundId }
  });
  t += 5000;

  // Traitor Buy
  events.push({
    id: `log_${t}`, serverId: 'srv_ttt_01', gameMode: GameMode.TTT, type: LogType.GAME_EVENT, timestamp: new Date(t).toISOString(), steamId: 'STEAM_0:1:666', playerName: 'EvilTraitor', rawText: 'EvilTraitor bought a C4',
    metadata: { roundId, attackerName: 'EvilTraitor', attackerRole: 'traitor', command: 'buy_equipment', args: ['weapon_ttt_c4'] }
  });
  t += 15000;

  // RDM Event (Inno kills Inno)
  events.push({
    id: `log_${t}`, serverId: 'srv_ttt_01', gameMode: GameMode.TTT, type: LogType.DAMAGE, timestamp: new Date(t).toISOString(), steamId: 'STEAM_0:1:123', playerName: 'NoobInno', rawText: 'NoobInno damaged GoodInno for 45 dmg',
    metadata: { roundId, attackerName: 'NoobInno', attackerSteamId: 'STEAM_0:1:123', attackerRole: 'innocent', victimName: 'GoodInno', victimRole: 'innocent', weapon: 'weapon_zm_mac10', damage: 45 }
  });
  t += 500;
  events.push({
    id: `log_${t}`, serverId: 'srv_ttt_01', gameMode: GameMode.TTT, type: LogType.KILL, timestamp: new Date(t).toISOString(), steamId: 'STEAM_0:1:123', playerName: 'NoobInno', rawText: 'NoobInno killed GoodInno',
    metadata: { roundId, attackerName: 'NoobInno', attackerSteamId: 'STEAM_0:1:123', attackerRole: 'innocent', victimName: 'GoodInno', victimRole: 'innocent', weapon: 'weapon_zm_mac10' }
  });
  t += 2000;
  
  // Chat Reaction
  events.push({
    id: `log_${t}`, serverId: 'srv_ttt_01', gameMode: GameMode.TTT, type: LogType.CHAT, timestamp: new Date(t).toISOString(), steamId: 'STEAM_0:1:999', playerName: 'Witness', rawText: 'RDM RDM RDM!!!',
    metadata: { roundId, message: 'RDM RDM RDM!!!' }
  });
  t += 10000;

  // Traitor Kill
  events.push({
    id: `log_${t}`, serverId: 'srv_ttt_01', gameMode: GameMode.TTT, type: LogType.KILL, timestamp: new Date(t).toISOString(), steamId: 'STEAM_0:1:666', playerName: 'EvilTraitor', rawText: 'EvilTraitor killed DetectiveJoe',
    metadata: { roundId, attackerName: 'EvilTraitor', attackerRole: 'traitor', victimName: 'DetectiveJoe', victimRole: 'detective', weapon: 'weapon_ttt_knife' }
  });
  t += 30000;

  // Round End
  events.push({
    id: `log_${t}`, serverId: 'srv_ttt_01', gameMode: GameMode.TTT, type: LogType.ROUND_END, timestamp: new Date(t).toISOString(), rawText: 'Round ended. Traitors win.',
    metadata: { roundId, winner: 'traitor', durationSeconds: (t - startTime) / 1000 }
  });

  return events;
};

const generateSandboxSpam = (sessionId: string, startTime: number): LogEntry[] => {
  const events: LogEntry[] = [];
  let t = startTime;

  // Connect
  events.push({
    id: `log_${t}`, serverId: 'srv_sandbox_01', gameMode: GameMode.SANDBOX, type: LogType.CONNECT, timestamp: new Date(t).toISOString(), steamId: 'STEAM_0:0:555', playerName: 'PropSpammer', rawText: 'PropSpammer connected.',
    metadata: { ip: '187.20.20.20' }
  });
  t += 5000;

  // Spam 20 props
  for (let i = 0; i < 20; i++) {
    t += 200; // Fast spawn
    events.push({
      id: `log_${t}_${i}`, serverId: 'srv_sandbox_01', gameMode: GameMode.SANDBOX, type: LogType.PROP_SPAWN, timestamp: new Date(t).toISOString(), steamId: 'STEAM_0:0:555', playerName: 'PropSpammer', rawText: 'PropSpammer spawned models/props_c17/oildrum001.mdl',
      metadata: { propModel: 'models/props_c17/oildrum001.mdl' }
    });
  }
  
  t += 2000;
  // Admin Action
  events.push({
    id: `log_${t}`, serverId: 'srv_sandbox_01', gameMode: GameMode.SANDBOX, type: LogType.ULX, timestamp: new Date(t).toISOString(), steamId: 'STEAM_0:0:111', playerName: 'AdminUser', rawText: 'AdminUser used command !cleanup PropSpammer',
    metadata: { command: '!cleanup', args: ['PropSpammer'], attackerName: 'AdminUser' }
  });

  return events;
};

const now = Date.now();
// Combine all scenarios
export const MOCK_LOGS: LogEntry[] = [
  ...generateTTTRound('rnd_1', now - 1000 * 60 * 10),
  ...generateSandboxSpam('sess_1', now - 1000 * 60 * 5),
  ...generateTTTRound('rnd_2', now - 1000 * 60 * 2)
].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()); // Newest first

// Export MOCK_EVENTS as generic ServerEvents for compatibility with older components if needed, though we should transition to LogEntry
export const MOCK_EVENTS = MOCK_LOGS as any;

// Mock Stats for Chart
export const MOCK_STATS: DailyStats[] = [
  { date: 'Seg', players: 45, rounds: 120 },
  { date: 'Ter', players: 52, rounds: 135 },
  { date: 'Qua', players: 49, rounds: 110 },
  { date: 'Qui', players: 65, rounds: 160 },
  { date: 'Sex', players: 85, rounds: 240 },
  { date: 'Sab', players: 120, rounds: 300 },
  { date: 'Dom', players: 110, rounds: 280 },
];

// Helper to generate activity history
const generateActivityHistory = (): ActivityHistoryItem[] => {
  return Array.from({ length: 14 }).map((_, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (13 - i));
    return {
      date: date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      hoursPlayed: parseFloat((Math.random() * 5).toFixed(1)),
      sessions: Math.floor(Math.random() * 4)
    };
  });
};

const getRankFromPoints = (points: number): string => {
  if (points > 10000) return 'Global Elite';
  if (points > 7000) return 'Lenda';
  if (points > 5000) return 'Mestre';
  if (points > 3000) return 'Diamante';
  if (points > 1500) return 'Platina';
  if (points > 800) return 'Ouro';
  if (points > 300) return 'Prata';
  return 'Bronze';
};

// MOCK PLAYERS LIST
export const MOCK_PLAYERS: Player[] = Array.from({ length: 20 }).map((_, i) => {
  const tttPoints = Math.floor(Math.random() * 12000);
  
  return {
    steamId: `STEAM_0:1:${55443322 + i}`,
    name: i === 0 ? 'TrollMaster69' : i === 1 ? 'LittleTimmy_BR' : `Player_Generic_${i}`,
    avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${55443322 + i}&backgroundColor=b6e3f4`,
    lastSeen: new Date(Date.now() - Math.random() * 86400000 * 10).toISOString(),
    firstSeen: new Date(Date.now() - Math.random() * 86400000 * 365).toISOString(),
    totalConnections: Math.floor(Math.random() * 200) + 1,
    playTimeHours: Math.floor(Math.random() * 500),
    isVip: i % 4 === 0,
    vipPlan: i % 4 === 0 ? (i % 3 === 0 ? 'Ouro' : i % 2 === 0 ? 'Prata' : 'Bronze') : undefined,
    vipExpiry: i % 4 === 0 ? new Date(Date.now() + Math.random() * 86400000 * 30).toISOString() : undefined,
    ip: i < 2 ? '189.23.102.45' : `192.168.1.${i + 50}`, // Match duplicate mock for first 2
    geo: { country: 'BR', city: i < 2 ? 'São Paulo' : 'Rio de Janeiro', state: i < 2 ? 'SP' : 'RJ' },
    serverStats: {
      'srv_ttt_01': { playTimeHours: Math.floor(Math.random() * 100), connections: Math.floor(Math.random() * 50) },
      'srv_murder_01': { playTimeHours: Math.floor(Math.random() * 50), connections: Math.floor(Math.random() * 20) },
    },
    punishments: i === 0 ? [
      { id: 'p1', type: PunishmentType.BAN, reason: 'RDM em Massa', staffName: 'AdminUser', date: new Date(Date.now() - 86400000 * 20).toISOString(), duration: '3 dias', active: false },
      { id: 'p2', type: PunishmentType.MUTE, reason: 'Mic spam / gritaria', staffName: 'Mod_João', date: new Date(Date.now() - 86400000 * 5).toISOString(), duration: '1 hora', active: false },
      { id: 'p3', type: PunishmentType.WARN, reason: 'Ghosting', staffName: 'AdminUser', date: new Date(Date.now() - 86400000 * 2).toISOString(), active: true },
    ] : i === 1 ? [
      { id: 'p4', type: PunishmentType.KICK, reason: 'AFK', staffName: 'System', date: new Date().toISOString(), active: false }
    ] : [],
    notes: i === 0 ? [
      { id: 'n1', content: 'Jogador problemático, ficar de olho quando entrar no TTT.', staffName: 'AdminUser', date: new Date(Date.now() - 86400000 * 30).toISOString() },
      { id: 'n2', content: 'Alega que é primo do dono.', staffName: 'Mod_João', date: new Date(Date.now() - 86400000 * 10).toISOString() }
    ] : [],
    // --- NEW STATS MOCK ---
    gameModeStats: {
      ttt: {
        roundsPlayed: 150 + Math.floor(Math.random() * 500),
        roundsWon: 50 + Math.floor(Math.random() * 200),
        traitorRounds: 30 + Math.floor(Math.random() * 100),
        traitorWins: 10 + Math.floor(Math.random() * 50),
        detectiveRounds: 15 + Math.floor(Math.random() * 50),
        detectiveWins: 8 + Math.floor(Math.random() * 30),
        innocentRounds: 100 + Math.floor(Math.random() * 300),
        innocentWins: 30 + Math.floor(Math.random() * 100),
        kills: 200 + Math.floor(Math.random() * 500),
        deaths: 150 + Math.floor(Math.random() * 400),
        points: tttPoints,
        rank: getRankFromPoints(tttPoints)
      },
      murder: i % 2 === 0 ? {
         roundsPlayed: 50 + Math.floor(Math.random() * 200),
         murdererRounds: 10 + Math.floor(Math.random() * 30),
         murdererWins: 5 + Math.floor(Math.random() * 20),
         bystanderWins: 20 + Math.floor(Math.random() * 50)
      } : undefined,
      sandbox: i % 3 === 0 ? {
        totalPlayTimeHours: 10 + Math.floor(Math.random() * 50),
        totalSessions: 5 + Math.floor(Math.random() * 20),
        propsSpawned: 500 + Math.floor(Math.random() * 2000)
      } : undefined
    },
    activityHistory: generateActivityHistory()
  };
});

// Mock Suspicious Groups
export const MOCK_SUSPICIOUS_GROUPS: SuspiciousGroup[] = [
  {
    id: 'sus_01',
    level: SuspicionLevel.HIGH,
    commonIpOrSubnet: '189.23.102.45',
    location: 'São Paulo, SP - BR',
    lastActivity: new Date().toISOString(),
    players: [
      MOCK_PLAYERS[0],
      MOCK_PLAYERS[1]
    ]
  },
  {
    id: 'sus_02',
    level: SuspicionLevel.MODERATE,
    commonIpOrSubnet: '200.10.55.0/24',
    location: 'Rio de Janeiro, RJ - BR',
    lastActivity: new Date(Date.now() - 86400000).toISOString(),
    players: [
      {
        ...MOCK_PLAYERS[2],
        steamId: 'STEAM_0:1:11223344',
        name: 'DarkKiller',
        ip: '200.10.55.12',
        geo: { country: 'BR', city: 'Rio de Janeiro', state: 'RJ', lat: -22.906847, lng: -43.172900 }
      },
      {
        ...MOCK_PLAYERS[3],
        steamId: 'STEAM_0:0:55667788',
        name: 'NoobSlayer',
        ip: '200.10.55.99',
        geo: { country: 'BR', city: 'Rio de Janeiro', state: 'RJ', lat: -22.907800, lng: -43.173900 }
      }
    ]
  }
];

// Helper for server stats generation
export const generateServerAnalytics = (days: number): ServerAnalytics => {
  const dates = Array.from({ length: days }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1 - i));
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  });

  return {
    totalPlayTimeHours: Math.floor(Math.random() * 5000),
    totalSessions: Math.floor(Math.random() * 1000),
    newPlayers: Math.floor(Math.random() * 200),
    peakPlayers: Math.floor(Math.random() * 32) + 10,
    
    playTimeTrend: dates.map(date => ({
      date,
      hours: Math.floor(Math.random() * 100) + 20
    })),
    
    playerCountTrend: dates.map(date => ({
      date,
      count: Math.floor(Math.random() * 30) + 5
    })),
    
    topPlayers: MOCK_PLAYERS.slice(0, 5).map(p => ({
      steamId: p.steamId,
      name: p.name,
      avatarUrl: p.avatarUrl || '',
      hours: Math.floor(Math.random() * 500)
    })).sort((a,b) => b.hours - a.hours)
  };
};
import bcrypt from 'bcryptjs';
import { prisma } from './db/client';
import { GameMode, ServerStatus, UserRole } from './domain';
import { hashApiKey } from './utils/apiKey';

const toPrismaMode = (mode: GameMode) =>
  mode === GameMode.SANDBOX ? 'SANDBOX' : mode === GameMode.MURDER ? 'MURDER' : 'TTT';

const toPrismaStatus = (status: ServerStatus) =>
  status === ServerStatus.ONLINE
    ? 'ONLINE'
    : status === ServerStatus.MAINTENANCE
    ? 'MAINTENANCE'
    : 'OFFLINE';

// Default site config (mirrors the previous in-memory config)
const defaultSiteConfig = {
  general: {
    siteName: 'Backstabber',
    primaryColor: '#dc2626',
  },
  social: {
    discordUrl: 'https://discord.gg/example',
    steamGroupUrl: 'https://steamcommunity.com/groups/example',
  },
  home: {
    heroTitle: 'Backstabber',
    heroTitleHighlight: 'Brasil',
    heroSubtitleSegments: [
      { text: 'Não confie em ninguém. A melhor rede de ', color: '#a1a1aa' },
      { text: 'TTT', color: '#ef4444' },
      { text: ' e ', color: '#a1a1aa' },
      { text: 'Murder', color: '#a855f7' },
      { text: ' do Brasil.', color: '#a1a1aa' },
    ],
    heroButtonText: 'Entrar no Discord',
    heroBackgroundUrl: 'https://picsum.photos/1920/1080?grayscale',
    feature1Title: 'Anti-Cheat Robusto',
    feature1Desc:
      'Ambiente justo. Nossa staff e sistemas automáticos garantem que trapaceiros sejam banidos permanentemente.',
    feature2Title: 'Sistema de Ranks',
    feature2Desc:
      'Suba de nível jogando. Desbloqueie skins, trails e itens cosméticos exclusivos na nossa loja Pointshop.',
    feature3Title: 'Baixa Latência',
    feature3Desc:
      'Servidores hospedados no Brasil. Ping baixo e tickrate otimizado para garantir que seu tiro conte.',
  },
  vip: {
    promoTextPrefix: 'Compre mais meses e pague',
    promoTextHighlight: 'BEM',
    promoTextSuffix: 'menos!',
    plans: [
      {
        id: 'vip_bronze',
        name: 'VIP Bronze',
        price: 10,
        color: '#ea580c',
        benefits: {
          TTT: ['Tag [VIP] no chat', 'Slot reservado', 'Skin exclusiva básica', 'Pequeno bônus de points'],
          Sandbox: ['Tag [VIP] no chat', 'Slot reservado', 'Limite de props +20%', 'Skins extras'],
          Murder: ['Tag [VIP] no chat', 'Slot reservado', 'Skins exclusivas', 'Cor do nome'],
        },
      },
      {
        id: 'vip_silver',
        name: 'VIP Prata',
        price: 15,
        color: '#94a3b8',
        benefits: {
          TTT: ['Tudo do Bronze', '2x Points', 'Comando !votemap', 'Destaque no Scoreboard'],
          Sandbox: ['Tudo do Bronze', 'Limite de props +50%', 'Ferramentas extras', 'Trails visuais'],
          Murder: ['Tudo do Bronze', 'Trails personalizados', 'Comando !votemap', 'Bônus de XP'],
        },
      },
      {
        id: 'vip_gold',
        name: 'VIP Ouro',
        price: 20,
        color: '#eab308',
        benefits: {
          TTT: ['Tudo do Prata', 'Imunidade a VoteKick', 'Skins Raras', 'Trail personalizado', 'Join Message'],
          Sandbox: ['Tudo do Prata', 'Limite máximo seguro', 'Ferramentas avançadas', 'Destaque total'],
          Murder: ['Tudo do Prata', 'Skins Murderer/Bystander', 'Emotes (/dance)', 'Destaque visual'],
        },
      },
    ],
  },
  logs: {
    ignoredTools: [],
    ignoredCommands: [],
    rawTextFilters: [],
  },
};

const defaultServers = [
  {
    id: 'srv_ttt_01',
    name: 'Backstabber TTT #1 [PT-BR]',
    ip: '192.168.1.10',
    port: 27015,
    mode: GameMode.TTT,
    status: ServerStatus.ONLINE,
    currentPlayers: 24,
    maxPlayers: 32,
    apiKey: 'sk_live_ttt1_xyz123',
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
    apiKey: 'sk_live_murder1_abc456',
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
    apiKey: 'sk_live_sand1_dfg789',
  },
];

const defaultPlayers = [
  {
    steamId: 'STEAM_0:1:12345678',
    name: 'DarkKiller',
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=DarkKiller',
    lastSeen: new Date(),
    firstSeen: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30),
    totalConnections: 42,
    playTimeHours: 120,
    isVip: true,
    vipPlan: 'VIP Ouro',
    vipExpiry: new Date(Date.now() + 1000 * 60 * 60 * 24 * 15),
    serverStats: {
      srv_ttt_01: { playTimeHours: 80, connections: 30 },
      srv_murder_01: { playTimeHours: 40, connections: 12 },
    },
  },
  {
    steamId: 'STEAM_0:1:87654321',
    name: 'TrollMaster',
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=TrollMaster',
    lastSeen: new Date(),
    firstSeen: new Date(Date.now() - 1000 * 60 * 60 * 24 * 15),
    totalConnections: 20,
    playTimeHours: 45,
    isVip: false,
    serverStats: {
      srv_ttt_01: { playTimeHours: 30, connections: 15 },
    },
  },
];

const defaultLogs = [
  {
    serverId: 'srv_ttt_01',
    gameMode: GameMode.TTT,
    type: 'CONNECT',
    timestamp: new Date(),
    steamId: 'STEAM_0:1:12345678',
    playerName: 'DarkKiller',
    rawText: 'DarkKiller entrou no servidor',
    metadata: { message: 'Player connected' },
  },
  {
    serverId: 'srv_ttt_01',
    gameMode: GameMode.TTT,
    type: 'CHAT',
    timestamp: new Date(Date.now() - 1000 * 60 * 5),
    steamId: 'STEAM_0:1:87654321',
    playerName: 'TrollMaster',
    rawText: 'TrollMaster: RDM?',
    metadata: { message: 'RDM?' },
  },
  {
    serverId: 'srv_ttt_01',
    gameMode: GameMode.TTT,
    type: 'KILL',
    timestamp: new Date(Date.now() - 1000 * 60 * 10),
    steamId: 'STEAM_0:1:12345678',
    playerName: 'DarkKiller',
    rawText: 'DarkKiller killed InnocentJoe',
    metadata: {
      attackerName: 'DarkKiller',
      attackerSteamId: 'STEAM_0:1:12345678',
      attackerRole: 'traitor',
      victimName: 'InnocentJoe',
      victimRole: 'innocent',
      weapon: 'weapon_ttt_ak47',
    },
  },
];

export async function bootstrap() {
  // Seed admin/staff if missing
  const usersCount = await prisma.user.count();
  if (usersCount === 0) {
    const adminHash = bcrypt.hashSync('admin', 10);
    const staffHash = bcrypt.hashSync('staff', 10);
    await prisma.user.createMany({
      data: [
        {
          username: 'admin',
          email: 'admin@backstabber.com',
          passwordHash: adminHash,
          role: UserRole.SUPERADMIN,
          avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=admin_std',
        },
        {
          username: 'staff',
          email: 'staff@backstabber.com',
          passwordHash: staffHash,
          role: UserRole.ADMIN,
          avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=staff',
        },
      ],
    });
    console.log('[bootstrap] Seeded default users (admin/staff).');
  }

  // Seed site config if missing
  const siteConfig = await prisma.siteConfig.findUnique({ where: { id: 1 } });
  if (!siteConfig) {
    await prisma.siteConfig.create({
      data: {
        id: 1,
        data: defaultSiteConfig as any,
      },
    });
    console.log('[bootstrap] Seeded default site config.');
  }

  // Seed servers if missing
  const serversCount = await prisma.gameServer.count();
  if (serversCount === 0) {
    await prisma.gameServer.createMany({
      data: defaultServers.map((srv) => ({
        id: srv.id,
        name: srv.name,
        ip: srv.ip,
        port: srv.port,
        mode: toPrismaMode(srv.mode) as any,
        status: toPrismaStatus(srv.status) as any,
        currentPlayers: srv.currentPlayers,
        maxPlayers: srv.maxPlayers,
        apiKeyHash: srv.apiKey ? hashApiKey(srv.apiKey) : null,
      })),
    });
    console.log('[bootstrap] Seeded default servers. Use regenerate key to get a new API key.');
  }

  // Seed players if missing
  const playersCount = await prisma.playerProfile.count();
  if (playersCount === 0) {
    await prisma.playerProfile.createMany({
      data: defaultPlayers.map((p) => ({
        steamId: p.steamId,
        name: p.name,
        avatarUrl: p.avatarUrl,
        lastSeen: p.lastSeen,
        firstSeen: p.firstSeen,
        totalConnections: p.totalConnections,
        playTimeHours: p.playTimeHours,
        isVip: p.isVip,
        vipPlan: p.vipPlan ?? null,
        vipExpiry: p.vipExpiry ?? null,
        serverStats: p.serverStats as any,
      })),
    });
    console.log('[bootstrap] Seeded default players.');
  }

  // Seed logs if missing
  const logsCount = await prisma.log.count();
  if (logsCount === 0) {
    const servers = await prisma.gameServer.findMany();
    const getServerIdForMode = (mode: GameMode) => {
      const match = servers.find((s) => s.mode === toPrismaMode(mode));
      return match?.id || servers[0]?.id;
    };
    const filteredLogs = defaultLogs
      .map((l) => {
        const serverId = getServerIdForMode(l.gameMode);
        if (!serverId) return null;
        return { ...l, serverId };
      })
      .filter(Boolean) as typeof defaultLogs;

    if (filteredLogs.length === 0) {
      console.warn('[bootstrap] Skipping log seed: no servers found.');
    } else {
      await prisma.log.createMany({
        data: filteredLogs.map((l) => ({
          serverId: l.serverId,
          gameMode: toPrismaMode(l.gameMode) as any,
          type: l.type as any,
          timestamp: l.timestamp,
          steamId: l.steamId ?? null,
          playerName: l.playerName ?? null,
          rawText: l.rawText,
          metadata: l.metadata as any,
        })),
      });
      console.log('[bootstrap] Seeded default logs.');
    }
  }
}

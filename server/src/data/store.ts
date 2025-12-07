import { GameServer, GameMode, ServerStatus, SiteConfig, User, UserRole } from '../domain';
import bcrypt from 'bcryptjs';

export interface UserRecord extends User {
  passwordHash: string;
}

interface InMemoryDb {
  users: UserRecord[];
  siteConfig: SiteConfig;
  servers: GameServer[];
}

const makeDefaultSiteConfig = (): SiteConfig => ({
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
});

const hashPassword = (plain: string): string => {
  const salt = bcrypt.genSaltSync(10);
  return bcrypt.hashSync(plain, salt);
};

const nowIso = () => new Date().toISOString();

const defaultServers: GameServer[] = [
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

const defaultUsers: UserRecord[] = [
  {
    id: 'u_admin',
    username: 'admin',
    email: 'admin@backstabber.com',
    role: UserRole.SUPERADMIN,
    createdAt: nowIso(),
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=admin_std',
    passwordHash: hashPassword('admin'),
  },
  {
    id: 'u_staff',
    username: 'staff',
    email: 'staff@backstabber.com',
    role: UserRole.ADMIN,
    createdAt: nowIso(),
    avatarUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=staff',
    passwordHash: hashPassword('staff'),
  },
];

const db: InMemoryDb = {
  users: defaultUsers,
  siteConfig: makeDefaultSiteConfig(),
  servers: defaultServers,
};

export const store = {
  getUsers(): UserRecord[] {
    return db.users;
  },

  addUser(user: Omit<UserRecord, 'id' | 'createdAt'>): UserRecord {
    const record: UserRecord = {
      ...user,
      id: `u_${Date.now()}`,
      createdAt: nowIso(),
    };
    db.users.push(record);
    return record;
  },

  updateUserRole(userId: string, role: UserRole): UserRecord | undefined {
    const user = db.users.find((u) => u.id === userId);
    if (!user) return undefined;
    user.role = role;
    return user;
  },

  findUserByEmailOrUsername(identifier: string): UserRecord | undefined {
    const lower = identifier.toLowerCase();
    return db.users.find(
      (u) => u.email.toLowerCase() === lower || u.username.toLowerCase() === lower,
    );
  },

  getSiteConfig(): SiteConfig {
    return db.siteConfig;
  },

  setSiteConfig(config: SiteConfig): SiteConfig {
    db.siteConfig = config;
    return db.siteConfig;
  },

  getServers(): GameServer[] {
    return db.servers;
  },

  getServerById(id: string): GameServer | undefined {
    return db.servers.find((s) => s.id === id);
  },

  addServer(data: {
    name: string;
    ip: string;
    port: number;
    mode: GameMode;
    maxPlayers: number;
    apiKey?: string;
  }): GameServer {
    const base: GameServer = {
      id: `srv_${Date.now()}`,
      name: data.name,
      ip: data.ip,
      port: data.port,
      mode: data.mode,
      status: ServerStatus.OFFLINE,
      currentPlayers: 0,
      maxPlayers: data.maxPlayers,
    };
    const server: GameServer = data.apiKey ? { ...base, apiKey: data.apiKey } : base;
    db.servers.push(server);
    return server;
  },

  updateServerApiKey(id: string, apiKey: string): GameServer | undefined {
    const server = db.servers.find((s) => s.id === id);
    if (!server) return undefined;
    server.apiKey = apiKey;
    return server;
  },
};

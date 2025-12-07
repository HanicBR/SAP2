export enum UserRole {
  USER = 'USER',
  ADMIN = 'ADMIN',
  SUPERADMIN = 'SUPERADMIN',
}

export interface User {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  createdAt: string;
  avatarUrl?: string;
}

export enum GameMode {
  TTT = 'TTT',
  SANDBOX = 'Sandbox',
  MURDER = 'Murder',
}

export enum ServerStatus {
  ONLINE = 'online',
  OFFLINE = 'offline',
  MAINTENANCE = 'maintenance',
}

export interface GameServer {
  id: string;
  name: string;
  ip: string;
  port: number;
  mode: GameMode;
  status: ServerStatus;
  currentPlayers: number;
  maxPlayers: number;
   currentMap?: string;
   lastHeartbeat?: string;
  apiKey?: string;
}

// --- Analytics / Dashboard Types ---

export interface DailyStats {
  date: string;
  players: number;
  rounds: number;
  [key: string]: any;
}

export interface MapStats {
  name: string;
  playCount: number;
  percentage: number;
  [key: string]: any;
}

export interface LiveActivityItem {
  id: string;
  message: string;
  type: 'INFO' | 'WARNING' | 'SUCCESS' | 'ERROR';
  timestamp: string;
  serverName?: string;
}

export interface FinancialStats {
  revenueToday: number;
  revenueMonth: number;
  transactionsToday: number;
}

export interface DashboardData {
  uniquePlayers24h: number;
  totalConnections: number;
  roundsPlayed: number;
  activeBans: number;
  chartData: DailyStats[];
  mapStats: Record<string, MapStats[]>;
  liveActivity: LiveActivityItem[];
  financialStats: FinancialStats;
}

export interface ServerAnalytics {
  totalPlayTimeHours: number;
  totalSessions: number;
  newPlayers: number;
  peakPlayers: number;
  playTimeTrend: { date: string; hours: number }[];
  playerCountTrend: { date: string; count: number }[];
  topPlayers: {
    steamId: string;
    name: string;
    avatarUrl: string;
    hours: number;
  }[];
}

export interface HeroSegment {
  text: string;
  color: string;
}

export interface VipPlanConfig {
  id: string;
  name: string;
  price: number;
  color: string;
  benefits: Record<string, string[]>;
}

export interface SiteConfig {
  general: {
    siteName: string;
    logoUrl?: string;
    primaryColor: string;
  };
  social: {
    discordUrl: string;
    steamGroupUrl: string;
  };
  home: {
    heroTitle: string;
    heroTitleHighlight: string;
    heroSubtitleSegments: HeroSegment[];
    heroButtonText: string;
    heroBackgroundUrl: string;
    feature1Title: string;
    feature1Desc: string;
    feature2Title: string;
    feature2Desc: string;
    feature3Title: string;
    feature3Desc: string;
  };
  vip: {
    promoTextPrefix: string;
    promoTextHighlight: string;
    promoTextSuffix: string;
    plans: VipPlanConfig[];
  };
  logs?: {
    ignoredTools?: string[];
    ignoredCommands?: string[];
    rawTextFilters?: string[];
  };
}

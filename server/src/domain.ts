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
  mustChangePassword?: boolean;
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

export interface DashboardOpsHealth {
  totalServers: number;
  onlineServers: number;
  offlineServers: number;
  maintenanceServers: number;
  currentPlayers: number;
  maxPlayers: number;
  wsConnectedServers: number;
  wsLiveStateServers: number;
  wsInvalidMessages: number;
  wsAckErrors: number;
  actionQueueSize: number;
}

export interface DashboardHighlights {
  logs24h: number;
  punishments24h: number;
  deactivations24h: number;
  activeMutes: number;
  activeGags: number;
  topEventTypes24h: { type: string; count: number }[];
}

export interface DashboardData {
  generatedAt: string;
  uniquePlayers24h: number;
  totalConnections: number;
  roundsPlayed: number;
  activeBans: number;
  chartData: DailyStats[];
  mapStats: Record<string, MapStats[]>;
  liveActivity: LiveActivityItem[];
  financialStats: FinancialStats;
  opsHealth: DashboardOpsHealth;
  highlights: DashboardHighlights;
}

export interface ServerAnalytics {
  totalPlayTimeHours: number;
  totalSessions: number;
  newPlayers: number;
  peakPlayers: number;
  uniquePlayers?: number;
  avgSessionMinutes?: number;
  medianSessionMinutes?: number;
  playTimeTrend: { date: string; hours: number }[];
  playerCountTrend: { date: string; count: number }[];
  topPlayers: {
    steamId: string;
    name: string;
    avatarUrl: string;
    hours: number;
  }[];
  topMaps?: { name: string; count: number; percentage: number }[];
  eventBreakdown?: { type: string; count: number }[];
  currentState?: {
    status: ServerStatus;
    currentPlayers: number;
    maxPlayers: number;
    currentMap?: string;
    lastHeartbeat?: string;
  };
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

export interface VipBillingOptionConfig {
  id: string;
  label: string;
  months: number;
  standardDiscount: number;
  ultimateDiscount: number;
}

export interface VipUltimatePlanConfig {
  enabled: boolean;
  name: string;
  basePrice: number;
  color: string;
  tagline: string;
  renewalText: string;
  benefits: string[];
}

export interface VipPaymentConfig {
  instructions: string;
  pixKey: string;
  copyHint: string;
}

export interface VipFaqItemConfig {
  question: string;
  answer: string;
  highlight?: boolean;
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
    billingOptions: VipBillingOptionConfig[];
    ultimatePlan: VipUltimatePlanConfig;
    payment: VipPaymentConfig;
    faq: VipFaqItemConfig[];
  };
  logs?: {
    ignoredTools?: string[];
    ignoredCommands?: string[];
    rawTextFilters?: string[];
  };
  vipAutomation?: {
    enabled: boolean;
    sandboxServerId?: string;
    grantTemplate: string;
    revokeTemplate: string;
  };
}

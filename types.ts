

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
  apiKey?: string; // Only visible to admins
}

export enum PunishmentType {
  BAN = 'BAN',
  MUTE = 'MUTE',
  GAG = 'GAG',
  KICK = 'KICK',
  WARN = 'WARN'
}

export interface Punishment {
  id: string;
  type: PunishmentType;
  reason: string;
  staffName: string;
  date: string; // ISO
  duration?: string; // e.g. "2 hours", "Permanent"
  active: boolean;
}

export interface StaffNote {
  id: string;
  content: string;
  staffName: string;
  date: string; // ISO
}

// --- NEW STATS INTERFACES ---

export interface TTTStats {
  roundsPlayed: number;
  roundsWon: number;
  traitorRounds: number;
  traitorWins: number;
  detectiveRounds: number;
  detectiveWins: number;
  innocentRounds: number;
  innocentWins: number;
  kills: number;
  deaths: number;
  points: number; // New field
  rank: string;   // New field (Patente)
}

export interface MurderStats {
  roundsPlayed: number;
  murdererRounds: number;
  murdererWins: number;
  bystanderWins: number;
}

export interface SandboxStats {
  totalPlayTimeHours: number;
  totalSessions: number;
  propsSpawned: number;
}

export interface GameModeStats {
  ttt?: TTTStats;
  murder?: MurderStats;
  sandbox?: SandboxStats;
}

export interface ActivityHistoryItem {
  date: string; // YYYY-MM-DD
  hoursPlayed: number;
  sessions: number;
}

export interface Player {
  steamId: string;
  name: string;
  avatarUrl?: string; // URL to avatar image
  lastSeen: string; // ISO Date
  firstSeen: string; // ISO Date
  totalConnections: number;
  playTimeHours: number;
  isVip: boolean;
  vipPlan?: string;
  vipExpiry?: string; // ISO Date
  ip?: string; // Only visible to admins
  geo?: {
    country: string;
    city: string;
    state: string;
    lat?: number;
    lng?: number;
  };
  serverStats?: Record<string, { // ServerID -> Stats
    playTimeHours: number;
    connections: number;
  }>;
  punishments?: Punishment[];
  notes?: StaffNote[];
  // New Stats Fields
  gameModeStats?: GameModeStats;
  activityHistory?: ActivityHistoryItem[];
}

// --- LOGS & EVENTS SYSTEM ---

export enum LogType {
  CONNECT = 'CONNECT',
  DISCONNECT = 'DISCONNECT',
  CHAT = 'CHAT',
  COMMAND = 'COMMAND', // !menu, !rtv
  ULX = 'ULX', // Admin commands
  KILL = 'KILL',
  DAMAGE = 'DAMAGE',
  PROP_SPAWN = 'PROP_SPAWN',
  TOOL_USE = 'TOOL_USE',
  ROUND_START = 'ROUND_START',
  ROUND_END = 'ROUND_END',
  GAME_EVENT = 'GAME_EVENT', // Map change, etc
}

export interface LogMetadata {
  // General
  ip?: string;
  message?: string;
  command?: string;
  args?: string[];
  
  // Combat
  attackerName?: string;
  attackerSteamId?: string;
  attackerRole?: 'innocent' | 'traitor' | 'detective' | 'murderer' | 'bystander' | 'none';
  victimName?: string;
  victimSteamId?: string;
  victimRole?: 'innocent' | 'traitor' | 'detective' | 'murderer' | 'bystander' | 'none';
  weapon?: string;
  damage?: number;
  hitgroup?: string; // head, chest, etc.
  
  // Sandbox
  propModel?: string;
  toolName?: string;
  entIndex?: number;
  
  // TTT Round Info
  roundId?: string;
  roundNumber?: number;
  sessionId?: string;
  serverSessionId?: string;
  sessionStart?: string;
  map?: string;
  serverName?: string;
  playerCount?: number;
  rdmSuspect?: boolean;
  winner?: 'traitor' | 'innocent' | 'timeout';
  durationSeconds?: number;
}

export interface LogEntry {
  id: string;
  serverId: string;
  gameMode: GameMode;
  type: LogType;
  timestamp: string; // ISO Date
  steamId?: string; // Primary actor
  playerName?: string; // Primary actor name
  rawText: string; // Original log line
  metadata: LogMetadata;
}

// Legacy support if needed, but LogEntry is preferred
export interface ServerEvent extends LogEntry {} 

export interface LegacyImportSummary {
  format: 'ULX' | 'TAGGED';
  linesParsed: number;
  eventsGenerated: number;
  eventsInserted: number;
  playersTouched: number;
  byType: Record<string, number>;
  dryRun: boolean;
  errors?: { line: number; text: string; reason: string }[];
}

export interface VipPlan {
  id: string;
  name: string;
  price: number;
  currency: string;
  benefits: string[];
  applicableServers: 'ALL' | GameMode[];
  color: string;
}

// --- FINANCIAL SYSTEM ---

export enum TransactionType {
  INCOME = 'INCOME',
  EXPENSE = 'EXPENSE'
}

export enum TransactionCategory {
  VIP_SALE = 'VIP_SALE',
  SERVER_HOSTING = 'SERVER_HOSTING',
  DOMAIN_WEB = 'DOMAIN_WEB',
  DEV_PLUGIN = 'DEV_PLUGIN',
  OTHER = 'OTHER'
}

export interface Transaction {
  id: string;
  date: string; // ISO
  amount: number;
  type: TransactionType;
  category: TransactionCategory;
  description: string;
  proofUrl?: string; // URL image of receipt
  
  // VIP Specifics
  relatedSteamId?: string; // If it's a VIP sale
  relatedPlayerName?: string;
  vipPlan?: string;
  vipDurationDays?: number;
  
  createdBy: string; // Admin User ID
}

// --- AUTH SYSTEM ---

export enum UserRole {
  USER = 'USER',
  ADMIN = 'ADMIN',           // Can view Dashboard, Logs, Players, Servers (Read Only)
  SUPERADMIN = 'SUPERADMIN'  // Can do everything + Manage Users + Add Servers + View API Keys
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

// Chart Data Types
export interface DailyStats {
  date: string;
  players: number;
  rounds: number;
  [key: string]: any;
}

export interface MapStats {
  name: string;
  playCount: number; // How many times played or rounds played
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
  mapStats: Record<string, MapStats[]>; // Changed to support grouping by mode
  liveActivity: LiveActivityItem[];
  financialStats: FinancialStats;
}

// Duplicate Detection Types
export enum SuspicionLevel {
  HIGH = 'HIGH',       // Same exact IP
  MODERATE = 'MODERATE', // Same Subnet /24 + Same City
}

export interface SuspiciousGroup {
  id: string;
  level: SuspicionLevel;
  commonIpOrSubnet: string;
  location: string; // City, State, Country
  lastActivity: string;
  players: Player[];
}

// --- SERVER ANALYTICS (NEW) ---
export interface ServerAnalytics {
  totalPlayTimeHours: number; // Sum of all players in period
  totalSessions: number;
  newPlayers: number; // First join in period
  peakPlayers: number;
  
  // Charts
  playTimeTrend: { date: string; hours: number }[];
  playerCountTrend: { date: string; count: number }[];
  
  // Ranking
  topPlayers: {
    steamId: string;
    name: string;
    avatarUrl: string;
    hours: number;
  }[];
}

// --- SITE CONFIGURATION (NEW) ---

export interface HeroSegment {
  text: string;
  color: string; // Hex code
}

export interface VipPlanConfig {
  id: string;
  name: string;
  price: number;
  color: string; // Hex code
  benefits: Record<string, string[]>; // GameMode -> List of benefits
}

export interface SiteConfig {
  general: {
    siteName: string;
    logoUrl?: string; 
    primaryColor: string; // Hex for branding
  };
  social: {
    discordUrl: string;
    steamGroupUrl: string;
  };
  home: {
    heroTitle: string;
    heroTitleHighlight: string;
    heroSubtitleSegments: HeroSegment[]; // CHANGED: Replaced simple string with customizable segments
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
    plans: VipPlanConfig[]; // CHANGED: Plans are now configurable
  };
  logs?: {
    ignoredTools?: string[];
    ignoredCommands?: string[];
    rawTextFilters?: string[];
  };
}

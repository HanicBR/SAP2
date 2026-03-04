

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

export interface ServerWsLivePlayer {
  steamId: string;
  name?: string;
}

export interface ViewerStateVector3 {
  x: number;
  y: number;
  z: number;
}

export interface ViewerStateAngles {
  pitch: number;
  yaw: number;
  roll: number;
}

export interface ServerViewerStatePlayer {
  steamId: string;
  name?: string;
  pos: ViewerStateVector3;
  eyeAngles: ViewerStateAngles;
  health?: number;
  armor?: number;
  teamId?: number;
  teamName?: string;
  alive?: boolean;
}

export interface ServerViewerStateSnapshot {
  serverId: string;
  receivedAt: string;
  sentAt?: string;
  map?: string;
  playerCount: number;
  players: ServerViewerStatePlayer[];
}

export interface ViewerMapOverlayConfig {
  map: string;
  imageUrl: string;
  worldMinX: number;
  worldMinY: number;
  worldMaxX: number;
  worldMaxY: number;
  enabled?: boolean;
  flipX?: boolean;
  flipY?: boolean;
}

export interface ServerViewerMapOverlayResolved {
  map: string;
  imageUrl: string;
  worldMinX: number;
  worldMinY: number;
  worldMaxX: number;
  worldMaxY: number;
  flipX: boolean;
  flipY: boolean;
}

export interface ServerViewerMapOverlayResponse {
  serverId: string;
  requestedMap?: string;
  currentMap?: string;
  available: boolean;
  overlay?: ServerViewerMapOverlayResolved;
  reason?: string;
}

export interface ServerWsViewerStateItem {
  serverId: string;
  transport: 'websocket';
  connected: boolean;
  wsConnectedAt?: string;
  receivedAt: string;
  ageSeconds?: number;
  sentAt?: string;
  map?: string;
  playerCount: number;
  players: ServerViewerStatePlayer[];
}

export interface ServerWsViewerStateListResponse {
  now: string;
  total: number;
  items: ServerWsViewerStateItem[];
}

export interface ServerViewerStateResponse extends Partial<ServerWsViewerStateItem> {
  serverId: string;
  available: boolean;
  transport: 'websocket';
  fallback: ServerLiveStateFallback;
}

export type ServerViewerActionType = 'KICK' | 'MUTE_10M' | 'GAG_10M' | 'UNMUTE' | 'UNGAG';
export type ServerActionDispatchStatus = 'QUEUED' | 'ACK_OK' | 'ACK_FAILED' | 'HTTP_PULLED';

export interface ServerViewerActionRequest {
  action: ServerViewerActionType;
  steamId: string;
  reason?: string;
}

export interface ServerViewerActionDispatchResponse {
  ok: boolean;
  serverId: string;
  actionId: string;
  status: ServerActionDispatchStatus;
  requestedAt: string;
}

export interface ServerViewerActionStatusResponse {
  ok: boolean;
  actionId: string;
  serverId: string;
  command: string;
  status: ServerActionDispatchStatus;
  createdAt: string;
  updatedAt: string;
  wsAttemptCount: number;
  wsLastSentAt?: string;
  wsLastAckAt?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export type WorkshopJobStatus = 'queued' | 'running' | 'retry_wait' | 'success' | 'failed' | 'dropped';

export interface WorkshopQueueJob {
  id: string;
  key: string;
  status: WorkshopJobStatus;
  appId: number;
  workshopId: string;
  mapName: string;
  serverId: string;
  source: 'heartbeat' | 'viewer_state' | 'manual' | 'reconcile';
  resolutionSource: string;
  refresh: boolean;
  retryCount: number;
  maxRetries: number;
  runCount: number;
  enqueuedAt: string;
  updatedAt: string;
  nextRunAt: string;
  nextRunInMs: number;
  lastStartedAt?: string;
  lastFinishedAt?: string;
  lastError?: string;
  lastExitCode?: number;
  lastSignal?: string;
  downloadTimedOut?: boolean;
  processTimedOut?: boolean;
  outputTail?: string[];
  reportSummary: {
    download: {
      exists: boolean;
      ok?: boolean;
      status?: string;
      error?: string;
      finishedAt?: string;
    };
    process: {
      exists: boolean;
      ok?: boolean;
      status?: string;
      error?: string;
      finishedAt?: string;
      sourceioEngineUsed?: string;
      materialsWithTexture?: number;
      materialsTotal?: number;
      modelsExported?: number;
      modelsTotal?: number;
      warningsCount?: number;
    };
    extract: {
      exists: boolean;
      ok?: boolean;
      status?: string;
      error?: string;
      finishedAt?: string;
    };
  };
  reports: {
    download: string;
    process: string;
    extract: string;
  };
}

export interface WorkshopQueueSnapshotResponse {
  now: string;
  runtimeEnabled: boolean;
  initialized: boolean;
  config: {
    enabled: boolean;
    autoProcessEnabled: boolean;
    appId: number;
    workerConcurrency: number;
    maxQueueSize: number;
    maxRetries: number;
    retryBaseMs: number;
    retryMaxMs: number;
    downloadTimeoutMs: number;
    processTimeoutMs: number;
    successCooldownMs: number;
    queueStorePath: string;
    reportsDir: string;
    runtimeCachePath: string;
    configPath: string;
  };
  worker: {
    activeJobs: number;
    wakeScheduled: boolean;
  };
  counts: {
    total: number;
    queued: number;
    running: number;
    retry_wait: number;
    success: number;
    failed: number;
    dropped: number;
    pending: number;
  };
  jobs: WorkshopQueueJob[];
}

export interface WorkshopManualEnqueueRequest {
  mapName: string;
  workshopInput?: string;
  workshopId?: string;
  refresh?: boolean;
  serverId?: string;
}

export interface WorkshopManualEnqueueResponse {
  ok: boolean;
  queued: boolean;
  deduped: boolean;
  reason: string;
  mapName?: string;
  workshopId?: string;
  refresh?: boolean;
  resolutionSource?: string;
  droppedOldestJobId?: string;
  job?: {
    id: string;
    key: string;
    status: WorkshopJobStatus;
    retryCount: number;
    maxRetries: number;
    reports: {
      download: string;
      process: string;
      extract: string;
    };
  };
  error?: string;
}

export interface WorkshopDiagnosticsReportRequest {
  mapName: string;
  serverId?: string;
  reason?: string;
}

export interface WorkshopDiagnosticsReportDownload {
  blob: Blob;
  filename: string;
  generatedAt: string;
  diagnosticsPath?: string;
}

export interface WorkshopResolutionCandidate {
  workshopId: string;
  title: string;
  source: 'steam_api_queryfiles' | 'steamcommunity_browse';
  score: number;
  exactTitle: boolean;
  rejected: boolean;
}

export interface WorkshopResolutionOptionsResponse {
  ok: boolean;
  requestedMapName?: string;
  resolvedMapName?: string;
  aliasTarget?: string;
  staticWorkshopId?: string;
  runtimeWorkshopId?: string;
  processReportWorkshopId?: string;
  mappedWorkshopId?: string;
  mappedSource?: string;
  discovery?: {
    resolutionSource: string;
    reason: string;
    workshopId?: string;
    candidates: WorkshopResolutionCandidate[];
  };
  error?: string;
}

export interface WorkshopResolveSelectionRequest {
  mapName: string;
  workshopInput: string;
  serverId?: string;
  persistMode?: 'static' | 'runtime';
  enqueue?: boolean;
  refresh?: boolean;
}

export interface WorkshopResolveSelectionResponse {
  ok: boolean;
  mapName: string;
  workshopId?: string;
  persistMode?: 'static' | 'runtime';
  persisted?: boolean;
  persistedTo?: string;
  enqueue: {
    attempted: boolean;
    queued: boolean;
    deduped: boolean;
    reason: string;
    jobId?: string;
  };
  error?: string;
}

export interface WorkshopResetCacheAndReprocessRequest {
  mapName: string;
  workshopInput?: string;
  workshopId?: string;
  serverId?: string;
  refresh?: boolean;
  clearAllForMap?: boolean;
}

export interface WorkshopProcessCacheResetSummary {
  ok: boolean;
  mapName: string;
  workshopId?: string;
  appId: number;
  cachePath: string;
  hadCacheFile: boolean;
  removedKeys: string[];
  reason: string;
  error?: string;
}

export interface WorkshopResetCacheAndReprocessResponse {
  ok: boolean;
  mapName: string;
  workshopId?: string;
  reset: WorkshopProcessCacheResetSummary;
  enqueue: WorkshopManualEnqueueResponse;
  error?: string;
}

export interface ServerWsLiveStateItem {
  serverId: string;
  transport: 'websocket';
  connected: boolean;
  wsConnectedAt?: string;
  receivedAt: string;
  ageSeconds?: number;
  sentAt?: string;
  map?: string;
  playerCount: number;
  players: ServerWsLivePlayer[];
}

export interface ServerWsLiveStateListResponse {
  now: string;
  total: number;
  items: ServerWsLiveStateItem[];
}

export interface ServerLiveStateFallback {
  status: string;
  currentPlayers: number;
  maxPlayers: number;
  currentMap?: string;
  lastHeartbeat?: string;
}

export interface ServerLiveStateResponse extends Partial<ServerWsLiveStateItem> {
  serverId: string;
  available: boolean;
  transport: 'websocket';
  fallback: ServerLiveStateFallback;
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
  status?: 'ACTIVE' | 'REVOKED' | 'EXPIRED' | 'EXECUTED';
  deactivationReason?: string;
  deactivatedAt?: string;
  deactivatedBy?: string;
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
  serverHours?: Record<string, number>;
}

export interface ModerationSummary {
  windowDays: number;
  chatCount: number;
  commandCount: number;
  punishCount: number;
  propBurstCount: number;
  lastPunishAt?: string;
}

export interface RiskAssessment {
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  reasons: string[];
  signals: {
    recentConnections24h: number;
    shortSessions24h: number;
    punishCount30d: number;
    propBurstCount30d: number;
    chatCount30d: number;
    commandCount30d: number;
  };
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
  moderationSummary?: ModerationSummary;
  riskAssessment?: RiskAssessment;
}

export interface VipDispatchInfo {
  queued: boolean;
  skipped?: boolean;
  reason?: string;
  serverId?: string;
  actionId?: string;
  vipActionId?: string;
}

export interface VipAdminItem {
  steamId: string;
  name: string;
  avatarUrl?: string;
  isVip: boolean;
  vipPlan?: string;
  vipExpiry?: string;
  lastSeen?: string;
  vipStatus?: 'ACTIVE' | 'EXPIRED' | 'INACTIVE';
  vipServerIds?: string[];
  vipServerNames?: string[];
}

export interface VipAdminListResponse {
  items: VipAdminItem[];
  total: number;
}

export type VipAutomationActionStatus = 'QUEUED' | 'FAILED' | 'SKIPPED';

export interface VipAutomationActionItem {
  id: string;
  createdAt: string;
  updatedAt: string;
  action: 'GRANT' | 'REVOKE';
  status: VipAutomationActionStatus;
  steamId: string;
  vipPlan?: string;
  vipExpiry?: string;
  serverId?: string;
  command?: string;
  reason?: string;
  queuedActionId?: string;
  retryOfActionId?: string;
  retriedAt?: string;
  retries: number;
}

export interface VipAutomationActionListResponse {
  items: VipAutomationActionItem[];
  total: number;
}

export interface VipReconcileItem {
  steamId: string;
  name: string;
  vipPlan?: string;
  vipExpiry?: string;
  updated: boolean;
  dispatch?: VipDispatchInfo;
  error?: string;
}

export interface VipReconcileResponse {
  dryRun: boolean;
  limit: number;
  now: string;
  expiredCount: number;
  updatedCount: number;
  updateFailures: number;
  dispatchQueuedCount: number;
  dispatchNotQueuedCount: number;
  items: VipReconcileItem[];
}

export interface VipAutomationConfig {
  enabled: boolean;
  sandboxServerId?: string;
  grantTemplate: string;
  revokeTemplate: string;
  source?: 'env' | 'site_config';
}

// --- LOGS & EVENTS SYSTEM ---

export enum LogType {
  CONNECT = 'CONNECT',
  DISCONNECT = 'DISCONNECT',
  CHAT = 'CHAT',
  COMMAND = 'COMMAND', // !menu, !rtv
  PUNISH = 'PUNISH', // SAM punishments
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
  eventId?: string;
  source?: string;
  sourceTag?: string;
  actorType?: 'player' | 'console' | 'system';
  actorGroup?: string;
  punishmentType?: 'BAN' | 'KICK' | 'WARN' | 'MUTE' | 'GAG';
  action?: string;
  targetSteamId?: string;
  targetName?: string;
  reason?: string;
  durationText?: string;
  durationMinutes?: number | null;
  ipHash?: string;
  
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

export interface LogsQueryParams {
  search?: string;
  serverId?: string;
  type?: string;
  mode?: GameMode | 'ALL' | 'TTT' | 'SANDBOX' | 'MURDER' | 'Sandbox' | 'Murder';
  from?: string;
  to?: string;
  actorType?: 'player' | 'console' | 'system' | 'ALL';
  target?: string;
  limit?: number;
  page?: number;
  cursor?: string | null;
}

export interface LogsQueryResponse {
  mode: 'page' | 'cursor';
  items: ServerEvent[];
  limit: number;
  hasMore: boolean;
  nextCursor?: string | null;
  page?: number;
  total?: number;
  totalPages?: number;
}

export interface SiteAuditLogEntry {
  id: string;
  userId?: string;
  username?: string;
  userRole?: UserRole;
  action: string;
  method: string;
  path: string;
  statusCode: number;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface SiteAuditLogsQueryParams {
  search?: string;
  userId?: string;
  username?: string;
  action?: string;
  from?: string;
  to?: string;
  limit?: number;
  page?: number;
}

export interface SiteAuditLogsQueryResponse {
  mode: 'page';
  items: SiteAuditLogEntry[];
  limit: number;
  hasMore: boolean;
  nextCursor?: string | null;
  page: number;
  total: number;
  totalPages: number;
}

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
  createdAt?: string; // ISO
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
  createdByName?: string;
}

export interface TransactionProofUploadResult {
  url: string;
  filename: string;
  size: number;
  mime: string;
}

// --- AUTH SYSTEM ---

export enum UserRole {
  USER = 'USER',
  MODERATOR = 'MODERATOR',
  ADMIN = 'ADMIN',
  SUPERADMIN = 'SUPERADMIN',
}

export interface User {
  id: string;
  username: string;
  email: string;
  emailVerifiedAt?: string;
  role: UserRole;
  mustChangePassword?: boolean;
  createdAt: string;
  avatarUrl?: string;
  steamId64?: string;
  steamProfileUrl?: string;
  steamAvatarUrl?: string;
  steamPersonaName?: string;
  steamLinkedAt?: string;
  steamLastSyncAt?: string;
}

export interface AuthRegisterResponse {
  user: User;
  token?: string | null;
  requiresEmailVerification?: boolean;
  verificationEmailSent?: boolean;
}

export interface PlayerAliasHistoryItem {
  name: string;
  firstSeen?: string;
  lastSeen?: string;
  seenCount: number;
}

export interface PlayerAliasHistoryResponse {
  steamId: string;
  total: number;
  items: PlayerAliasHistoryItem[];
}

export interface PlayerAvatarHistoryItem {
  avatarUrl: string;
  firstSeen?: string;
  lastSeen?: string;
  seenCount: number;
}

export interface PlayerAvatarHistoryResponse {
  steamId: string;
  total: number;
  items: PlayerAvatarHistoryItem[];
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
  mapStats: Record<string, MapStats[]>; // Changed to support grouping by mode
  liveActivity: LiveActivityItem[];
  financialStats: FinancialStats;
  opsHealth: DashboardOpsHealth;
  highlights: DashboardHighlights;
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

export type DuplicateReasonCode = 'SAME_IP' | 'SAME_SUBNET' | 'SAME_LOCATION';
export type DuplicateConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface PlayerIpHistoryItemV2 {
  ip: string;
  firstSeen: string;
  lastSeen: string;
  connections: number;
  lastServerId?: string;
  geo?: {
    country?: string;
    state?: string;
    city?: string;
    lat?: number;
    lng?: number;
    source?: string;
    [key: string]: unknown;
  };
  location: string;
}

export interface PlayerIpHistoryResponseV2 {
  steamId: string;
  total: number;
  items: PlayerIpHistoryItemV2[];
}

export interface RelatedAccountReasonV2 {
  code: DuplicateReasonCode;
  confidence: DuplicateConfidence;
  label: string;
  evidence: string[];
}

export interface RelatedAccountItemV2 {
  player: Player;
  confidence: DuplicateConfidence;
  reasons: RelatedAccountReasonV2[];
}

export interface RelatedAccountsResponseV2 {
  steamId: string;
  analyzedAt: string;
  total: number;
  items: RelatedAccountItemV2[];
}

export interface SuspiciousGroupV2 {
  id: string;
  level: 'HIGH' | 'MODERATE';
  confidence: DuplicateConfidence;
  reasonCode: DuplicateReasonCode;
  reasonLabel: string;
  commonIpOrSubnet: string;
  location: string;
  lastActivity: string;
  players: Player[];
}

// --- SERVER ANALYTICS (NEW) ---
export interface ServerAnalytics {
  totalPlayTimeHours: number; // Sum of all players in period
  totalSessions: number;
  newPlayers: number; // First join in period
  peakPlayers: number;
  playtimeSource?: 'legacy' | 'pulse';
  pulseCoveragePct?: number;
  playtimeDiagnostics?: {
    configuredSource: 'legacy' | 'hybrid' | 'pulse';
    decisionReason: string;
    hybridMinCoveragePct: number;
    legacyHours: number;
    pulseHours?: number;
    diffHours?: number;
    diffPct?: number;
    legacyUniquePlayers: number;
    pulseUniquePlayers?: number;
  };
  uniquePlayers?: number;
  avgSessionMinutes?: number;
  medianSessionMinutes?: number;
  
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
  viewerMapOverlays?: ViewerMapOverlayConfig[];
}

export type LoadingScreenMode = 'TTT' | 'SANDBOX' | 'MURDER' | 'CUSTOM';

export interface LoadingScreenBackgroundItem {
  id: string;
  url: string;
  enabled: boolean;
}

export interface LoadingScreenMusicTrackItem {
  id: string;
  url: string;
  enabled: boolean;
}

export interface LoadingScreenVipEntry {
  name: string;
  steamId?: string;
  avatarUrl?: string;
  vipPlan?: string;
}

export interface LoadingScreenHero {
  badge: string;
  title: string;
  subtitle: string;
  descriptionLines: string[];
}

export interface LoadingScreenNotice {
  title: string;
  lines: string[];
  ctaLabel?: string;
  ctaUrl?: string;
  qrImageUrl?: string;
}

export interface LoadingScreenProfile {
  slug: string;
  name: string;
  mode: LoadingScreenMode;
  enabled: boolean;
  routePath: string;
  accentColor: string;
  backgroundImages: string[];
  backgroundImageItems?: LoadingScreenBackgroundItem[];
  backgroundRotationSec?: number;
  musicTracks: string[];
  musicTrackItems?: LoadingScreenMusicTrackItem[];
  musicVolumePct?: number;
  hero: LoadingScreenHero;
  notice: LoadingScreenNotice;
  rules: string[];
  vipTitle: string;
  vipPlayers: LoadingScreenVipEntry[];
  updatedAt: string;
}

export interface LoadingScreensResponse {
  updatedAt: string;
  profiles: LoadingScreenProfile[];
}

export interface LoadingMediaUploadResult {
  url: string;
  filename: string;
  size: number;
  mime: string;
}

export type LoadingTelemetryRange = '24h' | '7d' | '30d';

export interface LoadingTelemetrySlugItem {
  slug: string;
  sessions: number;
  completed: number;
  abandoned: number;
  completionRatePct: number;
  lastStartedAt: string | null;
}

export interface LoadingTelemetrySlugsResponse {
  range: LoadingTelemetryRange;
  window: {
    from: string;
    to: string;
  };
  totalSessionsScanned: number;
  truncated: boolean;
  items: LoadingTelemetrySlugItem[];
}

export interface LoadingTelemetrySummaryTotals {
  sessions: number;
  completed: number;
  abandoned: number;
  completionRatePct: number;
  eventsAnalyzed: number;
  sessionsWithDuration: number;
  avgDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
}

export interface LoadingTelemetryStatusItem {
  status: string;
  count: number;
}

export interface LoadingTelemetryStageDurationItem {
  stage: string;
  count: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

export interface LoadingTelemetrySlowFileItem {
  fileName: string;
  occurrences: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
}

export interface LoadingTelemetrySourceItem {
  source: string;
  count: number;
}

export interface LoadingTelemetryTimelineItem {
  from: string;
  to: string;
  label: string;
  sessions: number;
  completed: number;
  abandoned: number;
  avgDurationMs: number;
  p95DurationMs: number;
}

export interface LoadingTelemetrySummaryResponse {
  generatedAt: string;
  range: LoadingTelemetryRange;
  window: {
    from: string;
    to: string;
  };
  slug: string | null;
  limits: {
    maxSessions: number;
    maxEvents: number;
    maxTrackedFiles: number;
    maxStepDurationMs: number;
  };
  totals: LoadingTelemetrySummaryTotals;
  statusBreakdown: LoadingTelemetryStatusItem[];
  stageDurations: LoadingTelemetryStageDurationItem[];
  slowFiles: LoadingTelemetrySlowFileItem[];
  sources: LoadingTelemetrySourceItem[];
  timeline: LoadingTelemetryTimelineItem[];
  truncated: {
    sessions: boolean;
    events: boolean;
  };
}

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

type TriggerSource = 'heartbeat' | 'viewer_state' | 'manual';

type NotifyInput = {
  serverId: string;
  mapName: string;
  source: TriggerSource;
};

type WorkshopMapConfigFile = {
  enabled?: boolean;
  autoProcessEnabled?: boolean;
  assetResolutionMode?: 'permissive' | 'strict';
  sourceioMode?: 'auto' | 'required' | 'off';
  appId?: number;
  maps?: Record<string, string>;
  aliases?: Record<string, string>;
  maxRetries?: number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  maxQueueSize?: number;
  successCooldownMs?: number;
  downloadTimeoutMs?: number;
  processTimeoutMs?: number;
  workerConcurrency?: number;
  queueStorePath?: string;
  terminalRetentionDays?: number;
  maxStoredJobs?: number;
};

type WorkshopMapConfigResolved = {
  enabled: boolean;
  autoProcessEnabled: boolean;
  assetResolutionMode: 'permissive' | 'strict';
  sourceioMode: 'auto' | 'required' | 'off';
  appId: number;
  maps: Record<string, string>;
  aliases: Record<string, string>;
  maxRetries: number;
  retryBaseMs: number;
  retryMaxMs: number;
  maxQueueSize: number;
  successCooldownMs: number;
  downloadTimeoutMs: number;
  processTimeoutMs: number;
  workerConcurrency: number;
  queueStorePath: string;
  terminalRetentionDays: number;
  maxStoredJobs: number;
  rootDir: string;
  runtimeCachePath: string;
  reportsDir: string;
  configPath: string;
};

type PersistedJobStatus = 'queued' | 'running' | 'retry_wait' | 'success' | 'failed' | 'dropped';

type PersistedWorkshopJob = {
  id: string;
  key: string;
  appId: number;
  workshopId: string;
  mapName: string;
  serverId: string;
  source: TriggerSource;
  resolutionSource: string;
  refresh: boolean;
  maxRetries: number;
  retryCount: number;
  runCount: number;
  status: PersistedJobStatus;
  createdAt: string;
  updatedAt: string;
  enqueuedAtMs: number;
  nextRunAtMs: number;
  lastStartedAt?: string;
  lastFinishedAt?: string;
  lastError?: string;
  lastExitCode?: number;
  lastSignal?: string;
  downloadTimedOut?: boolean;
  processTimedOut?: boolean;
  outputTail?: string[];
  downloadReportPath: string;
  processReportPath: string;
  extractReportPath: string;
};

type JobRunResult = {
  exitCode: number;
  signal?: string;
  timedOut: boolean;
  outputTail: string[];
};

type RuntimeMapCacheFile = {
  version: 1;
  updatedAt: string;
  mappings: Record<string, string>;
};

type MapHint = {
  mapName: string;
  workshopId?: string;
};

type QueueStoreFile = {
  version: 1;
  updatedAt: string;
  jobs: PersistedWorkshopJob[];
};

type WorkshopQueueSnapshot = {
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
  jobs: Array<{
    id: string;
    key: string;
    status: PersistedJobStatus;
    appId: number;
    workshopId: string;
    mapName: string;
    serverId: string;
    source: TriggerSource;
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
  }>;
};

type EnqueueResult = {
  queued: boolean;
  deduped: boolean;
  reason: string;
  droppedOldestJobId?: string;
  job?: PersistedWorkshopJob;
};

const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_CONFIG_PATH = path.resolve(WORKSPACE_ROOT, 'server', 'config', 'workshop-maps.json');
const DEFAULT_RUNTIME_CACHE_PATH = path.resolve(WORKSPACE_ROOT, 'server', 'config', 'workshop-maps.runtime.json');
const DEFAULTS = {
  enabled: true,
  autoProcessEnabled: true,
  assetResolutionMode: 'permissive' as const,
  sourceioMode: 'auto' as const,
  appId: 4000,
  maxRetries: 3,
  retryBaseMs: 15_000,
  retryMaxMs: 10 * 60 * 1000,
  maxQueueSize: 200,
  successCooldownMs: 10 * 60 * 1000,
  downloadTimeoutMs: 30 * 60 * 1000,
  processTimeoutMs: 180 * 60 * 1000,
  workerConcurrency: 1,
  terminalRetentionDays: 14,
  maxStoredJobs: 2000,
};

const TERMINAL_STATUS = new Set<PersistedJobStatus>(['success', 'failed', 'dropped']);
const ACTIVE_STATUS = new Set<PersistedJobStatus>(['queued', 'running', 'retry_wait']);

let started = false;
let runtimeEnabled = true;
let serverLastMap = new Map<string, string>();
let warnedMissingMap = new Set<string>();
let recentSuccessByKey = new Map<string, number>();
let wakeTimer: NodeJS.Timeout | null = null;
let cachedConfig: WorkshopMapConfigResolved | null = null;
let cachedConfigMtimeMs = -1;
let runtimeMapCache = new Map<string, string>();
let runtimeMapCacheLoaded = false;
let discoveredFromReports = new Map<string, string>();
let discoveredFromReportsLoadedAtMs = 0;
let queueStoreLoaded = false;
let queueStorePathLoaded = '';
let jobsById = new Map<string, PersistedWorkshopJob>();
let activeJobIds = new Set<string>();

const toInt = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.floor(parsed);
};

const toPositiveInt = (value: unknown, fallback: number): number => {
  const parsed = toInt(value, fallback);
  if (parsed <= 0) return fallback;
  return parsed;
};

const parseBool = (value: unknown, fallback: boolean): boolean => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const sanitizeMapName = (raw: string): string => {
  const value = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\\/g, '/');
  if (!value) return '';
  const base = value.includes('/') ? value.slice(value.lastIndexOf('/') + 1) : value;
  const noExt = base.endsWith('.bsp') ? base.slice(0, -4) : base;
  if (!noExt) return '';
  if (noExt.includes('..') || noExt.includes('/') || noExt.includes('\\')) return '';
  if (!/^[a-z0-9][a-z0-9_-]{1,127}$/.test(noExt)) return '';
  return noExt;
};

const isWorkshopId = (raw: unknown): raw is string => /^\d+$/.test(String(raw || '').trim());

const parseMapHint = (raw: string): MapHint => {
  const normalizedRaw = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\\/g, '/');
  const workshopMatch = /(?:^|\/)workshop\/(\d+)\/([^/?#]+)/.exec(normalizedRaw);
  if (workshopMatch && workshopMatch[1] && workshopMatch[2]) {
    const mapName = sanitizeMapName(workshopMatch[2]);
    if (mapName) {
      const workshopId = workshopMatch[1];
      return {
        mapName,
        ...(isWorkshopId(workshopId) ? { workshopId } : {}),
      };
    }
  }
  return { mapName: sanitizeMapName(normalizedRaw) };
};

const parseMapTable = (input: unknown): Record<string, string> => {
  if (!input || typeof input !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    const mapName = sanitizeMapName(rawKey);
    const workshopId = String(rawValue || '').trim();
    if (!mapName || !isWorkshopId(workshopId)) continue;
    out[mapName] = workshopId;
  }
  return out;
};

const parseAliasTable = (input: unknown): Record<string, string> => {
  if (!input || typeof input !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    const alias = sanitizeMapName(rawKey);
    const target = sanitizeMapName(String(rawValue || ''));
    if (!alias || !target) continue;
    out[alias] = target;
  }
  return out;
};

const parseAssetResolutionMode = (value: unknown, fallback: 'permissive' | 'strict'): 'permissive' | 'strict' => {
  const raw = String(value ?? '').trim().toLowerCase();
  return raw === 'strict' ? 'strict' : fallback;
};

const parseSourceioMode = (
  value: unknown,
  fallback: 'auto' | 'required' | 'off',
): 'auto' | 'required' | 'off' => {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'required') return 'required';
  if (raw === 'off') return 'off';
  return fallback;
};

const nowIso = () => new Date().toISOString();

const getRootDir = (): string =>
  path.resolve(
    String(
      process.env.WORKSHOP_ROOT
        || (process.platform === 'linux'
          ? '/opt/backstabber/workshop'
          : path.join(WORKSPACE_ROOT, 'sandbox', 'workshop')),
    ),
  );

const getConfigPath = (): string =>
  path.resolve(String(process.env.WORKSHOP_MAPS_FILE || DEFAULT_CONFIG_PATH));

const getRuntimeCachePath = (): string =>
  path.resolve(String(process.env.WORKSHOP_RUNTIME_MAPS_FILE || DEFAULT_RUNTIME_CACHE_PATH));

const getReportsDir = (): string => {
  const rootDir = getRootDir();
  return path.resolve(String(process.env.WORKSHOP_REPORTS_DIR || path.join(rootDir, 'reports')));
};

const writeJsonAtomic = (targetPath: string, value: unknown) => {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tmpPath, targetPath);
};

const writeRuntimeCache = (targetPath: string) => {
  const payload: RuntimeMapCacheFile = {
    version: 1,
    updatedAt: nowIso(),
    mappings: Object.fromEntries(Array.from(runtimeMapCache.entries()).sort((a, b) => a[0].localeCompare(b[0]))),
  };
  writeJsonAtomic(targetPath, payload);
};

const loadRuntimeCache = (targetPath: string) => {
  if (runtimeMapCacheLoaded) return;
  runtimeMapCacheLoaded = true;
  if (!fs.existsSync(targetPath)) return;
  try {
    const parsed = JSON.parse(fs.readFileSync(targetPath, 'utf8')) as RuntimeMapCacheFile;
    const mappings = parsed?.mappings && typeof parsed.mappings === 'object' ? parsed.mappings : {};
    for (const [rawMap, rawId] of Object.entries(mappings)) {
      const mapName = sanitizeMapName(rawMap);
      const workshopId = String(rawId || '').trim();
      if (!mapName || !isWorkshopId(workshopId)) continue;
      runtimeMapCache.set(mapName, workshopId);
    }
  } catch (error: any) {
    console.warn('[workshop-auto] runtime_cache_load_failed', {
      targetPath,
      error: String(error?.message || error),
    });
  }
};

const rememberRuntimeMapping = (
  mapName: string,
  workshopId: string,
  source: string,
  runtimeCachePath: string,
) => {
  const safeMap = sanitizeMapName(mapName);
  if (!safeMap || !isWorkshopId(workshopId)) return;
  const existing = runtimeMapCache.get(safeMap);
  if (existing === workshopId) return;
  runtimeMapCache.set(safeMap, workshopId);
  try {
    writeRuntimeCache(runtimeCachePath);
    console.log('[workshop-auto] runtime_mapping_saved', {
      map: safeMap,
      workshopId,
      source,
      runtimeCachePath,
    });
  } catch (error: any) {
    console.warn('[workshop-auto] runtime_cache_write_failed', {
      map: safeMap,
      workshopId,
      source,
      error: String(error?.message || error),
      runtimeCachePath,
    });
  }
};

const discoverFromProcessReports = (config: WorkshopMapConfigResolved): Map<string, string> => {
  const now = Date.now();
  if (now - discoveredFromReportsLoadedAtMs < 60_000 && discoveredFromReports.size > 0) {
    return discoveredFromReports;
  }
  discoveredFromReportsLoadedAtMs = now;
  const discovered = new Map<string, string>();
  if (!fs.existsSync(config.reportsDir)) {
    discoveredFromReports = discovered;
    return discovered;
  }
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(config.reportsDir, { withFileTypes: true });
  } catch {
    discoveredFromReports = discovered;
    return discovered;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name.toLowerCase();
    if (!name.endsWith('.process.json')) continue;
    const fullPath = path.join(config.reportsDir, entry.name);
    try {
      const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as any;
      if (String(parsed?.status || '').toLowerCase() !== 'success') continue;
      const mapName = sanitizeMapName(String(parsed?.mapName || ''));
      const workshopId = String(parsed?.workshopId || '').trim();
      const appId = Number(parsed?.appId || 0);
      if (!mapName || !isWorkshopId(workshopId) || appId !== config.appId) continue;
      discovered.set(mapName, workshopId);
    } catch {
      // ignore malformed report files
    }
  }
  discoveredFromReports = discovered;
  return discovered;
};

const readConfig = (): WorkshopMapConfigResolved => {
  const configPath = getConfigPath();
  const rootDir = getRootDir();
  const runtimeCachePath = getRuntimeCachePath();
  const reportsDir = getReportsDir();
  let fileMtimeMs = -1;
  if (fs.existsSync(configPath)) {
    fileMtimeMs = fs.statSync(configPath).mtimeMs;
  }
  if (cachedConfig && fileMtimeMs >= 0 && cachedConfigMtimeMs === fileMtimeMs) {
    return cachedConfig;
  }
  if (cachedConfig && fileMtimeMs < 0 && cachedConfigMtimeMs < 0) {
    return cachedConfig;
  }

  let fileData: WorkshopMapConfigFile = {};
  if (fs.existsSync(configPath)) {
    try {
      fileData = JSON.parse(fs.readFileSync(configPath, 'utf8')) as WorkshopMapConfigFile;
    } catch (error: any) {
      console.error('[workshop-auto] invalid config JSON', {
        configPath,
        error: String(error?.message || error),
      });
      fileData = {};
    }
  }

  const maps = parseMapTable(fileData.maps);
  const aliases = parseAliasTable(fileData.aliases);
  const queueStorePath = path.resolve(
    String(process.env.WORKSHOP_QUEUE_STORE_FILE || fileData.queueStorePath || path.join(rootDir, 'queue', 'workshop-jobs.json')),
  );
  const resolved: WorkshopMapConfigResolved = {
    enabled: parseBool(process.env.WORKSHOP_AUTO_DOWNLOAD_ENABLED, parseBool(fileData.enabled, DEFAULTS.enabled)),
    autoProcessEnabled: parseBool(
      process.env.WORKSHOP_AUTO_PROCESS_ENABLED,
      parseBool(fileData.autoProcessEnabled, DEFAULTS.autoProcessEnabled),
    ),
    assetResolutionMode: parseAssetResolutionMode(
      process.env.WORKSHOP_ASSET_RESOLUTION_MODE || fileData.assetResolutionMode,
      DEFAULTS.assetResolutionMode,
    ),
    sourceioMode: parseSourceioMode(
      process.env.WORKSHOP_SOURCEIO_MODE || fileData.sourceioMode,
      DEFAULTS.sourceioMode,
    ),
    appId: toPositiveInt(process.env.WORKSHOP_APP_ID || fileData.appId, DEFAULTS.appId),
    maps,
    aliases,
    maxRetries: Math.max(0, Math.min(10, toPositiveInt(process.env.WORKSHOP_MAX_RETRIES || fileData.maxRetries, DEFAULTS.maxRetries))),
    retryBaseMs: Math.max(1_000, toPositiveInt(process.env.WORKSHOP_RETRY_BASE_MS || fileData.retryBaseMs, DEFAULTS.retryBaseMs)),
    retryMaxMs: Math.max(10_000, toPositiveInt(process.env.WORKSHOP_RETRY_MAX_MS || fileData.retryMaxMs, DEFAULTS.retryMaxMs)),
    maxQueueSize: Math.max(10, Math.min(10_000, toPositiveInt(process.env.WORKSHOP_MAX_QUEUE_SIZE || fileData.maxQueueSize, DEFAULTS.maxQueueSize))),
    successCooldownMs: Math.max(
      0,
      toPositiveInt(process.env.WORKSHOP_SUCCESS_COOLDOWN_MS || fileData.successCooldownMs, DEFAULTS.successCooldownMs),
    ),
    downloadTimeoutMs: Math.max(
      5_000,
      toPositiveInt(process.env.WORKSHOP_DOWNLOAD_TIMEOUT_MS || fileData.downloadTimeoutMs, DEFAULTS.downloadTimeoutMs),
    ),
    processTimeoutMs: Math.max(
      30_000,
      toPositiveInt(process.env.WORKSHOP_PROCESS_TIMEOUT_MS || fileData.processTimeoutMs, DEFAULTS.processTimeoutMs),
    ),
    workerConcurrency: Math.max(
      1,
      Math.min(8, toPositiveInt(process.env.WORKSHOP_WORKER_CONCURRENCY || fileData.workerConcurrency, DEFAULTS.workerConcurrency)),
    ),
    queueStorePath,
    terminalRetentionDays: Math.max(
      1,
      Math.min(
        90,
        toPositiveInt(
          process.env.WORKSHOP_TERMINAL_RETENTION_DAYS || fileData.terminalRetentionDays,
          DEFAULTS.terminalRetentionDays,
        ),
      ),
    ),
    maxStoredJobs: Math.max(
      100,
      Math.min(100_000, toPositiveInt(process.env.WORKSHOP_MAX_STORED_JOBS || fileData.maxStoredJobs, DEFAULTS.maxStoredJobs)),
    ),
    rootDir,
    runtimeCachePath,
    reportsDir,
    configPath,
  };

  cachedConfig = resolved;
  cachedConfigMtimeMs = fileMtimeMs;
  loadRuntimeCache(resolved.runtimeCachePath);
  discoverFromProcessReports(resolved);
  return resolved;
};

const resolveWorkshopId = (
  mapHint: MapHint,
  config: WorkshopMapConfigResolved,
): { normalizedMap: string; workshopId?: string; resolutionSource: string } => {
  const normalizedMap = sanitizeMapName(mapHint.mapName);
  if (!normalizedMap) return { normalizedMap: '', resolutionSource: 'invalid_map' };

  if (mapHint.workshopId && isWorkshopId(mapHint.workshopId)) {
    return { normalizedMap, workshopId: mapHint.workshopId, resolutionSource: 'map_hint' };
  }

  const aliasTarget = config.aliases[normalizedMap];
  const mapKey = aliasTarget || normalizedMap;
  const workshopId = config.maps[mapKey];
  if (workshopId) {
    return { normalizedMap: mapKey, workshopId, resolutionSource: aliasTarget ? 'static_alias' : 'static_map' };
  }

  const runtimeId = runtimeMapCache.get(mapKey);
  if (runtimeId && isWorkshopId(runtimeId)) {
    return { normalizedMap: mapKey, workshopId: runtimeId, resolutionSource: 'runtime_cache' };
  }

  const discovered = discoverFromProcessReports(config).get(mapKey);
  if (discovered && isWorkshopId(discovered)) {
    rememberRuntimeMapping(mapKey, discovered, 'report_discovery', config.runtimeCachePath);
    return { normalizedMap: mapKey, workshopId: discovered, resolutionSource: 'process_report' };
  }

  return { normalizedMap: mapKey, resolutionSource: 'unmapped' };
};

const computeRetryDelayMs = (
  attempt: number,
  config: WorkshopMapConfigResolved,
): number => {
  const exp = Math.max(0, attempt - 1);
  const base = config.retryBaseMs * Math.pow(2, exp);
  return Math.min(config.retryMaxMs, Math.max(config.retryBaseMs, Math.floor(base)));
};

const tailLines = (input: string, max = 80): string[] =>
  input
    .split(/\r?\n/g)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(-max);

const readReportSummary = (
  reportPath: string,
): {
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
} => {
  const absolute = String(reportPath || '').trim();
  if (!absolute || !fs.existsSync(absolute)) {
    return { exists: false };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(absolute, 'utf8')) as Record<string, unknown>;
    const statusValue = String(parsed?.status || '').trim();
    const errorValue = String(parsed?.error || '').trim();
    const finishedAtValue = String(parsed?.finishedAt || '').trim();
    const okRaw = parsed?.ok;
    const sourceioEngineUsed = String((parsed as any)?.settings?.sourceioEngineUsed || '').trim();
    const materialsWithTextureRaw = Number((parsed as any)?.materials?.withTexture);
    const materialsTotalRaw = Number((parsed as any)?.materials?.total);
    const modelsExportedRaw = Number((parsed as any)?.models?.exported);
    const modelsTotalRaw = Number((parsed as any)?.models?.total);
    const warningsRaw = (parsed as any)?.warnings;

    return {
      exists: true,
      ...(typeof okRaw === 'boolean' ? { ok: okRaw } : {}),
      ...(statusValue ? { status: statusValue } : {}),
      ...(errorValue ? { error: errorValue } : {}),
      ...(finishedAtValue ? { finishedAt: finishedAtValue } : {}),
      ...(sourceioEngineUsed ? { sourceioEngineUsed } : {}),
      ...(Number.isFinite(materialsWithTextureRaw) ? { materialsWithTexture: Math.max(0, Math.floor(materialsWithTextureRaw)) } : {}),
      ...(Number.isFinite(materialsTotalRaw) ? { materialsTotal: Math.max(0, Math.floor(materialsTotalRaw)) } : {}),
      ...(Number.isFinite(modelsExportedRaw) ? { modelsExported: Math.max(0, Math.floor(modelsExportedRaw)) } : {}),
      ...(Number.isFinite(modelsTotalRaw) ? { modelsTotal: Math.max(0, Math.floor(modelsTotalRaw)) } : {}),
      ...(Array.isArray(warningsRaw) ? { warningsCount: warningsRaw.length } : {}),
    };
  } catch (error: any) {
    return {
      exists: true,
      error: `report_parse_failed:${String(error?.message || error)}`,
    };
  }
};

const resolveTsNodeRunner = (): { command: string; argsPrefix: string[] } => {
  const tsNodeJs = path.resolve(WORKSPACE_ROOT, 'server', 'node_modules', 'ts-node', 'dist', 'bin.js');
  if (fs.existsSync(tsNodeJs)) {
    return {
      command: process.execPath,
      argsPrefix: [tsNodeJs],
    };
  }
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return {
    command: npxCmd,
    argsPrefix: ['ts-node'],
  };
};

const runCommandWithTimeout = (
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<JobRunResult> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: WORKSPACE_ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    let timedOut = false;
    const killTimer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // best effort kill
      }
    }, timeoutMs);
    killTimer.unref?.();

    const append = (chunk: unknown) => {
      const text = String(chunk || '');
      if (!text) return;
      output += text;
      if (output.length > 1024 * 1024) {
        output = output.slice(output.length - 1024 * 1024);
      }
    };

    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', (error) => {
      clearTimeout(killTimer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(killTimer);
      resolve({
        exitCode: typeof code === 'number' ? code : -1,
        ...(signal ? { signal: String(signal) } : {}),
        timedOut,
        outputTail: tailLines(output, 120),
      });
    });
  });

const runDownloadProcess = (job: PersistedWorkshopJob, config: WorkshopMapConfigResolved): Promise<JobRunResult> => {
  const runner = resolveTsNodeRunner();
  const args = runner.argsPrefix.concat([
    path.join('server', 'src', 'scripts', 'downloadWorkshopMap.ts'),
    '--id',
    job.workshopId,
    '--app-id',
    String(job.appId),
  ]);
  if (job.refresh) args.push('--refresh');
  return runCommandWithTimeout(runner.command, args, config.downloadTimeoutMs);
};

const runProcessMapPipeline = (
  job: PersistedWorkshopJob,
  config: WorkshopMapConfigResolved,
): Promise<JobRunResult> => {
  const runner = resolveTsNodeRunner();
  const args = runner.argsPrefix.concat([
    path.join('server', 'src', 'scripts', 'processWorkshopMap.ts'),
    '--id',
    job.workshopId,
    '--map',
    job.mapName,
    '--app-id',
    String(job.appId),
    '--asset-resolution-mode',
    config.assetResolutionMode,
    '--sourceio-mode',
    config.sourceioMode,
  ]);
  return runCommandWithTimeout(runner.command, args, config.processTimeoutMs);
};

const parseStatus = (value: unknown): PersistedJobStatus | null => {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'queued') return 'queued';
  if (raw === 'running') return 'running';
  if (raw === 'retry_wait') return 'retry_wait';
  if (raw === 'success') return 'success';
  if (raw === 'failed') return 'failed';
  if (raw === 'dropped') return 'dropped';
  return null;
};

const normalizeStoredJob = (raw: unknown): PersistedWorkshopJob | null => {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;

  const id = String(src.id || '').trim();
  const appId = toPositiveInt(src.appId, 0);
  const workshopId = String(src.workshopId || '').trim();
  const mapName = sanitizeMapName(String(src.mapName || ''));
  const keyRaw = String(src.key || '').trim();
  const status = parseStatus(src.status);

  if (!id || !appId || !isWorkshopId(workshopId) || !mapName || !status) return null;

  const key = keyRaw || `${appId}:${workshopId}:${mapName}`;
  const createdAt = String(src.createdAt || '').trim() || nowIso();
  const updatedAt = String(src.updatedAt || '').trim() || createdAt;
  const enqueuedAtMs = Math.max(0, toInt(src.enqueuedAtMs, Date.now()));
  const nextRunAtMs = Math.max(0, toInt(src.nextRunAtMs, enqueuedAtMs));
  const retryCount = Math.max(0, Math.min(1000, toInt(src.retryCount, 0)));
  const runCount = Math.max(0, Math.min(1000, toInt(src.runCount, 0)));
  const maxRetries = Math.max(0, Math.min(10, toInt(src.maxRetries, DEFAULTS.maxRetries)));

  return {
    id,
    key,
    appId,
    workshopId,
    mapName,
    serverId: String(src.serverId || '').trim() || 'unknown',
    source: (String(src.source || '').trim() as TriggerSource) || 'manual',
    resolutionSource: String(src.resolutionSource || '').trim() || 'unknown',
    refresh: parseBool(src.refresh, false),
    maxRetries,
    retryCount,
    runCount,
    status,
    createdAt,
    updatedAt,
    enqueuedAtMs,
    nextRunAtMs,
    ...(String(src.lastStartedAt || '').trim() ? { lastStartedAt: String(src.lastStartedAt) } : {}),
    ...(String(src.lastFinishedAt || '').trim() ? { lastFinishedAt: String(src.lastFinishedAt) } : {}),
    ...(String(src.lastError || '').trim() ? { lastError: String(src.lastError) } : {}),
    ...(Number.isFinite(Number(src.lastExitCode)) ? { lastExitCode: Number(src.lastExitCode) } : {}),
    ...(String(src.lastSignal || '').trim() ? { lastSignal: String(src.lastSignal) } : {}),
    ...(typeof src.downloadTimedOut === 'boolean' ? { downloadTimedOut: src.downloadTimedOut } : {}),
    ...(typeof src.processTimedOut === 'boolean' ? { processTimedOut: src.processTimedOut } : {}),
    ...(Array.isArray(src.outputTail)
      ? { outputTail: (src.outputTail as unknown[]).map((item) => String(item || '')).slice(-120) }
      : {}),
    downloadReportPath: String(src.downloadReportPath || '').trim() || '',
    processReportPath: String(src.processReportPath || '').trim() || '',
    extractReportPath: String(src.extractReportPath || '').trim() || '',
  };
};

const serializeStore = (): QueueStoreFile => ({
  version: 1,
  updatedAt: nowIso(),
  jobs: Array.from(jobsById.values()).sort((a, b) => a.enqueuedAtMs - b.enqueuedAtMs || a.id.localeCompare(b.id)),
});

const pruneStoredJobs = (config: WorkshopMapConfigResolved) => {
  const retentionMs = config.terminalRetentionDays * 24 * 60 * 60 * 1000;
  const now = Date.now();

  for (const [id, job] of jobsById.entries()) {
    if (!TERMINAL_STATUS.has(job.status)) continue;
    const finishedTs = Date.parse(job.lastFinishedAt || job.updatedAt || job.createdAt);
    const ageMs = Number.isFinite(finishedTs) ? now - finishedTs : Number.POSITIVE_INFINITY;
    if (ageMs > retentionMs) {
      jobsById.delete(id);
    }
  }

  if (jobsById.size <= config.maxStoredJobs) return;

  const terminal = Array.from(jobsById.values())
    .filter((job) => TERMINAL_STATUS.has(job.status))
    .sort((a, b) => {
      const at = Date.parse(a.lastFinishedAt || a.updatedAt || a.createdAt);
      const bt = Date.parse(b.lastFinishedAt || b.updatedAt || b.createdAt);
      return at - bt || a.enqueuedAtMs - b.enqueuedAtMs;
    });

  for (const job of terminal) {
    if (jobsById.size <= config.maxStoredJobs) break;
    jobsById.delete(job.id);
  }
};

const saveQueueStore = (config: WorkshopMapConfigResolved) => {
  pruneStoredJobs(config);
  try {
    writeJsonAtomic(config.queueStorePath, serializeStore());
  } catch (error: any) {
    console.error('[workshop-auto] queue_store_save_failed', {
      queueStorePath: config.queueStorePath,
      error: String(error?.message || error),
    });
  }
};

const loadQueueStoreIfNeeded = (config: WorkshopMapConfigResolved) => {
  if (queueStoreLoaded && queueStorePathLoaded === config.queueStorePath) return;

  queueStoreLoaded = true;
  queueStorePathLoaded = config.queueStorePath;
  jobsById = new Map<string, PersistedWorkshopJob>();
  activeJobIds.clear();
  recentSuccessByKey.clear();

  if (!fs.existsSync(config.queueStorePath)) {
    saveQueueStore(config);
    return;
  }

  let parsed: QueueStoreFile | null = null;
  try {
    parsed = JSON.parse(fs.readFileSync(config.queueStorePath, 'utf8')) as QueueStoreFile;
  } catch (error: any) {
    console.error('[workshop-auto] queue_store_load_failed', {
      queueStorePath: config.queueStorePath,
      error: String(error?.message || error),
    });
    parsed = null;
  }

  const jobs = Array.isArray(parsed?.jobs) ? parsed?.jobs : [];
  const now = Date.now();
  for (const rawJob of jobs) {
    const job = normalizeStoredJob(rawJob);
    if (!job) continue;

    if (job.status === 'running') {
      job.status = 'retry_wait';
      job.nextRunAtMs = now + 1_000;
      job.retryCount = Math.max(0, job.retryCount + 1);
      job.lastError = 'recovered_after_process_restart';
      job.updatedAt = nowIso();
    }

    if (!job.downloadReportPath) {
      job.downloadReportPath = path.join(config.reportsDir, `${job.workshopId}.download.json`);
    }
    if (!job.processReportPath) {
      job.processReportPath = path.join(config.reportsDir, `${job.workshopId}.${job.mapName}.process.json`);
    }
    if (!job.extractReportPath) {
      job.extractReportPath = path.join(config.reportsDir, `${job.workshopId}.${job.mapName}.extract.json`);
    }

    if (job.status === 'success') {
      const lastTs = Date.parse(job.lastFinishedAt || job.updatedAt || job.createdAt);
      if (Number.isFinite(lastTs)) {
        recentSuccessByKey.set(job.key, lastTs);
      }
    }

    jobsById.set(job.id, job);
  }

  saveQueueStore(config);
};

const findActiveJobByKey = (key: string): PersistedWorkshopJob | undefined => {
  for (const job of jobsById.values()) {
    if (job.key !== key) continue;
    if (!ACTIVE_STATUS.has(job.status)) continue;
    return job;
  }
  return undefined;
};

const countPendingJobs = (): number => {
  let total = 0;
  for (const job of jobsById.values()) {
    if (ACTIVE_STATUS.has(job.status)) total += 1;
  }
  return total;
};

const dropOldestPendingJob = (config: WorkshopMapConfigResolved): PersistedWorkshopJob | null => {
  const candidates = Array.from(jobsById.values())
    .filter((job) => job.status === 'queued' || job.status === 'retry_wait')
    .sort((a, b) => a.enqueuedAtMs - b.enqueuedAtMs || a.id.localeCompare(b.id));
  const oldest = candidates[0];
  if (!oldest) return null;

  oldest.status = 'dropped';
  oldest.updatedAt = nowIso();
  oldest.lastFinishedAt = nowIso();
  oldest.lastError = `dropped_by_backpressure:maxQueueSize=${config.maxQueueSize}`;
  jobsById.set(oldest.id, oldest);
  saveQueueStore(config);
  return oldest;
};

const pickReadyJobs = (): PersistedWorkshopJob[] => {
  const now = Date.now();
  return Array.from(jobsById.values())
    .filter((job) => {
      if (job.status !== 'queued' && job.status !== 'retry_wait') return false;
      return job.nextRunAtMs <= now;
    })
    .sort((a, b) => a.nextRunAtMs - b.nextRunAtMs || a.enqueuedAtMs - b.enqueuedAtMs || a.id.localeCompare(b.id));
};

const scheduleWakeTimer = () => {
  if (wakeTimer) {
    clearTimeout(wakeTimer);
    wakeTimer = null;
  }

  if (!started || !runtimeEnabled) return;

  let nextAt = Number.POSITIVE_INFINITY;
  for (const job of jobsById.values()) {
    if (job.status !== 'queued' && job.status !== 'retry_wait') continue;
    nextAt = Math.min(nextAt, job.nextRunAtMs);
  }

  if (!Number.isFinite(nextAt)) return;
  const delay = Math.max(50, nextAt - Date.now());
  wakeTimer = setTimeout(() => {
    wakeTimer = null;
    void processQueue();
  }, delay);
  wakeTimer.unref?.();
};

const updateJob = (job: PersistedWorkshopJob) => {
  job.updatedAt = nowIso();
  jobsById.set(job.id, job);
};

const processOneJob = async (jobId: string, config: WorkshopMapConfigResolved) => {
  const job = jobsById.get(jobId);
  if (!job) {
    activeJobIds.delete(jobId);
    return;
  }

  console.log('[workshop-auto] worker_job_start', JSON.stringify({
    id: job.id,
    key: job.key,
    map: job.mapName,
    workshopId: job.workshopId,
    retryCount: job.retryCount,
    maxRetries: job.maxRetries,
    runCount: job.runCount,
    source: job.source,
    serverId: job.serverId,
  }));

  let downloadResult: JobRunResult | null = null;
  let processResult: JobRunResult | null = null;
  let downloadError: unknown = null;
  let processError: unknown = null;

  try {
    try {
      downloadResult = await runDownloadProcess(job, config);
    } catch (error) {
      downloadError = error;
    }

    if (!downloadError && downloadResult && downloadResult.exitCode === 0 && config.autoProcessEnabled) {
      try {
        processResult = await runProcessMapPipeline(job, config);
      } catch (error) {
        processError = error;
      }
    }

    const failed =
      downloadError !== null
      || !downloadResult
      || downloadResult.exitCode !== 0
      || processError !== null
      || (config.autoProcessEnabled && (!processResult || processResult.exitCode !== 0));

    if (!failed) {
      job.status = 'success';
      job.lastFinishedAt = nowIso();
      delete job.lastError;
      job.lastExitCode = processResult ? processResult.exitCode : downloadResult!.exitCode;
      const successSignal = processResult?.signal || downloadResult!.signal;
      if (successSignal) job.lastSignal = successSignal;
      else delete job.lastSignal;
      if (typeof downloadResult?.timedOut === 'boolean') job.downloadTimedOut = downloadResult.timedOut;
      else delete job.downloadTimedOut;
      if (typeof processResult?.timedOut === 'boolean') job.processTimedOut = processResult.timedOut;
      else delete job.processTimedOut;
      job.outputTail = (processResult?.outputTail || downloadResult?.outputTail || []).slice(-20);
      recentSuccessByKey.set(job.key, Date.now());
      rememberRuntimeMapping(job.mapName, job.workshopId, 'successful_job', config.runtimeCachePath);
      updateJob(job);
      saveQueueStore(config);

      console.log('[workshop-auto] worker_job_success', JSON.stringify({
        id: job.id,
        key: job.key,
        map: job.mapName,
        workshopId: job.workshopId,
      }));
      return;
    }

    const reason = (() => {
      if (downloadError) {
        return `download_error:${String((downloadError as any)?.message || downloadError)}`;
      }
      if (!downloadResult) {
        return 'download_result_missing';
      }
      if (downloadResult.timedOut) {
        return `download_timeout_${downloadResult.exitCode}${downloadResult.signal ? `_signal_${downloadResult.signal}` : ''}`;
      }
      if (downloadResult.exitCode !== 0) {
        return `download_exit_${downloadResult.exitCode}${downloadResult.signal ? `_signal_${downloadResult.signal}` : ''}`;
      }
      if (!config.autoProcessEnabled) {
        return `download_exit_${downloadResult.exitCode}${downloadResult.signal ? `_signal_${downloadResult.signal}` : ''}`;
      }
      if (processError) {
        return `process_error:${String((processError as any)?.message || processError)}`;
      }
      if (!processResult) {
        return 'process_result_missing';
      }
      if (processResult.timedOut) {
        return `process_timeout_${processResult.exitCode}${processResult.signal ? `_signal_${processResult.signal}` : ''}`;
      }
      return `process_exit_${processResult.exitCode}${processResult.signal ? `_signal_${processResult.signal}` : ''}`;
    })();

    const nextRetryCount = job.retryCount + 1;
    const canRetry = nextRetryCount <= job.maxRetries;

    job.retryCount = nextRetryCount;
    job.lastError = reason;
    const failedExitCode = processResult?.exitCode ?? downloadResult?.exitCode;
    if (typeof failedExitCode === 'number') job.lastExitCode = failedExitCode;
    else delete job.lastExitCode;
    const failedSignal = processResult?.signal || downloadResult?.signal;
    if (failedSignal) job.lastSignal = failedSignal;
    else delete job.lastSignal;
    if (typeof downloadResult?.timedOut === 'boolean') job.downloadTimedOut = downloadResult.timedOut;
    else delete job.downloadTimedOut;
    if (typeof processResult?.timedOut === 'boolean') job.processTimedOut = processResult.timedOut;
    else delete job.processTimedOut;
    job.outputTail = [
      ...(downloadResult?.outputTail || []),
      ...(processResult?.outputTail || []),
    ].slice(-20);

    if (canRetry) {
      const delayMs = computeRetryDelayMs(nextRetryCount, config);
      job.status = 'retry_wait';
      job.nextRunAtMs = Date.now() + delayMs;
      updateJob(job);
      saveQueueStore(config);

      console.warn('[workshop-auto] worker_job_retry_scheduled', JSON.stringify({
        id: job.id,
        key: job.key,
        map: job.mapName,
        workshopId: job.workshopId,
        retryCount: job.retryCount,
        maxRetries: job.maxRetries,
        nextInMs: delayMs,
        reason,
        ...(downloadResult ? { downloadTimedOut: downloadResult.timedOut } : {}),
        ...(processResult ? { processTimedOut: processResult.timedOut } : {}),
      }));
      return;
    }

    job.status = 'failed';
    job.lastFinishedAt = nowIso();
    updateJob(job);
    saveQueueStore(config);

    console.error('[workshop-auto] worker_job_failed', JSON.stringify({
      id: job.id,
      key: job.key,
      map: job.mapName,
      workshopId: job.workshopId,
      retryCount: job.retryCount,
      maxRetries: job.maxRetries,
      reason,
      ...(downloadResult ? { downloadTimedOut: downloadResult.timedOut } : {}),
      ...(processResult ? { processTimedOut: processResult.timedOut } : {}),
    }));
  } finally {
    activeJobIds.delete(jobId);
    scheduleWakeTimer();
    void processQueue();
  }
};

const processQueue = async () => {
  if (!started || !runtimeEnabled) return;

  const config = readConfig();
  loadQueueStoreIfNeeded(config);

  if (!config.enabled) {
    scheduleWakeTimer();
    return;
  }

  while (activeJobIds.size < config.workerConcurrency) {
    const ready = pickReadyJobs();
    const nextJob = ready[0];
    if (!nextJob) break;

    nextJob.status = 'running';
    nextJob.runCount += 1;
    nextJob.lastStartedAt = nowIso();
    nextJob.downloadTimedOut = false;
    nextJob.processTimedOut = false;
    updateJob(nextJob);
    saveQueueStore(config);

    activeJobIds.add(nextJob.id);
    void processOneJob(nextJob.id, config);
  }

  scheduleWakeTimer();
};

const createJob = (
  mapName: string,
  workshopId: string,
  appId: number,
  serverId: string,
  source: TriggerSource,
  resolutionSource: string,
  refresh: boolean,
  config: WorkshopMapConfigResolved,
): PersistedWorkshopJob => {
  const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const key = `${appId}:${workshopId}:${mapName}`;
  const nowMs = Date.now();
  const ts = nowIso();

  return {
    id,
    key,
    appId,
    workshopId,
    mapName,
    serverId,
    source,
    resolutionSource,
    refresh,
    maxRetries: config.maxRetries,
    retryCount: 0,
    runCount: 0,
    status: 'queued',
    createdAt: ts,
    updatedAt: ts,
    enqueuedAtMs: nowMs,
    nextRunAtMs: nowMs,
    downloadReportPath: path.join(config.reportsDir, `${workshopId}.download.json`),
    processReportPath: path.join(config.reportsDir, `${workshopId}.${mapName}.process.json`),
    extractReportPath: path.join(config.reportsDir, `${workshopId}.${mapName}.extract.json`),
  };
};

const enqueueJob = (
  mapName: string,
  workshopId: string,
  serverId: string,
  source: TriggerSource,
  resolutionSource: string,
  refresh: boolean,
  config: WorkshopMapConfigResolved,
) : EnqueueResult => {
  loadQueueStoreIfNeeded(config);

  const key = `${config.appId}:${workshopId}:${mapName}`;
  const active = findActiveJobByKey(key);
  if (active) {
    active.updatedAt = nowIso();
    active.serverId = serverId;
    active.source = source;
    if (active.status === 'retry_wait') {
      active.nextRunAtMs = Math.min(active.nextRunAtMs, Date.now());
    }
    jobsById.set(active.id, active);
    saveQueueStore(config);

    console.log('[workshop-auto] queue_dedupe_hit', JSON.stringify({
      key,
      activeJobId: active.id,
      status: active.status,
      map: mapName,
      workshopId,
    }));
    return {
      queued: false,
      deduped: true,
      reason: 'active_job_already_exists',
      job: active,
    };
  }

  let droppedOldestJobId: string | undefined;
  const pendingCount = countPendingJobs();
  if (pendingCount >= config.maxQueueSize) {
    const dropped = dropOldestPendingJob(config);
    if (!dropped) {
      console.warn('[workshop-auto] queue_full_reject', JSON.stringify({
        map: mapName,
        workshopId,
        maxQueueSize: config.maxQueueSize,
      }));
      return {
        queued: false,
        deduped: false,
        reason: 'queue_full_no_droppable_job',
      };
    }
    droppedOldestJobId = dropped.id;
    console.warn('[workshop-auto] queue_backpressure_drop', JSON.stringify({
      droppedJobId: dropped.id,
      droppedMap: dropped.mapName,
      droppedWorkshopId: dropped.workshopId,
      maxQueueSize: config.maxQueueSize,
    }));
  }

  const job = createJob(
    mapName,
    workshopId,
    config.appId,
    serverId,
    source,
    resolutionSource,
    refresh,
    config,
  );

  jobsById.set(job.id, job);
  saveQueueStore(config);

  console.log('[workshop-auto] queued', JSON.stringify({
    id: job.id,
    key: job.key,
    map: job.mapName,
    workshopId: job.workshopId,
    resolutionSource,
    source,
    serverId,
    pending: countPendingJobs(),
    active: activeJobIds.size,
  }));

  scheduleWakeTimer();
  void processQueue();

  return {
    queued: true,
    deduped: false,
    reason: 'queued',
    ...(droppedOldestJobId ? { droppedOldestJobId } : {}),
    job,
  };
};

export const notifyMapObservedForWorkshop = (input: NotifyInput) => {
  if (!started || !runtimeEnabled) return;

  const serverId = String(input.serverId || '').trim();
  const rawMap = String(input.mapName || '').trim();
  if (!serverId || !rawMap) return;

  const mapHint = parseMapHint(rawMap);
  const normalizedIncomingMap = sanitizeMapName(mapHint.mapName);
  if (!normalizedIncomingMap) return;

  const previousMap = serverLastMap.get(serverId);
  if (previousMap === normalizedIncomingMap) return;
  serverLastMap.set(serverId, normalizedIncomingMap);

  const config = readConfig();
  loadQueueStoreIfNeeded(config);
  if (!config.enabled) return;

  const resolved = resolveWorkshopId(mapHint, config);
  if (!resolved.workshopId) {
    if (!warnedMissingMap.has(resolved.normalizedMap)) {
      warnedMissingMap.add(resolved.normalizedMap);
      console.warn('[workshop-auto] map_without_workshop_mapping', JSON.stringify({
        map: resolved.normalizedMap,
        source: input.source,
        serverId,
        configPath: config.configPath,
      }));
    }
    return;
  }

  if (resolved.resolutionSource === 'map_hint' || resolved.resolutionSource === 'process_report') {
    rememberRuntimeMapping(resolved.normalizedMap, resolved.workshopId, resolved.resolutionSource, config.runtimeCachePath);
  }

  const key = `${config.appId}:${resolved.workshopId}:${resolved.normalizedMap}`;

  const recentSuccessTs = recentSuccessByKey.get(key);
  if (
    typeof recentSuccessTs === 'number'
    && config.successCooldownMs > 0
    && Date.now() - recentSuccessTs < config.successCooldownMs
  ) {
    return;
  }

  enqueueJob(
    resolved.normalizedMap,
    resolved.workshopId,
    serverId,
    input.source,
    resolved.resolutionSource,
    false,
    config,
  );

};

export const enqueueWorkshopAutoDownloadManual = (input: {
  serverId?: string;
  mapName: string;
  workshopId?: string;
  refresh?: boolean;
}) => {
  const serverId = String(input.serverId || 'admin').trim() || 'admin';
  const rawMap = String(input.mapName || '').trim();
  const rawWorkshopId = String(input.workshopId || '').trim();
  const refresh = parseBool(input.refresh, false);

  if (!started || !runtimeEnabled) {
    return {
      ok: false,
      queued: false,
      deduped: false,
      reason: 'worker_not_running',
    };
  }

  const mapName = sanitizeMapName(rawMap);
  if (!mapName) {
    return {
      ok: false,
      queued: false,
      deduped: false,
      reason: 'invalid_map_name',
    };
  }

  const config = readConfig();
  loadQueueStoreIfNeeded(config);
  if (!config.enabled) {
    return {
      ok: false,
      queued: false,
      deduped: false,
      reason: 'worker_disabled_by_config',
    };
  }

  let workshopId = '';
  let resolutionSource = 'manual_input';
  if (rawWorkshopId) {
    if (!isWorkshopId(rawWorkshopId)) {
      return {
        ok: false,
        queued: false,
        deduped: false,
        reason: 'invalid_workshop_id',
      };
    }
    workshopId = rawWorkshopId;
  } else {
    const resolved = resolveWorkshopId({ mapName }, config);
    if (!resolved.workshopId) {
      return {
        ok: false,
        queued: false,
        deduped: false,
        reason: 'workshop_id_not_resolved_for_map',
      };
    }
    workshopId = resolved.workshopId;
    resolutionSource = resolved.resolutionSource;
  }

  const enqueue = enqueueJob(
    mapName,
    workshopId,
    serverId,
    'manual',
    resolutionSource,
    refresh,
    config,
  );

  return {
    ok: true,
    queued: enqueue.queued,
    deduped: enqueue.deduped,
    reason: enqueue.reason,
    mapName,
    workshopId,
    refresh,
    resolutionSource,
    ...(enqueue.droppedOldestJobId ? { droppedOldestJobId: enqueue.droppedOldestJobId } : {}),
    ...(enqueue.job
      ? {
          job: {
            id: enqueue.job.id,
            key: enqueue.job.key,
            status: enqueue.job.status,
            retryCount: enqueue.job.retryCount,
            maxRetries: enqueue.job.maxRetries,
            reports: {
              download: enqueue.job.downloadReportPath,
              process: enqueue.job.processReportPath,
              extract: enqueue.job.extractReportPath,
            },
          },
        }
      : {}),
  };
};

export const getWorkshopAutoDownloadQueueSnapshot = (limitRaw?: number): WorkshopQueueSnapshot => {
  const config = readConfig();
  loadQueueStoreIfNeeded(config);

  const limit = Math.max(1, Math.min(500, toInt(limitRaw, 100)));

  const counts = {
    total: jobsById.size,
    queued: 0,
    running: 0,
    retry_wait: 0,
    success: 0,
    failed: 0,
    dropped: 0,
    pending: 0,
  };

  for (const job of jobsById.values()) {
    if (job.status === 'queued') counts.queued += 1;
    else if (job.status === 'running') counts.running += 1;
    else if (job.status === 'retry_wait') counts.retry_wait += 1;
    else if (job.status === 'success') counts.success += 1;
    else if (job.status === 'failed') counts.failed += 1;
    else if (job.status === 'dropped') counts.dropped += 1;

    if (ACTIVE_STATUS.has(job.status)) counts.pending += 1;
  }

  const now = Date.now();
  const jobs = Array.from(jobsById.values())
    .sort((a, b) => {
      const at = Date.parse(a.updatedAt || a.createdAt);
      const bt = Date.parse(b.updatedAt || b.createdAt);
      return bt - at || b.enqueuedAtMs - a.enqueuedAtMs;
    })
    .slice(0, limit)
    .map((job) => ({
      id: job.id,
      key: job.key,
      status: job.status,
      appId: job.appId,
      workshopId: job.workshopId,
      mapName: job.mapName,
      serverId: job.serverId,
      source: job.source,
      resolutionSource: job.resolutionSource,
      refresh: job.refresh,
      retryCount: job.retryCount,
      maxRetries: job.maxRetries,
      runCount: job.runCount,
      enqueuedAt: new Date(job.enqueuedAtMs).toISOString(),
      updatedAt: job.updatedAt,
      nextRunAt: new Date(job.nextRunAtMs).toISOString(),
      nextRunInMs: Math.max(0, job.nextRunAtMs - now),
      ...(job.lastStartedAt ? { lastStartedAt: job.lastStartedAt } : {}),
      ...(job.lastFinishedAt ? { lastFinishedAt: job.lastFinishedAt } : {}),
      ...(job.lastError ? { lastError: job.lastError } : {}),
      ...(Number.isFinite(job.lastExitCode) ? { lastExitCode: job.lastExitCode } : {}),
      ...(job.lastSignal ? { lastSignal: job.lastSignal } : {}),
      ...(typeof job.downloadTimedOut === 'boolean' ? { downloadTimedOut: job.downloadTimedOut } : {}),
      ...(typeof job.processTimedOut === 'boolean' ? { processTimedOut: job.processTimedOut } : {}),
      ...(Array.isArray(job.outputTail) && job.outputTail.length
        ? {
            outputTail: job.outputTail.slice(-20),
          }
        : {}),
      reportSummary: {
        download: readReportSummary(job.downloadReportPath),
        process: readReportSummary(job.processReportPath),
        extract: readReportSummary(job.extractReportPath),
      },
      reports: {
        download: job.downloadReportPath,
        process: job.processReportPath,
        extract: job.extractReportPath,
      },
    }));

  return {
    now: nowIso(),
    runtimeEnabled,
    initialized: started,
    config: {
      enabled: config.enabled,
      autoProcessEnabled: config.autoProcessEnabled,
      appId: config.appId,
      workerConcurrency: config.workerConcurrency,
      maxQueueSize: config.maxQueueSize,
      maxRetries: config.maxRetries,
      retryBaseMs: config.retryBaseMs,
      retryMaxMs: config.retryMaxMs,
      downloadTimeoutMs: config.downloadTimeoutMs,
      processTimeoutMs: config.processTimeoutMs,
      successCooldownMs: config.successCooldownMs,
      queueStorePath: config.queueStorePath,
      reportsDir: config.reportsDir,
      runtimeCachePath: config.runtimeCachePath,
      configPath: config.configPath,
    },
    worker: {
      activeJobs: activeJobIds.size,
      wakeScheduled: Boolean(wakeTimer),
    },
    counts,
    jobs,
  };
};

export const startWorkshopAutoDownloadJob = () => {
  if (started) {
    return () => undefined;
  }
  started = true;
  runtimeEnabled = parseBool(process.env.WORKSHOP_AUTO_DOWNLOAD_ENABLED, true);

  const config = readConfig();
  loadQueueStoreIfNeeded(config);
  console.log('[workshop-auto] initialized', JSON.stringify({
    runtimeEnabled,
    configEnabled: config.enabled,
    autoProcessEnabled: config.autoProcessEnabled,
    assetResolutionMode: config.assetResolutionMode,
    sourceioMode: config.sourceioMode,
    downloadTimeoutMs: config.downloadTimeoutMs,
    processTimeoutMs: config.processTimeoutMs,
    workerConcurrency: config.workerConcurrency,
    appId: config.appId,
    mappedMaps: Object.keys(config.maps).length,
    runtimeMappedMaps: runtimeMapCache.size,
    aliases: Object.keys(config.aliases).length,
    queueStorePath: config.queueStorePath,
    reportsDir: config.reportsDir,
    runtimeCachePath: config.runtimeCachePath,
    configPath: config.configPath,
    pendingJobs: countPendingJobs(),
  }));

  scheduleWakeTimer();
  void processQueue();

  return () => {
    started = false;
    serverLastMap.clear();
    warnedMissingMap.clear();
    if (wakeTimer) {
      clearTimeout(wakeTimer);
      wakeTimer = null;
    }
    activeJobIds.clear();
  };
};

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
  runtimeCachePath: string;
  reportsDir: string;
  configPath: string;
};

type DownloadJob = {
  key: string;
  appId: number;
  workshopId: string;
  mapName: string;
  serverId: string;
  source: TriggerSource;
  attempt: number;
  nextRunAtMs: number;
  enqueuedAtMs: number;
  refresh: boolean;
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
};

let started = false;
let runtimeEnabled = true;
let queue: DownloadJob[] = [];
let inflightKeys = new Set<string>();
let serverLastMap = new Map<string, string>();
let warnedMissingMap = new Set<string>();
let recentSuccessByKey = new Map<string, number>();
let processing = false;
let wakeTimer: NodeJS.Timeout | null = null;
let cachedConfig: WorkshopMapConfigResolved | null = null;
let cachedConfigMtimeMs = -1;
let runtimeMapCache = new Map<string, string>();
let runtimeMapCacheLoaded = false;
let discoveredFromReports = new Map<string, string>();
let discoveredFromReportsLoadedAtMs = 0;

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

const getConfigPath = (): string =>
  path.resolve(String(process.env.WORKSHOP_MAPS_FILE || DEFAULT_CONFIG_PATH));

const getRuntimeCachePath = (): string =>
  path.resolve(String(process.env.WORKSHOP_RUNTIME_MAPS_FILE || DEFAULT_RUNTIME_CACHE_PATH));

const getReportsDir = (): string => {
  const rootDir = path.resolve(
    String(process.env.WORKSHOP_ROOT || (process.platform === 'linux' ? '/opt/backstabber/workshop' : path.join(WORKSPACE_ROOT, 'sandbox', 'workshop'))),
  );
  return path.resolve(String(process.env.WORKSHOP_REPORTS_DIR || path.join(rootDir, 'reports')));
};

const writeRuntimeCache = (targetPath: string) => {
  const payload: RuntimeMapCacheFile = {
    version: 1,
    updatedAt: new Date().toISOString(),
    mappings: Object.fromEntries(Array.from(runtimeMapCache.entries()).sort((a, b) => a[0].localeCompare(b[0]))),
  };
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
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

const runDownloadProcess = (job: DownloadJob, config: WorkshopMapConfigResolved): Promise<JobRunResult> => {
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
  job: DownloadJob,
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

const scheduleWakeTimer = () => {
  if (wakeTimer) {
    clearTimeout(wakeTimer);
    wakeTimer = null;
  }
  if (!queue.length) return;
  const nextAt = queue.reduce((min, job) => Math.min(min, job.nextRunAtMs), Number.POSITIVE_INFINITY);
  if (!Number.isFinite(nextAt)) return;
  const delay = Math.max(50, nextAt - Date.now());
  wakeTimer = setTimeout(() => {
    wakeTimer = null;
    void processQueue();
  }, delay);
  wakeTimer.unref?.();
};

const dequeueReadyJob = (): DownloadJob | null => {
  const now = Date.now();
  let bestIdx = -1;
  let bestTime = Number.POSITIVE_INFINITY;
  for (let i = 0; i < queue.length; i += 1) {
    const candidate = queue[i];
    if (!candidate) continue;
    if (candidate.nextRunAtMs <= now && candidate.nextRunAtMs < bestTime) {
      bestIdx = i;
      bestTime = candidate.nextRunAtMs;
    }
  }
  if (bestIdx < 0) return null;
  const [job] = queue.splice(bestIdx, 1);
  return job || null;
};

const processQueue = async () => {
  if (!started || !runtimeEnabled) return;
  if (processing) return;
  processing = true;
  try {
    while (true) {
      const job = dequeueReadyJob();
      if (!job) break;

      const config = readConfig();
      const beginTs = new Date().toISOString();
      console.log('[workshop-auto] download_start', JSON.stringify({
        key: job.key,
        map: job.mapName,
        workshopId: job.workshopId,
        attempt: job.attempt,
        source: job.source,
        serverId: job.serverId,
        startedAt: beginTs,
      }));

      let result: JobRunResult | null = null;
      let runError: unknown = null;
      try {
        result = await runDownloadProcess(job, config);
      } catch (error) {
        runError = error;
      }
      let processResult: JobRunResult | null = null;
      let processError: unknown = null;
      if (!runError && result && result.exitCode === 0 && config.autoProcessEnabled) {
        console.log('[workshop-auto] process_start', JSON.stringify({
          key: job.key,
          map: job.mapName,
          workshopId: job.workshopId,
          attempt: job.attempt,
          assetResolutionMode: config.assetResolutionMode,
          sourceioMode: config.sourceioMode,
        }));
        try {
          processResult = await runProcessMapPipeline(job, config);
        } catch (error) {
          processError = error;
        }
      }

      const failed =
        runError !== null
        || !result
        || result.exitCode !== 0
        || processError !== null
        || (config.autoProcessEnabled && (!processResult || processResult.exitCode !== 0));
      if (!failed) {
        const okResult = result as JobRunResult;
        recentSuccessByKey.set(job.key, Date.now());
        rememberRuntimeMapping(job.mapName, job.workshopId, 'successful_job', config.runtimeCachePath);
        inflightKeys.delete(job.key);
        console.log('[workshop-auto] download_ok', JSON.stringify({
          key: job.key,
          map: job.mapName,
          workshopId: job.workshopId,
          attempt: job.attempt,
          exitCode: okResult.exitCode,
          logTail: okResult.outputTail.slice(-5),
        }));
        if (config.autoProcessEnabled && processResult) {
          console.log('[workshop-auto] process_ok', JSON.stringify({
            key: job.key,
            map: job.mapName,
            workshopId: job.workshopId,
            attempt: job.attempt,
            exitCode: processResult.exitCode,
            logTail: processResult.outputTail.slice(-5),
          }));
        }
        continue;
      }

      const attempt = job.attempt + 1;
      const canRetry = attempt <= config.maxRetries;
      const errMsg = processError
        ? `process_error:${String((processError as any)?.message || processError)}`
        : runError
          ? `download_error:${String((runError as any)?.message || runError)}`
          : config.autoProcessEnabled
            ? `process_${processResult?.timedOut ? 'timeout' : 'exit'}_${processResult?.exitCode ?? 'unknown'}${processResult?.signal ? `_signal_${processResult.signal}` : ''}`
            : `download_${result?.timedOut ? 'timeout' : 'exit'}_${result?.exitCode ?? 'unknown'}${result?.signal ? `_signal_${result.signal}` : ''}`;

      if (canRetry) {
        const delay = computeRetryDelayMs(attempt, config);
        queue.push({
          ...job,
          attempt,
          nextRunAtMs: Date.now() + delay,
        });
        console.warn('[workshop-auto] download_retry_scheduled', JSON.stringify({
          key: job.key,
          map: job.mapName,
          workshopId: job.workshopId,
          attempt,
          nextInMs: delay,
          reason: errMsg,
          ...(result ? { downloadTimedOut: result.timedOut } : {}),
          ...(processResult ? { processTimedOut: processResult.timedOut } : {}),
          ...(result ? { downloadLogTail: result.outputTail.slice(-5) } : {}),
          ...(processResult ? { processLogTail: processResult.outputTail.slice(-5) } : {}),
        }));
        continue;
      }

      inflightKeys.delete(job.key);
      console.error('[workshop-auto] download_failed', JSON.stringify({
        key: job.key,
        map: job.mapName,
        workshopId: job.workshopId,
        attempts: attempt,
        reason: errMsg,
        ...(result ? { downloadTimedOut: result.timedOut } : {}),
        ...(processResult ? { processTimedOut: processResult.timedOut } : {}),
        ...(result ? { downloadLogTail: result.outputTail.slice(-10) } : {}),
        ...(processResult ? { processLogTail: processResult.outputTail.slice(-10) } : {}),
      }));
    }
  } finally {
    processing = false;
    scheduleWakeTimer();
  }
};

const enqueueJob = (job: DownloadJob, config: WorkshopMapConfigResolved) => {
  if (queue.length >= config.maxQueueSize) {
    const dropped = queue.shift();
    if (dropped) {
      inflightKeys.delete(dropped.key);
      console.warn('[workshop-auto] queue_drop_oldest', JSON.stringify({
        droppedKey: dropped.key,
        droppedMap: dropped.mapName,
        queueSize: queue.length,
        maxQueueSize: config.maxQueueSize,
      }));
    }
  }
  queue.push(job);
  scheduleWakeTimer();
  void processQueue();
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

  const key = `${config.appId}:${resolved.workshopId}`;
  if (inflightKeys.has(key)) return;

  const recentSuccessTs = recentSuccessByKey.get(key);
  if (
    typeof recentSuccessTs === 'number'
    && config.successCooldownMs > 0
    && Date.now() - recentSuccessTs < config.successCooldownMs
  ) {
    return;
  }

  inflightKeys.add(key);
  enqueueJob(
    {
      key,
      appId: config.appId,
      workshopId: resolved.workshopId,
      mapName: resolved.normalizedMap,
      serverId,
      source: input.source,
      attempt: 0,
      nextRunAtMs: Date.now(),
      enqueuedAtMs: Date.now(),
      refresh: false,
    },
    config,
  );

  console.log('[workshop-auto] queued', JSON.stringify({
    key,
    map: resolved.normalizedMap,
    workshopId: resolved.workshopId,
    resolutionSource: resolved.resolutionSource,
    source: input.source,
    serverId,
    queueSize: queue.length,
  }));
};

export const startWorkshopAutoDownloadJob = () => {
  if (started) {
    return () => undefined;
  }
  started = true;
  runtimeEnabled = parseBool(process.env.WORKSHOP_AUTO_DOWNLOAD_ENABLED, true);

  const config = readConfig();
  console.log('[workshop-auto] initialized', JSON.stringify({
    runtimeEnabled,
    configEnabled: config.enabled,
    autoProcessEnabled: config.autoProcessEnabled,
    assetResolutionMode: config.assetResolutionMode,
    sourceioMode: config.sourceioMode,
    downloadTimeoutMs: config.downloadTimeoutMs,
    processTimeoutMs: config.processTimeoutMs,
    appId: config.appId,
    mappedMaps: Object.keys(config.maps).length,
    runtimeMappedMaps: runtimeMapCache.size,
    aliases: Object.keys(config.aliases).length,
    reportsDir: config.reportsDir,
    runtimeCachePath: config.runtimeCachePath,
    configPath: config.configPath,
  }));

  return () => {
    started = false;
    queue = [];
    inflightKeys.clear();
    serverLastMap.clear();
    warnedMissingMap.clear();
    recentSuccessByKey.clear();
    if (wakeTimer) {
      clearTimeout(wakeTimer);
      wakeTimer = null;
    }
  };
};

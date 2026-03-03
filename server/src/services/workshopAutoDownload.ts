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
  outputTail: string[];
};

const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_CONFIG_PATH = path.resolve(WORKSPACE_ROOT, 'server', 'config', 'workshop-maps.json');
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

const normalizeMap = (raw: string): string => {
  const trimmed = String(raw || '').trim().toLowerCase();
  if (!trimmed) return '';
  return trimmed.endsWith('.bsp') ? trimmed.slice(0, -4) : trimmed;
};

const isWorkshopId = (raw: unknown): raw is string => /^\d+$/.test(String(raw || '').trim());

const parseMapTable = (input: unknown): Record<string, string> => {
  if (!input || typeof input !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    const mapName = normalizeMap(rawKey);
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
    const alias = normalizeMap(rawKey);
    const target = normalizeMap(String(rawValue || ''));
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

const readConfig = (): WorkshopMapConfigResolved => {
  const configPath = getConfigPath();
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
    configPath,
  };

  cachedConfig = resolved;
  cachedConfigMtimeMs = fileMtimeMs;
  return resolved;
};

const resolveWorkshopId = (
  mapName: string,
  config: WorkshopMapConfigResolved,
): { normalizedMap: string; workshopId?: string } => {
  const normalizedMap = normalizeMap(mapName);
  if (!normalizedMap) return { normalizedMap: '' };

  const aliasTarget = config.aliases[normalizedMap];
  const mapKey = aliasTarget || normalizedMap;
  const workshopId = config.maps[mapKey];
  if (!workshopId) return { normalizedMap: mapKey };
  return { normalizedMap: mapKey, workshopId };
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

const runDownloadProcess = (job: DownloadJob): Promise<JobRunResult> =>
  new Promise((resolve, reject) => {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const args = [
      '--prefix',
      'server',
      'run',
      'workshop:download',
      '--',
      '--id',
      job.workshopId,
      '--app-id',
      String(job.appId),
    ];
    if (job.refresh) args.push('--refresh');

    const child = spawn(npmCmd, args, {
      cwd: WORKSPACE_ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
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
    child.on('error', (error) => reject(error));
    child.on('close', (code, signal) => {
      resolve({
        exitCode: typeof code === 'number' ? code : -1,
        ...(signal ? { signal: String(signal) } : {}),
        outputTail: tailLines(output, 120),
      });
    });
  });

const runProcessMapPipeline = (
  job: DownloadJob,
  config: WorkshopMapConfigResolved,
): Promise<JobRunResult> =>
  new Promise((resolve, reject) => {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const args = [
      '--prefix',
      'server',
      'run',
      'workshop:process-map',
      '--',
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
    ];
    const child = spawn(npmCmd, args, {
      cwd: WORKSPACE_ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
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
    child.on('error', (error) => reject(error));
    child.on('close', (code, signal) => {
      resolve({
        exitCode: typeof code === 'number' ? code : -1,
        ...(signal ? { signal: String(signal) } : {}),
        outputTail: tailLines(output, 120),
      });
    });
  });

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
        result = await runDownloadProcess(job);
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
            ? `process_exit_code_${processResult?.exitCode ?? 'unknown'}${processResult?.signal ? `_signal_${processResult.signal}` : ''}`
            : `download_exit_code_${result?.exitCode ?? 'unknown'}${result?.signal ? `_signal_${result.signal}` : ''}`;

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

  const normalizedIncomingMap = normalizeMap(rawMap);
  if (!normalizedIncomingMap) return;

  const previousMap = serverLastMap.get(serverId);
  if (previousMap === normalizedIncomingMap) return;
  serverLastMap.set(serverId, normalizedIncomingMap);

  const config = readConfig();
  if (!config.enabled) return;

  const resolved = resolveWorkshopId(normalizedIncomingMap, config);
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
    appId: config.appId,
    mappedMaps: Object.keys(config.maps).length,
    aliases: Object.keys(config.aliases).length,
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

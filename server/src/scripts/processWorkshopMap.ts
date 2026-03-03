import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';

type Status = 'success' | 'failed';

type Options = {
  workshopId: string;
  mapName: string;
  appId: number;
  rootDir: string;
  contentDir: string;
  contentCandidates: string[];
  extractDir: string;
  reportsDir: string;
  mountsPath: string;
  outDir: string;
  pipelineReportPath: string;
  auditReportPath: string;
  processReportPath: string;
  extractReportPath: string;
  pythonBin: string;
  extractScriptPath: string;
  pipelineMode: {
    assetResolutionMode: 'permissive' | 'strict';
    sourceioMode: 'auto' | 'required' | 'off';
  };
  cleanExtractDir: boolean;
  timeoutExtractMs: number;
  timeoutPipelineMs: number;
  staleLockMs: number;
  lockPath: string;
  cacheFilePath: string;
  cleanupEnabled: boolean;
  cleanupRetentionDays: number;
};

type StepResult = {
  name: 'cache' | 'extract' | 'pipeline';
  ok: boolean;
  durationMs: number;
  exitCode?: number;
  signal?: string;
  timedOut?: boolean;
  command: string[];
  logTail: string[];
  error?: string;
};

type ExtractReport = {
  ok: boolean;
  bspFiles?: string[];
  warnings?: string[];
  payloads?: Array<Record<string, unknown>>;
  error?: string;
};

type ProcessReport = {
  version: 1;
  status: Status;
  workshopId: string;
  mapName: string;
  appId: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  paths: {
    contentDir: string;
    extractDir: string;
    mountsPath: string;
    outDir: string;
    pipelineReportPath: string;
    auditReportPath: string;
    extractReportPath: string;
    lockPath: string;
  };
  selection: {
    selectedBsp?: string;
    derivedMapRoot?: string;
    candidates: string[];
    strategy: string;
  };
  steps: StepResult[];
  cache: {
    key: string;
    signature: string;
    hit: boolean;
    reason: string;
  };
  cleanup: {
    enabled: boolean;
    retentionDays: number;
    removedExtractDirs: number;
    removedReportFiles: number;
    removedLockFiles: number;
    errors: string[];
  };
  warnings: string[];
  error?: string;
};

type ProcessCacheEntry = {
  signature: string;
  processedAt: string;
  workshopId: string;
  mapName: string;
  selectedBsp?: string;
  derivedMapRoot?: string;
  outDir: string;
  pipelineReportPath: string;
};

type ProcessCacheFile = {
  version: 1;
  entries: Record<string, ProcessCacheEntry>;
};

const PROJECT_SERVER_ROOT = path.resolve(__dirname, '..', '..');
const PROJECT_ROOT = path.resolve(PROJECT_SERVER_ROOT, '..');
const isLinux = process.platform === 'linux';
const defaultRootDir = isLinux
  ? '/opt/backstabber/workshop'
  : path.join(PROJECT_ROOT, 'sandbox', 'workshop');

const DEFAULTS = {
  appId: 4000,
  timeoutExtractMs: 30 * 60 * 1000,
  timeoutPipelineMs: 120 * 60 * 1000,
  staleLockMs: 2 * 60 * 60 * 1000,
  cleanupRetentionDays: 14,
};

const toNum = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const normalizeMapName = (raw: string): string => {
  const value = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\\/g, '/');
  if (!value) return '';
  const base = value.includes('/') ? value.slice(value.lastIndexOf('/') + 1) : value;
  return base.endsWith('.bsp') ? base.slice(0, -4) : base;
};

const parseArgs = (): Map<string, string> => {
  const map = new Map<string, string>();
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = String(args[i] || '').trim();
    if (!arg || !arg.startsWith('--')) continue;
    if (arg.includes('=')) {
      const idx = arg.indexOf('=');
      map.set(arg.slice(0, idx), arg.slice(idx + 1));
      continue;
    }
    if (arg === '--clean-extract-dir') {
      map.set('--clean-extract-dir', '1');
      continue;
    }
    if (arg === '--no-clean-extract-dir') {
      map.set('--clean-extract-dir', '0');
      continue;
    }
    const next = String(args[i + 1] || '').trim();
    if (!next || next.startsWith('--')) throw new Error(`invalid_arg_value:${arg}`);
    map.set(arg, next);
    i += 1;
  }
  return map;
};

const resolveFlexiblePath = (raw: string): string => {
  const target = String(raw || '').trim();
  if (!target) return '';
  const fromCwd = path.resolve(target);
  const fromProject = path.resolve(PROJECT_ROOT, target);
  const fromServer = path.resolve(PROJECT_SERVER_ROOT, target);
  if (fs.existsSync(fromCwd)) return fromCwd;
  if (fs.existsSync(fromProject)) return fromProject;
  if (fs.existsSync(fromServer)) return fromServer;
  return fromProject;
};

type ContentPathSummary = {
  path: string;
  exists: boolean;
  files: number;
  totalBytes: number;
};

const summarizeContentPath = (target: string): ContentPathSummary => {
  const absolute = path.resolve(target);
  if (!fs.existsSync(absolute)) {
    return { path: absolute, exists: false, files: 0, totalBytes: 0 };
  }
  const stack = [absolute];
  let files = 0;
  let totalBytes = 0;
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.isFile()) {
        files += 1;
        try {
          totalBytes += fs.statSync(full).size;
        } catch {
          // best effort
        }
      }
    }
  }
  return { path: absolute, exists: true, files, totalBytes };
};

const readDownloadReportContentPath = (reportsDir: string, workshopId: string): string | null => {
  const reportPath = path.join(reportsDir, `${workshopId}.download.json`);
  if (!fs.existsSync(reportPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as Record<string, unknown>;
    const contentPath = String(parsed?.contentPath || '').trim();
    if (!contentPath) return null;
    return path.resolve(contentPath);
  } catch {
    return null;
  }
};

const buildContentCandidates = (
  rootDir: string,
  reportsDir: string,
  appId: number,
  workshopId: string,
): string[] => {
  const app = String(appId);
  const wid = String(workshopId);
  const homeDir = os.homedir();
  const fromReport = readDownloadReportContentPath(reportsDir, wid);
  const list = [
    ...(fromReport ? [fromReport] : []),
    path.join(rootDir, 'steamcmd', 'steamapps', 'workshop', 'content', app, wid),
    path.join(rootDir, 'steamapps', 'workshop', 'content', app, wid),
    path.join(homeDir, 'Steam', 'steamapps', 'workshop', 'content', app, wid),
    path.join(homeDir, '.steam', 'steam', 'steamapps', 'workshop', 'content', app, wid),
    path.join(homeDir, '.local', 'share', 'Steam', 'steamapps', 'workshop', 'content', app, wid),
    path.join(homeDir, '.steam', 'steamcmd', 'steamapps', 'workshop', 'content', app, wid),
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of list) {
    const normalized = path.resolve(candidate);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
};

const resolveBestContentDir = (
  rootDir: string,
  reportsDir: string,
  appId: number,
  workshopId: string,
): { contentDir: string; candidates: string[] } => {
  const candidates = buildContentCandidates(rootDir, reportsDir, appId, workshopId);
  const summaries = candidates.map(summarizeContentPath);
  const sorted = summaries.slice().sort((a, b) => {
    const aScore = (a.exists ? 1 : 0);
    const bScore = (b.exists ? 1 : 0);
    if (aScore !== bScore) return bScore - aScore;
    if (a.files !== b.files) return b.files - a.files;
    if (a.totalBytes !== b.totalBytes) return b.totalBytes - a.totalBytes;
    return a.path.localeCompare(b.path);
  });
  const best = sorted[0];
  return {
    contentDir: best?.path || candidates[0] || path.resolve(rootDir),
    candidates: summaries.map((entry) => `${entry.path}#exists=${entry.exists ? '1' : '0'}#files=${entry.files}`),
  };
};

const parseOptions = (): Options => {
  const args = parseArgs();
  const workshopId = String(args.get('--id') || process.env.WORKSHOP_ID || '').trim();
  const mapRawInput = String(args.get('--map') || process.env.WORKSHOP_MAP_NAME || '').trim();
  if (mapRawInput.includes('..') || mapRawInput.includes('/') || mapRawInput.includes('\\')) {
    throw new Error(`invalid_map_name_path_traversal:${mapRawInput}`);
  }
  const mapName = normalizeMapName(mapRawInput);
  if (!/^\d+$/.test(workshopId)) {
    throw new Error(`invalid_or_missing_workshop_id:${workshopId || '<empty>'}`);
  }
  if (!mapName) {
    throw new Error('missing_required_arg: --map=<map_name>');
  }
  if (mapName.includes('..') || mapName.includes('/') || mapName.includes('\\')) {
    throw new Error(`invalid_map_name_path_traversal:${mapName}`);
  }
  if (!/^[a-z0-9][a-z0-9_-]{1,127}$/.test(mapName)) {
    throw new Error(`invalid_map_name_format:${mapName}`);
  }

  const appId = toNum(args.get('--app-id') || process.env.WORKSHOP_APP_ID, DEFAULTS.appId);
  const rootDir = resolveFlexiblePath(String(args.get('--root-dir') || process.env.WORKSHOP_ROOT || defaultRootDir));
  const reportsDir = resolveFlexiblePath(String(args.get('--reports-dir') || path.join(rootDir, 'reports')));
  const explicitContentDirArg = String(args.get('--content-dir') || '').trim();
  const contentResolved = explicitContentDirArg
    ? {
        contentDir: resolveFlexiblePath(explicitContentDirArg),
        candidates: [resolveFlexiblePath(explicitContentDirArg)],
      }
    : resolveBestContentDir(rootDir, reportsDir, appId, workshopId);
  const contentDir = contentResolved.contentDir;
  const contentCandidates = contentResolved.candidates;
  const extractDir = resolveFlexiblePath(String(args.get('--extract-dir') || path.join(rootDir, 'extracted', workshopId)));
  const mountsPath = resolveFlexiblePath(
    String(args.get('--mounts') || process.env.WORKSHOP_MOUNTS_FILE || 'server/config/mounts.json'),
  );
  const outDir = resolveFlexiblePath(String(args.get('--out-dir') || path.join(PROJECT_ROOT, 'public', 'maps', mapName)));
  const pipelineReportPath = resolveFlexiblePath(
    String(args.get('--pipeline-report') || path.join(outDir, 'reports', 'report.json')),
  );
  const auditReportPath = resolveFlexiblePath(
    String(args.get('--audit-report') || path.join(PROJECT_ROOT, 'reports', `audit-${mapName}.json`)),
  );
  const processReportPath = resolveFlexiblePath(
    String(args.get('--report') || path.join(reportsDir, `${workshopId}.${mapName}.process.json`)),
  );
  const extractReportPath = resolveFlexiblePath(
    String(args.get('--extract-report') || path.join(reportsDir, `${workshopId}.${mapName}.extract.json`)),
  );
  const pythonBin = String(args.get('--python') || process.env.PYTHON || (isLinux ? 'python3' : 'python')).trim();
  const extractScriptPath = resolveFlexiblePath(
    String(args.get('--extract-script') || 'server/scripts/extract_workshop_payload.py'),
  );
  const assetResolutionModeRaw = String(args.get('--asset-resolution-mode') || 'permissive').trim().toLowerCase();
  const sourceioModeRaw = String(args.get('--sourceio-mode') || 'auto').trim().toLowerCase();
  const cleanExtractDirRaw = String(
    args.get('--clean-extract-dir') || process.env.WORKSHOP_PROCESS_CLEAN_EXTRACT_DIR || '1',
  ).trim().toLowerCase();
  const cleanExtractDir = ['1', 'true', 'yes', 'on'].includes(cleanExtractDirRaw);
  const timeoutExtractMs = toNum(args.get('--timeout-extract-ms') || process.env.WORKSHOP_PROCESS_TIMEOUT_EXTRACT_MS, DEFAULTS.timeoutExtractMs);
  const timeoutPipelineMs = toNum(args.get('--timeout-pipeline-ms') || process.env.WORKSHOP_PROCESS_TIMEOUT_PIPELINE_MS, DEFAULTS.timeoutPipelineMs);
  const staleLockMs = toNum(args.get('--stale-lock-ms') || process.env.WORKSHOP_STALE_LOCK_MS, DEFAULTS.staleLockMs);
  const cleanupEnabledRaw = String(
    args.get('--cleanup-enabled') || process.env.WORKSHOP_PROCESS_CLEANUP_ENABLED || '1',
  ).trim().toLowerCase();
  const cleanupEnabled = ['1', 'true', 'yes', 'on'].includes(cleanupEnabledRaw);
  const cleanupRetentionDays = Math.max(
    1,
    toNum(args.get('--cleanup-retention-days') || process.env.WORKSHOP_CLEANUP_RETENTION_DAYS, DEFAULTS.cleanupRetentionDays),
  );
  const lockPath = path.join(rootDir, 'locks', `process_${appId}_${workshopId}_${mapName}.lock`);
  const cacheFilePath = path.join(reportsDir, 'process-cache.json');

  return {
    workshopId,
    mapName,
    appId,
    rootDir,
    contentDir,
    contentCandidates,
    extractDir,
    reportsDir,
    mountsPath,
    outDir,
    pipelineReportPath,
    auditReportPath,
    processReportPath,
    extractReportPath,
    pythonBin,
    extractScriptPath,
    pipelineMode: {
      assetResolutionMode: assetResolutionModeRaw === 'strict' ? 'strict' : 'permissive',
      sourceioMode: sourceioModeRaw === 'required' ? 'required' : sourceioModeRaw === 'off' ? 'off' : 'auto',
    },
    cleanExtractDir,
    timeoutExtractMs,
    timeoutPipelineMs,
    staleLockMs,
    lockPath,
    cacheFilePath,
    cleanupEnabled,
    cleanupRetentionDays,
  };
};

const ensureDir = (target: string) => fs.mkdirSync(target, { recursive: true });

const writeJson = (target: string, value: unknown) => {
  ensureDir(path.dirname(target));
  fs.writeFileSync(target, JSON.stringify(value, null, 2) + '\n', 'utf8');
};

const safeReadJson = (target: string): any | null => {
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch {
    return null;
  }
};

const readProcessCache = (cachePath: string): ProcessCacheFile => {
  const parsed = safeReadJson(cachePath);
  if (!parsed || typeof parsed !== 'object') return { version: 1, entries: {} };
  const entries = (parsed as any).entries;
  if (!entries || typeof entries !== 'object') return { version: 1, entries: {} };
  return { version: 1, entries: entries as Record<string, ProcessCacheEntry> };
};

const writeProcessCache = (cachePath: string, cache: ProcessCacheFile) => {
  writeJson(cachePath, cache);
};

const tailLines = (raw: string, max = 120): string[] =>
  raw
    .split(/\r?\n/g)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(-max);

const acquireLock = (lockPath: string, staleMs: number): { ok: boolean; reason?: string } => {
  ensureDir(path.dirname(lockPath));
  try {
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(
      fd,
      JSON.stringify({ pid: process.pid, host: os.hostname(), startedAt: new Date().toISOString() }, null, 2) + '\n',
      'utf8',
    );
    fs.closeSync(fd);
    return { ok: true };
  } catch (error: any) {
    if (error?.code !== 'EEXIST') return { ok: false, reason: String(error?.message || error) };
    try {
      const stat = fs.statSync(lockPath);
      if (Date.now() - stat.mtimeMs > staleMs) {
        fs.rmSync(lockPath, { force: true });
        const fd = fs.openSync(lockPath, 'wx');
        fs.writeFileSync(
          fd,
          JSON.stringify({ pid: process.pid, host: os.hostname(), startedAt: new Date().toISOString(), staleRecovered: true }, null, 2) + '\n',
          'utf8',
        );
        fs.closeSync(fd);
        return { ok: true };
      }
      return { ok: false, reason: 'lock_in_use' };
    } catch (statError: any) {
      return { ok: false, reason: `lock_stat_failed:${String(statError?.message || statError)}` };
    }
  }
};

const releaseLock = (lockPath: string) => {
  try {
    fs.rmSync(lockPath, { force: true });
  } catch {
    // best effort
  }
};

const runStep = (
  name: StepResult['name'],
  command: string,
  args: string[],
  timeoutMs: number,
  cwd: string,
): StepResult => {
  const started = Date.now();
  const exec = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024 * 64,
    env: process.env,
  });
  const durationMs = Math.max(0, Date.now() - started);
  const output = `${String(exec.stdout || '')}\n${String(exec.stderr || '')}`;
  const logTail = tailLines(output, 120);
  const step: StepResult = {
    name,
    ok: !exec.error && exec.status === 0,
    durationMs,
    command: [command].concat(args),
    logTail,
  };
  if (typeof exec.status === 'number') step.exitCode = exec.status;
  if (exec.signal) step.signal = exec.signal;
  if (exec.error) {
    const errorMessage = String(exec.error.message || exec.error);
    const timedOut = /timed out|timeout|etimedout/i.test(errorMessage);
    if (timedOut) {
      step.timedOut = true;
      step.error = `timeout_after_ms:${timeoutMs}`;
    } else {
      step.error = errorMessage;
    }
  }
  if (!step.ok && !step.error) step.error = `exit_code_${String(exec.status)}`;
  return step;
};

const deriveMapRoot = (bspPath: string): string => {
  const normalized = path.normalize(bspPath);
  const parts = normalized.split(path.sep);
  const lower = parts.map((p) => p.toLowerCase());
  const mapsIdx = lower.lastIndexOf('maps');
  if (mapsIdx > 0) {
    return parts.slice(0, mapsIdx).join(path.sep);
  }
  return path.dirname(normalized);
};

const resolveTsNodeCommand = (): { command: string; argsPrefix: string[] } => {
  const tsNodeJs = resolveFlexiblePath(
    path.join('server', 'node_modules', 'ts-node', 'dist', 'bin.js'),
  );
  if (fs.existsSync(tsNodeJs)) {
    return { command: process.execPath, argsPrefix: [tsNodeJs] };
  }
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  return { command: npxCmd, argsPrefix: ['ts-node'] };
};

const pickBspForMap = (bspCandidates: string[], mapName: string): string | null => {
  if (!bspCandidates.length) return null;
  const normalizedMap = normalizeMapName(mapName);
  const scored = bspCandidates
    .map((candidate) => {
      const base = normalizeMapName(path.basename(candidate));
      let score = 0;
      if (base === normalizedMap) score += 100;
      if (candidate.toLowerCase().includes(`/maps/${normalizedMap}.bsp`.replace(/\//g, path.sep.toLowerCase()))) score += 20;
      if (base.includes(normalizedMap)) score += 10;
      return { candidate, score };
    })
    .sort((a, b) => b.score - a.score || a.candidate.localeCompare(b.candidate));
  return scored[0]?.candidate || null;
};

const computeContentSignature = (contentDir: string): string => {
  const files: string[] = [];
  const stack = [contentDir];
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
      } else if (entry.isFile()) {
        files.push(absolute);
      }
    }
  }
  files.sort((a, b) => a.localeCompare(b));
  const hash = crypto.createHash('sha1');
  hash.update('content-signature-v1\n');
  for (const file of files) {
    let size = 0;
    let mtimeMs = 0;
    try {
      const stat = fs.statSync(file);
      size = stat.size;
      mtimeMs = Math.floor(stat.mtimeMs);
    } catch {
      // ignore stat failures for signature; still deterministic over available files
    }
    const rel = path.relative(contentDir, file).replace(/\\/g, '/');
    hash.update(`${rel}|${size}|${mtimeMs}\n`);
  }
  return hash.digest('hex');
};

const pruneOldFiles = (
  baseDir: string,
  predicate: (absolutePath: string) => boolean,
  maxAgeMs: number,
): { removed: number; errors: string[] } => {
  const out = { removed: 0, errors: [] as string[] };
  if (!fs.existsSync(baseDir)) return out;
  const now = Date.now();
  const stack = [baseDir];
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (error: any) {
      out.errors.push(`scan_failed:${current}:${String(error?.message || error)}`);
      continue;
    }
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!predicate(absolute)) continue;
      try {
        const stat = fs.statSync(absolute);
        if (now - stat.mtimeMs < maxAgeMs) continue;
        fs.rmSync(absolute, { force: true });
        out.removed += 1;
      } catch (error: any) {
        out.errors.push(`remove_failed:${absolute}:${String(error?.message || error)}`);
      }
    }
  }
  return out;
};

const pruneOldExtractDirs = (
  extractedRoot: string,
  keepWorkshopId: string,
  maxAgeMs: number,
): { removed: number; errors: string[] } => {
  const out = { removed: 0, errors: [] as string[] };
  if (!fs.existsSync(extractedRoot)) return out;
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(extractedRoot, { withFileTypes: true });
  } catch (error: any) {
    out.errors.push(`scan_failed:${extractedRoot}:${String(error?.message || error)}`);
    return out;
  }
  const now = Date.now();
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === keepWorkshopId) continue;
    const absolute = path.join(extractedRoot, entry.name);
    try {
      const stat = fs.statSync(absolute);
      if (now - stat.mtimeMs < maxAgeMs) continue;
      fs.rmSync(absolute, { recursive: true, force: true });
      out.removed += 1;
    } catch (error: any) {
      out.errors.push(`remove_failed:${absolute}:${String(error?.message || error)}`);
    }
  }
  return out;
};

const run = () => {
  const options = parseOptions();
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const steps: StepResult[] = [];
  const warnings: string[] = [];
  const selection: ProcessReport['selection'] = {
    candidates: [],
    strategy: 'exact_basename_then_maps_path_then_contains',
  };
  const cacheKey = `${options.appId}:${options.workshopId}:${options.mapName}`;
  const signature = computeContentSignature(options.contentDir);
  const cacheState: ProcessReport['cache'] = {
    key: cacheKey,
    signature,
    hit: false,
    reason: 'cache_miss_default',
  };
  const cleanupState: ProcessReport['cleanup'] = {
    enabled: options.cleanupEnabled,
    retentionDays: options.cleanupRetentionDays,
    removedExtractDirs: 0,
    removedReportFiles: 0,
    removedLockFiles: 0,
    errors: [],
  };
  let cleanupExecuted = false;

  const runCleanup = () => {
    if (cleanupExecuted) return;
    cleanupExecuted = true;
    if (!options.cleanupEnabled) return;
    const retentionMs = options.cleanupRetentionDays * 24 * 60 * 60 * 1000;
    const extractedRoot = path.join(options.rootDir, 'extracted');
    const pruneDirs = pruneOldExtractDirs(extractedRoot, options.workshopId, retentionMs);
    cleanupState.removedExtractDirs += pruneDirs.removed;
    cleanupState.errors.push(...pruneDirs.errors);

    const reportPrune = pruneOldFiles(
      options.reportsDir,
      (absolutePath) => /\.(extract|process|download)\.json$/i.test(path.basename(absolutePath)),
      retentionMs,
    );
    cleanupState.removedReportFiles += reportPrune.removed;
    cleanupState.errors.push(...reportPrune.errors);

    const locksDir = path.join(options.rootDir, 'locks');
    const lockPrune = pruneOldFiles(
      locksDir,
      (absolutePath) => absolutePath.toLowerCase().endsWith('.lock'),
      retentionMs,
    );
    cleanupState.removedLockFiles += lockPrune.removed;
    cleanupState.errors.push(...lockPrune.errors);
  };

  const reportBase: Omit<ProcessReport, 'status' | 'finishedAt' | 'durationMs'> = {
    version: 1,
    workshopId: options.workshopId,
    mapName: options.mapName,
    appId: options.appId,
    startedAt,
    paths: {
      contentDir: options.contentDir,
      extractDir: options.extractDir,
      mountsPath: options.mountsPath,
      outDir: options.outDir,
      pipelineReportPath: options.pipelineReportPath,
      auditReportPath: options.auditReportPath,
      extractReportPath: options.extractReportPath,
      lockPath: options.lockPath,
    },
    selection,
    steps,
    cache: cacheState,
    cleanup: cleanupState,
    warnings,
  };

  const finish = (status: Status, error?: string) => {
    runCleanup();
    const report: ProcessReport = {
      ...reportBase,
      status,
      finishedAt: new Date().toISOString(),
      durationMs: Math.max(0, Date.now() - startedAtMs),
      ...(error ? { error } : {}),
    };
    writeJson(options.processReportPath, report);
    if (status !== 'success') {
      throw new Error(error || 'process_failed');
    }
  };

  if (!fs.existsSync(options.contentDir)) {
    finish('failed', `workshop_content_dir_not_found:${options.contentDir}|candidates:${options.contentCandidates.join(',')}`);
    return;
  }
  if (!fs.existsSync(options.extractScriptPath)) {
    finish('failed', `extract_script_not_found:${options.extractScriptPath}`);
    return;
  }
  if (!fs.existsSync(options.mountsPath)) {
    warnings.push(`mounts_file_not_found:${options.mountsPath}`);
  }

  const lock = acquireLock(options.lockPath, options.staleLockMs);
  if (!lock.ok) {
    finish('failed', `process_lock_failed:${lock.reason || 'unknown'}`);
    return;
  }

  try {
    ensureDir(options.reportsDir);
    ensureDir(options.extractDir);
    ensureDir(path.dirname(options.pipelineReportPath));
    ensureDir(path.dirname(options.auditReportPath));

    const cacheFile = readProcessCache(options.cacheFilePath);
    const cachedEntry = cacheFile.entries[cacheKey];
    const manifestPath = path.join(options.outDir, 'manifest.json');
    if (
      cachedEntry
      && cachedEntry.signature === signature
      && fs.existsSync(options.pipelineReportPath)
      && fs.existsSync(manifestPath)
    ) {
      cacheState.hit = true;
      cacheState.reason = 'signature_match_and_outputs_present';
      if (cachedEntry.selectedBsp) selection.selectedBsp = cachedEntry.selectedBsp;
      if (cachedEntry.derivedMapRoot) selection.derivedMapRoot = cachedEntry.derivedMapRoot;
      steps.push({
        name: 'cache',
        ok: true,
        durationMs: 0,
        command: [],
        logTail: ['cache_hit: pipeline skipped'],
      });
      finish('success');
      return;
    }
    if (cachedEntry && cachedEntry.signature !== signature) {
      cacheState.reason = 'signature_changed';
    } else if (cachedEntry) {
      cacheState.reason = 'outputs_missing_rebuild';
    } else {
      cacheState.reason = 'entry_not_found';
    }

    steps.push({
      name: 'cache',
      ok: true,
      durationMs: 0,
      command: [],
      logTail: [cacheState.reason],
    });

    const extractArgs = [
      options.extractScriptPath,
      '--input-dir',
      options.contentDir,
      '--out-dir',
      options.extractDir,
      '--workshop-id',
      options.workshopId,
      '--report',
      options.extractReportPath,
      ...(options.cleanExtractDir ? ['--clean-out-dir'] : []),
    ];
    const extractStep = runStep('extract', options.pythonBin, extractArgs, options.timeoutExtractMs, PROJECT_ROOT);
    steps.push(extractStep);
    if (!extractStep.ok) {
      finish('failed', `extract_step_failed:${extractStep.error || 'unknown'}`);
      return;
    }

    const extractReport = safeReadJson(options.extractReportPath) as ExtractReport | null;
    if (!extractReport || extractReport.ok !== true) {
      finish('failed', `extract_report_invalid_or_failed:${options.extractReportPath}`);
      return;
    }
    if (Array.isArray(extractReport.warnings) && extractReport.warnings.length) {
      warnings.push(...extractReport.warnings.slice(0, 200).map((w) => String(w)));
    }

    const bspCandidates = Array.isArray(extractReport.bspFiles)
      ? extractReport.bspFiles
          .map((entry) => String(entry || '').trim())
          .filter(Boolean)
      : [];
    selection.candidates = bspCandidates.slice();
    const selectedBsp = pickBspForMap(bspCandidates, options.mapName);
    if (!selectedBsp) {
      finish('failed', `map_bsp_not_found_for_map:${options.mapName}`);
      return;
    }
    selection.selectedBsp = selectedBsp;
    const mapRoot = deriveMapRoot(selectedBsp);
    selection.derivedMapRoot = mapRoot;

    const tsNodeRunner = resolveTsNodeCommand();
    const pipelineArgs = tsNodeRunner.argsPrefix.concat([
      path.join('server', 'src', 'scripts', 'buildMapPipeline.ts'),
      '--map-bsp',
      selectedBsp,
      '--map-root',
      mapRoot,
      '--mounts',
      options.mountsPath,
      '--audit-report',
      options.auditReportPath,
      '--out-dir',
      options.outDir,
      '--report',
      options.pipelineReportPath,
      '--asset-resolution-mode',
      options.pipelineMode.assetResolutionMode,
      '--sourceio-mode',
      options.pipelineMode.sourceioMode,
    ]);
    const pipelineStep = runStep('pipeline', tsNodeRunner.command, pipelineArgs, options.timeoutPipelineMs, PROJECT_ROOT);
    steps.push(pipelineStep);
    if (!pipelineStep.ok) {
      finish('failed', `pipeline_step_failed:${pipelineStep.error || 'unknown'}`);
      return;
    }

    cacheFile.entries[cacheKey] = {
      signature,
      processedAt: new Date().toISOString(),
      workshopId: options.workshopId,
      mapName: options.mapName,
      ...(selection.selectedBsp ? { selectedBsp: selection.selectedBsp } : {}),
      ...(selection.derivedMapRoot ? { derivedMapRoot: selection.derivedMapRoot } : {}),
      outDir: options.outDir,
      pipelineReportPath: options.pipelineReportPath,
    };
    writeProcessCache(options.cacheFilePath, cacheFile);

    finish('success');
  } finally {
    runCleanup();
    releaseLock(options.lockPath);
  }
};

run();

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

type Status = 'success' | 'failed' | 'cached';

type Options = {
  workshopId: string;
  appId: number;
  refresh: boolean;
  rootDir: string;
  reportsDir: string;
  locksDir: string;
  steamcmdDir: string;
  steamcmdBin: string;
  steamUser: string;
  steamPass?: string;
  timeoutMs: number;
  staleLockMs: number;
};

type ItemFilesSummary = {
  filesCount: number;
  totalBytes: number;
  gmaFiles: string[];
  bspFiles: string[];
};

type DownloadReport = {
  version: 1;
  status: Status;
  appId: number;
  workshopId: string;
  refresh: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  contentPath: string;
  filesCount: number;
  totalBytes: number;
  gmaFiles: string[];
  bspFiles: string[];
  steamcmd: {
    bin: string;
    installDir: string;
    exitCode?: number;
    signal?: string;
    timedOut: boolean;
    args: string[];
  };
  lock: {
    path: string;
    staleLockMs: number;
  };
  logTail: string[];
  error?: string;
};

type ArgMap = Map<string, string>;

const PROJECT_SERVER_ROOT = path.resolve(__dirname, '..', '..');
const PROJECT_ROOT = path.resolve(PROJECT_SERVER_ROOT, '..');
const isLinux = process.platform === 'linux';
const defaultRootDir = isLinux
  ? '/opt/backstabber/workshop'
  : path.join(PROJECT_ROOT, 'sandbox', 'workshop');

const DEFAULTS = {
  appId: 4000,
  timeoutMs: 30 * 60 * 1000,
  staleLockMs: 2 * 60 * 60 * 1000,
};

const envOr = (name: string, fallback: string): string => {
  const value = String(process.env[name] || '').trim();
  return value || fallback;
};

const parsePositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const parseArgsMap = (): ArgMap => {
  const map = new Map<string, string>();
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const raw = String(args[i] || '').trim();
    if (!raw) continue;
    if (!raw.startsWith('--')) continue;
    if (raw.includes('=')) {
      const idx = raw.indexOf('=');
      map.set(raw.slice(0, idx), raw.slice(idx + 1));
      continue;
    }
    if (raw === '--refresh') {
      map.set('--refresh', '1');
      continue;
    }
    if (raw === '--no-refresh') {
      map.set('--refresh', '0');
      continue;
    }
    const next = String(args[i + 1] || '').trim();
    if (!next || next.startsWith('--')) {
      throw new Error(`invalid_arg_value:${raw}`);
    }
    map.set(raw, next);
    i += 1;
  }
  return map;
};

const resolveSteamcmdBin = (preferred: string, steamcmdDir: string): string => {
  const explicit = String(preferred || '').trim();
  if (explicit) return explicit;

  const localLinux = path.join(steamcmdDir, 'steamcmd.sh');
  const localWin = path.join(steamcmdDir, 'steamcmd.exe');
  if (fs.existsSync(localLinux)) return localLinux;
  if (fs.existsSync(localWin)) return localWin;

  return 'steamcmd';
};

const parseOptions = (): Options => {
  const args = parseArgsMap();
  const workshopIdRaw = String(
    args.get('--id')
      || args.get('--workshop-id')
      || process.env.WORKSHOP_ID
      || '',
  ).trim();
  if (!workshopIdRaw) {
    throw new Error('missing_required_arg: --id=<workshopId>');
  }
  if (!/^\d+$/.test(workshopIdRaw)) {
    throw new Error(`invalid_workshop_id:${workshopIdRaw}`);
  }

  const appId = parsePositiveInt(
    args.get('--app-id') || process.env.WORKSHOP_APP_ID,
    DEFAULTS.appId,
  );
  const refreshFlagRaw = String(
    args.get('--refresh')
      || process.env.WORKSHOP_REFRESH
      || '',
  ).trim().toLowerCase();
  const refresh = ['1', 'true', 'yes', 'on'].includes(refreshFlagRaw);
  const rootDir = path.resolve(
    String(args.get('--root-dir') || envOr('WORKSHOP_ROOT', defaultRootDir)),
  );
  const reportsDir = path.resolve(
    String(args.get('--reports-dir') || envOr('WORKSHOP_REPORTS_DIR', path.join(rootDir, 'reports'))),
  );
  const locksDir = path.resolve(
    String(args.get('--locks-dir') || envOr('WORKSHOP_LOCKS_DIR', path.join(rootDir, 'locks'))),
  );
  const steamcmdDir = path.resolve(
    String(args.get('--steamcmd-dir') || envOr('WORKSHOP_STEAMCMD_DIR', path.join(rootDir, 'steamcmd'))),
  );
  const steamcmdBin = resolveSteamcmdBin(
    String(args.get('--steamcmd-bin') || process.env.WORKSHOP_STEAMCMD_BIN || ''),
    steamcmdDir,
  );
  const steamUser = String(args.get('--steam-user') || process.env.WORKSHOP_STEAM_USER || 'anonymous').trim();
  if (!steamUser) throw new Error('invalid_steam_user');
  const steamPassRaw = String(args.get('--steam-pass') || process.env.WORKSHOP_STEAM_PASS || '').trim();
  const timeoutMs = parsePositiveInt(
    args.get('--timeout-ms') || process.env.WORKSHOP_TIMEOUT_MS,
    DEFAULTS.timeoutMs,
  );
  const staleLockMs = parsePositiveInt(
    args.get('--stale-lock-ms') || process.env.WORKSHOP_STALE_LOCK_MS,
    DEFAULTS.staleLockMs,
  );

  return {
    workshopId: workshopIdRaw,
    appId,
    refresh,
    rootDir,
    reportsDir,
    locksDir,
    steamcmdDir,
    steamcmdBin,
    steamUser,
    ...(steamPassRaw ? { steamPass: steamPassRaw } : {}),
    timeoutMs,
    staleLockMs,
  };
};

const ensureDir = (target: string) => {
  fs.mkdirSync(target, { recursive: true });
};

const nowIso = () => new Date().toISOString();

const safeReadJson = (target: string): Record<string, unknown> | null => {
  try {
    const raw = fs.readFileSync(target, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
};

const writeJson = (target: string, data: unknown) => {
  ensureDir(path.dirname(target));
  fs.writeFileSync(target, JSON.stringify(data, null, 2) + '\n', 'utf8');
};

const collectItemFiles = (itemPath: string): ItemFilesSummary => {
  if (!fs.existsSync(itemPath)) {
    return { filesCount: 0, totalBytes: 0, gmaFiles: [], bspFiles: [] };
  }

  const files: string[] = [];
  const stack = [itemPath];
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
        continue;
      }
      if (entry.isFile()) files.push(absolute);
    }
  }

  let totalBytes = 0;
  const gmaFiles: string[] = [];
  const bspFiles: string[] = [];
  for (const file of files) {
    try {
      totalBytes += fs.statSync(file).size;
    } catch {
      // ignore stat errors and keep deterministic counting for available files
    }
    const rel = path.relative(itemPath, file).replace(/\\/g, '/');
    const lower = rel.toLowerCase();
    if (lower.endsWith('.gma')) gmaFiles.push(rel);
    if (lower.endsWith('.bsp')) bspFiles.push(rel);
  }

  gmaFiles.sort();
  bspFiles.sort();
  return {
    filesCount: files.length,
    totalBytes,
    gmaFiles,
    bspFiles,
  };
};

const hasUsableMapPayload = (summary: ItemFilesSummary): boolean =>
  summary.gmaFiles.length > 0 || summary.bspFiles.length > 0;

const tailLines = (input: string, max = 120): string[] =>
  input
    .split(/\r?\n/g)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(-max);

const sanitizeSteamcmdArgs = (args: string[], steamPass?: string): string[] => {
  if (!steamPass) return args.slice();
  return args.map((entry) => (entry === steamPass ? '<redacted>' : entry));
};

const tryAcquireLock = (
  lockPath: string,
  staleLockMs: number,
): { acquired: boolean; staleReclaimed: boolean; reason?: string } => {
  ensureDir(path.dirname(lockPath));
  const lockInfo = {
    pid: process.pid,
    host: os.hostname(),
    startedAt: nowIso(),
  };

  const attemptOpen = (): { acquired: boolean; staleReclaimed: boolean; reason?: string } => {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeFileSync(fd, JSON.stringify(lockInfo, null, 2) + '\n', 'utf8');
      fs.closeSync(fd);
      return { acquired: true, staleReclaimed: false };
    } catch (error: any) {
      if (error?.code !== 'EEXIST') {
        return { acquired: false, staleReclaimed: false, reason: String(error?.message || error) };
      }
      const stat = fs.existsSync(lockPath) ? fs.statSync(lockPath) : null;
      const ageMs = stat ? Date.now() - stat.mtimeMs : 0;
      if (!stat || ageMs <= staleLockMs) {
        const payload = safeReadJson(lockPath);
        const pid = payload && typeof payload.pid === 'number' ? payload.pid : undefined;
        const startedAt = payload && typeof payload.startedAt === 'string' ? payload.startedAt : undefined;
        return {
          acquired: false,
          staleReclaimed: false,
          reason: `lock_in_use pid=${pid || 'unknown'} startedAt=${startedAt || 'unknown'}`,
        };
      }
      try {
        fs.rmSync(lockPath, { force: true });
      } catch (rmError: any) {
        return {
          acquired: false,
          staleReclaimed: false,
          reason: `stale_lock_remove_failed:${String(rmError?.message || rmError)}`,
        };
      }
      return { acquired: false, staleReclaimed: true };
    }
  };

  const first = attemptOpen();
  if (first.acquired) return first;
  if (!first.staleReclaimed) return first;
  const second = attemptOpen();
  return {
    acquired: second.acquired,
    staleReclaimed: true,
    ...(second.reason ? { reason: second.reason } : {}),
  };
};

const run = () => {
  const options = parseOptions();
  const startedAtMs = Date.now();
  const startedAtIso = new Date(startedAtMs).toISOString();
  const lockPath = path.join(options.locksDir, `${options.appId}_${options.workshopId}.lock`);
  const reportPath = path.join(options.reportsDir, `${options.workshopId}.download.json`);
  const itemPath = path.join(
    options.steamcmdDir,
    'steamapps',
    'workshop',
    'content',
    String(options.appId),
    options.workshopId,
  );
  let lockHeld = false;
  const releaseLock = () => {
    if (!lockHeld) return;
    lockHeld = false;
    try {
      fs.rmSync(lockPath, { force: true });
    } catch {
      // best effort lock cleanup
    }
  };

  const createBaseReport = (status: Status): DownloadReport => ({
    version: 1,
    status,
    appId: options.appId,
    workshopId: options.workshopId,
    refresh: options.refresh,
    startedAt: startedAtIso,
    finishedAt: nowIso(),
    durationMs: Math.max(0, Date.now() - startedAtMs),
    contentPath: itemPath,
    filesCount: 0,
    totalBytes: 0,
    gmaFiles: [],
    bspFiles: [],
    steamcmd: {
      bin: options.steamcmdBin,
      installDir: options.steamcmdDir,
      timedOut: false,
      args: [],
    },
    lock: {
      path: lockPath,
      staleLockMs: options.staleLockMs,
    },
    logTail: [],
  });

  let failureReport: DownloadReport | null = null;

  try {
    ensureDir(options.rootDir);
    ensureDir(options.reportsDir);
    ensureDir(options.locksDir);
    ensureDir(options.steamcmdDir);

    const lockResult = tryAcquireLock(lockPath, options.staleLockMs);
    if (!lockResult.acquired) {
      const fail = createBaseReport('failed');
      fail.error = `download_lock_failed:${lockResult.reason || 'unknown'}`;
      fail.logTail = [`lock_path=${lockPath}`];
      failureReport = fail;
      throw new Error(fail.error);
    }
    lockHeld = true;

    if (!options.refresh) {
      const existing = collectItemFiles(itemPath);
      if (hasUsableMapPayload(existing)) {
        const report = createBaseReport('cached');
        report.filesCount = existing.filesCount;
        report.totalBytes = existing.totalBytes;
        report.gmaFiles = existing.gmaFiles;
        report.bspFiles = existing.bspFiles;
        report.logTail = ['cache_hit: existing workshop payload found'];
        writeJson(reportPath, report);
        console.log(`Workshop item cached: ${options.workshopId}`);
        console.log(`Report: ${reportPath}`);
        return;
      }
    }

    const args: string[] = [
      '+force_install_dir',
      options.steamcmdDir,
      '+login',
      options.steamUser,
      ...(options.steamUser !== 'anonymous'
        ? [options.steamPass || '']
        : []),
      '+workshop_download_item',
      String(options.appId),
      options.workshopId,
      '+quit',
    ];

    if (options.steamUser !== 'anonymous' && !options.steamPass) {
      throw new Error('steam_password_required_for_non_anonymous_login');
    }

    const exec = spawnSync(options.steamcmdBin, args, {
      encoding: 'utf8',
      timeout: options.timeoutMs,
      maxBuffer: 1024 * 1024 * 32,
    });
    const output = `${String(exec.stdout || '')}\n${String(exec.stderr || '')}`;
    const summary = collectItemFiles(itemPath);
    const report = createBaseReport('success');
    report.filesCount = summary.filesCount;
    report.totalBytes = summary.totalBytes;
    report.gmaFiles = summary.gmaFiles;
    report.bspFiles = summary.bspFiles;
    report.logTail = tailLines(output, 120);
    if (typeof exec.status === 'number') {
      report.steamcmd.exitCode = exec.status;
    }
    if (exec.signal) {
      report.steamcmd.signal = exec.signal;
    }
    report.steamcmd.timedOut = Boolean(exec.error && String((exec.error as any)?.message || '').toLowerCase().includes('timeout'));
    report.steamcmd.args = sanitizeSteamcmdArgs(args, options.steamPass);

    if (exec.error) {
      report.status = 'failed';
      report.error = `steamcmd_exec_error:${String(exec.error.message || exec.error)}`;
      failureReport = report;
      throw new Error(report.error);
    }

    if (exec.status !== 0) {
      report.status = 'failed';
      report.error = `steamcmd_exit_nonzero:${String(exec.status)}`;
      failureReport = report;
      throw new Error(report.error);
    }

    if (!hasUsableMapPayload(summary)) {
      report.status = 'failed';
      report.error = 'download_payload_empty:expected_gma_or_bsp';
      failureReport = report;
      throw new Error(report.error);
    }

    writeJson(reportPath, report);
    console.log(`Workshop item downloaded: ${options.workshopId}`);
    console.log(`Content: ${itemPath}`);
    console.log(`Report: ${reportPath}`);
  } catch (error: any) {
    const fail = failureReport || createBaseReport('failed');
    if (!fail.error) fail.error = String(error?.message || error);
    if (!fail.logTail.length) fail.logTail = [`error=${String(error?.message || error)}`];
    writeJson(reportPath, fail);
    throw error;
  } finally {
    releaseLock();
  }
};

run();

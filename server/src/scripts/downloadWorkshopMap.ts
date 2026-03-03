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
  steamcmdAutoInstall: boolean;
  steamcmdBootstrapUrl: string;
  steamcmdBootstrapTimeoutMs: number;
  timeoutMs: number;
  staleLockMs: number;
};

type ItemFilesSummary = {
  filesCount: number;
  totalBytes: number;
  gmaFiles: string[];
  bspFiles: string[];
  binFiles: string[];
  extensionlessFiles: string[];
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
  binFiles: string[];
  extensionlessFiles: string[];
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
  contentCandidates?: Array<{
    path: string;
    filesCount: number;
    totalBytes: number;
    gmaCount: number;
    bspCount: number;
    binCount: number;
    extensionlessCount: number;
  }>;
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
  steamcmdBootstrapTimeoutMs: 10 * 60 * 1000,
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
  const localLinuxAlt = path.join(steamcmdDir, 'steamcmd');
  if (fs.existsSync(localLinux)) return localLinux;
  if (fs.existsSync(localWin)) return localWin;
  if (fs.existsSync(localLinuxAlt)) return localLinuxAlt;

  if (process.platform === 'linux') {
    const linuxCandidates = [
      '/usr/games/steamcmd',
      '/usr/games/steamcmd.sh',
      '/usr/bin/steamcmd',
      '/usr/bin/steamcmd.sh',
      '/usr/local/bin/steamcmd',
      '/usr/local/bin/steamcmd.sh',
    ];
    for (const candidate of linuxCandidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  return 'steamcmd';
};

const isPathLikeExecutable = (value: string): boolean => /[\\/]/.test(value) || value.startsWith('.');

const resolveExecutableOnPath = (name: string): string | null => {
  const target = String(name || '').trim();
  if (!target) return null;
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const probe = spawnSync(cmd, [target], {
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
  });
  if (probe.error || probe.status !== 0) return null;
  const first = String(probe.stdout || '')
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .find(Boolean);
  return first || null;
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
  const steamcmdAutoInstallRaw = String(
    args.get('--steamcmd-auto-install')
      || process.env.WORKSHOP_STEAMCMD_AUTO_INSTALL
      || (process.platform === 'linux' ? '1' : '0'),
  ).trim().toLowerCase();
  const steamcmdAutoInstall = ['1', 'true', 'yes', 'on'].includes(steamcmdAutoInstallRaw);
  const steamcmdBootstrapUrl = String(
    args.get('--steamcmd-bootstrap-url')
      || process.env.WORKSHOP_STEAMCMD_BOOTSTRAP_URL
      || 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz',
  ).trim();
  const steamcmdBootstrapTimeoutMs = parsePositiveInt(
    args.get('--steamcmd-bootstrap-timeout-ms') || process.env.WORKSHOP_STEAMCMD_BOOTSTRAP_TIMEOUT_MS,
    DEFAULTS.steamcmdBootstrapTimeoutMs,
  );
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
    steamcmdAutoInstall,
    steamcmdBootstrapUrl,
    steamcmdBootstrapTimeoutMs,
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
    return { filesCount: 0, totalBytes: 0, gmaFiles: [], bspFiles: [], binFiles: [], extensionlessFiles: [] };
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
  const binFiles: string[] = [];
  const extensionlessFiles: string[] = [];
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
    if (lower.endsWith('.bin')) binFiles.push(rel);
    const base = path.posix.basename(rel);
    if (base && !base.includes('.')) extensionlessFiles.push(rel);
  }

  gmaFiles.sort();
  bspFiles.sort();
  binFiles.sort();
  extensionlessFiles.sort();
  return {
    filesCount: files.length,
    totalBytes,
    gmaFiles,
    bspFiles,
    binFiles,
    extensionlessFiles,
  };
};

const hasUsableMapPayload = (summary: ItemFilesSummary): boolean =>
  summary.filesCount > 0;

const buildItemPathCandidates = (options: Options): string[] => {
  const app = String(options.appId);
  const wid = options.workshopId;
  const homeDir = os.homedir();
  const candidates = [
    path.join(options.steamcmdDir, 'steamapps', 'workshop', 'content', app, wid),
    path.join(options.rootDir, 'steamapps', 'workshop', 'content', app, wid),
    path.join(homeDir, 'Steam', 'steamapps', 'workshop', 'content', app, wid),
    path.join(homeDir, '.steam', 'steam', 'steamapps', 'workshop', 'content', app, wid),
    path.join(homeDir, '.local', 'share', 'Steam', 'steamapps', 'workshop', 'content', app, wid),
    path.join(homeDir, '.steam', 'steamcmd', 'steamapps', 'workshop', 'content', app, wid),
  ];
  const unique = new Set<string>();
  const out: string[] = [];
  for (const candidate of candidates) {
    const normalized = path.resolve(candidate);
    if (unique.has(normalized)) continue;
    unique.add(normalized);
    out.push(normalized);
  }
  return out;
};

const summarizeCandidates = (paths: string[]): Array<{ path: string; summary: ItemFilesSummary }> =>
  paths.map((entry) => ({ path: entry, summary: collectItemFiles(entry) }));

const pickBestCandidate = (
  entries: Array<{ path: string; summary: ItemFilesSummary }>,
): { path: string; summary: ItemFilesSummary } | null => {
  if (!entries.length) return null;
  const sorted = entries.slice().sort((a, b) => {
    const aUsable = hasUsableMapPayload(a.summary) ? 1 : 0;
    const bUsable = hasUsableMapPayload(b.summary) ? 1 : 0;
    if (aUsable !== bUsable) return bUsable - aUsable;
    if (a.summary.filesCount !== b.summary.filesCount) return b.summary.filesCount - a.summary.filesCount;
    if (a.summary.totalBytes !== b.summary.totalBytes) return b.summary.totalBytes - a.summary.totalBytes;
    return a.path.localeCompare(b.path);
  });
  return sorted[0] || null;
};

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
  const itemPathCandidates = buildItemPathCandidates(options);
  let candidateSummaries = summarizeCandidates(itemPathCandidates);
  let selectedCandidate = pickBestCandidate(candidateSummaries);
  let itemPath = selectedCandidate?.path || itemPathCandidates[0] || path.join(options.steamcmdDir, 'steamapps', 'workshop', 'content', String(options.appId), options.workshopId);
  let effectiveSteamcmdBin = options.steamcmdBin;
  let bootstrapLogTail: string[] = [];
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
    binFiles: [],
    extensionlessFiles: [],
    steamcmd: {
      bin: effectiveSteamcmdBin,
      installDir: options.steamcmdDir,
      timedOut: false,
      args: [],
    },
    lock: {
      path: lockPath,
      staleLockMs: options.staleLockMs,
    },
    contentCandidates: candidateSummaries.map((entry) => ({
      path: entry.path,
      filesCount: entry.summary.filesCount,
      totalBytes: entry.summary.totalBytes,
      gmaCount: entry.summary.gmaFiles.length,
      bspCount: entry.summary.bspFiles.length,
      binCount: entry.summary.binFiles.length,
      extensionlessCount: entry.summary.extensionlessFiles.length,
    })),
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

    const ensureSteamcmdAvailable = (): { ok: boolean; error?: string } => {
      if (isPathLikeExecutable(effectiveSteamcmdBin)) {
        if (fs.existsSync(effectiveSteamcmdBin)) {
          return { ok: true };
        }
      } else {
        const resolvedPath = resolveExecutableOnPath(effectiveSteamcmdBin);
        if (resolvedPath) {
          effectiveSteamcmdBin = resolvedPath;
          bootstrapLogTail.push(`steamcmd_in_path:${resolvedPath}`);
          return { ok: true };
        }
      }

      if (process.platform !== 'linux' || !options.steamcmdAutoInstall) {
        return { ok: false, error: `steamcmd_not_found:${effectiveSteamcmdBin}` };
      }

      const archivePath = path.join(options.steamcmdDir, 'steamcmd_linux.tar.gz');
      const installScript = [
        'set -euo pipefail',
        'mkdir -p "$STEAMCMD_DIR"',
        'if command -v curl >/dev/null 2>&1; then',
        '  curl -fsSL "$STEAMCMD_URL" -o "$STEAMCMD_ARCHIVE"',
        'elif command -v wget >/dev/null 2>&1; then',
        '  wget -qO "$STEAMCMD_ARCHIVE" "$STEAMCMD_URL"',
        'else',
        '  echo "missing_downloader:curl_or_wget" >&2',
        '  exit 127',
        'fi',
        'tar -xzf "$STEAMCMD_ARCHIVE" -C "$STEAMCMD_DIR"',
        'chmod +x "$STEAMCMD_DIR/steamcmd.sh" 2>/dev/null || true',
        'rm -f "$STEAMCMD_ARCHIVE"',
      ].join('; ');

      const bootstrapExec = spawnSync('bash', ['-lc', installScript], {
        encoding: 'utf8',
        timeout: options.steamcmdBootstrapTimeoutMs,
        maxBuffer: 1024 * 1024 * 16,
        env: {
          ...process.env,
          STEAMCMD_DIR: options.steamcmdDir,
          STEAMCMD_URL: options.steamcmdBootstrapUrl,
          STEAMCMD_ARCHIVE: archivePath,
        },
      });
      const bootstrapOutput = `${String(bootstrapExec.stdout || '')}\n${String(bootstrapExec.stderr || '')}`;
      bootstrapLogTail = tailLines(bootstrapOutput, 40);

      if (bootstrapExec.error) {
        return {
          ok: false,
          error: `steamcmd_bootstrap_exec_error:${String(bootstrapExec.error.message || bootstrapExec.error)}`,
        };
      }
      if (bootstrapExec.status !== 0) {
        return {
          ok: false,
          error: `steamcmd_bootstrap_exit_nonzero:${String(bootstrapExec.status)}`,
        };
      }

      const localResolved = resolveSteamcmdBin('', options.steamcmdDir);
      if (fs.existsSync(localResolved)) {
        effectiveSteamcmdBin = localResolved;
        return { ok: true };
      }

      const pathResolved = resolveExecutableOnPath('steamcmd');
      if (pathResolved) {
        effectiveSteamcmdBin = pathResolved;
        return { ok: true };
      }

      return { ok: false, error: 'steamcmd_bootstrap_completed_but_binary_not_found' };
    };

    const steamcmdAvailability = ensureSteamcmdAvailable();
    if (!steamcmdAvailability.ok) {
      const fail = createBaseReport('failed');
      fail.error = `${steamcmdAvailability.error || 'steamcmd_unavailable'}|hint:install_steamcmd_or_set_WORKSHOP_STEAMCMD_BIN`;
      fail.logTail = [
        `steamcmd_bin=${effectiveSteamcmdBin}`,
        `steamcmd_dir=${options.steamcmdDir}`,
        ...(bootstrapLogTail.length ? bootstrapLogTail : []),
      ].slice(-120);
      failureReport = fail;
      throw new Error(fail.error);
    }

    if (!options.refresh) {
      candidateSummaries = summarizeCandidates(itemPathCandidates);
      selectedCandidate = pickBestCandidate(candidateSummaries);
      if (selectedCandidate) itemPath = selectedCandidate.path;
      const existing = selectedCandidate?.summary || collectItemFiles(itemPath);
      if (hasUsableMapPayload(existing)) {
        const report = createBaseReport('cached');
        report.contentPath = itemPath;
        report.filesCount = existing.filesCount;
        report.totalBytes = existing.totalBytes;
        report.gmaFiles = existing.gmaFiles;
        report.bspFiles = existing.bspFiles;
        report.binFiles = existing.binFiles;
        report.extensionlessFiles = existing.extensionlessFiles;
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

    const exec = spawnSync(effectiveSteamcmdBin, args, {
      encoding: 'utf8',
      timeout: options.timeoutMs,
      maxBuffer: 1024 * 1024 * 32,
    });
    const output = `${String(exec.stdout || '')}\n${String(exec.stderr || '')}`;
    candidateSummaries = summarizeCandidates(itemPathCandidates);
    selectedCandidate = pickBestCandidate(candidateSummaries);
    if (selectedCandidate) itemPath = selectedCandidate.path;
    const summary = selectedCandidate?.summary || collectItemFiles(itemPath);
    const report = createBaseReport('success');
    report.contentPath = itemPath;
    report.filesCount = summary.filesCount;
    report.totalBytes = summary.totalBytes;
    report.gmaFiles = summary.gmaFiles;
    report.bspFiles = summary.bspFiles;
    report.binFiles = summary.binFiles;
    report.extensionlessFiles = summary.extensionlessFiles;
    report.logTail = tailLines(output, 120);
    if (bootstrapLogTail.length) {
      report.logTail = report.logTail.concat(bootstrapLogTail).slice(-120);
    }
    if (typeof exec.status === 'number') {
      report.steamcmd.exitCode = exec.status;
    }
    if (exec.signal) {
      report.steamcmd.signal = exec.signal;
    }
    report.steamcmd.timedOut = Boolean(exec.error && String((exec.error as any)?.message || '').toLowerCase().includes('timeout'));
    report.steamcmd.args = sanitizeSteamcmdArgs(args, options.steamPass);

    if (exec.error) {
      const rawError = String(exec.error.message || exec.error);
      report.status = 'failed';
      if (/enoent/i.test(rawError)) {
        report.error = `steamcmd_exec_error:${rawError}|hint:install_steamcmd_or_set_WORKSHOP_STEAMCMD_BIN`;
      } else {
        report.error = `steamcmd_exec_error:${rawError}`;
      }
      failureReport = report;
      throw new Error(report.error);
    }

    if (exec.status !== 0) {
      report.status = 'failed';
      const lowerOutput = output.toLowerCase();
      if (exec.status === 127 && process.platform === 'linux') {
        const arch = process.arch;
        const hint = arch === 'x64'
          ? 'hint:missing_linux_32bit_runtime;install=dpkg --add-architecture i386 && apt-get update && apt-get install -y libc6-i386 lib32gcc-s1 libstdc++6:i386'
          : `hint:unsupported_arch_for_steamcmd:${arch};use_x86_64_host_or_container`;
        const detail = lowerOutput.includes('required file not found')
          ? 'required_file_not_found'
          : lowerOutput.includes('no such file or directory')
            ? 'no_such_file_or_directory'
            : 'runtime_missing';
        report.error = `steamcmd_exit_nonzero:127|${detail}|${hint}`;
      } else {
        report.error = `steamcmd_exit_nonzero:${String(exec.status)}`;
      }
      failureReport = report;
      throw new Error(report.error);
    }

    if (!hasUsableMapPayload(summary)) {
      report.status = 'failed';
      report.error = 'download_payload_empty:expected_files_after_download';
      report.logTail = report.logTail.concat(
        report.contentCandidates?.map((entry) => (
          `candidate path=${entry.path} files=${entry.filesCount} gma=${entry.gmaCount} bsp=${entry.bspCount} bin=${entry.binCount} extless=${entry.extensionlessCount}`
        )) || [],
      ).slice(-120);
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

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

type Status = 'success' | 'failed';

type Options = {
  workshopId: string;
  mapName: string;
  appId: number;
  rootDir: string;
  contentDir: string;
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
};

type StepResult = {
  name: 'extract' | 'pipeline';
  ok: boolean;
  durationMs: number;
  exitCode?: number;
  signal?: string;
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
  warnings: string[];
  error?: string;
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
};

const toNum = (raw: string | undefined, fallback: number): number => {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const normalizeMapName = (raw: string): string => {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return '';
  return value.endsWith('.bsp') ? value.slice(0, -4) : value;
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

const parseOptions = (): Options => {
  const args = parseArgs();
  const workshopId = String(args.get('--id') || process.env.WORKSHOP_ID || '').trim();
  const mapName = normalizeMapName(String(args.get('--map') || process.env.WORKSHOP_MAP_NAME || ''));
  if (!/^\d+$/.test(workshopId)) {
    throw new Error(`invalid_or_missing_workshop_id:${workshopId || '<empty>'}`);
  }
  if (!mapName) {
    throw new Error('missing_required_arg: --map=<map_name>');
  }

  const appId = toNum(args.get('--app-id') || process.env.WORKSHOP_APP_ID, DEFAULTS.appId);
  const rootDir = resolveFlexiblePath(String(args.get('--root-dir') || process.env.WORKSHOP_ROOT || defaultRootDir));
  const contentDir = resolveFlexiblePath(
    String(args.get('--content-dir') || path.join(rootDir, 'steamcmd', 'steamapps', 'workshop', 'content', String(appId), workshopId)),
  );
  const extractDir = resolveFlexiblePath(String(args.get('--extract-dir') || path.join(rootDir, 'extracted', workshopId)));
  const reportsDir = resolveFlexiblePath(String(args.get('--reports-dir') || path.join(rootDir, 'reports')));
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
  const cleanExtractDir = String(args.get('--clean-extract-dir') || '').trim() === '1';
  const timeoutExtractMs = toNum(args.get('--timeout-extract-ms') || process.env.WORKSHOP_PROCESS_TIMEOUT_EXTRACT_MS, DEFAULTS.timeoutExtractMs);
  const timeoutPipelineMs = toNum(args.get('--timeout-pipeline-ms') || process.env.WORKSHOP_PROCESS_TIMEOUT_PIPELINE_MS, DEFAULTS.timeoutPipelineMs);
  const staleLockMs = toNum(args.get('--stale-lock-ms') || process.env.WORKSHOP_STALE_LOCK_MS, DEFAULTS.staleLockMs);
  const lockPath = path.join(rootDir, 'locks', `process_${appId}_${workshopId}_${mapName}.lock`);

  return {
    workshopId,
    mapName,
    appId,
    rootDir,
    contentDir,
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
  if (exec.error) step.error = String(exec.error.message || exec.error);
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
    warnings,
  };

  const finish = (status: Status, error?: string) => {
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
    finish('failed', `workshop_content_dir_not_found:${options.contentDir}`);
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

    finish('success');
  } finally {
    releaseLock(options.lockPath);
  }
};

run();

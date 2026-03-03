import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';

type Severity = 'critical' | 'major' | 'minor';
type MissingType = 'mdl' | 'vmt' | 'vtf' | 'patch-include' | 'skybox' | 'world-material';
type MountId = 'gmod' | 'css' | 'hl2' | 'hl2ep1' | 'hl2ep2' | 'tf2' | 'custom';
type MountSource = 'cli' | 'config' | 'env' | 'auto';
type MountStatus = 'ok' | 'missing' | 'invalid';

export type AssetResolutionMode = 'strict' | 'permissive';

export type CliOptions = {
  mapBsp: string;
  mapRoot: string;
  reportPath: string;
  mountsConfigPath: string;
  mountOverrides: Partial<Record<MountId, string[]>>;
  assetResolutionMode: AssetResolutionMode;
};

type MissingRecord = {
  type: MissingType;
  asset: string;
  severity: Severity;
  suggestedMount: MountId;
  occurrences: number;
  references: string[];
  note?: string;
};

type MissingInput = {
  type: MissingType;
  asset: string;
  severity: Severity;
  reference: string;
  suggestedMount?: MountId;
  note?: string;
};

type NormalizedMountConfig = Record<MountId, string[]>;

type ResolvedMount = {
  id: MountId;
  rootPath: string;
  source: MountSource;
  sourceId: string;
  checks: {
    materials: boolean;
    models: boolean;
    maps: boolean;
  };
};

type BspLump = {
  offset: number;
  length: number;
  version: number;
  fourCC: number;
};

type BspParsedData = {
  usedWorldMaterials: string[];
  staticPropModelNames: string[];
  staticPropModelRefs: number[];
  skyName: string | null;
  bspVersion: number;
  pakfileLength: number;
  pakfileScanned: boolean;
  pakfileFilesCount: number;
  pakArchive: PakArchive | null;
  pakfileError?: string;
};

type MountResolution = {
  mounts: ResolvedMount[];
  configPathUsed: string;
  unresolvedInputPaths: Array<{ mount: MountId; path: string; source: MountSource }>;
  autoDetected: Record<MountId, string[]>;
  attemptedCandidates: Record<MountId, string[]>;
  libraryFoldersScanned: string[];
  mountValidation: Array<{
    mount: MountId;
    source: MountSource;
    inputPath: string;
    status: MountStatus;
    resolvedPath?: string;
    checks: { materials: boolean; models: boolean; maps: boolean };
    reason?: string;
    sourceId?: string;
  }>;
};

type MaterialAnalysis = {
  material: string;
  found: boolean;
  sourcePath?: string;
  includeMaterials: string[];
  missingIncludes: string[];
  baseTextureCandidates: string[];
  resolvedBaseTexture?: string;
};

type PakEntry = {
  name: string;
  normalizedName: string;
  flags: number;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

type AssetLocation =
  | { kind: 'filesystem'; sourceId: string; absolutePath: string }
  | { kind: 'pak'; sourceId: string; entryName: string };

const SUPPORTED_MOUNTS: MountId[] = ['gmod', 'css', 'hl2', 'hl2ep1', 'hl2ep2', 'tf2', 'custom'];
const SKYBOX_SIDES = ['bk', 'dn', 'ft', 'lf', 'rt', 'up'];
const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  major: 1,
  minor: 2,
};

const defaultMountsPath = (() => {
  const local = path.resolve(process.cwd(), 'config', 'mounts.json');
  if (fs.existsSync(local) || process.cwd().toLowerCase().endsWith(`${path.sep}server`)) {
    return local;
  }
  return path.resolve(process.cwd(), 'server', 'config', 'mounts.json');
})();

const DEFAULT_OPTIONS: Pick<CliOptions, 'reportPath' | 'mountsConfigPath'> = {
  reportPath: 'reports/audit-report.json',
  mountsConfigPath: defaultMountsPath,
};

class MissingTracker {
  private items = new Map<string, {
    type: MissingType;
    asset: string;
    severity: Severity;
    suggestedMount: MountId;
    references: Set<string>;
    occurrences: number;
    note?: string;
  }>();

  add(input: MissingInput) {
    const normalizedAsset = normalizeAssetPath(input.asset);
    const reference = String(input.reference || '').trim() || 'unknown';
    const suggestedMount = input.suggestedMount || inferMountSuggestion(normalizedAsset);
    const normalizedSeverity = applySeverityPolicy(
      input.severity,
      input.type,
      reference,
      suggestedMount,
    );
    const key = `${input.type}|${normalizedAsset}`;
    const current = this.items.get(key);
    if (current) {
      current.occurrences += 1;
      current.references.add(reference);
      if (SEVERITY_ORDER[normalizedSeverity] < SEVERITY_ORDER[current.severity]) {
        current.severity = normalizedSeverity;
      }
      if (!current.note && input.note) {
        current.note = input.note;
      }
      return;
    }

    this.items.set(key, {
      type: input.type,
      asset: normalizedAsset,
      severity: normalizedSeverity,
      suggestedMount,
      references: new Set([reference]),
      occurrences: 1,
      ...(input.note ? { note: input.note } : {}),
    });
  }

  getSummary() {
    const summary = { critical: 0, major: 0, minor: 0 };
    for (const item of this.items.values()) {
      summary[item.severity] += 1;
    }
    return summary;
  }

  toSortedList(): MissingRecord[] {
    const out: MissingRecord[] = [];
    for (const item of this.items.values()) {
      out.push({
        type: item.type,
        asset: item.asset,
        severity: item.severity,
        suggestedMount: item.suggestedMount,
        occurrences: item.occurrences,
        references: Array.from(item.references).sort((a, b) => a.localeCompare(b)),
        ...(item.note ? { note: item.note } : {}),
      });
    }
    out.sort((a, b) => {
      const severityDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (severityDiff !== 0) return severityDiff;
      const typeDiff = a.type.localeCompare(b.type);
      if (typeDiff !== 0) return typeDiff;
      const assetDiff = a.asset.localeCompare(b.asset);
      if (assetDiff !== 0) return assetDiff;
      const aRef = a.references[0] || '';
      const bRef = b.references[0] || '';
      return aRef.localeCompare(bRef);
    });
    return out;
  }
}

class PakArchive {
  private entriesByAsset = new Map<string, PakEntry>();
  private entriesAll: PakEntry[] = [];
  private bufferCache = new Map<string, Buffer | null>();

  constructor(private readonly pakData: Buffer) {}

  static fromBuffer(pakData: Buffer): PakArchive {
    const archive = new PakArchive(pakData);
    archive.parseCentralDirectory();
    return archive;
  }

  private parseCentralDirectory() {
    if (this.pakData.length < 22) {
      throw new Error('pak_zip_too_small');
    }

    let eocdOffset = -1;
    const minOffset = Math.max(0, this.pakData.length - (0xffff + 22));
    for (let i = this.pakData.length - 22; i >= minOffset; i -= 1) {
      if (this.pakData.readUInt32LE(i) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset < 0) {
      throw new Error('pak_eocd_not_found');
    }

    const totalEntries = this.pakData.readUInt16LE(eocdOffset + 10);
    const centralDirSize = this.pakData.readUInt32LE(eocdOffset + 12);
    const centralDirOffset = this.pakData.readUInt32LE(eocdOffset + 16);
    if (centralDirOffset < 0 || centralDirSize < 0 || centralDirOffset + centralDirSize > this.pakData.length) {
      throw new Error('pak_central_directory_out_of_bounds');
    }

    let cursor = centralDirOffset;
    let parsed = 0;
    while (cursor + 46 <= this.pakData.length && parsed < totalEntries) {
      if (this.pakData.readUInt32LE(cursor) !== 0x02014b50) {
        break;
      }
      const flags = this.pakData.readUInt16LE(cursor + 8);
      const method = this.pakData.readUInt16LE(cursor + 10);
      const compressedSize = this.pakData.readUInt32LE(cursor + 20);
      const uncompressedSize = this.pakData.readUInt32LE(cursor + 24);
      const nameLen = this.pakData.readUInt16LE(cursor + 28);
      const extraLen = this.pakData.readUInt16LE(cursor + 30);
      const commentLen = this.pakData.readUInt16LE(cursor + 32);
      const localHeaderOffset = this.pakData.readUInt32LE(cursor + 42);

      const nameStart = cursor + 46;
      const nameEnd = nameStart + nameLen;
      if (nameEnd > this.pakData.length) {
        break;
      }

      const isUtf8 = (flags & 0x0800) !== 0;
      const rawName = this.pakData.subarray(nameStart, nameEnd).toString(isUtf8 ? 'utf8' : 'latin1');
      const normalizedName = normalizeAssetPath(rawName);
      const entry: PakEntry = {
        name: rawName,
        normalizedName,
        flags,
        method,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      };
      this.entriesAll.push(entry);

      if (!normalizedName.endsWith('/')) {
        const ext = path.extname(normalizedName).toLowerCase();
        if ((ext === '.mdl' || ext === '.vmt' || ext === '.vtf') && !this.entriesByAsset.has(normalizedName)) {
          this.entriesByAsset.set(normalizedName, entry);
        }
      }

      cursor = nameEnd + extraLen + commentLen;
      parsed += 1;
    }
  }

  getAllEntriesCount(): number {
    return this.entriesAll.length;
  }

  getIndexedAssetEntriesCount(): number {
    return this.entriesByAsset.size;
  }

  getIndexedAssetPaths(): string[] {
    return Array.from(this.entriesByAsset.keys()).sort((a, b) => a.localeCompare(b));
  }

  resolveEntry(assetPath: string): PakEntry | null {
    const normalized = normalizeAssetPath(assetPath);
    return this.entriesByAsset.get(normalized) || null;
  }

  readEntry(assetPath: string): Buffer | null {
    const normalized = normalizeAssetPath(assetPath);
    if (this.bufferCache.has(normalized)) {
      return this.bufferCache.get(normalized) || null;
    }
    const entry = this.entriesByAsset.get(normalized);
    if (!entry) {
      this.bufferCache.set(normalized, null);
      return null;
    }

    const localOffset = entry.localHeaderOffset;
    if (localOffset < 0 || localOffset + 30 > this.pakData.length) {
      this.bufferCache.set(normalized, null);
      return null;
    }
    if (this.pakData.readUInt32LE(localOffset) !== 0x04034b50) {
      this.bufferCache.set(normalized, null);
      return null;
    }

    const localNameLen = this.pakData.readUInt16LE(localOffset + 26);
    const localExtraLen = this.pakData.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + entry.compressedSize;
    if (dataStart < 0 || dataEnd > this.pakData.length || dataEnd < dataStart) {
      this.bufferCache.set(normalized, null);
      return null;
    }

    const compressed = this.pakData.subarray(dataStart, dataEnd);
    let out: Buffer | null = null;
    if (entry.method === 0) {
      out = Buffer.from(compressed);
    } else if (entry.method === 8) {
      try {
        out = zlib.inflateRawSync(compressed);
      } catch {
        out = null;
      }
    }

    this.bufferCache.set(normalized, out);
    return out;
  }
}

class AssetCatalog {
  private files = new Map<string, AssetLocation[]>();
  private roots: Array<{
    id: string;
    kind: 'filesystem' | 'pak';
    source: string;
    role: 'pak' | 'map-root' | 'mount';
    mountId?: MountId;
  }> = [];
  private pakSources = new Map<string, PakArchive>();
  private resolvedAssetsBySource = new Map<string, Set<string>>();
  private sourceMeta = new Map<string, { priority: number; order: number }>();
  private sourceOrderCounter = 0;

  private registerSource(sourceId: string, priority: number) {
    if (this.sourceMeta.has(sourceId)) return;
    this.sourceMeta.set(sourceId, {
      priority,
      order: this.sourceOrderCounter,
    });
    this.sourceOrderCounter += 1;
  }

  addPakRoot(id: string, archive: PakArchive) {
    this.registerSource(id, 0);
    this.pakSources.set(id, archive);
    this.roots.push({ id, kind: 'pak', source: 'bsp:pakfile', role: 'pak' });
    for (const assetPath of archive.getIndexedAssetPaths()) {
      const existing = this.files.get(assetPath) || [];
      existing.push({
        kind: 'pak',
        sourceId: id,
        entryName: assetPath,
      });
      this.files.set(assetPath, existing);
    }
  }

  addRoot(
    id: string,
    rootPath: string,
    options?: {
      role?: 'map-root' | 'mount';
      mountId?: MountId;
    },
  ) {
    const normalizedRoot = path.resolve(rootPath);
    const normalizedRootForMatch = normalizeAssetPath(normalizedRoot);
    const isGmodBase = options?.mountId === 'gmod' && normalizedRootForMatch.endsWith('/garrysmod');
    const isAddonContent = normalizedRootForMatch.includes('/garrysmod/addons/');
    let priority = 4;
    if (options?.role === 'map-root') priority = 1;
    else if (isGmodBase) priority = 2;
    else if (isAddonContent) priority = 3;

    this.registerSource(id, priority);
    this.roots.push({
      id,
      kind: 'filesystem',
      source: normalizedRoot,
      role: options?.role || 'mount',
      ...(options?.mountId ? { mountId: options.mountId } : {}),
    });
    this.indexExtensions(id, normalizedRoot, 'materials');
    this.indexExtensions(id, normalizedRoot, 'models');
  }

  private indexExtensions(sourceId: string, rootPath: string, subDir: 'materials' | 'models') {
    const startDir = path.join(rootPath, subDir);
    if (!fs.existsSync(startDir) || !fs.statSync(startDir).isDirectory()) {
      return;
    }

    const stack: string[] = [startDir];
    while (stack.length) {
      const currentDir = stack.pop() as string;
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch {
        continue;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
      for (const entry of entries) {
        const full = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
          continue;
        }
        if (!entry.isFile()) {
          continue;
        }

        const ext = path.extname(entry.name).toLowerCase();
        if (ext !== '.mdl' && ext !== '.vmt' && ext !== '.vtf') {
          continue;
        }
        const rel = normalizeAssetPath(path.relative(rootPath, full));
        const existing = this.files.get(rel) || [];
        existing.push({
          kind: 'filesystem',
          sourceId,
          absolutePath: full,
        });
        this.files.set(rel, existing);
      }
    }
  }

  resolveLocation(assetPath: string): AssetLocation | null {
    const key = normalizeAssetPath(assetPath);
    const hit = this.files.get(key);
    if (!hit || hit.length === 0) return null;
    let chosen: AssetLocation | null = null;
    for (const candidate of hit) {
      if (!chosen) {
        chosen = candidate;
        continue;
      }
      const chosenMeta = this.sourceMeta.get(chosen.sourceId) || { priority: 999, order: 999999 };
      const candidateMeta = this.sourceMeta.get(candidate.sourceId) || { priority: 999, order: 999999 };
      if (candidateMeta.priority < chosenMeta.priority) {
        chosen = candidate;
        continue;
      }
      if (candidateMeta.priority > chosenMeta.priority) {
        continue;
      }
      if (candidateMeta.order < chosenMeta.order) {
        chosen = candidate;
      }
    }

    if (chosen) {
      const bySource = this.resolvedAssetsBySource.get(chosen.sourceId) || new Set<string>();
      bySource.add(key);
      this.resolvedAssetsBySource.set(chosen.sourceId, bySource);
    }
    return chosen;
  }

  resolve(assetPath: string): string | null {
    const location = this.resolveLocation(assetPath);
    if (!location) return null;
    if (location.kind === 'filesystem') return location.absolutePath;
    return `pak:${location.entryName}`;
  }

  exists(assetPath: string): boolean {
    return this.resolveLocation(assetPath) !== null;
  }

  readBuffer(assetPath: string): Buffer | null {
    const location = this.resolveLocation(assetPath);
    if (!location) return null;
    if (location.kind === 'filesystem') {
      try {
        return fs.readFileSync(location.absolutePath);
      } catch {
        return null;
      }
    }
    const pak = this.pakSources.get(location.sourceId);
    if (!pak) return null;
    return pak.readEntry(location.entryName);
  }

  readText(assetPath: string): string | null {
    const buffer = this.readBuffer(assetPath);
    if (!buffer) return null;
    try {
      return buffer.toString('utf8');
    } catch {
      return buffer.toString('latin1');
    }
  }

  describeLocation(location: AssetLocation): string {
    if (location.kind === 'filesystem') {
      return location.absolutePath;
    }
    return `pak:${location.entryName}`;
  }

  getResolvedCountsBySource(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [sourceId, assets] of this.resolvedAssetsBySource.entries()) {
      out[sourceId] = assets.size;
    }
    return out;
  }

  stats() {
    return {
      roots: this.roots.slice(),
      fileCount: this.files.size,
      resolvedCountsBySource: this.getResolvedCountsBySource(),
      sourceMeta: Array.from(this.sourceMeta.entries()).map(([sourceId, meta]) => ({ sourceId, ...meta })),
    };
  }
}

const parseArgs = (): CliOptions => {
  const args = process.argv.slice(2);
  const options = new Map<string, string>();
  const mountOverrides: Partial<Record<MountId, string[]>> = {};

  const appendMountOverride = (specRaw: string) => {
    const spec = String(specRaw || '').trim();
    const eq = spec.indexOf('=');
    if (eq <= 0) {
      throw new Error(`invalid_mount_override: expected --mount <mountId>=<path>, got "${specRaw}"`);
    }
    const mountId = spec.slice(0, eq).trim().toLowerCase() as MountId;
    const mountPath = spec.slice(eq + 1).trim();
    if (!SUPPORTED_MOUNTS.includes(mountId)) {
      throw new Error(`invalid_mount_id: ${mountId}. Use one of: ${SUPPORTED_MOUNTS.join(', ')}`);
    }
    if (!mountPath) {
      throw new Error(`invalid_mount_override_path: ${specRaw}`);
    }
    const current = mountOverrides[mountId] || [];
    current.push(mountPath);
    mountOverrides[mountId] = current;
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = String(args[i] || '').trim();
    if (!arg) continue;
    if (arg === '--mount') {
      const next = String(args[i + 1] || '').trim();
      if (!next || next.startsWith('--')) {
        throw new Error('invalid_mount_override: --mount requires value <mountId>=<path>');
      }
      appendMountOverride(next);
      i += 1;
      continue;
    }
    if (
      arg === '--mounts' ||
      arg === '--map-bsp' ||
      arg === '--map-root' ||
      arg === '--report' ||
      arg === '--asset-resolution-mode'
    ) {
      const next = String(args[i + 1] || '').trim();
      if (!next || next.startsWith('--')) {
        throw new Error(`invalid_arg_value: ${arg} requires a value`);
      }
      options.set(arg, next);
      i += 1;
      continue;
    }
    if (arg.startsWith('--mount=')) {
      appendMountOverride(arg.slice('--mount='.length));
      continue;
    }
    if (!arg.startsWith('--') || !arg.includes('=')) continue;
    const idx = arg.indexOf('=');
    options.set(arg.slice(0, idx), arg.slice(idx + 1));
  }

  const mapBsp = String(options.get('--map-bsp') || '').trim();
  const mapRoot = String(options.get('--map-root') || '').trim();
  const reportPath = String(options.get('--report') || DEFAULT_OPTIONS.reportPath).trim();
  const mountsConfigPath = String(
    options.get('--mounts') ||
      process.env.MOUNTS_FILE ||
      process.env.MAP_AUDIT_MOUNTS_FILE ||
      DEFAULT_OPTIONS.mountsConfigPath,
  ).trim();
  const resolutionModeRaw = String(
    options.get('--asset-resolution-mode') ||
      process.env.MAP_AUDIT_ASSET_RESOLUTION_MODE ||
      'permissive',
  )
    .trim()
    .toLowerCase();
  const assetResolutionMode: AssetResolutionMode = resolutionModeRaw === 'strict' ? 'strict' : 'permissive';

  if (!mapBsp || !mapRoot) {
    throw new Error(
      'missing_required_args: use --map-bsp=<path/to/map.bsp> and --map-root=<path/to/map/root>',
    );
  }

  const resolveWithParentFallback = (inputPath: string): string => {
    const primary = path.resolve(inputPath);
    if (fs.existsSync(primary)) return primary;
    if (path.isAbsolute(inputPath)) return primary;
    const parent = path.resolve(process.cwd(), '..', inputPath);
    if (fs.existsSync(parent)) return parent;
    return primary;
  };

  return {
    mapBsp: resolveWithParentFallback(mapBsp),
    mapRoot: resolveWithParentFallback(mapRoot),
    reportPath: path.resolve(reportPath),
    mountsConfigPath: resolveWithParentFallback(mountsConfigPath),
    mountOverrides,
    assetResolutionMode,
  };
};

const normalizeAssetPath = (value: string): string => {
  const raw = String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/')
    .toLowerCase();
  return raw;
};

const normalizeMaterialName = (value: string): string => {
  let normalized = normalizeAssetPath(value);
  normalized = normalized.replace(/^materials\//, '');
  normalized = normalized.replace(/\.vmt$/i, '');
  normalized = normalized.replace(/\.vtf$/i, '');
  normalized = normalized.replace(/^\/+/, '');
  return normalized;
};

const normalizeModelName = (value: string): string => {
  let normalized = normalizeAssetPath(value);
  normalized = normalized.replace(/^models\//, '');
  normalized = normalized.replace(/\.mdl$/i, '');
  return normalized;
};

const splitEnvPaths = (raw: string): string[] => {
  const value = String(raw || '').trim();
  if (!value) return [];
  if (process.platform === 'win32') {
    return value
      .split(/[;\n,]+/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return value
    .split(/[:;\n,]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
};

const dedupeSortedStrings = (items: string[]): string[] => {
  return Array.from(new Set(items.map((item) => String(item || '').trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b),
  );
};

const dedupeSortedPaths = (items: string[]): string[] => {
  return Array.from(new Set(items.map((item) => path.resolve(item)))).sort((a, b) => a.localeCompare(b));
};

const envVarByMount: Record<MountId, string> = {
  gmod: 'MAP_AUDIT_MOUNT_GMOD',
  css: 'MAP_AUDIT_MOUNT_CSS',
  hl2: 'MAP_AUDIT_MOUNT_HL2',
  hl2ep1: 'MAP_AUDIT_MOUNT_HL2EP1',
  hl2ep2: 'MAP_AUDIT_MOUNT_HL2EP2',
  tf2: 'MAP_AUDIT_MOUNT_TF2',
  custom: 'MAP_AUDIT_MOUNT_CUSTOM',
};

const loadConfigMounts = (configPath: string): NormalizedMountConfig => {
  const out: NormalizedMountConfig = {
    gmod: [],
    css: [],
    hl2: [],
    hl2ep1: [],
    hl2ep2: [],
    tf2: [],
    custom: [],
  };
  if (!fs.existsSync(configPath)) {
    return out;
  }

  const raw = fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '');
  const parsed = JSON.parse(raw) as unknown;
  const fromRoot = parsed as Record<string, unknown>;
  const mountsRaw = (fromRoot.mounts || fromRoot) as Record<string, unknown>;
  for (const mount of SUPPORTED_MOUNTS) {
    const value = mountsRaw[mount];
    if (Array.isArray(value)) {
      out[mount] = value.map((item) => String(item || '').trim()).filter(Boolean);
      continue;
    }
    if (typeof value === 'string' && value.trim()) {
      out[mount] = [value.trim()];
    }
  }
  return out;
};

const candidateMountSubdirs = (mount: MountId): string[] => {
  if (mount === 'gmod') return ['garrysmod'];
  if (mount === 'hl2') return ['hl2'];
  if (mount === 'css') return ['cstrike'];
  if (mount === 'tf2') return ['tf'];
  if (mount === 'hl2ep1' || mount === 'hl2ep2') return [];
  return [];
};

const inspectMountRoot = (dirPath: string): { materials: boolean; models: boolean; maps: boolean } => {
  const hasDir = (name: string) => {
    const target = path.join(dirPath, name);
    return fs.existsSync(target) && fs.statSync(target).isDirectory();
  };
  return {
    materials: hasDir('materials'),
    models: hasDir('models'),
    maps: hasDir('maps'),
  };
};

const validateMountCandidate = (
  mount: MountId,
  rawPath: string,
): {
  status: MountStatus;
  resolvedPath?: string;
  checks: { materials: boolean; models: boolean; maps: boolean };
  reason?: string;
} => {
  const absolute = path.resolve(rawPath);
  const emptyChecks = { materials: false, models: false, maps: false };
  if (!fs.existsSync(absolute)) {
    return { status: 'missing', checks: emptyChecks, reason: 'path_not_found' };
  }
  if (!fs.statSync(absolute).isDirectory()) {
    return { status: 'invalid', checks: emptyChecks, reason: 'path_is_not_directory' };
  }

  const candidates = [absolute, ...candidateMountSubdirs(mount).map((sub) => path.join(absolute, sub))];
  const seen = new Set<string>();
  let bestInvalid: { materials: boolean; models: boolean; maps: boolean; resolvedPath: string } | null = null;

  for (const candidate of candidates) {
    const normalized = path.resolve(candidate);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    if (!fs.existsSync(normalized) || !fs.statSync(normalized).isDirectory()) continue;
    const checks = inspectMountRoot(normalized);
    const isValid =
      mount === 'custom'
        ? checks.materials || checks.models || checks.maps
        : checks.materials && checks.models;
    if (isValid) {
      return { status: 'ok', resolvedPath: normalized, checks };
    }
    bestInvalid = { ...checks, resolvedPath: normalized };
  }

  if (bestInvalid) {
    const missing = [
      ...(bestInvalid.materials ? [] : ['materials']),
      ...(bestInvalid.models ? [] : ['models']),
    ];
    return {
      status: 'invalid',
      resolvedPath: bestInvalid.resolvedPath,
      checks: {
        materials: bestInvalid.materials,
        models: bestInvalid.models,
        maps: bestInvalid.maps,
      },
      reason: mount === 'custom'
        ? 'custom_mount_missing_materials_models_maps'
        : `missing_expected_subdirs:${missing.join('+')}`,
    };
  }

  return {
    status: 'invalid',
    checks: emptyChecks,
    reason: 'directory_exists_but_game_content_not_found',
  };
};

const parseSteamLibraryFolders = (libraryVdfPath: string): string[] => {
  if (!fs.existsSync(libraryVdfPath)) return [];
  let text = '';
  try {
    text = fs.readFileSync(libraryVdfPath, 'utf8');
  } catch {
    return [];
  }

  const out: string[] = [];
  const regex = /"path"\s*"([^"]+)"/gi;
  let match = regex.exec(text);
  while (match) {
    const rawPath = String(match[1] || '').replace(/\\\\/g, '\\').replace(/\\\//g, '/').trim();
    if (rawPath) out.push(rawPath);
    match = regex.exec(text);
  }
  return dedupeSortedPaths(out);
};

const guessMountFromAddonFolderName = (folderName: string): MountId | null => {
  const name = String(folderName || '').toLowerCase();
  if (!name) return null;
  if (name.includes('css')) return 'css';
  if (name.includes('hl2ep1') || name.includes('episode1') || name.includes('ep1')) return 'hl2ep1';
  if (name.includes('hl2ep2') || name.includes('episode2') || name.includes('ep2')) return 'hl2ep2';
  if (name.includes('tf2') || name.includes('teamfortress2') || name.includes('team_fortress_2')) return 'tf2';
  return null;
};

const autoDetectMounts = (): {
  detected: Record<MountId, string[]>;
  attemptedCandidates: Record<MountId, string[]>;
  libraryFoldersScanned: string[];
} => {
  const detected: Record<MountId, string[]> = {
    gmod: [],
    css: [],
    hl2: [],
    hl2ep1: [],
    hl2ep2: [],
    tf2: [],
    custom: [],
  };
  const attemptedCandidates: Record<MountId, string[]> = {
    gmod: [],
    css: [],
    hl2: [],
    hl2ep1: [],
    hl2ep2: [],
    tf2: [],
    custom: [],
  };
  const addCandidate = (mount: MountId, candidatePath: string) => {
    if (!candidatePath) return;
    attemptedCandidates[mount].push(candidatePath);
    if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isDirectory()) {
      detected[mount].push(candidatePath);
    }
  };

  const steamRoots = new Set<string>();
  if (process.platform === 'win32') {
    const pf86 = process.env['ProgramFiles(x86)'];
    const pf = process.env.ProgramFiles;
    if (pf86) steamRoots.add(path.join(pf86, 'Steam'));
    if (pf) steamRoots.add(path.join(pf, 'Steam'));
    steamRoots.add('C:\\Program Files (x86)\\Steam');
    steamRoots.add('C:\\Program Files\\Steam');
    steamRoots.add('C:\\Steam');
  } else {
    const home = os.homedir();
    steamRoots.add(path.join(home, '.local', 'share', 'Steam'));
    steamRoots.add(path.join(home, '.steam', 'steam'));
    steamRoots.add(path.join(home, '.steam', 'root'));
  }

  const libraryRoots = new Set<string>();
  for (const steamRoot of steamRoots) {
    const steamAppsDir = path.join(steamRoot, 'steamapps');
    if (fs.existsSync(steamAppsDir) && fs.statSync(steamAppsDir).isDirectory()) {
      libraryRoots.add(path.resolve(steamRoot));
    }
    const vdfPath = path.join(steamAppsDir, 'libraryfolders.vdf');
    for (const libraryPath of parseSteamLibraryFolders(vdfPath)) {
      libraryRoots.add(path.resolve(libraryPath));
    }
  }

  const libraryFoldersScanned = Array.from(libraryRoots).sort((a, b) => a.localeCompare(b));
  const gameByMount: Record<'gmod' | 'hl2' | 'css' | 'tf2', { gameFolder: string; contentFolder: string }> = {
    gmod: { gameFolder: 'GarrysMod', contentFolder: 'garrysmod' },
    hl2: { gameFolder: 'Half-Life 2', contentFolder: 'hl2' },
    css: { gameFolder: 'Counter-Strike Source', contentFolder: 'cstrike' },
    tf2: { gameFolder: 'Team Fortress 2', contentFolder: 'tf' },
  };

  for (const libraryRoot of libraryFoldersScanned) {
    for (const mount of ['gmod', 'hl2', 'css', 'tf2'] as const) {
      const target = path.join(
        libraryRoot,
        'steamapps',
        'common',
        gameByMount[mount].gameFolder,
        gameByMount[mount].contentFolder,
      );
      attemptedCandidates[mount].push(target);
      if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
        detected[mount].push(target);
      }
    }
  }

  const addonDefaults: Array<{ mount: MountId; folder: string }> = [
    { mount: 'css', folder: 'css-content-gmodcontent' },
    { mount: 'hl2ep1', folder: 'hl2ep1-content-gmodcontent' },
    { mount: 'hl2ep2', folder: 'hl2ep2-content-gmodcontent' },
    { mount: 'tf2', folder: 'tf2-content-gmodcontent' },
  ];

  for (const gmodRoot of detected.gmod) {
    const addonsDir = path.join(gmodRoot, 'addons');
    if (!fs.existsSync(addonsDir) || !fs.statSync(addonsDir).isDirectory()) {
      continue;
    }

    for (const item of addonDefaults) {
      const expectedPath = path.join(addonsDir, item.folder);
      addCandidate(item.mount, expectedPath);
    }

    let addonEntries: fs.Dirent[] = [];
    try {
      addonEntries = fs.readdirSync(addonsDir, { withFileTypes: true });
    } catch {
      addonEntries = [];
    }
    for (const entry of addonEntries) {
      if (!entry.isDirectory()) continue;
      const guessed = guessMountFromAddonFolderName(entry.name);
      if (!guessed) continue;
      const candidate = path.join(addonsDir, entry.name);
      addCandidate(guessed, candidate);
    }
  }

  if (process.platform !== 'win32') {
    const linuxContentRoots = dedupeSortedPaths(
      [
        process.env.MAP_AUDIT_CONTENT_ROOT || '',
        '/opt/backstabber/content',
      ].filter(Boolean),
    );

    for (const contentRoot of linuxContentRoots) {
      addCandidate('gmod', path.join(contentRoot, 'gmod-base'));
      addCandidate('gmod', path.join(contentRoot, 'garrysmod'));
      addCandidate('css', path.join(contentRoot, 'css-content-gmodcontent'));
      addCandidate('hl2', path.join(contentRoot, 'hl2-content-gmodcontent'));
      addCandidate('hl2', path.join(contentRoot, 'hl2'));
      addCandidate('hl2ep1', path.join(contentRoot, 'hl2ep1-content-gmodcontent'));
      addCandidate('hl2ep2', path.join(contentRoot, 'hl2ep2-content-gmodcontent'));
      addCandidate('tf2', path.join(contentRoot, 'tf2-content-gmodcontent'));
      addCandidate('custom', path.join(contentRoot, 'hl1-gmodcontent'));
    }
  }

  for (const mount of SUPPORTED_MOUNTS) {
    detected[mount] = dedupeSortedPaths(detected[mount]);
    attemptedCandidates[mount] = dedupeSortedPaths(attemptedCandidates[mount]);
  }
  return {
    detected,
    attemptedCandidates,
    libraryFoldersScanned,
  };
};

const resolveMounts = (
  configPath: string,
  cliOverrides: Partial<Record<MountId, string[]>>,
): MountResolution => {
  const fromCli: NormalizedMountConfig = {
    gmod: cliOverrides.gmod || [],
    css: cliOverrides.css || [],
    hl2: cliOverrides.hl2 || [],
    hl2ep1: cliOverrides.hl2ep1 || [],
    hl2ep2: cliOverrides.hl2ep2 || [],
    tf2: cliOverrides.tf2 || [],
    custom: cliOverrides.custom || [],
  };
  const fromConfig = loadConfigMounts(configPath);
  const fromEnv: NormalizedMountConfig = {
    gmod: splitEnvPaths(process.env[envVarByMount.gmod] || ''),
    css: splitEnvPaths(process.env[envVarByMount.css] || ''),
    hl2: splitEnvPaths(process.env[envVarByMount.hl2] || ''),
    hl2ep1: splitEnvPaths(process.env[envVarByMount.hl2ep1] || ''),
    hl2ep2: splitEnvPaths(process.env[envVarByMount.hl2ep2] || ''),
    tf2: splitEnvPaths(process.env[envVarByMount.tf2] || ''),
    custom: splitEnvPaths(process.env[envVarByMount.custom] || ''),
  };

  const auto = autoDetectMounts();
  const autoDetected = auto.detected;
  const mounts: ResolvedMount[] = [];
  const unresolvedInputPaths: Array<{ mount: MountId; path: string; source: MountSource }> = [];
  const mountValidation: Array<{
    mount: MountId;
    source: MountSource;
    inputPath: string;
    status: MountStatus;
    resolvedPath?: string;
    checks: { materials: boolean; models: boolean; maps: boolean };
    reason?: string;
    sourceId?: string;
  }> = [];
  const seen = new Set<string>();
  const mountCounters: Record<MountId, number> = {
    gmod: 0,
    css: 0,
    hl2: 0,
    hl2ep1: 0,
    hl2ep2: 0,
    tf2: 0,
    custom: 0,
  };

  const ingest = (mount: MountId, entries: string[], source: MountSource) => {
    for (const entry of entries) {
      const validation = validateMountCandidate(mount, entry);
      const item = {
        mount,
        source,
        inputPath: path.resolve(entry),
        status: validation.status,
        checks: validation.checks,
        ...(validation.resolvedPath ? { resolvedPath: validation.resolvedPath } : {}),
        ...(validation.reason ? { reason: validation.reason } : {}),
      };

      if (validation.status !== 'ok' || !validation.resolvedPath) {
        mountValidation.push(item);
        if (validation.status === 'missing') {
          unresolvedInputPaths.push({ mount, path: path.resolve(entry), source });
        }
        continue;
      }

      const key = `${mount}|${normalizeAssetPath(validation.resolvedPath)}`;
      if (seen.has(key)) {
        mountValidation.push({ ...item, reason: item.reason || 'duplicate_mount_path' });
        continue;
      }
      seen.add(key);
      const idx = mountCounters[mount];
      mountCounters[mount] += 1;
      const sourceId = `mount:${mount}:${idx}`;
      mounts.push({
        id: mount,
        rootPath: validation.resolvedPath,
        source,
        sourceId,
        checks: validation.checks,
      });
      mountValidation.push({ ...item, sourceId });
    }
  };

  for (const mount of SUPPORTED_MOUNTS) {
    ingest(mount, fromCli[mount], 'cli');
    ingest(mount, fromConfig[mount], 'config');
    ingest(mount, fromEnv[mount], 'env');
  }

  for (const mount of SUPPORTED_MOUNTS) {
    const hasActive = mounts.some((item) => item.id === mount);
    if (hasActive) continue;
    ingest(mount, auto.attemptedCandidates[mount], 'auto');
  }

  mounts.sort((a, b) => {
    const idDiff = SUPPORTED_MOUNTS.indexOf(a.id) - SUPPORTED_MOUNTS.indexOf(b.id);
    if (idDiff !== 0) return idDiff;
    return a.rootPath.localeCompare(b.rootPath);
  });

  return {
    mounts,
    configPathUsed: configPath,
    unresolvedInputPaths,
    autoDetected,
    attemptedCandidates: auto.attemptedCandidates,
    libraryFoldersScanned: auto.libraryFoldersScanned,
    mountValidation,
  };
};

const inferMountSuggestion = (assetPath: string): MountId => {
  const normalized = normalizeAssetPath(assetPath);

  if (normalized.startsWith('maps/')) return 'custom';
  if (normalized.includes('/custom/') || normalized.includes('rp_evocity')) return 'custom';

  if (
    normalized.includes('/cstrike/') ||
    normalized.startsWith('materials/cs_') ||
    normalized.startsWith('materials/de_') ||
    normalized.includes('cs_assault') ||
    normalized.includes('cs_havana') ||
    normalized.includes('cs_italy')
  ) {
    return 'css';
  }

  if (
    normalized.includes('episode_1') ||
    normalized.includes('/ep1/') ||
    normalized.includes('hl2ep1')
  ) {
    return 'hl2ep1';
  }

  if (
    normalized.includes('episode_2') ||
    normalized.includes('/ep2/') ||
    normalized.includes('hl2ep2')
  ) {
    return 'hl2ep2';
  }

  if (
    normalized.includes('/tf/') ||
    normalized.includes('2fort') ||
    normalized.includes('payload') ||
    normalized.includes('koth_') ||
    normalized.includes('ctf_')
  ) {
    return 'tf2';
  }

  if (
    normalized.includes('props_c17') ||
    normalized.includes('props_wasteland') ||
    normalized.includes('props_combine') ||
    normalized.includes('props_lab') ||
    normalized.includes('props_junk') ||
    normalized.includes('/hl2/')
  ) {
    return 'hl2';
  }

  return 'gmod';
};

const applySeverityPolicy = (
  severity: Severity,
  type: MissingType,
  reference: string,
  suggestedMount: MountId,
): Severity => {
  const ref = String(reference || '').toLowerCase();
  const isWorldEssential =
    type === 'world-material' ||
    type === 'skybox' ||
    ref.startsWith('world:') ||
    ref.startsWith('skybox:');

  if (suggestedMount === 'css') {
    return 'critical';
  }

  const optionalMounts: MountId[] = ['hl2ep1', 'hl2ep2', 'tf2'];
  if (optionalMounts.includes(suggestedMount) && !isWorldEssential) {
    return 'major';
  }

  return severity;
};

const readCString = (buffer: Buffer, offset: number, maxLength = 4096): string => {
  if (offset < 0 || offset >= buffer.length) return '';
  let end = offset;
  const limit = Math.min(buffer.length, offset + maxLength);
  while (end < limit && buffer[end] !== 0) {
    end += 1;
  }
  return buffer.subarray(offset, end).toString('latin1');
};

const fourCC = (value: string): number => {
  if (value.length !== 4) throw new Error(`invalid_fourcc: ${value}`);
  return (
    value.charCodeAt(0) |
    (value.charCodeAt(1) << 8) |
    (value.charCodeAt(2) << 16) |
    (value.charCodeAt(3) << 24)
  );
};

const parseBspLumps = (buffer: Buffer): { version: number; lumps: BspLump[] } => {
  const ident = buffer.readInt32LE(0);
  if (ident !== fourCC('VBSP')) {
    throw new Error('invalid_bsp_signature');
  }
  const version = buffer.readInt32LE(4);
  const lumps: BspLump[] = [];
  for (let i = 0; i < 64; i += 1) {
    const base = 8 + i * 16;
    lumps.push({
      offset: buffer.readInt32LE(base),
      length: buffer.readInt32LE(base + 4),
      version: buffer.readInt32LE(base + 8),
      fourCC: buffer.readInt32LE(base + 12),
    });
  }
  return { version, lumps };
};

const parseWorldspawnSkyname = (entitiesText: string): string | null => {
  const entityRegex = /\{([\s\S]*?)\}/g;
  let match = entityRegex.exec(entitiesText);
  while (match) {
    const block = String(match[1] || '');
    const pairs = new Map<string, string>();
    const kvRegex = /"([^"]+)"\s*"([^"]*)"/g;
    let kvMatch = kvRegex.exec(block);
    while (kvMatch) {
      pairs.set(String(kvMatch[1] || '').toLowerCase(), String(kvMatch[2] || ''));
      kvMatch = kvRegex.exec(block);
    }
    if (pairs.get('classname') === 'worldspawn') {
      const sky = String(pairs.get('skyname') || '').trim();
      return sky || null;
    }
    match = entityRegex.exec(entitiesText);
  }
  return null;
};

const parseTexdataStringsCandidate = (
  buffer: Buffer,
  dataLump: BspLump,
  tableLump: BspLump,
): string[] => {
  if (dataLump.length <= 0 || tableLump.length <= 0 || tableLump.length % 4 !== 0) return [];
  if (dataLump.offset < 0 || tableLump.offset < 0) return [];
  if (dataLump.offset + dataLump.length > buffer.length) return [];
  if (tableLump.offset + tableLump.length > buffer.length) return [];

  const out: string[] = [];
  for (let i = 0; i < tableLump.length / 4; i += 1) {
    const rel = buffer.readInt32LE(tableLump.offset + i * 4);
    if (!Number.isFinite(rel) || rel < 0 || rel >= dataLump.length) continue;
    const text = readCString(buffer, dataLump.offset + rel, 512).trim();
    if (!text) continue;
    out.push(text);
  }
  return out;
};

const parseTexdataNameStringTable = (buffer: Buffer, texLump43: BspLump, texLump44: BspLump): string[] => {
  const texFrom43_44 = parseTexdataStringsCandidate(buffer, texLump43, texLump44);
  const texFrom44_43 = parseTexdataStringsCandidate(buffer, texLump44, texLump43);
  return texFrom44_43.length > texFrom43_44.length ? texFrom44_43 : texFrom43_44;
};

const parseTexdataNameIds = (buffer: Buffer, texdataLump: BspLump): number[] => {
  if (texdataLump.length <= 0 || texdataLump.offset < 0 || texdataLump.offset + texdataLump.length > buffer.length) {
    return [];
  }
  const structSize = 32;
  const count = Math.floor(texdataLump.length / structSize);
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const base = texdataLump.offset + i * structSize;
    out.push(buffer.readInt32LE(base + 12));
  }
  return out;
};

const parseTexinfoTexdataIndices = (buffer: Buffer, texinfoLump: BspLump): number[] => {
  if (texinfoLump.length <= 0 || texinfoLump.offset < 0 || texinfoLump.offset + texinfoLump.length > buffer.length) {
    return [];
  }
  const structSize = 72;
  const count = Math.floor(texinfoLump.length / structSize);
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const base = texinfoLump.offset + i * structSize;
    out.push(buffer.readInt32LE(base + 68));
  }
  return out;
};

const parseFaceTexinfoIndices = (buffer: Buffer, facesLump: BspLump): number[] => {
  if (facesLump.length <= 0 || facesLump.offset < 0 || facesLump.offset + facesLump.length > buffer.length) {
    return [];
  }
  const structSize = 56;
  const count = Math.floor(facesLump.length / structSize);
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const base = facesLump.offset + i * structSize;
    out.push(buffer.readInt16LE(base + 10));
  }
  return out;
};

const collectUsedWorldMaterials = (buffer: Buffer, lumps: BspLump[]): string[] => {
  const texdataLump = lumps[2];
  const texinfoLump = lumps[6];
  const facesLump = lumps[7];
  const texLump43 = lumps[43];
  const texLump44 = lumps[44];
  if (!texdataLump || !texinfoLump || !facesLump || !texLump43 || !texLump44) {
    return [];
  }

  const texStrings = parseTexdataNameStringTable(buffer, texLump43, texLump44);
  const texdataNameIds = parseTexdataNameIds(buffer, texdataLump);
  const texinfoTexdata = parseTexinfoTexdataIndices(buffer, texinfoLump);
  const faceTexinfos = parseFaceTexinfoIndices(buffer, facesLump);

  const used = new Set<string>();
  for (const texinfoIdx of faceTexinfos) {
    if (texinfoIdx < 0 || texinfoIdx >= texinfoTexdata.length) continue;
    const texdataIdx = texinfoTexdata[texinfoIdx];
    if (texdataIdx === undefined || texdataIdx < 0 || texdataIdx >= texdataNameIds.length) continue;
    const nameStringIdx = texdataNameIds[texdataIdx];
    if (nameStringIdx === undefined) continue;
    if (nameStringIdx < 0 || nameStringIdx >= texStrings.length) continue;
    const name = normalizeMaterialName(texStrings[nameStringIdx] || '');
    if (!name) continue;
    used.add(name);
  }

  if (used.size > 0) {
    return Array.from(used).sort((a, b) => a.localeCompare(b));
  }

  // Fallback defensivo: se não conseguimos mapear faces, usa a tabela de strings de texdata.
  return dedupeSortedStrings(texStrings.map((name) => normalizeMaterialName(name)).filter(Boolean));
};

const parsePakArchiveFromLump = (
  buffer: Buffer,
  pakLump: BspLump,
): { archive: PakArchive | null; scanned: boolean; filesCount: number; error?: string } => {
  if (pakLump.length <= 0 || pakLump.offset < 0 || pakLump.offset + pakLump.length > buffer.length) {
    return { archive: null, scanned: false, filesCount: 0 };
  }
  const pakData = buffer.subarray(pakLump.offset, pakLump.offset + pakLump.length);
  try {
    const archive = PakArchive.fromBuffer(pakData);
    return {
      archive,
      scanned: true,
      filesCount: archive.getAllEntriesCount(),
    };
  } catch (error) {
    return {
      archive: null,
      scanned: false,
      filesCount: 0,
      error: (error as Error)?.message || 'pak_parse_failed',
    };
  }
};

const parseStaticPropsFromGameLump = (
  buffer: Buffer,
  gameLump: BspLump,
): { modelNames: string[]; refs: number[] } => {
  if (gameLump.length <= 0 || gameLump.offset < 0 || gameLump.offset + gameLump.length > buffer.length) {
    return { modelNames: [], refs: [] };
  }
  let cursor = gameLump.offset;
  const lumpCount = buffer.readInt32LE(cursor);
  cursor += 4;
  let sprpOffset = -1;
  let sprpLength = 0;

  for (let i = 0; i < lumpCount; i += 1) {
    if (cursor + 16 > gameLump.offset + gameLump.length) break;
    const id = buffer.readInt32LE(cursor);
    const fileOffset = buffer.readInt32LE(cursor + 8);
    const fileLength = buffer.readInt32LE(cursor + 12);
    cursor += 16;
    const isStaticPropLump = id === fourCC('sprp') || id === fourCC('prps');
    if (!isStaticPropLump) continue;
    sprpOffset = fileOffset;
    sprpLength = fileLength;
    break;
  }

  if (sprpOffset < 0 || sprpLength <= 0 || sprpOffset + sprpLength > buffer.length) {
    return { modelNames: [], refs: [] };
  }

  cursor = sprpOffset;
  const end = sprpOffset + sprpLength;

  if (cursor + 4 > end) return { modelNames: [], refs: [] };
  const dictCount = buffer.readInt32LE(cursor);
  cursor += 4;
  if (dictCount < 0 || dictCount > 200000) return { modelNames: [], refs: [] };

  const modelNames: string[] = [];
  for (let i = 0; i < dictCount; i += 1) {
    if (cursor + 128 > end) break;
    const raw = readCString(buffer, cursor, 128);
    modelNames.push(normalizeModelName(raw));
    cursor += 128;
  }

  if (cursor + 4 > end) return { modelNames, refs: [] };
  const leafCount = buffer.readInt32LE(cursor);
  cursor += 4;
  if (leafCount < 0 || leafCount > 10_000_000) return { modelNames, refs: [] };

  const leafBytes = leafCount * 2;
  if (cursor + leafBytes > end) return { modelNames, refs: [] };
  cursor += leafBytes;

  if (cursor + 4 > end) return { modelNames, refs: [] };
  const propCount = buffer.readInt32LE(cursor);
  cursor += 4;
  if (propCount <= 0 || propCount > 10_000_000) return { modelNames, refs: [] };

  const remaining = end - cursor;
  const stride = Math.floor(remaining / propCount);
  if (stride < 26) {
    return { modelNames, refs: [] };
  }

  const refs: number[] = [];
  for (let i = 0; i < propCount; i += 1) {
    const base = cursor + i * stride;
    if (base + 26 > end) break;
    refs.push(buffer.readUInt16LE(base + 24));
  }
  return { modelNames, refs };
};

const parseBspData = (bspPath: string): BspParsedData => {
  const buffer = fs.readFileSync(bspPath);
  const { version, lumps } = parseBspLumps(buffer);

  const entitiesLump = lumps[0];
  const gameLump = lumps[35];
  const pakLump = lumps[40];
  if (!entitiesLump || !gameLump || !pakLump) {
    throw new Error('bsp_lumps_missing');
  }
  let skyName: string | null = null;
  if (entitiesLump.length > 0) {
    const entitiesRaw = buffer
      .subarray(entitiesLump.offset, entitiesLump.offset + entitiesLump.length)
      .toString('latin1');
    skyName = parseWorldspawnSkyname(entitiesRaw);
  }

  const usedWorldMaterials = collectUsedWorldMaterials(buffer, lumps);
  const pakInfo = parsePakArchiveFromLump(buffer, pakLump);

  const staticProp = parseStaticPropsFromGameLump(buffer, gameLump);
  return {
    usedWorldMaterials,
    staticPropModelNames: staticProp.modelNames,
    staticPropModelRefs: staticProp.refs,
    skyName,
    bspVersion: version,
    pakfileLength: pakLump.length,
    pakfileScanned: pakInfo.scanned,
    pakfileFilesCount: pakInfo.filesCount,
    pakArchive: pakInfo.archive,
    ...(pakInfo.error ? { pakfileError: pakInfo.error } : {}),
  };
};

const parseMdlMaterialRefsFromBuffer = (buffer: Buffer): string[] => {
  if (buffer.length < 224) return [];
  if (buffer.toString('latin1', 0, 4) !== 'IDST') return [];

  const version = buffer.readInt32LE(4);
  const textureInfoOffsets =
    version >= 44
      ? { countOffset: 204, dataOffset: 208, pathCountOffset: 212, pathOffset: 216 }
      : { countOffset: 208, dataOffset: 212, pathCountOffset: 216, pathOffset: 220 };

  if (textureInfoOffsets.pathOffset + 4 > buffer.length) return [];

  const textureCount = buffer.readInt32LE(textureInfoOffsets.countOffset);
  const textureDataOffset = buffer.readInt32LE(textureInfoOffsets.dataOffset);
  const texturePathCount = buffer.readInt32LE(textureInfoOffsets.pathCountOffset);
  const texturePathOffset = buffer.readInt32LE(textureInfoOffsets.pathOffset);

  if (
    textureCount < 0 ||
    textureCount > 10000 ||
    texturePathCount < 0 ||
    texturePathCount > 10000 ||
    textureDataOffset < 0 ||
    texturePathOffset < 0
  ) {
    return [];
  }

  const materialStructSize = version >= 53 ? 44 : 64;
  const textureNames: string[] = [];
  for (let i = 0; i < textureCount; i += 1) {
    const entry = textureDataOffset + i * materialStructSize;
    if (entry + 4 > buffer.length) break;
    const rel = buffer.readInt32LE(entry);
    if (rel <= 0 || entry + rel >= buffer.length) continue;
    const name = readCString(buffer, entry + rel, 512).trim();
    if (name) textureNames.push(normalizeMaterialName(name));
  }

  const texturePaths: string[] = [];
  for (let i = 0; i < texturePathCount; i += 1) {
    const entry = texturePathOffset + i * 4;
    if (entry + 4 > buffer.length) break;
    const rel = buffer.readInt32LE(entry);
    if (rel <= 0 || rel >= buffer.length) continue;
    const dirName = readCString(buffer, rel, 512).trim();
    if (dirName) texturePaths.push(normalizeMaterialName(dirName));
  }

  const out = new Set<string>();
  for (const textureName of textureNames) {
    if (!textureName) continue;
    if (textureName.includes('/')) {
      out.add(normalizeMaterialName(textureName));
    }
    if (texturePaths.length === 0) {
      out.add(normalizeMaterialName(textureName));
      continue;
    }
    for (const texturePath of texturePaths) {
      out.add(normalizeMaterialName(path.posix.join(texturePath, textureName)));
    }
  }

  return Array.from(out).sort((a, b) => a.localeCompare(b));
};

const parseMdlMaterialRefs = (catalog: AssetCatalog, mdlAsset: string): string[] => {
  const buffer = catalog.readBuffer(mdlAsset);
  if (!buffer) return [];
  return parseMdlMaterialRefsFromBuffer(buffer);
};

const stripLineComments = (raw: string): string => {
  return raw
    .split(/\r?\n/g)
    .map((line) => {
      const idx = line.indexOf('//');
      if (idx < 0) return line;
      return line.slice(0, idx);
    })
    .join('\n');
};

const parseVmtTokens = (raw: string): { includes: string[]; baseTextures: string[] } => {
  const includes: string[] = [];
  const baseTextures: string[] = [];
  const sanitized = stripLineComments(raw);

  const quotedPairs = /"([^"]+)"\s*"([^"]*)"/g;
  let pair = quotedPairs.exec(sanitized);
  while (pair) {
    const key = String(pair[1] || '').trim().toLowerCase();
    const value = String(pair[2] || '').trim();
    if (key === 'include') includes.push(value);
    if (key === '$basetexture') baseTextures.push(value);
    pair = quotedPairs.exec(sanitized);
  }

  const unquotedInclude = /\binclude\b\s+([^\s"\r\n\}]+)/gi;
  let matchInclude = unquotedInclude.exec(sanitized);
  while (matchInclude) {
    includes.push(String(matchInclude[1] || '').trim());
    matchInclude = unquotedInclude.exec(sanitized);
  }

  const unquotedBase = /\$basetexture\s+([^\s"\r\n\}]+)/gi;
  let matchBase = unquotedBase.exec(sanitized);
  while (matchBase) {
    baseTextures.push(String(matchBase[1] || '').trim());
    matchBase = unquotedBase.exec(sanitized);
  }

  return {
    includes: dedupeSortedStrings(includes.map((item) => normalizeMaterialName(item)).filter(Boolean)),
    baseTextures: dedupeSortedStrings(baseTextures.map((item) => normalizeMaterialName(item)).filter(Boolean)),
  };
};

const createMaterialAnalyzer = (catalog: AssetCatalog) => {
  const cache = new Map<string, MaterialAnalysis>();

  const analyze = (materialName: string, stack: string[] = []): MaterialAnalysis => {
    const normalizedMaterial = normalizeMaterialName(materialName);
    if (!normalizedMaterial) {
      return {
        material: normalizedMaterial,
        found: false,
        includeMaterials: [],
        missingIncludes: [],
        baseTextureCandidates: [],
      };
    }

    const cached = cache.get(normalizedMaterial);
    if (cached) return cached;
    if (stack.includes(normalizedMaterial)) {
      return {
        material: normalizedMaterial,
        found: false,
        includeMaterials: [],
        missingIncludes: [],
        baseTextureCandidates: [],
      };
    }

    const vmtAsset = `materials/${normalizedMaterial}.vmt`;
    const vmtLocation = catalog.resolveLocation(vmtAsset);
    if (!vmtLocation) {
      const missingResult: MaterialAnalysis = {
        material: normalizedMaterial,
        found: false,
        includeMaterials: [],
        missingIncludes: [],
        baseTextureCandidates: [],
      };
      cache.set(normalizedMaterial, missingResult);
      return missingResult;
    }

    const text = catalog.readText(vmtAsset);
    if (text === null) {
      const invalidResult: MaterialAnalysis = {
        material: normalizedMaterial,
        found: true,
        sourcePath: catalog.describeLocation(vmtLocation),
        includeMaterials: [],
        missingIncludes: [],
        baseTextureCandidates: [],
      };
      cache.set(normalizedMaterial, invalidResult);
      return invalidResult;
    }

    const parsed = parseVmtTokens(text);
    const includeMaterials = parsed.includes;
    const missingIncludes: string[] = [];
    const includeBaseTextures: string[] = [];

    for (const includeMat of includeMaterials) {
      const includeResult = analyze(includeMat, [...stack, normalizedMaterial]);
      if (!includeResult.found) {
        missingIncludes.push(includeMat);
      }
      if (includeResult.resolvedBaseTexture) {
        includeBaseTextures.push(includeResult.resolvedBaseTexture);
      }
      for (const nestedMissing of includeResult.missingIncludes) {
        missingIncludes.push(nestedMissing);
      }
    }

    const resolvedBaseTexture = parsed.baseTextures[0] || includeBaseTextures[0];
    const result: MaterialAnalysis = {
      material: normalizedMaterial,
      found: true,
      sourcePath: catalog.describeLocation(vmtLocation),
      includeMaterials,
      missingIncludes: dedupeSortedStrings(missingIncludes),
      baseTextureCandidates: parsed.baseTextures,
      ...(resolvedBaseTexture ? { resolvedBaseTexture } : {}),
    };
    cache.set(normalizedMaterial, result);
    return result;
  };

  return {
    analyze,
  };
};

export const buildAudit = (options: CliOptions) => {
  if (!fs.existsSync(options.mapBsp)) {
    throw new Error(`map_bsp_not_found: ${options.mapBsp}`);
  }
  if (!fs.existsSync(options.mapRoot) || !fs.statSync(options.mapRoot).isDirectory()) {
    throw new Error(`map_root_not_found: ${options.mapRoot}`);
  }

  const bspData = parseBspData(options.mapBsp);
  const mountResolution = resolveMounts(options.mountsConfigPath, options.mountOverrides);
  const mountsNotFoundWarning = mountResolution.mounts.length === 0
    ? (() => {
      const attempted = ['gmod', 'css', 'hl2', 'hl2ep1', 'hl2ep2', 'tf2']
        .map((mount) => {
          const attempts = mountResolution.attemptedCandidates[mount as MountId] || [];
          const sample = attempts.slice(0, 2).join(' | ');
          return `${mount}: ${sample || 'no_candidates'}`;
        })
        .join('; ');
      const libraries = mountResolution.libraryFoldersScanned.slice(0, 5).join(' | ') || 'none';
      return (
        `mounts_not_found_warning: no valid mount roots resolved from ${options.mountsConfigPath} and env vars (` +
        `${Object.values(envVarByMount).join(', ')}). Continuing with pak+map-root only. ` +
        `Steam libraries scanned: ${libraries}. Candidate paths: ${attempted}`
      );
    })()
    : null;

  const catalog = new AssetCatalog();
  if (bspData.pakArchive) {
    catalog.addPakRoot('pak', bspData.pakArchive);
  }
  catalog.addRoot('map-root', options.mapRoot, { role: 'map-root' });
  for (const mount of mountResolution.mounts) {
    catalog.addRoot(mount.sourceId, mount.rootPath, { role: 'mount', mountId: mount.id });
  }

  const missing = new MissingTracker();
  const analyzeMaterial = createMaterialAnalyzer(catalog).analyze;

  const usedWorldMaterialsNoResolvedBase = new Set<string>();
  const patchIncludeMissingSet = new Set<string>();

  const auditMaterial = (
    materialName: string,
    reference: string,
    unresolvedBaseIsCritical: boolean,
    unresolvedBaseAsWorldCounter = false,
  ) => {
    const normalized = normalizeMaterialName(materialName);
    if (!normalized) return;

    const analysis = analyzeMaterial(normalized);
    if (!analysis.found) {
      missing.add({
        type: 'vmt',
        asset: `materials/${normalized}.vmt`,
        severity: unresolvedBaseIsCritical ? 'critical' : 'major',
        reference,
      });
      return;
    }

    for (const missingInclude of analysis.missingIncludes) {
      patchIncludeMissingSet.add(`materials/${missingInclude}.vmt`);
      missing.add({
        type: 'patch-include',
        asset: `materials/${missingInclude}.vmt`,
        severity: 'major',
        reference: `${reference} -> include`,
      });
    }

    if (!analysis.resolvedBaseTexture) {
      if (unresolvedBaseIsCritical) {
        missing.add({
          type: 'world-material',
          asset: `materials/${normalized}.vmt`,
          severity: 'critical',
          reference,
          note: 'No resolved $basetexture after patch/include chain',
        });
      } else {
        missing.add({
          type: 'world-material',
          asset: `materials/${normalized}.vmt`,
          severity: 'major',
          reference,
          note: 'No resolved $basetexture after patch/include chain',
        });
      }
      if (unresolvedBaseAsWorldCounter) {
        usedWorldMaterialsNoResolvedBase.add(normalized);
      }
      return;
    }

    const baseVtf = `materials/${normalizeMaterialName(analysis.resolvedBaseTexture)}.vtf`;
    const baseExists = catalog.exists(baseVtf);
    if (!baseExists) {
      missing.add({
        type: 'vtf',
        asset: baseVtf,
        severity: unresolvedBaseIsCritical ? 'critical' : 'major',
        reference: `${reference} -> $basetexture`,
      });
    }
  };

  const worldMaterials = bspData.usedWorldMaterials.slice().sort((a, b) => a.localeCompare(b));
  for (const worldMat of worldMaterials) {
    auditMaterial(worldMat, `world:${worldMat}`, true, true);
  }

  const modelDict = bspData.staticPropModelNames;
  const modelRefCount = new Map<string, number>();
  for (const idx of bspData.staticPropModelRefs) {
    const model = modelDict[idx];
    if (!model) continue;
    modelRefCount.set(model, (modelRefCount.get(model) || 0) + 1);
  }

  const sortedModelRefs = Array.from(modelRefCount.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const missingModels = new Map<string, number>();
  for (const [model, instances] of sortedModelRefs) {
    const mdlAsset = `models/${normalizeModelName(model)}.mdl`;
    const mdlExists = catalog.exists(mdlAsset);
    if (!mdlExists) {
      missingModels.set(normalizeModelName(model), instances);
      missing.add({
        type: 'mdl',
        asset: mdlAsset,
        severity: 'major',
        reference: `static-prop:${model}`,
        note: `instances=${instances}`,
      });
      continue;
    }

    const materialRefs = parseMdlMaterialRefs(catalog, mdlAsset);
    for (const matRef of materialRefs) {
      auditMaterial(matRef, `model:${model}`, false, false);
    }
  }

  let skyboxInvalid = false;
  const skyboxIssues: string[] = [];
  const skyNameRaw = String(bspData.skyName || '').trim();
  if (!skyNameRaw) {
    skyboxInvalid = true;
    skyboxIssues.push('worldspawn skyname missing');
    missing.add({
      type: 'skybox',
      asset: 'worldspawn:skyname',
      severity: 'critical',
      reference: 'worldspawn',
      suggestedMount: 'custom',
    });
  } else {
    const skyBase = normalizeMaterialName(skyNameRaw).replace(/^skybox\//, '');
    for (const side of SKYBOX_SIDES) {
      const sideMaterial = `skybox/${skyBase}${side}`;
      auditMaterial(sideMaterial, `skybox:${skyBase}:${side}`, true, false);

      const skyAnalysis = analyzeMaterial(sideMaterial);
      const skyVmtMissing = !skyAnalysis.found;
      const skyNoBase = !skyAnalysis.resolvedBaseTexture;
      const skyVtfMissing = !!skyAnalysis.resolvedBaseTexture &&
        !catalog.exists(`materials/${normalizeMaterialName(skyAnalysis.resolvedBaseTexture)}.vtf`);
      if (skyVmtMissing || skyNoBase || skyVtfMissing) {
        skyboxInvalid = true;
        skyboxIssues.push(`${sideMaterial} unresolved`);
        missing.add({
          type: 'skybox',
          asset: `materials/${sideMaterial}.vmt`,
          severity: 'critical',
          reference: `skybox:${skyBase}`,
          suggestedMount: inferMountSuggestion(`materials/${sideMaterial}.vmt`),
        });
      }
    }
  }

  const missingList = missing.toSortedList();
  const summary = missing.getSummary();
  const resolvedCountsBySource = catalog.getResolvedCountsBySource();
  const notes: string[] = [];
  if (mountsNotFoundWarning) {
    notes.push(mountsNotFoundWarning);
  }
  if (bspData.pakfileError) {
    notes.push(
      `BSP pakfile parse failed: ${bspData.pakfileError}`,
    );
  }

  const staticPropMissingModelsSorted = Array.from(missingModels.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([model, instances]) => ({ model, instances }));

  const mountsUsed = mountResolution.mountValidation.map((item) => ({
    mount: item.mount,
    source: item.source,
    inputPath: item.inputPath,
    status: item.status,
    ...(item.resolvedPath ? { resolvedPath: item.resolvedPath } : {}),
    checks: item.checks,
    resolvedAssets: item.sourceId ? resolvedCountsBySource[item.sourceId] || 0 : 0,
    ...(item.reason ? { reason: item.reason } : {}),
  }));

  const criticalTop50 = missingList
    .filter((item) => item.severity === 'critical')
    .sort((a, b) => b.occurrences - a.occurrences || a.asset.localeCompare(b.asset))
    .slice(0, 50)
    .map((item) => ({
      type: item.type,
      asset: item.asset,
      occurrences: item.occurrences,
      bestGuessMount: item.suggestedMount,
      searchedIn: {
        pak: bspData.pakfileScanned ? 'checked' : 'not_available',
        mapRoot: options.mapRoot,
        mounts: mountResolution.mounts.map((mount) => ({
          mount: mount.id,
          source: mount.source,
          path: mount.rootPath,
        })),
      },
      references: item.references.slice(0, 5),
    }));

  return {
    generatedAt: new Date().toISOString(),
    settings: {
      assetResolutionMode: options.assetResolutionMode,
    },
    map: {
      bspPath: options.mapBsp,
      mapRoot: options.mapRoot,
      mapName: path.basename(options.mapBsp, path.extname(options.mapBsp)),
      bspVersion: bspData.bspVersion,
      skyName: bspData.skyName,
      pakfileLength: bspData.pakfileLength,
      pakfileScanned: bspData.pakfileScanned,
      pakfileFilesCount: bspData.pakfileFilesCount,
    },
    mounts: {
      configPath: mountResolution.configPathUsed,
      resolved: mountResolution.mounts,
      autoDetected: mountResolution.autoDetected,
      attemptedCandidates: mountResolution.attemptedCandidates,
      libraryFoldersScanned: mountResolution.libraryFoldersScanned,
      unresolvedInputPaths: mountResolution.unresolvedInputPaths,
      validation: mountResolution.mountValidation,
    },
    mountsUsed,
    catalog: catalog.stats(),
    missingAssetsSummary: summary,
    counters: {
      staticProps: {
        totalInstances: bspData.staticPropModelRefs.length,
        uniqueModels: modelRefCount.size,
        uniqueMissingModels: missingModels.size,
        affectedInstances: staticPropMissingModelsSorted.reduce((acc, item) => acc + item.instances, 0),
      },
      usedMaterialsTotal: worldMaterials.length,
      usedWorldMaterialsWithoutResolvedBaseTexture: usedWorldMaterialsNoResolvedBase.size,
      vmtPatchIncludesMissingUnique: patchIncludeMissingSet.size,
      pakfileScanned: bspData.pakfileScanned,
      pakfileFilesCount: bspData.pakfileFilesCount,
      skyboxInvalid,
      skyboxIssueCount: skyboxIssues.length,
    },
    missingAssets: missingList,
    topMissing: {
      staticPropsModels: staticPropMissingModelsSorted.slice(0, 20),
      skyboxIssues,
    },
    criticalTop50,
    notes,
  };
};

export const writeReport = (reportPath: string, payload: unknown) => {
  const reportDir = path.dirname(reportPath);
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
};

const run = () => {
  const options = parseArgs();
  const report = buildAudit(options);
  writeReport(options.reportPath, report);

  const criticalMissing = Number((report as any)?.missingAssetsSummary?.critical || 0);
  const majorMissing = Number((report as any)?.missingAssetsSummary?.major || 0);
  const minorMissing = Number((report as any)?.missingAssetsSummary?.minor || 0);

  console.log(`Map audit completed: ${options.mapBsp}`);
  console.log(`Report: ${options.reportPath}`);
  console.log(`Asset resolution mode: ${options.assetResolutionMode}`);
  console.log(`Missing summary -> critical=${criticalMissing} major=${majorMissing} minor=${minorMissing}`);

  if (options.assetResolutionMode === 'strict' && criticalMissing > 0) {
    throw new Error(`critical_missing_assets_detected: ${criticalMissing}`);
  }
};

if (require.main === module) {
  run();
}

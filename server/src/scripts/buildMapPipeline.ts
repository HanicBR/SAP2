import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildAudit, writeReport as writeAuditReport, type AssetResolutionMode, type CliOptions as AuditCliOptions } from './auditMapAssets';

type SourceIOMode = 'auto' | 'required' | 'off';

type Options = {
  mapBsp: string;
  mapRoot: string;
  outDir: string;
  reportPath: string;
  auditReportPath: string;
  mountsConfigPath: string;
  chunkSize: number;
  maxWorldFacesPerChunk: number;
  maxInstancesPerChunk: number;
  worldCoverageMinPct: number;
  perChunkMaxTris: number;
  perChunkMaxVerts: number;
  perChunkMaxBytes: number;
  active3x3MaxTris: number;
  active3x3MaxDrawCalls: number;
  active3x3MaxBytes: number;
  active5x5MaxTris: number;
  active5x5MaxDrawCalls: number;
  active5x5MaxBytes: number;
  assetResolutionMode: AssetResolutionMode;
  sourceioMode: SourceIOMode;
  sourceioRoot: string;
  sourceioScript: string;
  sourceioPython: string;
};

type BspLump = { offset: number; length: number; version: number; fourCC: number };

type WorldFace = {
  x: number;
  y: number;
  z: number;
  texInfoId: number;
  dispInfoId: number;
  vertexCount: number;
  triCount: number;
  byteEstimate: number;
};

type PropInstance = {
  model: string;
  origin: [number, number, number];
  angles: [number, number, number];
  scale: [number, number, number];
};

type ImportData = {
  engine: 'sourceio' | 'fallback';
  importDurationMs: number;
  worldBounds: { min: [number, number, number]; max: [number, number, number] };
  worldFacesTotal: number;
  worldFacesExported: number;
  worldFacesInvalid: number;
  displacementsTotal: number;
  displacementsReferencedByWorld: number;
  worldFaces: WorldFace[];
  staticProps: PropInstance[];
  warnings: string[];
};

type AuditMissing = {
  type: string;
  asset: string;
  severity: 'critical' | 'major' | 'minor';
  references: string[];
};

type AuditReport = {
  missingAssetsSummary: { critical: number; major: number; minor: number };
  missingAssets: AuditMissing[];
  criticalTop50?: unknown[];
  notes?: string[];
};

type FaceAnnotated = WorldFace & { material: string; placeholderMaterial: boolean };
type PropAnnotated = PropInstance & { sourceModel: string; placeholderModel: boolean; model: string };

type Chunk = {
  id: string;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  size: number;
  worldFaceIndexes: number[];
  propIndexes: number[];
  splitDepth: number;
  splitReason?: string[];
};

const DEFAULTS = {
  chunkSize: 2048,
  maxWorldFacesPerChunk: 4000,
  maxInstancesPerChunk: 600,
  worldCoverageMinPct: 85,
  perChunkMaxTris: 250000,
  perChunkMaxVerts: 190000,
  perChunkMaxBytes: 12 * 1024 * 1024,
  active3x3MaxTris: 1800000,
  active3x3MaxDrawCalls: 1800,
  active3x3MaxBytes: 96 * 1024 * 1024,
  active5x5MaxTris: 4200000,
  active5x5MaxDrawCalls: 4200,
  active5x5MaxBytes: 220 * 1024 * 1024,
  sourceioMode: 'auto' as SourceIOMode,
  assetResolutionMode: 'permissive' as AssetResolutionMode,
};

const toNum = (raw: string | undefined, fallback: number): number => {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const parseArgs = (): Options => {
  const map = new Map<string, string>();
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = String(args[i] || '').trim();
    if (!arg) continue;
    if (arg.startsWith('--') && arg.includes('=')) {
      const idx = arg.indexOf('=');
      map.set(arg.slice(0, idx), arg.slice(idx + 1));
      continue;
    }
    if (!arg.startsWith('--')) continue;
    const next = String(args[i + 1] || '').trim();
    if (!next || next.startsWith('--')) throw new Error(`invalid_arg_value: ${arg}`);
    map.set(arg, next);
    i += 1;
  }

  const resolveWithParentFallback = (inputPath: string): string => {
    const primary = path.resolve(inputPath);
    if (fs.existsSync(primary) || path.isAbsolute(inputPath)) return primary;
    const parent = path.resolve(process.cwd(), '..', inputPath);
    if (fs.existsSync(parent)) return parent;
    return primary;
  };

  const mapBsp = resolveWithParentFallback(String(map.get('--map-bsp') || ''));
  const mapRoot = resolveWithParentFallback(String(map.get('--map-root') || ''));
  if (!mapBsp || !mapRoot) throw new Error('missing_required_args: --map-bsp --map-root');
  const mapName = path.basename(mapBsp, path.extname(mapBsp));
  const outDir = path.resolve(String(map.get('--out-dir') || `public/maps/${mapName}`));
  const reportPath = path.resolve(String(map.get('--report') || path.join(outDir, 'reports', 'report.json')));
  const auditReportPath = resolveWithParentFallback(String(map.get('--audit-report') || 'reports/audit-report.json'));
  const mountsConfigPath = resolveWithParentFallback(String(map.get('--mounts') || 'server/config/mounts.json'));
  const modeRaw = String(
    map.get('--asset-resolution-mode') ||
      process.env.MAP_AUDIT_ASSET_RESOLUTION_MODE ||
      DEFAULTS.assetResolutionMode,
  )
    .trim()
    .toLowerCase();
  const assetResolutionMode: AssetResolutionMode = modeRaw === 'strict' ? 'strict' : 'permissive';
  const sourceioModeRaw = String(map.get('--sourceio-mode') || DEFAULTS.sourceioMode).trim().toLowerCase();
  const sourceioMode: SourceIOMode = sourceioModeRaw === 'required'
    ? 'required'
    : sourceioModeRaw === 'off'
      ? 'off'
      : 'auto';

  const envOrArg = (argKey: string, envKey: string): string | undefined => {
    const fromArg = map.get(argKey);
    if (fromArg !== undefined) return fromArg;
    const fromEnv = process.env[envKey];
    return fromEnv !== undefined ? String(fromEnv) : undefined;
  };

  return {
    mapBsp,
    mapRoot,
    outDir,
    reportPath,
    auditReportPath,
    mountsConfigPath,
    chunkSize: Math.floor(toNum(map.get('--chunk-size'), DEFAULTS.chunkSize)),
    maxWorldFacesPerChunk: Math.floor(toNum(map.get('--max-world-faces-per-chunk'), DEFAULTS.maxWorldFacesPerChunk)),
    maxInstancesPerChunk: Math.floor(toNum(map.get('--max-instances-per-chunk'), DEFAULTS.maxInstancesPerChunk)),
    worldCoverageMinPct: toNum(map.get('--world-coverage-min-pct'), DEFAULTS.worldCoverageMinPct),
    perChunkMaxTris: Math.floor(toNum(envOrArg('--per-chunk-max-tris', 'MAP_PIPELINE_PER_CHUNK_MAX_TRIS'), DEFAULTS.perChunkMaxTris)),
    perChunkMaxVerts: Math.floor(toNum(envOrArg('--per-chunk-max-verts', 'MAP_PIPELINE_PER_CHUNK_MAX_VERTS'), DEFAULTS.perChunkMaxVerts)),
    perChunkMaxBytes: Math.floor(toNum(envOrArg('--per-chunk-max-bytes', 'MAP_PIPELINE_PER_CHUNK_MAX_BYTES'), DEFAULTS.perChunkMaxBytes)),
    active3x3MaxTris: Math.floor(toNum(envOrArg('--active-3x3-max-tris', 'MAP_PIPELINE_ACTIVE_3X3_MAX_TRIS'), DEFAULTS.active3x3MaxTris)),
    active3x3MaxDrawCalls: Math.floor(
      toNum(envOrArg('--active-3x3-max-drawcalls', 'MAP_PIPELINE_ACTIVE_3X3_MAX_DRAWCALLS'), DEFAULTS.active3x3MaxDrawCalls),
    ),
    active3x3MaxBytes: Math.floor(toNum(envOrArg('--active-3x3-max-bytes', 'MAP_PIPELINE_ACTIVE_3X3_MAX_BYTES'), DEFAULTS.active3x3MaxBytes)),
    active5x5MaxTris: Math.floor(toNum(envOrArg('--active-5x5-max-tris', 'MAP_PIPELINE_ACTIVE_5X5_MAX_TRIS'), DEFAULTS.active5x5MaxTris)),
    active5x5MaxDrawCalls: Math.floor(
      toNum(envOrArg('--active-5x5-max-drawcalls', 'MAP_PIPELINE_ACTIVE_5X5_MAX_DRAWCALLS'), DEFAULTS.active5x5MaxDrawCalls),
    ),
    active5x5MaxBytes: Math.floor(toNum(envOrArg('--active-5x5-max-bytes', 'MAP_PIPELINE_ACTIVE_5X5_MAX_BYTES'), DEFAULTS.active5x5MaxBytes)),
    assetResolutionMode,
    sourceioMode,
    sourceioRoot: resolveWithParentFallback(String(map.get('--sourceio-root') || 'sandbox/_techrefs/SourceIO')),
    sourceioScript: resolveWithParentFallback(String(map.get('--sourceio-script') || 'server/scripts/sourceio_extract_scene.py')),
    sourceioPython: String(map.get('--sourceio-python') || process.env.PYTHON || 'python').trim(),
  };
};

const normalizeAssetPath = (value: string): string =>
  String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/')
    .toLowerCase();

const normalizeMaterialName = (value: string): string =>
  normalizeAssetPath(value).replace(/^materials\//, '').replace(/\.vmt$/i, '').replace(/\.vtf$/i, '');

const normalizeModelName = (value: string): string =>
  normalizeAssetPath(value).replace(/^models\//, '').replace(/\.mdl$/i, '');

const readCString = (buffer: Buffer, offset: number, maxLength = 4096): string => {
  if (offset < 0 || offset >= buffer.length) return '';
  let end = offset;
  const limit = Math.min(buffer.length, offset + maxLength);
  while (end < limit && buffer[end] !== 0) end += 1;
  return buffer.subarray(offset, end).toString('latin1');
};

const fourCC = (value: string): number =>
  value.charCodeAt(0) | (value.charCodeAt(1) << 8) | (value.charCodeAt(2) << 16) | (value.charCodeAt(3) << 24);

const parseBspLumps = (buffer: Buffer): { version: number; lumps: BspLump[] } => {
  if (buffer.readInt32LE(0) !== fourCC('VBSP')) throw new Error('invalid_bsp_signature');
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

const parseTexdataStringsCandidate = (buffer: Buffer, dataLump: BspLump, tableLump: BspLump): string[] => {
  if (dataLump.length <= 0 || tableLump.length <= 0 || tableLump.length % 4 !== 0) return [];
  if (dataLump.offset + dataLump.length > buffer.length || tableLump.offset + tableLump.length > buffer.length) {
    return [];
  }
  const out: string[] = [];
  for (let i = 0; i < tableLump.length / 4; i += 1) {
    const rel = buffer.readInt32LE(tableLump.offset + i * 4);
    if (rel < 0 || rel >= dataLump.length) continue;
    const text = readCString(buffer, dataLump.offset + rel, 512).trim();
    if (text) out.push(text);
  }
  return out;
};

const parseTexdataNameStringTable = (buffer: Buffer, lump43: BspLump, lump44: BspLump): string[] => {
  const a = parseTexdataStringsCandidate(buffer, lump43, lump44);
  const b = parseTexdataStringsCandidate(buffer, lump44, lump43);
  return b.length > a.length ? b : a;
};

const parseTexdataNameIds = (buffer: Buffer, texdataLump: BspLump): number[] => {
  if (texdataLump.length <= 0 || texdataLump.offset + texdataLump.length > buffer.length) return [];
  const count = Math.floor(texdataLump.length / 32);
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) out.push(buffer.readInt32LE(texdataLump.offset + i * 32 + 12));
  return out;
};

const parseTexinfoTexdataIndices = (buffer: Buffer, texinfoLump: BspLump): number[] => {
  if (texinfoLump.length <= 0 || texinfoLump.offset + texinfoLump.length > buffer.length) return [];
  const count = Math.floor(texinfoLump.length / 72);
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) out.push(buffer.readInt32LE(texinfoLump.offset + i * 72 + 68));
  return out;
};

const buildMaterialByTexInfo = (buffer: Buffer, lumps: BspLump[]): string[] => {
  const texdata = lumps[2];
  const texinfo = lumps[6];
  const lump43 = lumps[43];
  const lump44 = lumps[44];
  if (!texdata || !texinfo || !lump43 || !lump44) return [];
  const strings = parseTexdataNameStringTable(buffer, lump43, lump44);
  const texdataNameIds = parseTexdataNameIds(buffer, texdata);
  const texinfoTexdata = parseTexinfoTexdataIndices(buffer, texinfo);
  const out: string[] = new Array(texinfoTexdata.length).fill('');
  for (let i = 0; i < texinfoTexdata.length; i += 1) {
    const texdataIdx = texinfoTexdata[i];
    if (texdataIdx === undefined) continue;
    if (texdataIdx < 0 || texdataIdx >= texdataNameIds.length) continue;
    const strIdx = texdataNameIds[texdataIdx];
    if (strIdx === undefined) continue;
    if (strIdx < 0 || strIdx >= strings.length) continue;
    out[i] = normalizeMaterialName(strings[strIdx] || '');
  }
  return out;
};

const parseWorldFacesFallback = (buffer: Buffer, lumps: BspLump[]): {
  bounds: { min: [number, number, number]; max: [number, number, number] };
  total: number;
  exported: number;
  invalid: number;
  faces: WorldFace[];
} => {
  const facesLump = lumps[7];
  const surfEdgesLump = lumps[13];
  const edgesLump = lumps[12];
  const verticesLump = lumps[3];
  const modelsLump = lumps[14];
  if (!facesLump || !surfEdgesLump || !edgesLump || !verticesLump || !modelsLump) {
    throw new Error('fallback_world_lumps_missing');
  }
  if (modelsLump.length < 48) throw new Error('fallback_world_model_missing');
  const worldMin: [number, number, number] = [
    buffer.readFloatLE(modelsLump.offset + 0),
    buffer.readFloatLE(modelsLump.offset + 4),
    buffer.readFloatLE(modelsLump.offset + 8),
  ];
  const worldMax: [number, number, number] = [
    buffer.readFloatLE(modelsLump.offset + 12),
    buffer.readFloatLE(modelsLump.offset + 16),
    buffer.readFloatLE(modelsLump.offset + 20),
  ];
  const worldFirstFace = buffer.readInt32LE(modelsLump.offset + 40);
  const worldFaceCount = buffer.readInt32LE(modelsLump.offset + 44);

  const faceCount = Math.floor(facesLump.length / 56);
  const surfEdgeCount = Math.floor(surfEdgesLump.length / 4);
  const vertexCount = Math.floor(verticesLump.length / 12);
  const edgeStride = edgesLump.length % 4 === 0 ? 4 : 2;
  const edgeCount = Math.floor(edgesLump.length / edgeStride);

  const readEdgeVertex = (edgeIndex: number, reverse: boolean): number => {
    if (edgeIndex < 0 || edgeIndex >= edgeCount) return -1;
    const base = edgesLump.offset + edgeIndex * edgeStride;
    if (edgeStride === 4) {
      const v0 = buffer.readUInt16LE(base);
      const v1 = buffer.readUInt16LE(base + 2);
      return reverse ? v1 : v0;
    }
    return buffer.readUInt16LE(base);
  };

  const faces: WorldFace[] = [];
  let invalid = 0;
  for (let i = 0; i < worldFaceCount; i += 1) {
    const faceIndex = worldFirstFace + i;
    if (faceIndex < 0 || faceIndex >= faceCount) {
      invalid += 1;
      continue;
    }
    const faceBase = facesLump.offset + faceIndex * 56;
    const firstEdge = buffer.readInt32LE(faceBase + 4);
    const edges = buffer.readUInt16LE(faceBase + 8);
    const texInfoId = buffer.readInt16LE(faceBase + 10);
    const dispInfoId = buffer.readInt16LE(faceBase + 12);
    if (edges <= 0 || firstEdge < 0 || firstEdge + edges > surfEdgeCount) {
      invalid += 1;
      continue;
    }
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let points = 0;
    for (let e = 0; e < edges; e += 1) {
      const surfEdge = buffer.readInt32LE(surfEdgesLump.offset + (firstEdge + e) * 4);
      const edgeIndex = Math.abs(surfEdge);
      const vertexIndex = readEdgeVertex(edgeIndex, surfEdge < 0);
      if (vertexIndex < 0 || vertexIndex >= vertexCount) continue;
      const vb = verticesLump.offset + vertexIndex * 12;
      sx += buffer.readFloatLE(vb + 0);
      sy += buffer.readFloatLE(vb + 4);
      sz += buffer.readFloatLE(vb + 8);
      points += 1;
    }
    if (points <= 0) {
      invalid += 1;
      continue;
    }
    faces.push({
      x: sx / points,
      y: sy / points,
      z: sz / points,
      texInfoId,
      dispInfoId,
      vertexCount: points,
      triCount: Math.max(1, points - 2),
      byteEstimate: Math.max(24, Math.max(1, points - 2) * 3 * 24),
    });
  }

  return {
    bounds: { min: worldMin, max: worldMax },
    total: worldFaceCount,
    exported: faces.length,
    invalid,
    faces,
  };
};

const parseStaticPropsFallback = (buffer: Buffer, gameLump: BspLump): PropInstance[] => {
  if (gameLump.length <= 0 || gameLump.offset + gameLump.length > buffer.length) return [];
  let cursor = gameLump.offset;
  const end = gameLump.offset + gameLump.length;
  if (cursor + 4 > end) return [];
  const lumpCount = buffer.readInt32LE(cursor);
  cursor += 4;

  let sprpOffset = -1;
  let sprpLength = 0;
  let sprpVersion = 0;
  for (let i = 0; i < lumpCount; i += 1) {
    if (cursor + 16 > end) break;
    const id = buffer.readInt32LE(cursor);
    const version = buffer.readUInt16LE(cursor + 4);
    const fileOffset = buffer.readInt32LE(cursor + 8);
    const fileLength = buffer.readInt32LE(cursor + 12);
    cursor += 16;
    if (id !== fourCC('sprp') && id !== fourCC('prps')) continue;
    sprpOffset = fileOffset;
    sprpLength = fileLength;
    sprpVersion = version;
    break;
  }
  if (sprpOffset < 0 || sprpLength <= 0 || sprpOffset + sprpLength > buffer.length) return [];

  cursor = sprpOffset;
  const sprpEnd = sprpOffset + sprpLength;
  const dictCount = buffer.readInt32LE(cursor);
  cursor += 4;
  if (dictCount < 0 || dictCount > 300000) return [];
  const modelNames: string[] = [];
  for (let i = 0; i < dictCount; i += 1) {
    if (cursor + 128 > sprpEnd) break;
    modelNames.push(normalizeModelName(readCString(buffer, cursor, 128)));
    cursor += 128;
  }
  if (cursor + 4 > sprpEnd) return [];
  const leafCount = buffer.readInt32LE(cursor);
  cursor += 4;
  const leafStride = sprpVersion >= 13 ? 4 : 2;
  cursor += Math.max(0, leafCount) * leafStride;
  if (sprpVersion === 12 && cursor + 8 <= sprpEnd) cursor += 8;
  if (cursor + 4 > sprpEnd) return [];
  const propCount = buffer.readInt32LE(cursor);
  cursor += 4;
  if (propCount <= 0) return [];
  const stride = Math.floor((sprpEnd - cursor) / propCount);
  if (stride < 28) return [];

  const out: PropInstance[] = [];
  for (let i = 0; i < propCount; i += 1) {
    const base = cursor + i * stride;
    if (base + 28 > sprpEnd) break;
    const modelRef = buffer.readUInt16LE(base + 24);
    const model = modelRef < modelNames.length ? modelNames[modelRef] || `__missing_model_ref_${modelRef}` : `__missing_model_ref_${modelRef}`;
    out.push({
      model,
      origin: [buffer.readFloatLE(base + 0), buffer.readFloatLE(base + 4), buffer.readFloatLE(base + 8)],
      angles: [buffer.readFloatLE(base + 12), buffer.readFloatLE(base + 16), buffer.readFloatLE(base + 20)],
      scale: [1, 1, 1],
    });
  }
  return out;
};

const runSourceIO = (options: Options): { data: ImportData | null; warnings: string[] } => {
  const warnings: string[] = [];
  if (options.sourceioMode === 'off') return { data: null, warnings: ['sourceio_disabled_by_option'] };
  if (!fs.existsSync(options.sourceioScript) || !fs.existsSync(options.sourceioRoot)) {
    const warning = 'sourceio_paths_missing';
    if (options.sourceioMode === 'required') throw new Error(warning);
    return { data: null, warnings: [warning] };
  }

  const tempPath = path.join(os.tmpdir(), `sap2-sourceio-${process.pid}-${Date.now()}.json`);
  const exec = spawnSync(
    options.sourceioPython,
    [
      options.sourceioScript,
      '--map-bsp',
      options.mapBsp,
      '--map-root',
      options.mapRoot,
      '--sourceio-root',
      options.sourceioRoot,
      '--out',
      tempPath,
    ],
    { encoding: 'utf8', timeout: 10 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 },
  );
  if (exec.error || !fs.existsSync(tempPath)) {
    const warning = `sourceio_exec_failed:${exec.error?.message || 'no_output'}`;
    if (options.sourceioMode === 'required') throw new Error(warning);
    return { data: null, warnings: [warning] };
  }
  const payload = JSON.parse(fs.readFileSync(tempPath, 'utf8')) as any;
  try {
    fs.unlinkSync(tempPath);
  } catch {
    // no-op
  }
  if (!payload?.ok) {
    const warning = `sourceio_failed:${payload?.error || 'unknown'}`;
    if (options.sourceioMode === 'required') throw new Error(warning);
    return { data: null, warnings: [warning] };
  }

  const data: ImportData = {
    engine: 'sourceio',
    importDurationMs: Number(payload.durationMs || 0),
    worldBounds: {
      min: [
        Number(payload.world?.bounds?.min?.[0] || 0),
        Number(payload.world?.bounds?.min?.[1] || 0),
        Number(payload.world?.bounds?.min?.[2] || 0),
      ],
      max: [
        Number(payload.world?.bounds?.max?.[0] || 0),
        Number(payload.world?.bounds?.max?.[1] || 0),
        Number(payload.world?.bounds?.max?.[2] || 0),
      ],
    },
    worldFacesTotal: Number(payload.world?.worldFacesTotal || 0),
    worldFacesExported: Number(payload.world?.worldFacesExported || 0),
    worldFacesInvalid: Number(payload.world?.worldFacesInvalid || 0),
    displacementsTotal: Number(payload.world?.displacementsTotal || 0),
    displacementsReferencedByWorld: Number(payload.world?.displacementsReferencedByWorld || 0),
    worldFaces: Array.isArray(payload.world?.faces)
      ? payload.world.faces.map((item: any) => ({
        x: Number(item?.[0] || 0),
        y: Number(item?.[1] || 0),
        z: Number(item?.[2] || 0),
        texInfoId: Number(item?.[3] ?? -1),
        dispInfoId: Number(item?.[4] ?? -1),
        vertexCount: Math.max(3, Number(item?.[5] || 3)),
        triCount: Math.max(1, Number(item?.[6] || 1)),
        byteEstimate: Math.max(24, Number(item?.[7] || 24)),
      }))
      : [],
    staticProps: Array.isArray(payload.staticProps?.instances)
      ? payload.staticProps.instances.map((item: any) => ({
        model: normalizeModelName(String(item?.model || '')),
        origin: [Number(item?.origin?.[0] || 0), Number(item?.origin?.[1] || 0), Number(item?.origin?.[2] || 0)],
        angles: [Number(item?.angles?.[0] || 0), Number(item?.angles?.[1] || 0), Number(item?.angles?.[2] || 0)],
        scale: [Number(item?.scale?.[0] || 1), Number(item?.scale?.[1] || 1), Number(item?.scale?.[2] || 1)],
      }))
      : [],
    warnings: Array.isArray(payload.warnings) ? payload.warnings.map((item: unknown) => String(item)) : [],
  };
  return { data, warnings };
};

const runFallback = (options: Options): ImportData => {
  const started = Date.now();
  const buffer = fs.readFileSync(options.mapBsp);
  const { lumps } = parseBspLumps(buffer);
  const world = parseWorldFacesFallback(buffer, lumps);
  const props = lumps[35] ? parseStaticPropsFallback(buffer, lumps[35]) : [];
  const dispLump = lumps[26];
  const dispTotal = dispLump && dispLump.length > 0 ? Math.floor(dispLump.length / 176) : 0;
  const dispRefs = new Set<number>();
  for (const face of world.faces) if (face.dispInfoId >= 0) dispRefs.add(face.dispInfoId);
  return {
    engine: 'fallback',
    importDurationMs: Date.now() - started,
    worldBounds: world.bounds,
    worldFacesTotal: world.total,
    worldFacesExported: world.exported,
    worldFacesInvalid: world.invalid,
    displacementsTotal: dispTotal,
    displacementsReferencedByWorld: dispRefs.size,
    worldFaces: world.faces,
    staticProps: props,
    warnings: ['sourceio_unavailable_using_fallback'],
  };
};

const writeJson = (filePath: string, payload: unknown) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
};

const computeChunkWorldStats = (chunk: Chunk, faces: FaceAnnotated[]) => {
  let tris = 0;
  let verts = 0;
  let bytes = 0;
  for (const index of chunk.worldFaceIndexes) {
    const face = faces[index];
    if (!face) continue;
    tris += Math.max(1, Number(face.triCount || 1));
    verts += Math.max(3, Number(face.vertexCount || 3));
    bytes += Math.max(24, Number(face.byteEstimate || 24));
  }
  return { tris, verts, bytes };
};

const splitChunk = (
  chunk: Chunk,
  faces: FaceAnnotated[],
  props: PropAnnotated[],
  maxFaces: number,
  maxProps: number,
  maxTris: number,
  maxVerts: number,
  maxBytes: number,
  minSize: number,
): Chunk[] => {
  const stats = computeChunkWorldStats(chunk, faces);
  const reason: string[] = [];
  if (chunk.worldFaceIndexes.length > maxFaces) reason.push(`faces>${maxFaces}`);
  if (chunk.propIndexes.length > maxProps) reason.push(`instances>${maxProps}`);
  if (stats.tris > maxTris) reason.push(`tris>${maxTris}`);
  if (stats.verts > maxVerts) reason.push(`verts>${maxVerts}`);
  if (stats.bytes > maxBytes) reason.push(`bytes>${maxBytes}`);

  if (reason.length === 0 || chunk.size <= minSize) {
    return [chunk];
  }
  const half = chunk.size / 2;
  const midX = chunk.bounds.minX + half;
  const midY = chunk.bounds.minY + half;
  const children: Chunk[] = [
    {
      id: `${chunk.id}_0`,
      bounds: { minX: chunk.bounds.minX, minY: chunk.bounds.minY, maxX: midX, maxY: midY },
      size: half,
      worldFaceIndexes: [],
      propIndexes: [],
      splitDepth: chunk.splitDepth + 1,
      splitReason: reason.slice(),
    },
    {
      id: `${chunk.id}_1`,
      bounds: { minX: midX, minY: chunk.bounds.minY, maxX: chunk.bounds.maxX, maxY: midY },
      size: half,
      worldFaceIndexes: [],
      propIndexes: [],
      splitDepth: chunk.splitDepth + 1,
      splitReason: reason.slice(),
    },
    {
      id: `${chunk.id}_2`,
      bounds: { minX: chunk.bounds.minX, minY: midY, maxX: midX, maxY: chunk.bounds.maxY },
      size: half,
      worldFaceIndexes: [],
      propIndexes: [],
      splitDepth: chunk.splitDepth + 1,
      splitReason: reason.slice(),
    },
    {
      id: `${chunk.id}_3`,
      bounds: { minX: midX, minY: midY, maxX: chunk.bounds.maxX, maxY: chunk.bounds.maxY },
      size: half,
      worldFaceIndexes: [],
      propIndexes: [],
      splitDepth: chunk.splitDepth + 1,
      splitReason: reason.slice(),
    },
  ];

  const choose = (x: number, y: number): number => (x >= midX ? 1 : 0) + (y >= midY ? 2 : 0);
  for (const index of chunk.worldFaceIndexes) {
    const face = faces[index];
    if (!face) continue;
    const target = children[choose(face.x, face.y)];
    if (!target) continue;
    target.worldFaceIndexes.push(index);
  }
  for (const index of chunk.propIndexes) {
    const prop = props[index];
    if (!prop) continue;
    const target = children[choose(prop.origin[0], prop.origin[1])];
    if (!target) continue;
    target.propIndexes.push(index);
  }

  const out: Chunk[] = [];
  for (const child of children) {
    if (child.worldFaceIndexes.length === 0 && child.propIndexes.length === 0) continue;
    out.push(...splitChunk(child, faces, props, maxFaces, maxProps, maxTris, maxVerts, maxBytes, minSize));
  }
  return out.length ? out : [chunk];
};

const run = () => {
  const options = parseArgs();
  const started = Date.now();
  if (!fs.existsSync(options.mapBsp)) throw new Error(`map_bsp_not_found: ${options.mapBsp}`);
  if (!fs.existsSync(options.mapRoot) || !fs.statSync(options.mapRoot).isDirectory()) {
    throw new Error(`map_root_not_found: ${options.mapRoot}`);
  }

  const auditOptions: AuditCliOptions = {
    mapBsp: options.mapBsp,
    mapRoot: options.mapRoot,
    reportPath: options.auditReportPath,
    mountsConfigPath: options.mountsConfigPath,
    mountOverrides: {},
    assetResolutionMode: options.assetResolutionMode,
  };
  const auditReport = buildAudit(auditOptions) as unknown as AuditReport;
  writeAuditReport(options.auditReportPath, auditReport);

  const sourceioAttempt = runSourceIO(options);
  const importData = sourceioAttempt.data || runFallback(options);
  const warnings = sourceioAttempt.warnings.concat(importData.warnings);

  const bspBuffer = fs.readFileSync(options.mapBsp);
  const { lumps } = parseBspLumps(bspBuffer);
  const materialByTexInfo = buildMaterialByTexInfo(bspBuffer, lumps);

  const missingModels = new Set<string>();
  const missingWorldMaterials = new Set<string>();
  for (const item of auditReport.missingAssets || []) {
    if (item.type === 'mdl') {
      missingModels.add(normalizeModelName(item.asset));
      continue;
    }
    const refs = Array.isArray(item.references) ? item.references : [];
    if (item.type === 'world-material' || refs.some((ref) => String(ref).startsWith('world:'))) {
      const mat = normalizeMaterialName(item.asset);
      if (mat) missingWorldMaterials.add(mat);
    }
  }

  const faces: FaceAnnotated[] = importData.worldFaces.map((face) => {
    const material = face.texInfoId >= 0 && face.texInfoId < materialByTexInfo.length
      ? materialByTexInfo[face.texInfoId] || '__missing_material'
      : '__missing_material';
    return {
      ...face,
      material,
      placeholderMaterial: material === '__missing_material' || missingWorldMaterials.has(material),
    };
  });

  const props: PropAnnotated[] = importData.staticProps.map((item) => {
    const sourceModel = normalizeModelName(item.model);
    const placeholderModel = !sourceModel || sourceModel.startsWith('__missing_model_ref_') || missingModels.has(sourceModel);
    return {
      ...item,
      sourceModel,
      placeholderModel,
      model: placeholderModel ? '__placeholder_box__' : sourceModel,
    };
  });

  const minX = importData.worldBounds.min[0];
  const minY = importData.worldBounds.min[1];
  const chunkMap = new Map<string, Chunk>();
  const ensureChunk = (cx: number, cy: number): Chunk => {
    const key = `${cx}:${cy}`;
    const hit = chunkMap.get(key);
    if (hit) return hit;
    const chunk: Chunk = {
      id: `g_${cx}_${cy}`,
      bounds: {
        minX: minX + cx * options.chunkSize,
        minY: minY + cy * options.chunkSize,
        maxX: minX + (cx + 1) * options.chunkSize,
        maxY: minY + (cy + 1) * options.chunkSize,
      },
      size: options.chunkSize,
      worldFaceIndexes: [],
      propIndexes: [],
      splitDepth: 0,
    };
    chunkMap.set(key, chunk);
    return chunk;
  };
  for (let i = 0; i < faces.length; i += 1) {
    const face = faces[i];
    if (!face) continue;
    const cx = Math.floor((face.x - minX) / options.chunkSize);
    const cy = Math.floor((face.y - minY) / options.chunkSize);
    ensureChunk(cx, cy).worldFaceIndexes.push(i);
  }
  for (let i = 0; i < props.length; i += 1) {
    const prop = props[i];
    if (!prop) continue;
    const cx = Math.floor((prop.origin[0] - minX) / options.chunkSize);
    const cy = Math.floor((prop.origin[1] - minY) / options.chunkSize);
    ensureChunk(cx, cy).propIndexes.push(i);
  }

  const minChunkSize = Math.max(256, Math.floor(options.chunkSize / 4));
  let chunks: Chunk[] = [];
  for (const chunk of chunkMap.values()) {
    chunks = chunks.concat(
      splitChunk(
        chunk,
        faces,
        props,
        options.maxWorldFacesPerChunk,
        options.maxInstancesPerChunk,
        options.perChunkMaxTris,
        options.perChunkMaxVerts,
        options.perChunkMaxBytes,
        minChunkSize,
      ),
    );
  }
  chunks.sort((a, b) => a.id.localeCompare(b.id));

  const batchMap = new Map<string, { model: string; placeholderModel: boolean; count: number }>();
  for (const prop of props) {
    const key = `${prop.model}|${prop.placeholderModel ? 'ph' : 'ok'}`;
    const item = batchMap.get(key) || { model: prop.model, placeholderModel: prop.placeholderModel, count: 0 };
    item.count += 1;
    batchMap.set(key, item);
  }
  const batches = Array.from(batchMap.values()).sort((a, b) => b.count - a.count || a.model.localeCompare(b.model));

  const mapName = path.basename(options.mapBsp, path.extname(options.mapBsp));
  const baseDir = path.join(options.outDir, 'base');
  const chunkDir = path.join(options.outDir, 'chunks', 'lod0');
  const reportsDir = path.join(options.outDir, 'reports');
  fs.rmSync(path.join(options.outDir, 'pipeline'), { recursive: true, force: true });
  fs.rmSync(baseDir, { recursive: true, force: true });
  fs.rmSync(path.join(options.outDir, 'chunks'), { recursive: true, force: true });
  fs.rmSync(reportsDir, { recursive: true, force: true });
  fs.mkdirSync(baseDir, { recursive: true });
  fs.mkdirSync(chunkDir, { recursive: true });
  fs.mkdirSync(reportsDir, { recursive: true });

  const PROP_TRI_ESTIMATE = 12;
  const PROP_VERT_ESTIMATE = 8;
  const PROP_BYTE_ESTIMATE = 384;

  let chunkedWorldFaces = 0;
  const budgetViolations: Array<{
    scope: 'chunk' | 'activeSet3x3' | 'activeSet5x5';
    type: 'tris' | 'verts' | 'bytes' | 'drawcalls';
    severity: 'hard';
    chunkId?: string;
    centerCell?: { x: number; y: number };
    observed: number;
    budget: number;
    message: string;
    splitReason?: string[];
  }> = [];
  const chunkIndex: Array<{
    id: string;
    url: string;
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
    size: number;
    splitDepth: number;
    splitReason: string[];
    baseCell: { x: number; y: number };
    counts: {
      worldFaces: number;
      staticProps: number;
      placeholderWorldFaces: number;
      placeholderStaticProps: number;
    };
    stats: {
      worldTris: number;
      worldVerts: number;
      worldBytes: number;
      propsTris: number;
      propsVerts: number;
      propsBytes: number;
      totalTris: number;
      totalVerts: number;
      totalBytes: number;
      drawCallsBeforeInstancing: number;
      drawCallsAfterInstancing: number;
    };
    overBudget: boolean;
  }> = [];

  for (const chunk of chunks) {
    const worldItems = chunk.worldFaceIndexes.map((idx) => {
      const face = faces[idx];
      if (!face) {
        return {
          position: [0, 0, 0] as [number, number, number],
          material: '__missing_material',
          placeholderMaterial: true,
          vertexCount: 3,
          triCount: 1,
          byteEstimate: 24,
        };
      }
      return {
        position: [face.x, face.y, face.z],
        material: face.material,
        placeholderMaterial: face.placeholderMaterial,
        vertexCount: Math.max(3, Number(face.vertexCount || 3)),
        triCount: Math.max(1, Number(face.triCount || 1)),
        byteEstimate: Math.max(24, Number(face.byteEstimate || 24)),
      };
    });
    const propItems = chunk.propIndexes.map((idx) => {
      const prop = props[idx];
      if (!prop) {
        return {
          model: '__placeholder_box__',
          sourceModel: '__missing_model',
          placeholderModel: true,
          origin: [0, 0, 0] as [number, number, number],
          angles: [0, 0, 0] as [number, number, number],
          scale: [1, 1, 1] as [number, number, number],
        };
      }
      return {
        model: prop.model,
        sourceModel: prop.sourceModel,
        placeholderModel: prop.placeholderModel,
        origin: prop.origin,
        angles: prop.angles,
        scale: prop.scale,
      };
    });

    chunkedWorldFaces += worldItems.length;
    const worldStats = computeChunkWorldStats(chunk, faces);
    const propModelSet = new Set(propItems.map((item) => item.model));
    const worldMaterialSet = new Set(worldItems.map((item) => item.material));
    const propsTris = propItems.length * PROP_TRI_ESTIMATE;
    const propsVerts = propItems.length * PROP_VERT_ESTIMATE;
    const propsBytes = propItems.length * PROP_BYTE_ESTIMATE;
    const totalTris = worldStats.tris + propsTris;
    const totalVerts = worldStats.verts + propsVerts;
    const totalBytes = worldStats.bytes + propsBytes;
    const drawCallsBeforeInstancing = worldMaterialSet.size + propItems.length;
    const drawCallsAfterInstancing = worldMaterialSet.size + propModelSet.size;

    const splitReason = Array.isArray(chunk.splitReason) ? chunk.splitReason.filter(Boolean) : [];
    const chunkViolations: Array<{ type: 'tris' | 'verts' | 'bytes'; observed: number; budget: number }> = [];
    if (totalTris > options.perChunkMaxTris) {
      chunkViolations.push({ type: 'tris', observed: totalTris, budget: options.perChunkMaxTris });
    }
    if (totalVerts > options.perChunkMaxVerts) {
      chunkViolations.push({ type: 'verts', observed: totalVerts, budget: options.perChunkMaxVerts });
    }
    if (totalBytes > options.perChunkMaxBytes) {
      chunkViolations.push({ type: 'bytes', observed: totalBytes, budget: options.perChunkMaxBytes });
    }
    const overBudget = chunkViolations.length > 0;
    for (const violation of chunkViolations) {
      budgetViolations.push({
        scope: 'chunk',
        type: violation.type,
        severity: 'hard',
        chunkId: chunk.id,
        observed: violation.observed,
        budget: violation.budget,
        message: `chunk_${violation.type}_over_budget`,
        splitReason,
      });
    }

    const centerX = (chunk.bounds.minX + chunk.bounds.maxX) * 0.5;
    const centerY = (chunk.bounds.minY + chunk.bounds.maxY) * 0.5;
    const baseCellX = Math.floor((centerX - minX) / options.chunkSize);
    const baseCellY = Math.floor((centerY - minY) / options.chunkSize);

    const fileName = `${chunk.id}.json`;
    writeJson(path.join(chunkDir, fileName), {
      id: chunk.id,
      lod: 0,
      bounds: chunk.bounds,
      size: chunk.size,
      splitDepth: chunk.splitDepth,
      splitReason,
      baseCell: { x: baseCellX, y: baseCellY },
      counts: {
        worldFaces: worldItems.length,
        staticProps: propItems.length,
        placeholderWorldFaces: worldItems.filter((item) => item.placeholderMaterial).length,
        placeholderStaticProps: propItems.filter((item) => item.placeholderModel).length,
      },
      stats: {
        worldTris: worldStats.tris,
        worldVerts: worldStats.verts,
        worldBytes: worldStats.bytes,
        propsTris,
        propsVerts,
        propsBytes,
        totalTris,
        totalVerts,
        totalBytes,
        drawCallsBeforeInstancing,
        drawCallsAfterInstancing,
      },
      world: { faces: worldItems },
      props: { instances: propItems },
      budgets: {
        perChunkMaxTris: options.perChunkMaxTris,
        perChunkMaxVerts: options.perChunkMaxVerts,
        perChunkMaxBytes: options.perChunkMaxBytes,
        overBudget,
      },
    });

    chunkIndex.push({
      id: chunk.id,
      url: `./chunks/lod0/${fileName}`,
      bounds: chunk.bounds,
      size: chunk.size,
      splitDepth: chunk.splitDepth,
      splitReason,
      baseCell: { x: baseCellX, y: baseCellY },
      counts: {
        worldFaces: worldItems.length,
        staticProps: propItems.length,
        placeholderWorldFaces: worldItems.filter((item) => item.placeholderMaterial).length,
        placeholderStaticProps: propItems.filter((item) => item.placeholderModel).length,
      },
      stats: {
        worldTris: worldStats.tris,
        worldVerts: worldStats.verts,
        worldBytes: worldStats.bytes,
        propsTris,
        propsVerts,
        propsBytes,
        totalTris,
        totalVerts,
        totalBytes,
        drawCallsBeforeInstancing,
        drawCallsAfterInstancing,
      },
      overBudget,
    });
  }

  writeJson(path.join(chunkDir, 'index.json'), { generatedAt: new Date().toISOString(), lod: 0, chunks: chunkIndex });

  const evalActiveSet = (
    radius: number,
    scope: 'activeSet3x3' | 'activeSet5x5',
    maxTris: number,
    maxDrawCalls: number,
    maxBytes: number,
  ) => {
    const cellKeys = Array.from(new Set(chunkIndex.map((item) => `${item.baseCell.x}:${item.baseCell.y}`)));
    let worst:
      | {
        centerCell: { x: number; y: number };
        chunkCount: number;
        tris: number;
        drawCallsBefore: number;
        drawCallsAfter: number;
        bytes: number;
        score: number;
      }
      | null = null;

    for (const key of cellKeys) {
      const [cxRaw, cyRaw] = key.split(':');
      const cx = Number(cxRaw);
      const cy = Number(cyRaw);
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) continue;

      let tris = 0;
      let drawCallsBefore = 0;
      let drawCallsAfter = 0;
      let bytes = 0;
      let chunkCount = 0;
      for (const chunk of chunkIndex) {
        if (Math.abs(chunk.baseCell.x - cx) > radius || Math.abs(chunk.baseCell.y - cy) > radius) continue;
        tris += chunk.stats.totalTris;
        drawCallsBefore += chunk.stats.drawCallsBeforeInstancing;
        drawCallsAfter += chunk.stats.drawCallsAfterInstancing;
        bytes += chunk.stats.totalBytes;
        chunkCount += 1;
      }
      if (chunkCount <= 0) continue;

      const score = Math.max(
        maxTris > 0 ? tris / maxTris : 0,
        maxDrawCalls > 0 ? drawCallsAfter / maxDrawCalls : 0,
        maxBytes > 0 ? bytes / maxBytes : 0,
      );
      if (!worst || score > worst.score || (score === worst.score && bytes > worst.bytes)) {
        worst = {
          centerCell: { x: cx, y: cy },
          chunkCount,
          tris,
          drawCallsBefore,
          drawCallsAfter,
          bytes,
          score,
        };
      }
    }

    const empty = {
      centerCell: { x: 0, y: 0 },
      chunkCount: 0,
      tris: 0,
      drawCallsBefore: 0,
      drawCallsAfter: 0,
      bytes: 0,
      score: 0,
    };
    const resolved = worst || empty;

    if (resolved.tris > maxTris) {
      budgetViolations.push({
        scope,
        type: 'tris',
        severity: 'hard',
        centerCell: resolved.centerCell,
        observed: resolved.tris,
        budget: maxTris,
        message: `${scope}_tris_over_budget`,
      });
    }
    if (resolved.drawCallsAfter > maxDrawCalls) {
      budgetViolations.push({
        scope,
        type: 'drawcalls',
        severity: 'hard',
        centerCell: resolved.centerCell,
        observed: resolved.drawCallsAfter,
        budget: maxDrawCalls,
        message: `${scope}_drawcalls_over_budget`,
      });
    }
    if (resolved.bytes > maxBytes) {
      budgetViolations.push({
        scope,
        type: 'bytes',
        severity: 'hard',
        centerCell: resolved.centerCell,
        observed: resolved.bytes,
        budget: maxBytes,
        message: `${scope}_bytes_over_budget`,
      });
    }

    return resolved;
  };

  const activeSet3x3 = evalActiveSet(
    1,
    'activeSet3x3',
    options.active3x3MaxTris,
    options.active3x3MaxDrawCalls,
    options.active3x3MaxBytes,
  );
  const activeSet5x5 = evalActiveSet(
    2,
    'activeSet5x5',
    options.active5x5MaxTris,
    options.active5x5MaxDrawCalls,
    options.active5x5MaxBytes,
  );

  const totalTrisWorld = faces.reduce((acc, item) => acc + Math.max(1, Number(item.triCount || 1)), 0);
  const totalBytesEstimate = chunkIndex.reduce((acc, item) => acc + item.stats.totalBytes, 0);
  const totalTrisPerChunk = chunkIndex.map((item) => item.stats.totalTris);
  const totalTrisPerChunkMin = totalTrisPerChunk.length ? Math.min(...totalTrisPerChunk) : 0;
  const totalTrisPerChunkMax = totalTrisPerChunk.length ? Math.max(...totalTrisPerChunk) : 0;
  const totalTrisPerChunkAvg = totalTrisPerChunk.length
    ? Number((totalTrisPerChunk.reduce((acc, value) => acc + value, 0) / totalTrisPerChunk.length).toFixed(4))
    : 0;

  const drawCallsBeforeInstancing = chunkIndex.reduce((acc, item) => acc + item.stats.drawCallsBeforeInstancing, 0);
  const drawCallsAfterInstancing = chunkIndex.reduce((acc, item) => acc + item.stats.drawCallsAfterInstancing, 0);
  const drawCallsReductionPct = drawCallsBeforeInstancing > 0
    ? Number((((drawCallsBeforeInstancing - drawCallsAfterInstancing) * 100) / drawCallsBeforeInstancing).toFixed(4))
    : 0;

  const topHeaviestChunks = chunkIndex
    .slice()
    .sort((a, b) => {
      if (b.stats.totalBytes !== a.stats.totalBytes) return b.stats.totalBytes - a.stats.totalBytes;
      if (b.stats.totalTris !== a.stats.totalTris) return b.stats.totalTris - a.stats.totalTris;
      return a.id.localeCompare(b.id);
    })
    .slice(0, 20)
    .map((item) => ({
      id: item.id,
      url: item.url,
      bounds: item.bounds,
      size: item.size,
      splitDepth: item.splitDepth,
      splitReason: item.splitReason,
      totalTris: item.stats.totalTris,
      totalVerts: item.stats.totalVerts,
      totalBytes: item.stats.totalBytes,
      worldFaces: item.counts.worldFaces,
      staticProps: item.counts.staticProps,
      drawCallsAfterInstancing: item.stats.drawCallsAfterInstancing,
      overBudget: item.overBudget,
    }));

  const sceneIntermediate = {
    map: {
      name: mapName,
      bspPath: options.mapBsp,
      mapRoot: options.mapRoot,
      outDir: options.outDir,
    },
    settings: {
      assetResolutionMode: options.assetResolutionMode,
      sourceioMode: options.sourceioMode,
      chunkSize: options.chunkSize,
      maxWorldFacesPerChunk: options.maxWorldFacesPerChunk,
      maxInstancesPerChunk: options.maxInstancesPerChunk,
      worldCoverageMinPct: options.worldCoverageMinPct,
      budgets: {
        perChunkMaxTris: options.perChunkMaxTris,
        perChunkMaxVerts: options.perChunkMaxVerts,
        perChunkMaxBytes: options.perChunkMaxBytes,
        active3x3MaxTris: options.active3x3MaxTris,
        active3x3MaxDrawCalls: options.active3x3MaxDrawCalls,
        active3x3MaxBytes: options.active3x3MaxBytes,
        active5x5MaxTris: options.active5x5MaxTris,
        active5x5MaxDrawCalls: options.active5x5MaxDrawCalls,
        active5x5MaxBytes: options.active5x5MaxBytes,
      },
    },
    import: {
      engineUsed: importData.engine,
      importDurationMs: importData.importDurationMs,
      worldFacesTotal: importData.worldFacesTotal,
      worldFacesExported: importData.worldFacesExported,
      worldFacesInvalid: importData.worldFacesInvalid,
      displacementsTotal: importData.displacementsTotal,
      displacementsReferencedByWorld: importData.displacementsReferencedByWorld,
      worldBounds: importData.worldBounds,
    },
    world: {
      totalFaces: faces.length,
      placeholderFaces: faces.filter((item) => item.placeholderMaterial).length,
      materialsUsed: Array.from(new Set(faces.map((item) => item.material))).sort((a, b) => a.localeCompare(b)),
    },
    staticProps: {
      totalInstances: props.length,
      placeholderInstances: props.filter((item) => item.placeholderModel).length,
      uniqueModels: Array.from(new Set(props.map((item) => item.sourceModel))).length,
    },
    instancing: {
      batches,
      drawCallsBeforeInstancing,
      drawCallsAfterInstancing,
      drawCallsReductionPct,
    },
    chunks: {
      total: chunks.length,
      lod0IndexPath: './chunks/lod0/index.json',
      topHeaviestChunks,
    },
    activeSets: {
      set3x3: activeSet3x3,
      set5x5: activeSet5x5,
    },
  };
  writeJson(path.join(reportsDir, 'scene.intermediate.json'), sceneIntermediate);

  const baseScene = {
    generatedAt: new Date().toISOString(),
    map: {
      name: mapName,
      bounds: importData.worldBounds,
      chunkSize: options.chunkSize,
    },
    placeholderAssets: {
      material: '__placeholder_checker__',
      model: '__placeholder_box__',
    },
  };
  writeJson(path.join(baseDir, 'base.scene.json'), baseScene);

  const manifest = {
    version: 2,
    generatedAt: new Date().toISOString(),
    map: {
      name: mapName,
      worldBounds: importData.worldBounds,
      chunkSize: options.chunkSize,
    },
    coordTransform: {
      source: 'source1_z_up',
      target: 'threejs_y_up',
      mapping: { x: 'x', y: 'z', z: 'y' },
    },
    streaming: {
      activeWindow: '3x3',
      prefetchWindow: '5x5',
      activeRadiusChunks: 1,
      prefetchRadiusChunks: 2,
      discardRadiusChunks: 2,
      gracePeriodMs: 4000,
    },
    budgets: {
      perChunk: {
        tris: options.perChunkMaxTris,
        verts: options.perChunkMaxVerts,
        bytes: options.perChunkMaxBytes,
      },
      active3x3: {
        tris: options.active3x3MaxTris,
        drawCalls: options.active3x3MaxDrawCalls,
        bytes: options.active3x3MaxBytes,
      },
      active5x5: {
        tris: options.active5x5MaxTris,
        drawCalls: options.active5x5MaxDrawCalls,
        bytes: options.active5x5MaxBytes,
      },
    },
    assets: {
      base: [
        {
          id: 'base_scene',
          format: 'scene-json',
          url: './base/base.scene.json',
        },
      ],
      chunks: {
        lod0IndexUrl: './chunks/lod0/index.json',
        format: 'scene-json',
      },
    },
    chunks: chunkIndex.map((item) => ({
      id: item.id,
      lod: 0,
      url: item.url,
      bounds: item.bounds,
      size: item.size,
      splitDepth: item.splitDepth,
      splitReason: item.splitReason,
      baseCell: item.baseCell,
      worldFaces: item.counts.worldFaces,
      staticProps: item.counts.staticProps,
      tris: item.stats.totalTris,
      bytes: item.stats.totalBytes,
    })),
    reports: {
      pipeline: './reports/report.json',
      audit: options.auditReportPath,
    },
  };
  writeJson(path.join(options.outDir, 'manifest.json'), manifest);

  const worldCoveragePct = importData.worldFacesTotal > 0 ? (chunkedWorldFaces * 100) / importData.worldFacesTotal : 0;
  const staticCoverage = importData.staticProps.length > 0 ? (props.length * 100) / importData.staticProps.length : 100;
  const dispCoverage = importData.displacementsTotal > 0
    ? (importData.displacementsReferencedByWorld * 100) / importData.displacementsTotal
    : 100;
  const importCompletenessPct = Number(((worldCoveragePct * 0.7) + (staticCoverage * 0.2) + (dispCoverage * 0.1)).toFixed(4));
  const strictMissingViolation = options.assetResolutionMode === 'strict' && (auditReport.missingAssetsSummary?.critical || 0) > 0;
  const worldCoverageViolation = worldCoveragePct < options.worldCoverageMinPct;
  const budgetPass = budgetViolations.length === 0;
  const budgetViolationCount = budgetViolations.length;

  const report = {
    generatedAt: new Date().toISOString(),
    map: {
      name: mapName,
      bspPath: options.mapBsp,
      mapRoot: options.mapRoot,
      outDir: options.outDir,
    },
    settings: {
      assetResolutionMode: options.assetResolutionMode,
      sourceioMode: options.sourceioMode,
      sourceioEngineUsed: importData.engine,
      sourceioRoot: options.sourceioRoot,
      sourceioScript: options.sourceioScript,
      chunkSize: options.chunkSize,
      maxWorldFacesPerChunk: options.maxWorldFacesPerChunk,
      maxInstancesPerChunk: options.maxInstancesPerChunk,
      worldCoverageMinPct: options.worldCoverageMinPct,
      budgets: {
        perChunkMaxTris: options.perChunkMaxTris,
        perChunkMaxVerts: options.perChunkMaxVerts,
        perChunkMaxBytes: options.perChunkMaxBytes,
        active3x3MaxTris: options.active3x3MaxTris,
        active3x3MaxDrawCalls: options.active3x3MaxDrawCalls,
        active3x3MaxBytes: options.active3x3MaxBytes,
        active5x5MaxTris: options.active5x5MaxTris,
        active5x5MaxDrawCalls: options.active5x5MaxDrawCalls,
        active5x5MaxBytes: options.active5x5MaxBytes,
      },
    },
    gates: {
      gateAImportParseExportFinished: true,
      gateBWorldCoverage: {
        passed: !worldCoverageViolation,
        coveragePct: Number(worldCoveragePct.toFixed(4)),
        thresholdPct: options.worldCoverageMinPct,
      },
      strictMissingGate: {
        enabled: options.assetResolutionMode === 'strict',
        passed: !strictMissingViolation,
        criticalMissing: Number(auditReport.missingAssetsSummary?.critical || 0),
      },
      budgetGate: {
        passed: budgetPass,
        violationCount: budgetViolationCount,
      },
    },
    metrics: {
      timings: { totalPipelineMs: Date.now() - started, importMs: importData.importDurationMs },
      importCompletenessPct,
      worldGeometryCoveragePct: Number(worldCoveragePct.toFixed(4)),
      worldFaces: {
        total: importData.worldFacesTotal,
        exported: importData.worldFacesExported,
        chunked: chunkedWorldFaces,
        invalid: importData.worldFacesInvalid,
      },
      displacements: {
        total: importData.displacementsTotal,
        referencedByWorld: importData.displacementsReferencedByWorld,
      },
      objects: {
        meshesEstimated: chunks.length + batches.length,
        worldChunkObjects: chunks.length,
        instancingBatches: batches.length,
        staticPropsTotal: props.length,
      },
      totals: {
        totalTrisWorld,
        totalTrisPerChunk: {
          min: totalTrisPerChunkMin,
          avg: totalTrisPerChunkAvg,
          max: totalTrisPerChunkMax,
        },
        totalBytesEstimate,
      },
      drawCallsEstimate: {
        beforeInstancing: drawCallsBeforeInstancing,
        afterInstancing: drawCallsAfterInstancing,
        reductionPct: drawCallsReductionPct,
      },
      activeSets: {
        set3x3: activeSet3x3,
        set5x5: activeSet5x5,
      },
      placeholders: {
        worldFaces: faces.filter((item) => item.placeholderMaterial).length,
        staticProps: props.filter((item) => item.placeholderModel).length,
        missingWorldMaterialsCount: missingWorldMaterials.size,
        missingModelsCount: missingModels.size,
      },
      topChunks: topHeaviestChunks,
    },
    budgets: {
      budgetPass,
      violations: budgetViolations,
    },
    audit: {
      reportPath: options.auditReportPath,
      summary: auditReport.missingAssetsSummary,
      criticalTop50: auditReport.criticalTop50 || [],
      notes: auditReport.notes || [],
    },
    warnings,
  };
  writeJson(options.reportPath, report);

  if (strictMissingViolation) {
    throw new Error(`strict_missing_gate_failed: critical_missing=${auditReport.missingAssetsSummary.critical}`);
  }
  if (worldCoverageViolation) {
    throw new Error(
      `world_coverage_gate_failed: coverage=${worldCoveragePct.toFixed(2)} threshold=${options.worldCoverageMinPct}`,
    );
  }
  if (!budgetPass) {
    throw new Error(`budget_gate_failed: violations=${budgetViolationCount}`);
  }

  console.log(`Map pipeline completed: ${options.mapBsp}`);
  console.log(`Output: ${options.outDir}`);
  console.log(`Manifest: ${path.join(options.outDir, 'manifest.json')}`);
  console.log(`Report: ${options.reportPath}`);
  console.log(`Coverage: ${worldCoveragePct.toFixed(2)}% | Chunks: ${chunks.length} | Static props: ${props.length}`);
  console.log(`Budgets: ${budgetPass ? 'PASS' : 'FAIL'} | Violations: ${budgetViolationCount}`);
};

run();

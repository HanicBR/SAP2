import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildAudit, writeReport as writeAuditReport, type AssetResolutionMode, type CliOptions as AuditCliOptions } from './auditMapAssets';

type SourceIOMode = 'auto' | 'required' | 'off';

type TexinfoMeta = {
  material: string;
  s: [number, number, number, number];
  t: [number, number, number, number];
  texWidth: number;
  texHeight: number;
};

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
  sourceioMaterialScript: string;
  sourceioModelScript: string;
  sourceioPython: string;
  modelLod: number;
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
  vertices: Array<[number, number, number]>;
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

type MaterialExportRecord = {
  material: string;
  status: string;
  sourcePath?: string;
  resolvedBaseTexture?: string;
  searchedVmt?: string;
  searchedVtf?: string;
  textureFile?: string;
  textureWidth?: number;
  textureHeight?: number;
  error?: string;
};

type ModelExportRecord = {
  model: string;
  status: string;
  sourcePath?: string;
  searchedMdl?: string;
  searchedVtx?: string;
  searchedVvd?: string;
  meshFile?: string;
  lodUsed?: number;
  mdlVersion?: number;
  triCount?: number;
  vertexCount?: number;
  subMeshCount?: number;
  byteEstimate?: number;
  bounds?: { min: [number, number, number]; max: [number, number, number] };
  materials?: string[];
  error?: string;
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
type PropPlaceholderReason =
  | 'missing_source_model'
  | 'missing_model_ref'
  | 'strict_audit_missing_model'
  | 'model_not_exported'
  | 'missing_prop_entry';
type PropAnnotated = PropInstance & {
  sourceModel: string;
  placeholderModel: boolean;
  placeholderReason: PropPlaceholderReason | undefined;
  model: string;
};

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
    sourceioMaterialScript: resolveWithParentFallback(
      String(map.get('--sourceio-material-script') || 'server/scripts/sourceio_export_materials.py'),
    ),
    sourceioModelScript: resolveWithParentFallback(
      String(map.get('--sourceio-model-script') || 'server/scripts/sourceio_export_models.py'),
    ),
    sourceioPython: String(map.get('--sourceio-python') || process.env.PYTHON || 'python').trim(),
    modelLod: Math.max(0, Math.floor(toNum(map.get('--model-lod'), 1))),
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

const parseTexdataDims = (buffer: Buffer, texdataLump: BspLump): Array<{ width: number; height: number }> => {
  if (texdataLump.length <= 0 || texdataLump.offset + texdataLump.length > buffer.length) return [];
  const count = Math.floor(texdataLump.length / 32);
  const out: Array<{ width: number; height: number }> = [];
  for (let i = 0; i < count; i += 1) {
    const base = texdataLump.offset + i * 32;
    const width = Math.max(1, buffer.readInt32LE(base + 16));
    const height = Math.max(1, buffer.readInt32LE(base + 20));
    out.push({ width, height });
  }
  return out;
};

const parseTexinfoTexdataIndices = (buffer: Buffer, texinfoLump: BspLump): number[] => {
  if (texinfoLump.length <= 0 || texinfoLump.offset + texinfoLump.length > buffer.length) return [];
  const count = Math.floor(texinfoLump.length / 72);
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) out.push(buffer.readInt32LE(texinfoLump.offset + i * 72 + 68));
  return out;
};

const buildTexinfoMeta = (buffer: Buffer, lumps: BspLump[]): TexinfoMeta[] => {
  const texdata = lumps[2];
  const texinfo = lumps[6];
  const lump43 = lumps[43];
  const lump44 = lumps[44];
  if (!texdata || !texinfo || !lump43 || !lump44) return [];
  const strings = parseTexdataNameStringTable(buffer, lump43, lump44);
  const texdataNameIds = parseTexdataNameIds(buffer, texdata);
  const texdataDims = parseTexdataDims(buffer, texdata);
  const texinfoTexdata = parseTexinfoTexdataIndices(buffer, texinfo);
  const out: TexinfoMeta[] = new Array(texinfoTexdata.length).fill(null as unknown as TexinfoMeta);
  for (let i = 0; i < texinfoTexdata.length; i += 1) {
    const base = texinfo.offset + i * 72;
    if (base + 68 > buffer.length) {
      out[i] = {
        material: '__missing_material',
        s: [1, 0, 0, 0],
        t: [0, 1, 0, 0],
        texWidth: 256,
        texHeight: 256,
      };
      continue;
    }
    const s: [number, number, number, number] = [
      buffer.readFloatLE(base + 0),
      buffer.readFloatLE(base + 4),
      buffer.readFloatLE(base + 8),
      buffer.readFloatLE(base + 12),
    ];
    const t: [number, number, number, number] = [
      buffer.readFloatLE(base + 16),
      buffer.readFloatLE(base + 20),
      buffer.readFloatLE(base + 24),
      buffer.readFloatLE(base + 28),
    ];
    const texdataIdx = texinfoTexdata[i];
    let material = '__missing_material';
    let texWidth = 256;
    let texHeight = 256;
    if (texdataIdx === undefined) continue;
    if (texdataIdx >= 0 && texdataIdx < texdataNameIds.length) {
      const strIdx = texdataNameIds[texdataIdx];
      if (strIdx !== undefined && strIdx >= 0 && strIdx < strings.length) {
        material = normalizeMaterialName(strings[strIdx] || '') || '__missing_material';
      }
      if (texdataIdx >= 0 && texdataIdx < texdataDims.length) {
        const dims = texdataDims[texdataIdx];
        texWidth = Math.max(1, Number(dims?.width || 256));
        texHeight = Math.max(1, Number(dims?.height || 256));
      }
    }
    out[i] = { material, s, t, texWidth, texHeight };
  }
  for (let i = 0; i < out.length; i += 1) {
    if (out[i]) continue;
    out[i] = {
      material: '__missing_material',
      s: [1, 0, 0, 0],
      t: [0, 1, 0, 0],
      texWidth: 256,
      texHeight: 256,
    };
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
    const vertexIndexes: number[] = [];
    for (let e = 0; e < edges; e += 1) {
      const surfEdge = buffer.readInt32LE(surfEdgesLump.offset + (firstEdge + e) * 4);
      const edgeIndex = Math.abs(surfEdge);
      const vertexIndex = readEdgeVertex(edgeIndex, surfEdge < 0);
      if (vertexIndex < 0 || vertexIndex >= vertexCount) continue;
      const last = vertexIndexes[vertexIndexes.length - 1];
      if (last === vertexIndex) continue;
      vertexIndexes.push(vertexIndex);
    }
    if (vertexIndexes.length >= 2 && vertexIndexes[0] === vertexIndexes[vertexIndexes.length - 1]) {
      vertexIndexes.pop();
    }
    if (vertexIndexes.length < 3) {
      invalid += 1;
      continue;
    }
    let sx = 0;
    let sy = 0;
    let sz = 0;
    const vertices: Array<[number, number, number]> = [];
    for (const vertexIndex of vertexIndexes) {
      const vb = verticesLump.offset + vertexIndex * 12;
      const vx = buffer.readFloatLE(vb + 0);
      const vy = buffer.readFloatLE(vb + 4);
      const vz = buffer.readFloatLE(vb + 8);
      vertices.push([vx, vy, vz]);
      sx += vx;
      sy += vy;
      sz += vz;
    }
    const points = vertices.length;
    const triCount = Math.max(1, points - 2);
    faces.push({
      x: sx / points,
      y: sy / points,
      z: sz / points,
      texInfoId,
      dispInfoId,
      vertexCount: points,
      triCount,
      byteEstimate: Math.max(24, triCount * 3 * 24),
      vertices,
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
        vertices: [],
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

const runSourceIOMaterialExport = (
  options: Options,
  materials: string[],
  contentRoots: string[],
  texturesOutDir: string,
): { records: Map<string, MaterialExportRecord>; warnings: string[]; rootsScanned: string[] } => {
  const records = new Map<string, MaterialExportRecord>();
  const warnings: string[] = [];
  if (materials.length === 0) return { records, warnings, rootsScanned: [] };

  if (!fs.existsSync(options.sourceioMaterialScript) || !fs.existsSync(options.sourceioRoot)) {
    warnings.push('sourceio_material_export_paths_missing');
    return { records, warnings, rootsScanned: [] };
  }

  const materialListPath = path.join(os.tmpdir(), `sap2-material-list-${process.pid}-${Date.now()}.json`);
  const outPath = path.join(os.tmpdir(), `sap2-material-export-${process.pid}-${Date.now()}.json`);
  try {
    fs.writeFileSync(materialListPath, `${JSON.stringify(materials, null, 2)}\n`, 'utf8');
  } catch (error: any) {
    warnings.push(`sourceio_material_export_write_failed:${String(error?.message || error)}`);
    return { records, warnings, rootsScanned: [] };
  }

  const uniqueRoots = Array.from(
    new Set(
      contentRoots
        .map((item) => path.resolve(String(item || '').trim()))
        .filter((item) => item.length > 0 && fs.existsSync(item)),
    ),
  ).sort((a, b) => a.localeCompare(b));
  const args: string[] = [
    options.sourceioMaterialScript,
    '--sourceio-root',
    options.sourceioRoot,
    '--materials-json',
    materialListPath,
    '--map-root',
    options.mapRoot,
    '--out',
    outPath,
    '--out-dir',
    texturesOutDir,
    '--max-size',
    '1024',
  ];
  for (const root of uniqueRoots) {
    args.push('--content-root', root);
  }

  const exec = spawnSync(options.sourceioPython, args, {
    encoding: 'utf8',
    timeout: 20 * 60 * 1000,
    maxBuffer: 12 * 1024 * 1024,
  });

  try {
    fs.unlinkSync(materialListPath);
  } catch {
    // no-op
  }

  if (exec.error || !fs.existsSync(outPath)) {
    warnings.push(`sourceio_material_export_exec_failed:${String(exec.error?.message || 'no_output')}`);
    return { records, warnings, rootsScanned: [] };
  }

  let rootsScanned: string[] = [];
  try {
    const payload = JSON.parse(fs.readFileSync(outPath, 'utf8')) as any;
    if (!payload?.ok) {
      warnings.push(`sourceio_material_export_failed:${String(payload?.error || 'unknown')}`);
      return { records, warnings, rootsScanned };
    }
    rootsScanned = Array.isArray(payload.rootsScanned)
      ? payload.rootsScanned.map((item: unknown) => String(item || '')).filter(Boolean)
      : [];
    const items = Array.isArray(payload.materials) ? payload.materials : [];
    for (const item of items) {
      const material = normalizeMaterialName(String(item?.material || ''));
      if (!material) continue;
      records.set(material, {
        material,
        status: String(item?.status || 'unknown'),
        ...(item?.sourcePath ? { sourcePath: String(item.sourcePath) } : {}),
        ...(item?.resolvedBaseTexture ? { resolvedBaseTexture: normalizeMaterialName(String(item.resolvedBaseTexture)) } : {}),
        ...(item?.searchedVmt ? { searchedVmt: normalizeAssetPath(String(item.searchedVmt)) } : {}),
        ...(item?.searchedVtf ? { searchedVtf: normalizeAssetPath(String(item.searchedVtf)) } : {}),
        ...(item?.textureFile ? { textureFile: String(item.textureFile) } : {}),
        ...(Number.isFinite(Number(item?.textureWidth)) ? { textureWidth: Number(item.textureWidth) } : {}),
        ...(Number.isFinite(Number(item?.textureHeight)) ? { textureHeight: Number(item.textureHeight) } : {}),
        ...(item?.error ? { error: String(item.error) } : {}),
      });
    }
    if (Array.isArray(payload.warnings)) {
      for (const warning of payload.warnings) warnings.push(`sourceio_material_export:${String(warning)}`);
    }
  } catch (error: any) {
    warnings.push(`sourceio_material_export_parse_failed:${String(error?.message || error)}`);
  } finally {
    try {
      fs.unlinkSync(outPath);
    } catch {
      // no-op
    }
  }

  return { records, warnings, rootsScanned };
};

const runSourceIOModelExport = (
  options: Options,
  models: string[],
  contentRoots: string[],
  modelsOutDir: string,
): { records: Map<string, ModelExportRecord>; warnings: string[]; rootsScanned: string[] } => {
  const records = new Map<string, ModelExportRecord>();
  const warnings: string[] = [];
  if (models.length === 0) return { records, warnings, rootsScanned: [] };

  if (!fs.existsSync(options.sourceioModelScript) || !fs.existsSync(options.sourceioRoot)) {
    warnings.push('sourceio_model_export_paths_missing');
    return { records, warnings, rootsScanned: [] };
  }

  const modelListPath = path.join(os.tmpdir(), `sap2-model-list-${process.pid}-${Date.now()}.json`);
  const outPath = path.join(os.tmpdir(), `sap2-model-export-${process.pid}-${Date.now()}.json`);
  try {
    fs.writeFileSync(modelListPath, `${JSON.stringify(models, null, 2)}\n`, 'utf8');
  } catch (error: any) {
    warnings.push(`sourceio_model_export_write_failed:${String(error?.message || error)}`);
    return { records, warnings, rootsScanned: [] };
  }

  const uniqueRoots = Array.from(
    new Set(
      contentRoots
        .map((item) => path.resolve(String(item || '').trim()))
        .filter((item) => item.length > 0 && fs.existsSync(item)),
    ),
  ).sort((a, b) => a.localeCompare(b));
  const args: string[] = [
    options.sourceioModelScript,
    '--sourceio-root',
    options.sourceioRoot,
    '--models-json',
    modelListPath,
    '--map-root',
    options.mapRoot,
    '--out',
    outPath,
    '--out-dir',
    modelsOutDir,
    '--lod',
    String(options.modelLod),
  ];
  for (const root of uniqueRoots) {
    args.push('--content-root', root);
  }

  const exec = spawnSync(options.sourceioPython, args, {
    encoding: 'utf8',
    timeout: 25 * 60 * 1000,
    maxBuffer: 16 * 1024 * 1024,
  });

  try {
    fs.unlinkSync(modelListPath);
  } catch {
    // no-op
  }

  if (exec.error || !fs.existsSync(outPath)) {
    warnings.push(`sourceio_model_export_exec_failed:${String(exec.error?.message || 'no_output')}`);
    return { records, warnings, rootsScanned: [] };
  }

  let rootsScanned: string[] = [];
  try {
    const payload = JSON.parse(fs.readFileSync(outPath, 'utf8')) as any;
    if (!payload?.ok) {
      warnings.push(`sourceio_model_export_failed:${String(payload?.error || 'unknown')}`);
      return { records, warnings, rootsScanned };
    }
    rootsScanned = Array.isArray(payload.rootsScanned)
      ? payload.rootsScanned.map((item: unknown) => String(item || '')).filter(Boolean)
      : [];
    const items = Array.isArray(payload.models) ? payload.models : [];
    for (const item of items) {
      const model = normalizeModelName(String(item?.model || ''));
      if (!model) continue;
      records.set(model, {
        model,
        status: String(item?.status || 'unknown'),
        ...(item?.sourcePath ? { sourcePath: String(item.sourcePath) } : {}),
        ...(item?.searchedMdl ? { searchedMdl: normalizeAssetPath(String(item.searchedMdl)) } : {}),
        ...(item?.searchedVtx ? { searchedVtx: normalizeAssetPath(String(item.searchedVtx)) } : {}),
        ...(item?.searchedVvd ? { searchedVvd: normalizeAssetPath(String(item.searchedVvd)) } : {}),
        ...(item?.meshFile ? { meshFile: String(item.meshFile) } : {}),
        ...(Number.isFinite(Number(item?.lodUsed)) ? { lodUsed: Number(item.lodUsed) } : {}),
        ...(Number.isFinite(Number(item?.mdlVersion)) ? { mdlVersion: Number(item.mdlVersion) } : {}),
        ...(Number.isFinite(Number(item?.triCount)) ? { triCount: Number(item.triCount) } : {}),
        ...(Number.isFinite(Number(item?.vertexCount)) ? { vertexCount: Number(item.vertexCount) } : {}),
        ...(Number.isFinite(Number(item?.subMeshCount)) ? { subMeshCount: Number(item.subMeshCount) } : {}),
        ...(Number.isFinite(Number(item?.byteEstimate)) ? { byteEstimate: Number(item.byteEstimate) } : {}),
        ...(item?.bounds &&
        Number.isFinite(Number(item?.bounds?.min?.[0])) &&
        Number.isFinite(Number(item?.bounds?.min?.[1])) &&
        Number.isFinite(Number(item?.bounds?.min?.[2])) &&
        Number.isFinite(Number(item?.bounds?.max?.[0])) &&
        Number.isFinite(Number(item?.bounds?.max?.[1])) &&
        Number.isFinite(Number(item?.bounds?.max?.[2]))
          ? {
            bounds: {
              min: [Number(item.bounds.min[0]), Number(item.bounds.min[1]), Number(item.bounds.min[2])],
              max: [Number(item.bounds.max[0]), Number(item.bounds.max[1]), Number(item.bounds.max[2])],
            },
          }
          : {}),
        ...(Array.isArray(item?.materials)
          ? { materials: item.materials.map((mat: unknown) => normalizeMaterialName(String(mat || ''))) }
          : {}),
        ...(item?.error ? { error: String(item.error) } : {}),
      });
    }
    if (Array.isArray(payload.warnings)) {
      for (const warning of payload.warnings) warnings.push(`sourceio_model_export:${String(warning)}`);
    }
  } catch (error: any) {
    warnings.push(`sourceio_model_export_parse_failed:${String(error?.message || error)}`);
  } finally {
    try {
      fs.unlinkSync(outPath);
    } catch {
      // no-op
    }
  }

  return { records, warnings, rootsScanned };
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
  const texinfoMetaById = buildTexinfoMeta(bspBuffer, lumps);
  const bspWorld = parseWorldFacesFallback(bspBuffer, lumps);

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

  const faces: FaceAnnotated[] = bspWorld.faces.map((face) => {
    const material = face.texInfoId >= 0 && face.texInfoId < texinfoMetaById.length
      ? texinfoMetaById[face.texInfoId]?.material || '__missing_material'
      : '__missing_material';
    return {
      ...face,
      material,
      placeholderMaterial: material === '__missing_material',
    };
  });

  const props: PropAnnotated[] = importData.staticProps.map((item) => {
    const sourceModel = normalizeModelName(item.model);
    const strictAuditModelPlaceholder = options.assetResolutionMode === 'strict';
    const missingByStrictAudit = strictAuditModelPlaceholder && missingModels.has(sourceModel);
    const placeholderReason: PropPlaceholderReason | undefined = !sourceModel
      ? 'missing_source_model'
      : sourceModel.startsWith('__missing_model_ref_')
        ? 'missing_model_ref'
        : missingByStrictAudit
          ? 'strict_audit_missing_model'
          : undefined;
    const placeholderModel = !!placeholderReason;
    return {
      ...item,
      sourceModel,
      placeholderModel,
      placeholderReason,
      model: placeholderModel ? '__placeholder_box__' : sourceModel,
    };
  });

  const minX = bspWorld.bounds.min[0];
  const minY = bspWorld.bounds.min[1];
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

  const mapName = path.basename(options.mapBsp, path.extname(options.mapBsp));
  const baseDir = path.join(options.outDir, 'base');
  const chunkDir = path.join(options.outDir, 'chunks', 'lod0');
  const reportsDir = path.join(options.outDir, 'reports');
  const materialsDir = path.join(options.outDir, 'materials');
  const materialsTextureDir = path.join(materialsDir, 'basecolor');
  const modelsDir = path.join(options.outDir, 'models');
  const modelsMeshDir = path.join(modelsDir, 'meshes');
  fs.rmSync(path.join(options.outDir, 'pipeline'), { recursive: true, force: true });
  fs.rmSync(baseDir, { recursive: true, force: true });
  fs.rmSync(path.join(options.outDir, 'chunks'), { recursive: true, force: true });
  fs.rmSync(reportsDir, { recursive: true, force: true });
  fs.rmSync(materialsDir, { recursive: true, force: true });
  fs.rmSync(modelsDir, { recursive: true, force: true });
  fs.mkdirSync(baseDir, { recursive: true });
  fs.mkdirSync(chunkDir, { recursive: true });
  fs.mkdirSync(reportsDir, { recursive: true });
  fs.mkdirSync(materialsTextureDir, { recursive: true });
  fs.mkdirSync(modelsMeshDir, { recursive: true });

  const PROP_TRI_ESTIMATE = 12;
  const PROP_VERT_ESTIMATE = 8;
  const PROP_BYTE_ESTIMATE = 384;

  const usedWorldMaterials = Array.from(
    new Set(
      faces
        .map((item) => normalizeMaterialName(item.material))
        .filter((item) => item.length > 0 && item !== '__missing_material'),
    ),
  ).sort((a, b) => a.localeCompare(b));
  const uniqueRuntimeModels = Array.from(
    new Set(
      props
        .filter((item) => !item.placeholderModel && item.model !== '__placeholder_box__')
        .map((item) => normalizeModelName(item.model))
        .filter((item) => item.length > 0),
    ),
  ).sort((a, b) => a.localeCompare(b));
  const auditMounts = Array.isArray((auditReport as any)?.mounts?.resolved)
    ? (auditReport as any).mounts.resolved as Array<{ rootPath?: string }>
    : [];
  const mapRootParents = [
    options.mapRoot,
    path.resolve(options.mapRoot, '..'),
    path.resolve(options.mapRoot, '..', '..'),
  ];
  const contentRoots = Array.from(
    new Set(
      mapRootParents
        .concat(auditMounts.map((item) => String(item?.rootPath || '').trim()).filter(Boolean))
        .map((item) => path.resolve(String(item || '').trim()))
        .filter((item) => item.length > 0 && fs.existsSync(item)),
    ),
  );
  const modelExport = runSourceIOModelExport(options, uniqueRuntimeModels, contentRoots, modelsMeshDir);
  warnings.push(...modelExport.warnings);

  const usedModelMaterials = Array.from(
    new Set(
      Array.from(modelExport.records.values())
        .filter((item) => item.status === 'ok')
        .flatMap((item) => (Array.isArray(item.materials) ? item.materials : []))
        .map((item) => normalizeMaterialName(String(item || '')))
        .filter((item) => item.length > 0 && item !== '__missing_material'),
    ),
  ).sort((a, b) => a.localeCompare(b));

  const materialUsage = new Map<string, Set<'world' | 'model'>>();
  const addMaterialUsage = (materialRaw: string, usage: 'world' | 'model') => {
    const material = normalizeMaterialName(materialRaw);
    if (!material || material === '__missing_material') return;
    const current = materialUsage.get(material) || new Set<'world' | 'model'>();
    current.add(usage);
    materialUsage.set(material, current);
  };
  for (const material of usedWorldMaterials) addMaterialUsage(material, 'world');
  for (const material of usedModelMaterials) addMaterialUsage(material, 'model');
  const requestedMaterials = Array.from(materialUsage.keys()).sort((a, b) => a.localeCompare(b));

  const materialExport = runSourceIOMaterialExport(options, requestedMaterials, contentRoots, materialsTextureDir);
  warnings.push(...materialExport.warnings);

  const materialIndexEntries = requestedMaterials.map((material) => {
    const exported = materialExport.records.get(material);
    const textureFile = String(exported?.textureFile || '').trim();
    const texturePath = textureFile ? path.join(materialsTextureDir, textureFile) : '';
    const hasTexture = !!texturePath && fs.existsSync(texturePath);
    return {
      id: material,
      material,
      usage: Array.from(materialUsage.get(material) || []).sort((a, b) => a.localeCompare(b)),
      placeholder: !hasTexture,
      status: exported?.status || 'not_exported',
      ...(exported?.sourcePath ? { sourcePath: exported.sourcePath } : {}),
      ...(exported?.resolvedBaseTexture ? { resolvedBaseTexture: exported.resolvedBaseTexture } : {}),
      ...(exported?.searchedVmt ? { searchedVmt: exported.searchedVmt } : {}),
      ...(exported?.searchedVtf ? { searchedVtf: exported.searchedVtf } : {}),
      ...(hasTexture ? { textureUrl: `./materials/basecolor/${textureFile}` } : {}),
      ...(Number.isFinite(Number(exported?.textureWidth)) ? { textureWidth: Number(exported?.textureWidth) } : {}),
      ...(Number.isFinite(Number(exported?.textureHeight)) ? { textureHeight: Number(exported?.textureHeight) } : {}),
      ...(exported?.error ? { error: exported.error } : {}),
    };
  });
  writeJson(path.join(materialsDir, 'index.json'), {
    generatedAt: new Date().toISOString(),
    total: materialIndexEntries.length,
    rootsScanned: materialExport.rootsScanned,
    materials: materialIndexEntries,
  });

  const materialsWithoutTexture = new Set(
    materialIndexEntries
      .filter((item) => item.placeholder)
      .map((item) => normalizeMaterialName(item.material))
      .filter((item) => item.length > 0),
  );
  const strictAuditMaterialPlaceholder = options.assetResolutionMode === 'strict';
  for (const face of faces) {
    const material = normalizeMaterialName(face.material);
    if (!material || material === '__missing_material') {
      face.placeholderMaterial = true;
      continue;
    }
    const missingTexture = materialsWithoutTexture.has(material);
    const missingByStrictAudit = strictAuditMaterialPlaceholder && missingWorldMaterials.has(material);
    face.placeholderMaterial = missingTexture || missingByStrictAudit;
  }

  const modelIndexEntries = uniqueRuntimeModels.map((model) => {
    const exported = modelExport.records.get(model);
    const meshFile = String(exported?.meshFile || '').trim();
    const meshPath = meshFile ? path.join(modelsMeshDir, meshFile) : '';
    const hasMesh = !!meshPath && fs.existsSync(meshPath);
    return {
      id: model,
      model,
      placeholder: !hasMesh,
      status: exported?.status || 'not_exported',
      ...(exported?.sourcePath ? { sourcePath: exported.sourcePath } : {}),
      ...(exported?.searchedMdl ? { searchedMdl: exported.searchedMdl } : {}),
      ...(exported?.searchedVtx ? { searchedVtx: exported.searchedVtx } : {}),
      ...(exported?.searchedVvd ? { searchedVvd: exported.searchedVvd } : {}),
      ...(hasMesh ? { meshUrl: `./models/meshes/${meshFile}` } : {}),
      ...(Number.isFinite(Number(exported?.lodUsed)) ? { lodUsed: Number(exported?.lodUsed) } : {}),
      ...(Number.isFinite(Number(exported?.mdlVersion)) ? { mdlVersion: Number(exported?.mdlVersion) } : {}),
      ...(Number.isFinite(Number(exported?.triCount)) ? { triCount: Number(exported?.triCount) } : {}),
      ...(Number.isFinite(Number(exported?.vertexCount)) ? { vertexCount: Number(exported?.vertexCount) } : {}),
      ...(Number.isFinite(Number(exported?.subMeshCount)) ? { subMeshCount: Number(exported?.subMeshCount) } : {}),
      ...(Number.isFinite(Number(exported?.byteEstimate)) ? { byteEstimate: Number(exported?.byteEstimate) } : {}),
      ...(exported?.bounds ? { bounds: exported.bounds } : {}),
      ...(Array.isArray(exported?.materials)
        ? { materials: exported.materials.map((item) => normalizeMaterialName(String(item || ''))) }
        : {}),
      ...(exported?.error ? { error: exported.error } : {}),
    };
  });
  writeJson(path.join(modelsDir, 'index.json'), {
    generatedAt: new Date().toISOString(),
    total: modelIndexEntries.length,
    rootsScanned: modelExport.rootsScanned,
    models: modelIndexEntries,
  });

  const availableModelSet = new Set(modelIndexEntries.filter((item) => !item.placeholder).map((item) => item.id));
  const modelSubMeshCountById = new Map<string, number>(
    modelIndexEntries
      .filter((item) => !item.placeholder)
      .map((item) => [item.id, Math.max(1, Number(item.subMeshCount || 1))] as const),
  );
  for (const prop of props) {
    if (prop.placeholderModel) continue;
    const runtimeModel = normalizeModelName(prop.model);
    if (!runtimeModel || !availableModelSet.has(runtimeModel)) {
      prop.placeholderModel = true;
      prop.placeholderReason = 'model_not_exported';
      prop.model = '__placeholder_box__';
    }
  }

  const batchMap = new Map<string, { model: string; placeholderModel: boolean; count: number }>();
  for (const prop of props) {
    const key = `${prop.model}|${prop.placeholderModel ? 'ph' : 'ok'}`;
    const item = batchMap.get(key) || { model: prop.model, placeholderModel: prop.placeholderModel, count: 0 };
    item.count += 1;
    batchMap.set(key, item);
  }
  const batches = Array.from(batchMap.values()).sort((a, b) => b.count - a.count || a.model.localeCompare(b.model));

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
    const worldMeshBuckets = new Map<string, {
      material: string;
      placeholderMaterial: boolean;
      positions: number[];
      uvs: number[];
      triCount: number;
      faceCount: number;
    }>();
    let placeholderWorldFaces = 0;
    for (const idx of chunk.worldFaceIndexes) {
      const face = faces[idx];
      if (!face || face.vertices.length < 3) continue;
      if (face.placeholderMaterial) placeholderWorldFaces += 1;
      const key = `${face.material}|${face.placeholderMaterial ? 'ph' : 'ok'}`;
      const bucket = worldMeshBuckets.get(key) || {
        material: face.material,
        placeholderMaterial: face.placeholderMaterial,
        positions: [],
        uvs: [],
        triCount: 0,
        faceCount: 0,
      };
      const v0 = face.vertices[0];
      if (!v0) continue;
      const texInfo = face.texInfoId >= 0 && face.texInfoId < texinfoMetaById.length
        ? texinfoMetaById[face.texInfoId]
        : null;
      const s = texInfo?.s || [1, 0, 0, 0];
      const t = texInfo?.t || [0, 1, 0, 0];
      const texWidth = Math.max(1, Number(texInfo?.texWidth || 256));
      const texHeight = Math.max(1, Number(texInfo?.texHeight || 256));
      const getUv = (v: [number, number, number]): [number, number] => {
        const uu = ((v[0] * s[0]) + (v[1] * s[1]) + (v[2] * s[2]) + s[3]) / texWidth;
        const vv = ((v[0] * t[0]) + (v[1] * t[1]) + (v[2] * t[2]) + t[3]) / texHeight;
        return [uu, vv];
      };
      for (let i = 1; i < face.vertices.length - 1; i += 1) {
        const v1 = face.vertices[i];
        const v2 = face.vertices[i + 1];
        if (!v1 || !v2) continue;
        bucket.positions.push(v0[0], v0[1], v0[2], v1[0], v1[1], v1[2], v2[0], v2[1], v2[2]);
        const uv0 = getUv(v0);
        const uv1 = getUv(v1);
        const uv2 = getUv(v2);
        bucket.uvs.push(uv0[0], uv0[1], uv1[0], uv1[1], uv2[0], uv2[1]);
        bucket.triCount += 1;
      }
      bucket.faceCount += 1;
      worldMeshBuckets.set(key, bucket);
    }
    const worldMeshes = Array.from(worldMeshBuckets.values())
      .filter((item) => item.positions.length >= 9)
      .map((item) => ({
        materialId: item.material,
        material: item.material,
        placeholderMaterial: item.placeholderMaterial,
        faceCount: item.faceCount,
        triCount: item.triCount,
        vertexCount: Math.floor(item.positions.length / 3),
        positions: item.positions,
        uvs: item.uvs,
      }));
    const worldFacesCount = chunk.worldFaceIndexes.length;
    const propItems = chunk.propIndexes.map((idx) => {
      const prop = props[idx];
      if (!prop) {
        return {
          model: '__placeholder_box__',
          sourceModel: '__missing_model',
          placeholderModel: true,
          placeholderReason: 'missing_prop_entry' as const,
          origin: [0, 0, 0] as [number, number, number],
          angles: [0, 0, 0] as [number, number, number],
          scale: [1, 1, 1] as [number, number, number],
        };
      }
      return {
        model: prop.model,
        sourceModel: prop.sourceModel,
        placeholderModel: prop.placeholderModel,
        placeholderReason: prop.placeholderReason,
        origin: prop.origin,
        angles: prop.angles,
        scale: prop.scale,
      };
    });

    chunkedWorldFaces += worldFacesCount;
    const worldStats = computeChunkWorldStats(chunk, faces);
    const propModelSet = new Set(propItems.map((item) => item.model));
    const worldMaterialSet = new Set(worldMeshes.map((item) => item.material));
    const propsTris = propItems.length * PROP_TRI_ESTIMATE;
    const propsVerts = propItems.length * PROP_VERT_ESTIMATE;
    const propsBytes = propItems.length * PROP_BYTE_ESTIMATE;
    const totalTris = worldStats.tris + propsTris;
    const totalVerts = worldStats.verts + propsVerts;
    const totalBytes = worldStats.bytes + propsBytes;
    const drawCallsBeforeInstancing = worldFacesCount + propItems.length;
    const propDrawCallsAfterInstancing = Array.from(propModelSet).reduce((acc, modelId) => {
      const resolved = modelSubMeshCountById.get(modelId);
      return acc + Math.max(1, Number(resolved || 1));
    }, 0);
    const drawCallsAfterInstancing = worldMaterialSet.size + propDrawCallsAfterInstancing;

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
        worldFaces: worldFacesCount,
        staticProps: propItems.length,
        placeholderWorldFaces,
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
      world: { meshes: worldMeshes },
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
        worldFaces: worldFacesCount,
        staticProps: propItems.length,
        placeholderWorldFaces,
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
      sourceioMaterialScript: options.sourceioMaterialScript,
      sourceioModelScript: options.sourceioModelScript,
      modelLod: options.modelLod,
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
    materials: {
      total: materialIndexEntries.length,
      withTexture: materialIndexEntries.filter((item) => !!item.textureUrl).length,
      placeholder: materialIndexEntries.filter((item) => item.placeholder).length,
      indexPath: './materials/index.json',
    },
    models: {
      total: modelIndexEntries.length,
      exported: modelIndexEntries.filter((item) => !item.placeholder).length,
      placeholder: modelIndexEntries.filter((item) => item.placeholder).length,
      indexPath: './models/index.json',
    },
    staticProps: {
      totalInstances: props.length,
      placeholderInstances: props.filter((item) => item.placeholderModel).length,
      uniqueModels: Array.from(new Set(props.map((item) => item.sourceModel))).length,
      placeholderByReason: Array.from(
        props
          .filter((item) => item.placeholderModel)
          .reduce((acc, item) => {
            const reason = String(item.placeholderReason || 'unknown').trim() || 'unknown';
            acc.set(reason, (acc.get(reason) || 0) + 1);
            return acc;
          }, new Map<string, number>())
          .entries(),
      )
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([reason, count]) => ({ reason, count })),
      topPlaceholderModels: Array.from(
        props
          .filter((item) => item.placeholderModel)
          .reduce((acc, item) => {
            const model = String(item.sourceModel || '__missing_model').trim() || '__missing_model';
            acc.set(model, (acc.get(model) || 0) + 1);
            return acc;
          }, new Map<string, number>())
          .entries(),
      )
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 50)
        .map(([model, count]) => ({ model, count })),
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
      materials: {
        indexUrl: './materials/index.json',
      },
      models: {
        indexUrl: './models/index.json',
        format: 'scene-json',
      },
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
      sourceioMaterialScript: options.sourceioMaterialScript,
      sourceioModelScript: options.sourceioModelScript,
      modelLod: options.modelLod,
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
        staticPropsByReason: Array.from(
          props
            .filter((item) => item.placeholderModel)
            .reduce((acc, item) => {
              const reason = String(item.placeholderReason || 'unknown').trim() || 'unknown';
              acc.set(reason, (acc.get(reason) || 0) + 1);
              return acc;
            }, new Map<string, number>())
            .entries(),
        )
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([reason, count]) => ({ reason, count })),
        topPlaceholderModels: Array.from(
          props
            .filter((item) => item.placeholderModel)
            .reduce((acc, item) => {
              const model = String(item.sourceModel || '__missing_model').trim() || '__missing_model';
              acc.set(model, (acc.get(model) || 0) + 1);
              return acc;
            }, new Map<string, number>())
            .entries(),
        )
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, 50)
          .map(([model, count]) => ({ model, count })),
      },
      materials: {
        total: materialIndexEntries.length,
        withTexture: materialIndexEntries.filter((item) => !!item.textureUrl).length,
        placeholder: materialIndexEntries.filter((item) => item.placeholder).length,
      },
      models: {
        total: modelIndexEntries.length,
        exported: modelIndexEntries.filter((item) => !item.placeholder).length,
        placeholder: modelIndexEntries.filter((item) => item.placeholder).length,
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
  console.log(`Models: exported=${modelIndexEntries.filter((item) => !item.placeholder).length}/${modelIndexEntries.length} (lod=${options.modelLod})`);
  console.log(`Budgets: ${budgetPass ? 'PASS' : 'FAIL'} | Violations: ${budgetViolationCount}`);
};

run();

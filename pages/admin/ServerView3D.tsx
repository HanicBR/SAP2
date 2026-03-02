import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Icons } from '../../components/Icon';

type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type ChunkEntry = {
  id: string;
  url: string;
  bounds: Bounds;
  size: number;
  baseCell?: { x: number; y: number };
  stats?: {
    totalTris?: number;
    totalBytes?: number;
    drawCallsAfterInstancing?: number;
  };
};

type ChunkIndex = {
  generatedAt: string;
  lod: number;
  chunks: ChunkEntry[];
};

type Manifest = {
  version: number;
  generatedAt: string;
  map: {
    name: string;
    worldBounds: { min: [number, number, number]; max: [number, number, number] };
    chunkSize: number;
  };
  streaming?: {
    activeRadiusChunks?: number;
    prefetchRadiusChunks?: number;
    discardRadiusChunks?: number;
    gracePeriodMs?: number;
  };
  assets: {
    base?: Array<{ id: string; url: string; format: string }>;
    materials?: {
      indexUrl: string;
    };
    chunks: {
      lod0IndexUrl: string;
      format: string;
    };
  };
};

type MaterialIndex = {
  generatedAt: string;
  total: number;
  materials: Array<{
    id: string;
    material: string;
    placeholder: boolean;
    status: string;
    textureUrl?: string;
  }>;
};

type ChunkPayload = {
  id: string;
  bounds: Bounds;
  counts?: {
    worldFaces?: number;
    staticProps?: number;
    placeholderWorldFaces?: number;
    placeholderStaticProps?: number;
  };
  stats?: {
    totalTris?: number;
    totalBytes?: number;
    drawCallsAfterInstancing?: number;
  };
  world?: {
    meshes?: Array<{
      materialId?: string;
      material: string;
      placeholderMaterial: boolean;
      faceCount?: number;
      triCount?: number;
      vertexCount?: number;
      positions: number[];
      uvs?: number[];
    }>;
    faces?: Array<{
      position: [number, number, number];
      material: string;
      placeholderMaterial: boolean;
      triCount?: number;
    }>;
  };
  props?: {
    instances?: Array<{
      model: string;
      sourceModel?: string;
      placeholderModel: boolean;
      origin: [number, number, number];
      angles: [number, number, number];
      scale: [number, number, number];
    }>;
  };
};

type RuntimeStats = {
  loadedChunks: number;
  visibleChunks: number;
  loadedTrisEstimate: number;
  loadedBytesEstimate: number;
  cameraCell: { x: number; y: number };
  firstActiveLoadMs: number | null;
};

const toAssetUrl = (manifestUrl: string, relativeOrAbsoluteUrl: string): string => {
  const resolved = new URL(relativeOrAbsoluteUrl, new URL(manifestUrl, window.location.origin));
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
};

const readJson = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`http_${response.status}: ${url}`);
  }
  return (await response.json()) as T;
};

const hashColor = (input: string, alpha = 1): THREE.Color => {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const hue = Math.abs(hash % 360);
  const color = new THREE.Color(`hsl(${hue}, 62%, 55%)`);
  color.multiplyScalar(alpha);
  return color;
};

const sourceToThree = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, z, y);

const disposeObject3D = (root: THREE.Object3D) => {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    const points = obj as THREE.Points;

    if (mesh.geometry) {
      mesh.geometry.dispose();
    }
    if (points.geometry) {
      points.geometry.dispose();
    }

    const materialCandidate = (mesh.material || (points as any).material) as THREE.Material | THREE.Material[] | undefined;
    if (!materialCandidate) return;
    if (Array.isArray(materialCandidate)) {
      materialCandidate.forEach((material) => material.dispose());
    } else {
      materialCandidate.dispose();
    }
  });
};

const normalizeMapName = (raw: string | null): string => {
  const value = String(raw || '').trim();
  if (!value) return 'rp_evocity_v33x';
  return value.replace(/\.bsp$/i, '');
};

const ServerView3D: React.FC = () => {
  const { serverId } = useParams<{ serverId: string }>();
  const [searchParams] = useSearchParams();
  const mapName = useMemo(() => normalizeMapName(searchParams.get('map')), [searchParams]);
  const manifestUrl = useMemo(() => `/maps/${mapName}/manifest.json`, [mapName]);
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<string>('Aguardando inicializacao...');
  const [error, setError] = useState<string | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [runtimeStats, setRuntimeStats] = useState<RuntimeStats>({
    loadedChunks: 0,
    visibleChunks: 0,
    loadedTrisEstimate: 0,
    loadedBytesEstimate: 0,
    cameraCell: { x: 0, y: 0 },
    firstActiveLoadMs: null,
  });
  const [streamingLogs, setStreamingLogs] = useState<string[]>([]);

  useEffect(() => {
    const host = mountRef.current;
    if (!host) return undefined;

    let cancelled = false;
    let animationFrameId = 0;
    let streamIntervalMs = 0;
    let startedAt = performance.now();
    let firstActiveLoadMs: number | null = null;

    const appendLog = (line: string) => {
      const msg = `[${new Date().toLocaleTimeString('pt-BR')}] ${line}`;
      setStreamingLogs((current) => [msg, ...current].slice(0, 24));
      console.log(`[viewer3d] ${line}`);
    };

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x09090b, 1);
    host.innerHTML = '';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(65, host.clientWidth / Math.max(1, host.clientHeight), 1, 250000);

    const ambient = new THREE.HemisphereLight(0x8aa2ff, 0x101010, 0.95);
    const dir = new THREE.DirectionalLight(0xffffff, 0.65);
    dir.position.set(0.5, 1.2, 0.3).multiplyScalar(5000);
    scene.add(ambient, dir);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.rotateSpeed = 0.65;
    controls.zoomSpeed = 1;
    controls.panSpeed = 0.55;

    const chunkRoot = new THREE.Group();
    chunkRoot.name = 'chunk-root';
    scene.add(chunkRoot);

    const grid = new THREE.GridHelper(36000, 120, 0x1f2937, 0x111827);
    grid.position.y = 0;
    scene.add(grid);

    const chunkRecords = new Map<string, {
      entry: ChunkEntry;
      group: THREE.Group;
      touchedAtMs: number;
      tris: number;
      bytes: number;
      drawCalls: number;
    }>();
    const loadingChunkIds = new Set<string>();
    const textureLoader = new THREE.TextureLoader();
    const textureCache = new Map<string, THREE.Texture | null>();
    const textureLoading = new Set<string>();
    const pendingMaterialBindings = new Map<string, Set<THREE.MeshStandardMaterial>>();
    const materialDefs = new Map<string, { placeholder: boolean; textureUrl?: string }>();

    const getWorldMaterial = (materialIdRaw: string, placeholderFlag: boolean): THREE.MeshStandardMaterial => {
      const materialId = String(materialIdRaw || '__missing_material');
      const def = materialDefs.get(materialId);
      const shouldPlaceholder = placeholderFlag || !def || def.placeholder || !def.textureUrl;
      const baseColor = shouldPlaceholder ? new THREE.Color(0x6b7280) : hashColor(materialId, 0.92);
      const material = new THREE.MeshStandardMaterial({
        color: baseColor,
        metalness: 0.04,
        roughness: 0.94,
        side: THREE.DoubleSide,
      });

      if (!shouldPlaceholder && def?.textureUrl) {
        const textureUrl = toAssetUrl(manifestUrl, def.textureUrl);
        const cachedTexture = textureCache.get(textureUrl);
        if (cachedTexture) {
          material.map = cachedTexture;
          material.color.set(0xffffff);
          material.needsUpdate = true;
        } else if (cachedTexture !== null) {
          const pending = pendingMaterialBindings.get(textureUrl) || new Set<THREE.MeshStandardMaterial>();
          pending.add(material);
          pendingMaterialBindings.set(textureUrl, pending);

          if (!textureLoading.has(textureUrl)) {
            textureLoading.add(textureUrl);
            textureLoader.load(
              textureUrl,
              (texture) => {
                texture.wrapS = THREE.RepeatWrapping;
                texture.wrapT = THREE.RepeatWrapping;
                texture.colorSpace = THREE.SRGBColorSpace;
                texture.anisotropy = 4;
                textureCache.set(textureUrl, texture);
                textureLoading.delete(textureUrl);
                const waiting = pendingMaterialBindings.get(textureUrl);
                if (waiting) {
                  for (const mat of waiting) {
                    mat.map = texture;
                    mat.color.set(0xffffff);
                    mat.needsUpdate = true;
                  }
                }
                pendingMaterialBindings.delete(textureUrl);
              },
              undefined,
              () => {
                textureCache.set(textureUrl, null);
                textureLoading.delete(textureUrl);
                pendingMaterialBindings.delete(textureUrl);
              },
            );
          }
        }
      }

      return material;
    };

    const disposeTextureCache = () => {
      for (const texture of textureCache.values()) {
        if (texture) texture.dispose();
      }
      textureCache.clear();
      textureLoading.clear();
      pendingMaterialBindings.clear();
    };

    const loadChunkGroup = async (entry: ChunkEntry): Promise<void> => {
      if (chunkRecords.has(entry.id) || loadingChunkIds.has(entry.id)) return;
      loadingChunkIds.add(entry.id);
      try {
        const payload = await readJson<ChunkPayload>(toAssetUrl(manifestUrl, entry.url));
        if (cancelled) return;

        const group = new THREE.Group();
        group.name = `chunk_${entry.id}`;

        const worldMeshes = Array.isArray(payload.world?.meshes) ? payload.world?.meshes : [];
        if (worldMeshes.length > 0) {
          for (const meshData of worldMeshes) {
            const rawPositions = Array.isArray(meshData.positions) ? meshData.positions : [];
            if (rawPositions.length < 9) continue;
            const positionArray = new Float32Array(rawPositions.length);
            for (let i = 0; i < rawPositions.length; i += 3) {
              const x = Number(rawPositions[i] || 0);
              const y = Number(rawPositions[i + 1] || 0);
              const z = Number(rawPositions[i + 2] || 0);
              // Source1 (x,y,z-up) -> Three.js (x,y-up,z)
              positionArray[i + 0] = x;
              positionArray[i + 1] = z;
              positionArray[i + 2] = y;
            }

            const worldGeo = new THREE.BufferGeometry();
            worldGeo.setAttribute('position', new THREE.BufferAttribute(positionArray, 3));
            const rawUvs = Array.isArray(meshData.uvs) ? meshData.uvs : [];
            if (rawUvs.length === (rawPositions.length / 3) * 2) {
              const uvArray = new Float32Array(rawUvs.length);
              for (let i = 0; i < rawUvs.length; i += 2) {
                uvArray[i + 0] = Number(rawUvs[i] || 0);
                uvArray[i + 1] = 1 - Number(rawUvs[i + 1] || 0);
              }
              worldGeo.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
            }
            worldGeo.computeVertexNormals();
            worldGeo.computeBoundingSphere();

            const matId = String(meshData.materialId || meshData.material || '__missing_material');
            const worldMat = getWorldMaterial(matId, !!meshData.placeholderMaterial);
            const worldMesh = new THREE.Mesh(worldGeo, worldMat);
            worldMesh.frustumCulled = true;
            group.add(worldMesh);
          }
        } else {
          const worldFaces = Array.isArray(payload.world?.faces) ? payload.world?.faces : [];
          if (worldFaces.length > 0) {
            const positionArray = new Float32Array(worldFaces.length * 3);
            const colorArray = new Float32Array(worldFaces.length * 3);
            for (let i = 0; i < worldFaces.length; i += 1) {
              const face = worldFaces[i];
              const point = sourceToThree(face.position[0], face.position[1], face.position[2]);
              positionArray[i * 3 + 0] = point.x;
              positionArray[i * 3 + 1] = point.y;
              positionArray[i * 3 + 2] = point.z;
              const color = face.placeholderMaterial ? new THREE.Color(0x6b7280) : hashColor(face.material || 'world-material');
              colorArray[i * 3 + 0] = color.r;
              colorArray[i * 3 + 1] = color.g;
              colorArray[i * 3 + 2] = color.b;
            }

            const worldGeo = new THREE.BufferGeometry();
            worldGeo.setAttribute('position', new THREE.BufferAttribute(positionArray, 3));
            worldGeo.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));
            const worldMat = new THREE.PointsMaterial({
              size: 14,
              sizeAttenuation: true,
              vertexColors: true,
              opacity: 0.92,
              transparent: true,
              depthWrite: false,
            });
            const points = new THREE.Points(worldGeo, worldMat);
            points.frustumCulled = true;
            group.add(points);
          }
        }

        const props = Array.isArray(payload.props?.instances) ? payload.props.instances : [];
        if (props.length > 0) {
          const byModel = new Map<string, typeof props>();
          for (const instance of props) {
            const key = String(instance.model || '__placeholder_box__');
            const arr = byModel.get(key) || [];
            arr.push(instance);
            byModel.set(key, arr);
          }

          for (const [model, instances] of byModel.entries()) {
            const placeholder = instances.some((item) => item.placeholderModel);
            const color = placeholder ? new THREE.Color(0xdc2626) : hashColor(model, 0.9);
            const boxGeo = new THREE.BoxGeometry(34, 72, 34);
            const boxMat = new THREE.MeshStandardMaterial({
              color,
              metalness: 0.08,
              roughness: 0.9,
              opacity: placeholder ? 0.72 : 0.85,
              transparent: true,
            });
            const instanced = new THREE.InstancedMesh(boxGeo, boxMat, instances.length);
            instanced.frustumCulled = true;

            const tmpPosition = new THREE.Vector3();
            const tmpQuaternion = new THREE.Quaternion();
            const tmpScale = new THREE.Vector3();
            const tmpMatrix = new THREE.Matrix4();
            for (let i = 0; i < instances.length; i += 1) {
              const instance = instances[i];
              const pos = sourceToThree(instance.origin[0], instance.origin[1], instance.origin[2]);
              tmpPosition.set(pos.x, pos.y + 36, pos.z);
              const pitch = THREE.MathUtils.degToRad(Number(instance.angles[0] || 0));
              const yaw = THREE.MathUtils.degToRad(Number(instance.angles[1] || 0));
              const roll = THREE.MathUtils.degToRad(Number(instance.angles[2] || 0));
              tmpQuaternion.setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
              tmpScale.set(
                Math.max(0.25, Number(instance.scale[0] || 1)),
                Math.max(0.25, Number(instance.scale[2] || 1)),
                Math.max(0.25, Number(instance.scale[1] || 1)),
              );
              tmpMatrix.compose(tmpPosition, tmpQuaternion, tmpScale);
              instanced.setMatrixAt(i, tmpMatrix);
            }
            instanced.instanceMatrix.needsUpdate = true;
            group.add(instanced);
          }
        }

        group.visible = false;
        chunkRoot.add(group);

        chunkRecords.set(entry.id, {
          entry,
          group,
          touchedAtMs: performance.now(),
          tris: Math.max(0, Number(payload.stats?.totalTris || entry.stats?.totalTris || 0)),
          bytes: Math.max(0, Number(payload.stats?.totalBytes || entry.stats?.totalBytes || 0)),
          drawCalls: Math.max(0, Number(payload.stats?.drawCallsAfterInstancing || entry.stats?.drawCallsAfterInstancing || 0)),
        });

        appendLog(`chunk carregado: ${entry.id}`);
      } catch (loadErr: any) {
        appendLog(`erro ao carregar chunk ${entry.id}: ${String(loadErr?.message || loadErr)}`);
      } finally {
        loadingChunkIds.delete(entry.id);
      }
    };

    const setup = async () => {
      try {
        setStatus('Carregando manifest...');
        const loadedManifest = await readJson<Manifest>(manifestUrl);
        if (cancelled) return;
        setManifest(loadedManifest);

        if (loadedManifest.assets.materials?.indexUrl) {
          try {
            const materialIndexUrl = toAssetUrl(manifestUrl, loadedManifest.assets.materials.indexUrl);
            const materialIndex = await readJson<MaterialIndex>(materialIndexUrl);
            if (!cancelled) {
              for (const item of materialIndex.materials || []) {
                const key = String(item.material || item.id || '').trim();
                if (!key) continue;
                materialDefs.set(key, {
                  placeholder: !!item.placeholder,
                  ...(item.textureUrl ? { textureUrl: item.textureUrl } : {}),
                });
              }
              appendLog(`materials index carregado: total=${materialDefs.size}`);
            }
          } catch (materialErr: any) {
            appendLog(`materials index indisponivel: ${String(materialErr?.message || materialErr)}`);
          }
        }

        const lod0IndexUrl = toAssetUrl(manifestUrl, loadedManifest.assets.chunks.lod0IndexUrl);
        setStatus('Carregando indice de chunks...');
        const chunkIndex = await readJson<ChunkIndex>(lod0IndexUrl);
        if (cancelled) return;

        const worldMinX = Number(loadedManifest.map.worldBounds.min[0] || 0);
        const worldMinY = Number(loadedManifest.map.worldBounds.min[1] || 0);
        const worldMaxX = Number(loadedManifest.map.worldBounds.max[0] || 0);
        const worldMaxY = Number(loadedManifest.map.worldBounds.max[1] || 0);
        const worldCenterX = (worldMinX + worldMaxX) * 0.5;
        const worldCenterY = (worldMinY + worldMaxY) * 0.5;
        const worldCenter = sourceToThree(worldCenterX, worldCenterY, 128);

        camera.position.set(worldCenter.x + 3200, worldCenter.y + 2200, worldCenter.z + 3200);
        controls.target.copy(worldCenter);
        controls.update();

        const chunkSize = Math.max(256, Number(loadedManifest.map.chunkSize || 2048));
        const activeRadius = Math.max(1, Number(loadedManifest.streaming?.activeRadiusChunks || 1));
        const prefetchRadius = Math.max(activeRadius, Number(loadedManifest.streaming?.prefetchRadiusChunks || 2));
        const discardRadius = Math.max(prefetchRadius, Number(loadedManifest.streaming?.discardRadiusChunks || prefetchRadius));
        const gracePeriodMs = Math.max(1000, Number(loadedManifest.streaming?.gracePeriodMs || 4000));

        const entries = chunkIndex.chunks || [];
        const byId = new Map(entries.map((entry) => [entry.id, entry] as const));

        const toBaseCell = (entry: ChunkEntry): { x: number; y: number } => {
          if (entry.baseCell && Number.isFinite(entry.baseCell.x) && Number.isFinite(entry.baseCell.y)) return entry.baseCell;
          const centerX = (entry.bounds.minX + entry.bounds.maxX) * 0.5;
          const centerY = (entry.bounds.minY + entry.bounds.maxY) * 0.5;
          return {
            x: Math.floor((centerX - worldMinX) / chunkSize),
            y: Math.floor((centerY - worldMinY) / chunkSize),
          };
        };

        const chunkCells = new Map<string, { x: number; y: number }>();
        for (const entry of entries) {
          chunkCells.set(entry.id, toBaseCell(entry));
        }

        const updateStreaming = () => {
          const now = performance.now();
          const cameraCell = {
            x: Math.floor((camera.position.x - worldMinX) / chunkSize),
            y: Math.floor((camera.position.z - worldMinY) / chunkSize),
          };

          const activeIds = new Set<string>();
          const prefetchIds = new Set<string>();
          const keepIds = new Set<string>();

          for (const entry of entries) {
            const cell = chunkCells.get(entry.id) || { x: 0, y: 0 };
            const dx = Math.abs(cell.x - cameraCell.x);
            const dy = Math.abs(cell.y - cameraCell.y);
            if (dx <= activeRadius && dy <= activeRadius) {
              activeIds.add(entry.id);
            }
            if (dx <= prefetchRadius && dy <= prefetchRadius) {
              prefetchIds.add(entry.id);
            }
            if (dx <= discardRadius && dy <= discardRadius) {
              keepIds.add(entry.id);
            }
          }

          for (const chunkId of prefetchIds) {
            const entry = byId.get(chunkId);
            if (!entry) continue;
            void loadChunkGroup(entry);
          }

          for (const [chunkId, record] of chunkRecords.entries()) {
            if (activeIds.has(chunkId)) {
              record.group.visible = true;
              record.touchedAtMs = now;
            } else {
              record.group.visible = false;
            }

            if (keepIds.has(chunkId)) continue;
            if (now - record.touchedAtMs < gracePeriodMs) continue;

            chunkRoot.remove(record.group);
            disposeObject3D(record.group);
            chunkRecords.delete(chunkId);
            appendLog(`chunk descarregado: ${chunkId}`);
          }

          if (firstActiveLoadMs === null && activeIds.size > 0 && Array.from(activeIds).every((id) => chunkRecords.has(id))) {
            firstActiveLoadMs = Math.round(performance.now() - startedAt);
            appendLog(`first_active_set_loaded_ms=${firstActiveLoadMs}`);
          }

          let visibleChunks = 0;
          let loadedTrisEstimate = 0;
          let loadedBytesEstimate = 0;
          for (const record of chunkRecords.values()) {
            if (record.group.visible) visibleChunks += 1;
            loadedTrisEstimate += record.tris;
            loadedBytesEstimate += record.bytes;
          }

          setRuntimeStats({
            loadedChunks: chunkRecords.size,
            visibleChunks,
            loadedTrisEstimate,
            loadedBytesEstimate,
            cameraCell,
            firstActiveLoadMs,
          });
        };

        const onResize = () => {
          if (!mountRef.current) return;
          const width = Math.max(1, mountRef.current.clientWidth);
          const height = Math.max(1, mountRef.current.clientHeight);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          renderer.setSize(width, height);
        };

        const animate = () => {
          if (cancelled) return;
          animationFrameId = window.requestAnimationFrame(animate);
          controls.update();
          renderer.render(scene, camera);
          const now = performance.now();
          if (now - streamIntervalMs >= 300) {
            streamIntervalMs = now;
            updateStreaming();
          }
        };

        window.addEventListener('resize', onResize);
        animate();

        setStatus(`Viewer online | map=${loadedManifest.map.name} | chunks=${entries.length}`);
        appendLog(`manifest carregado: ${loadedManifest.map.name}`);
        appendLog(`chunk_count=${entries.length} active=${activeRadius * 2 + 1}x${activeRadius * 2 + 1} prefetch=${prefetchRadius * 2 + 1}x${prefetchRadius * 2 + 1}`);

        return () => {
          window.removeEventListener('resize', onResize);
        };
      } catch (setupErr: any) {
        const message = String(setupErr?.message || setupErr);
        setError(message);
        setStatus('Falha ao inicializar viewer');
      }
      return undefined;
    };

    let teardown: (() => void) | undefined;
    void setup().then((cleanup) => {
      teardown = cleanup;
    });

    return () => {
      cancelled = true;
      if (animationFrameId) {
        window.cancelAnimationFrame(animationFrameId);
      }
      if (teardown) teardown();
      controls.dispose();
      for (const record of chunkRecords.values()) {
        chunkRoot.remove(record.group);
        disposeObject3D(record.group);
      }
      chunkRecords.clear();
      disposeTextureCache();
      renderer.dispose();
      host.innerHTML = '';
    };
  }, [manifestUrl]);

  return (
    <div className="space-y-4 pb-8">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <Link
            to={serverId ? `/admin/servers/${serverId}` : '/admin/servers'}
            className="text-zinc-500 hover:text-white text-sm font-bold uppercase flex items-center mb-2"
          >
            <Icons.ArrowLeft className="w-4 h-4 mr-1" /> Voltar para servidor
          </Link>
          <h1 className="text-2xl md:text-3xl font-black text-white uppercase italic tracking-tight">Web Viewer 3D (MVP)</h1>
          <p className="text-zinc-400 text-sm font-mono">map={mapName}</p>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-xs text-zinc-300 font-mono">
          <div>{status}</div>
          {manifest && <div>manifest v{manifest.version} | chunkSize={manifest.map.chunkSize}</div>}
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-900/50 bg-red-950/20 px-3 py-2 text-sm text-red-300">
          Erro: {error}
          <div className="text-xs text-zinc-400 mt-1">Verifique se os artefatos existem em `public/maps/{mapName}/manifest.json`.</div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-3 rounded border border-zinc-800 bg-zinc-950 overflow-hidden">
          <div ref={mountRef} className="h-[62vh] w-full" />
        </div>

        <div className="space-y-3">
          <div className="rounded border border-zinc-800 bg-zinc-900 p-3 text-xs text-zinc-300 space-y-1">
            <p className="text-zinc-500 uppercase font-bold text-[11px]">Streaming</p>
            <p>cameraCell: {runtimeStats.cameraCell.x}:{runtimeStats.cameraCell.y}</p>
            <p>loadedChunks: {runtimeStats.loadedChunks}</p>
            <p>visibleChunks: {runtimeStats.visibleChunks}</p>
            <p>loadedTris(est): {runtimeStats.loadedTrisEstimate.toLocaleString('pt-BR')}</p>
            <p>loadedBytes(est): {Math.round(runtimeStats.loadedBytesEstimate / (1024 * 1024)).toLocaleString('pt-BR')} MB</p>
            <p>firstActiveLoadMs: {runtimeStats.firstActiveLoadMs ?? 'pendente'}</p>
          </div>

          <div className="rounded border border-zinc-800 bg-zinc-900 p-3">
            <p className="text-zinc-500 uppercase font-bold text-[11px] mb-2">Logs</p>
            <div className="max-h-[260px] overflow-y-auto space-y-1 text-[11px] font-mono text-zinc-300">
              {!streamingLogs.length && <p className="text-zinc-500">Sem logs ainda...</p>}
              {streamingLogs.map((line, idx) => (
                <p key={`${line}_${idx}`}>{line}</p>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ServerView3D;

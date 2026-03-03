# SAP2 - GMod 3D Pipeline (MVP)

## Estado atual

- Modo default: `permissive`.
- Missing assets continuam no report, mas nao bloqueiam build em `permissive`.
- Gates bloqueantes ativos:
  - Gate A: import/parse/export precisa finalizar.
  - Gate B: `worldGeometryCoveragePct` >= threshold.
  - Budget Gate: violacoes graves de performance bloqueiam.

## Comandos

Audit:

```bash
npm --prefix server run audit:map-assets:evocity
npm --prefix server run audit:map-assets:evocity:strict
```

Pipeline completo (evocity):

```bash
npm --prefix server run map:pipeline:build:evocity
```

Pipeline em strict (missing critico volta a bloquear):

```bash
npm --prefix server run map:pipeline:build:evocity -- --asset-resolution-mode strict
```

## Artefatos gerados

Base path:

- `public/maps/rp_evocity_v33x/`

Estrutura:

- `manifest.json`
- `base/base.scene.json`
- `chunks/lod0/index.json`
- `chunks/lod0/<chunkId>.json`
- `chunks/lod1/index.json`
- `chunks/lod1/<chunkId>.json`
- `chunks/lod2/index.json`
- `chunks/lod2/<chunkId>.json`
- `reports/report.json`
- `reports/scene.intermediate.json`

## PR-04 Hardening (budgets como gates)

O `report.json` agora inclui:

- `metrics.totals.totalTrisWorld`
- `metrics.totals.totalTrisPerChunk.min/avg/max`
- `metrics.totals.totalBytesEstimate`
- `metrics.drawCallsEstimate.beforeInstancing/afterInstancing/reductionPct`
- `metrics.topChunks` (top 20 mais pesados)
- `budgets.budgetPass`
- `budgets.violations[]`
- `metrics.activeSets.set3x3` e `metrics.activeSets.set5x5`

Se qualquer violacao grave ocorrer, o pipeline falha com `budget_gate_failed`.

## Ajuste de budgets e chunk size (CLI/env)

CLI:

```bash
--chunk-size <n>
--per-chunk-max-tris <n>
--per-chunk-max-verts <n>
--per-chunk-max-bytes <n>
--active-3x3-max-tris <n>
--active-3x3-max-drawcalls <n>
--active-3x3-max-bytes <n>
--active-5x5-max-tris <n>
--active-5x5-max-drawcalls <n>
--active-5x5-max-bytes <n>
--world-coverage-min-pct <n>
--chunk-lod1-tri-stride <n>
--chunk-lod2-tri-stride <n>
--streaming-active-radius-chunks <n>
--streaming-render-radius-chunks <n>
--streaming-prefetch-radius-chunks <n>
--streaming-discard-radius-chunks <n>
--streaming-grace-period-ms <n>
--texture-ktx2-mode <auto|on|off>
--texture-toktx-binary <path_or_name>
--texture-profile-diffuse-max <n>
--texture-profile-normal-max <n>
--texture-profile-alpha-max <n>
--texture-profile-emissive-max <n>
--texture-vram-budget-mb <n>
```

Env vars equivalentes:

- `MAP_PIPELINE_PER_CHUNK_MAX_TRIS`
- `MAP_PIPELINE_PER_CHUNK_MAX_VERTS`
- `MAP_PIPELINE_PER_CHUNK_MAX_BYTES`
- `MAP_PIPELINE_ACTIVE_3X3_MAX_TRIS`
- `MAP_PIPELINE_ACTIVE_3X3_MAX_DRAWCALLS`
- `MAP_PIPELINE_ACTIVE_3X3_MAX_BYTES`
- `MAP_PIPELINE_ACTIVE_5X5_MAX_TRIS`
- `MAP_PIPELINE_ACTIVE_5X5_MAX_DRAWCALLS`
- `MAP_PIPELINE_ACTIVE_5X5_MAX_BYTES`
- `MAP_PIPELINE_CHUNK_LOD1_TRI_STRIDE`
- `MAP_PIPELINE_CHUNK_LOD2_TRI_STRIDE`
- `MAP_PIPELINE_STREAMING_ACTIVE_RADIUS_CHUNKS`
- `MAP_PIPELINE_STREAMING_RENDER_RADIUS_CHUNKS`
- `MAP_PIPELINE_STREAMING_PREFETCH_RADIUS_CHUNKS`
- `MAP_PIPELINE_STREAMING_DISCARD_RADIUS_CHUNKS`
- `MAP_PIPELINE_STREAMING_GRACE_PERIOD_MS`
- `MAP_PIPELINE_TEXTURE_KTX2_MODE`
- `MAP_PIPELINE_TEXTURE_TOKTX_BINARY`
- `MAP_PIPELINE_TEXTURE_PROFILE_DIFFUSE_MAX`
- `MAP_PIPELINE_TEXTURE_PROFILE_NORMAL_MAX`
- `MAP_PIPELINE_TEXTURE_PROFILE_ALPHA_MAX`
- `MAP_PIPELINE_TEXTURE_PROFILE_EMISSIVE_MAX`
- `MAP_PIPELINE_TEXTURE_VRAM_BUDGET_MB`

## PR-05 Viewer minimo

Rota nova:

- `/admin/servers/:serverId/view3d?map=rp_evocity_v33x`

Como abrir pelo painel:

- Em `ServerDetails`, clique no botao `Viewer 3D`.

Comportamento atual:

- Carrega `manifest.json`.
- Carrega `base` e faz streaming de chunks por LOD (`lod0/lod1/lod2`).
- Janela ativa (default): 3x3 em `lod0`.
- Janela visivel estendida (default): 9x9 com `lod1/lod2` para render mais longe.
- Prefetch (default): 9x9.
- Descarte por distancia com `gracePeriodMs`.
- Materiais/modelos faltantes usam placeholder.

## PR-11 KTX2/Basis + VRAM budget

- Export de texturas continua gerando fallback `PNG` em `materials/basecolor/`.
- Quando `toktx` esta disponivel, o pipeline gera `KTX2` em `materials/basecolor_ktx2/`.
- `materials/index.json` agora inclui:
  - `primaryFormat` / `fallbackFormat`
  - `ktx2Url` + `fallbackTextureUrl`
  - `textureClass` (`diffuse|normal|alpha|emissive`)
  - `textureProfile` (cap/compression/srgb)
  - `vramEstimateBytes`
- Viewer usa cadeia `KTX2 -> PNG` automaticamente.
- Pipeline publica budget de VRAM estimado para texturas no `report.json` e no `manifest.json`.

Perfis default:

- `diffuse`: max `1024`, `ETC1S`
- `normal`: max `1024`, `UASTC`
- `alpha`: max `1024`, `ETC1S`
- `emissive`: max `512`, `ETC1S`
- VRAM budget default: `1536 MB`

Requisitos para KTX2:

- `toktx` instalado no host onde roda o pipeline.
- Transcoder Basis em `public/vendor/basis` (o pipeline tenta copiar automaticamente de `node_modules/three/.../basis`).

## PR-06 Geometria real por chunk

- O pipeline agora exporta `world.meshes` triangulado por material em cada chunk.
- O viewer passou de `Points` para `Mesh` no mundo (ainda com material placeholder, sem textura Source/PBR).
- Resultado esperado: forma do mapa reconhecivel (ruas/prédios/terreno), mesmo sem fidelidade visual final.

## PR-07 Materiais e texturas (MVP)

- Pipeline exporta UV por triangulo de face BSP usando `texinfo`/`texdata`.
- Novo passo offline de texturas com SourceIO:
  - resolve `VMT -> $basetexture -> VTF`
  - converte para `PNG` em `public/maps/<map>/materials/basecolor/`
- Novo indice: `public/maps/<map>/materials/index.json`.
- Viewer carrega `materials/index.json` e aplica `map` no `MeshStandardMaterial` quando houver textura.
- Quando nao houver basetexture/textura, mantem fallback placeholder.

Observacao:
- O exportador usa Pillow no Python. Se Pillow nao estiver disponivel no host, o viewer continua funcional com placeholders.

## Mounts (template)

Copie template:

```powershell
Copy-Item server/config/mounts.template.json server/config/mounts.json
```

Linux:

```bash
cp server/config/mounts.template.json server/config/mounts.json
```

No Linux (VPS), o autodiscovery agora tenta por padrao:

- `/opt/backstabber/content/gmod-base`
- `/opt/backstabber/content/css-content-gmodcontent`
- `/opt/backstabber/content/hl2ep1-content-gmodcontent`
- `/opt/backstabber/content/hl2ep2-content-gmodcontent`
- `/opt/backstabber/content/tf2-content-gmodcontent`

Se o seu root de content for outro, use:

```bash
export MAP_AUDIT_CONTENT_ROOT=/caminho/do/content
```

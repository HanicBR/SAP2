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

Workshop download (PR-14.1 - etapa 1):

```bash
npm --prefix server run workshop:download -- --id 104607712
```

Forcar refresh:

```bash
npm --prefix server run workshop:download -- --id 104607712 --refresh
```

Defaults na VPS Linux:

- `WORKSHOP_ROOT=/opt/backstabber/workshop`
- `WORKSHOP_STEAMCMD_DIR=/opt/backstabber/workshop/steamcmd`
- `WORKSHOP_REPORTS_DIR=/opt/backstabber/workshop/reports`
- `WORKSHOP_LOCKS_DIR=/opt/backstabber/workshop/locks`

Variaveis uteis:

- `WORKSHOP_STEAMCMD_BIN` (path explicito do steamcmd/steamcmd.sh)
- `WORKSHOP_APP_ID` (default: `4000` para GMod)
- `WORKSHOP_STEAM_USER` (default: `anonymous`)
- `WORKSHOP_STEAM_PASS` (obrigatoria se usuario nao for anonymous)
- `WORKSHOP_TIMEOUT_MS` (default: `1800000`)
- `WORKSHOP_STALE_LOCK_MS` (default: `7200000`)

Relatorio gerado:

- `/opt/backstabber/workshop/reports/<workshopId>.download.json` (Linux default)
- `sandbox/workshop/reports/<workshopId>.download.json` (fallback local)

Lock por item:

- `<locksDir>/<appId>_<workshopId>.lock`
- Se lock estiver ativo, o job falha com mensagem clara.
- Lock stale e recuperado automaticamente conforme `WORKSHOP_STALE_LOCK_MS`.

## PR-14.2 Auto-download por troca de mapa (fila + retry)

Copie o mapeamento de mapas:

```bash
cp server/config/workshop-maps.template.json server/config/workshop-maps.json
```

No Windows:

```powershell
Copy-Item server/config/workshop-maps.template.json server/config/workshop-maps.json
```

Campos principais:

- `maps.<mapName> = <workshopId>`
- `aliases.<mapAlias> = <mapNameCanonico>`
- `autoProcessEnabled` (pos-download: extrair + pipeline)
- `assetResolutionMode` (`permissive|strict`)
- `sourceioMode` (`auto|required|off`)
- `maxRetries`, `retryBaseMs`, `retryMaxMs`, `maxQueueSize`

Trigger automatico:

- `heartbeat` com `map` novo enfileira download do Workshop (quando houver mapping).
- `viewer_state` WS com `map` novo tambem enfileira.
- Dedupe por `appId:workshopId` evita downloads duplicados.
- Retry com backoff exponencial ate `maxRetries`.
- Detecao automatica (PR-14.4):
  - se map vier como `workshop/<id>/<map>`, o `id` e aprendido automaticamente.
  - mapeamento aprendido e salvo em `server/config/workshop-maps.runtime.json`.
  - fallback adicional: reaproveita `*.process.json` de execucoes anteriores.

Controle por env:

- `WORKSHOP_AUTO_DOWNLOAD_ENABLED` (default `true`)
- `WORKSHOP_AUTO_PROCESS_ENABLED` (default `true`)
- `WORKSHOP_MAPS_FILE` (default `server/config/workshop-maps.json`)
- `WORKSHOP_ASSET_RESOLUTION_MODE` (`permissive|strict`)
- `WORKSHOP_SOURCEIO_MODE` (`auto|required|off`)
- `WORKSHOP_MAX_RETRIES`
- `WORKSHOP_RETRY_BASE_MS`
- `WORKSHOP_RETRY_MAX_MS`
- `WORKSHOP_MAX_QUEUE_SIZE`
- `WORKSHOP_SUCCESS_COOLDOWN_MS`
- `WORKSHOP_DOWNLOAD_TIMEOUT_MS` (timeout hard do subprocesso download)
- `WORKSHOP_PROCESS_TIMEOUT_MS` (timeout hard do subprocesso process-map)
- `WORKSHOP_RUNTIME_MAPS_FILE` (default `server/config/workshop-maps.runtime.json`)

Logs esperados:

- `[workshop-auto] initialized`
- `[workshop-auto] queued`
- `[workshop-auto] download_start`
- `[workshop-auto] download_ok` / `download_failed`
- `[workshop-auto] process_start` / `process_ok`

## PR-14.3 Processamento pos-download (extract + pipeline)

Comando manual (id + mapa):

```bash
npm --prefix server run workshop:process-map -- --id 262714246040502603 --map rp_evocity_v33x
```

Fluxo:

1. Detecta payload Workshop no item baixado (`.gma`, legado `.bin` LZMA, fallback zip-wrapped).
2. Extrai payload para `WORKSHOP_ROOT/extracted/<workshopId>/payload_*`.
3. Encontra `*.bsp` e seleciona o BSP do mapa alvo.
4. Roda `map:pipeline:build` automaticamente.

Garantias de seguranca/robustez:

- `workshopId` sempre validado como numerico.
- `map` sanitizado: sem `../`, sem barras, regex restrita (`[a-z0-9_-]`).
- timeouts hard por subprocesso:
  - `steamcmd` (download)
  - `python` (extract)
  - `buildMapPipeline` (pipeline)
- erros sempre registrados em report com `step`, `exitCode/signal`, `logTail`.

Cache/dedupe de processamento:

- `process-cache.json` (em `WORKSHOP_REPORTS_DIR`) guarda assinatura do payload.
- se assinatura nao mudou e artefatos existem, `workshop:process-map` retorna `cache_hit` e pula extract/pipeline.
- report marca `cache.hit=true` e `reason`.

Limpeza automatica (anti-acumulo):

- por padrao, limpa extracoes antigas em `WORKSHOP_ROOT/extracted` (retencao configuravel).
- remove reports/locks antigos de workshop.
- controle:
  - `WORKSHOP_PROCESS_CLEANUP_ENABLED` (default `1`)
  - `WORKSHOP_CLEANUP_RETENTION_DAYS` (default `14`)

Relatorios:

- `.../reports/<workshopId>.<map>.extract.json`
- `.../reports/<workshopId>.<map>.process.json`

Scripts novos:

- `server/scripts/extract_workshop_payload.py`
- `server/src/scripts/processWorkshopMap.ts`

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

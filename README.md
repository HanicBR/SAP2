# SAP2

## PR-01.2: Auditoria de Assets e Mounts (rp_evocity_v33x)

### 1) Preparar mounts

1. Copie o template:
   - PowerShell: `Copy-Item server/config/mounts.template.json server/config/mounts.json`
2. Edite `server/config/mounts.json` com os caminhos reais da sua instalacao.
3. Se preferir, sobrescreva por variaveis de ambiente:
   - `MOUNTS_FILE`
   - `MAP_AUDIT_MOUNTS_FILE`
   - `MAP_AUDIT_MOUNT_GMOD`
   - `MAP_AUDIT_MOUNT_HL2`
   - `MAP_AUDIT_MOUNT_CSS`
   - `MAP_AUDIT_MOUNT_TF2`
   - `MAP_AUDIT_MOUNT_CUSTOM`

Formato das variaveis:
- Windows: separado por `;`
- Linux: separado por `:`

### 2) Rodar auditoria

```bash
npm --prefix server run audit:map-assets:evocity
```

Windows (mounts custom + override rapido):

```powershell
npm --prefix server run audit:map-assets:evocity -- --mounts C:\meu\mounts.json --mount css=C:\Steam\steamapps\common\Counter-Strike Source\cstrike
```

Linux (via env):

```bash
MOUNTS_FILE=/home/steam/mounts.json npm --prefix server run audit:map-assets:evocity
```

### 3) Saida

- Relatorio JSON: `reports/audit-report.json`
- Gate obrigatorio:
  - o comando retorna erro se `missingAssetsSummary.critical > 0`.
- Prioridade de resolucao de assets:
  - `pakfile` interno do BSP (mount virtual, sem extrair em disco)
  - mapa extraido (`--map-root`)
  - mounts externos (`gmod/hl2/css/tf2/custom`)
- Auto-discovery:
  - parse de `libraryfolders.vdf` (Windows/Linux) para detectar candidatos de `gmod/hl2/css/tf2`
  - validacao por path com status `ok|missing|invalid` e checks de `materials/models/maps`

O relatorio inclui:
- `missingAssetsSummary` (`critical` / `major` / `minor`)
- lista `missingAssets` com tipo (`mdl`, `vmt`, `vtf`, `patch-include`, `skybox`, `world-material`), referencias e sugestao de mount
- `mountsUsed` com status por mount path e `resolvedAssets` por mount
- `criticalTop50` com `bestGuessMount` e `searchedIn` (`pak/map-root/mounts`)
- contadores obrigatorios:
  - `staticProps.uniqueMissingModels`
  - `staticProps.affectedInstances`
  - `usedMaterialsTotal`
  - `usedWorldMaterialsWithoutResolvedBaseTexture`
  - `vmtPatchIncludesMissingUnique`
  - `pakfileScanned`
  - `pakfileFilesCount`
  - `skyboxInvalid`

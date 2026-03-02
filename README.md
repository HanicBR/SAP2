# SAP2

## PR-01.1: Auditoria de Assets e Mounts (rp_evocity_v33x)

### 1) Preparar mounts

1. Copie o template:
   - PowerShell: `Copy-Item server/config/mounts.template.json server/config/mounts.json`
2. Edite `server/config/mounts.json` com os caminhos reais da sua instalacao.
3. Se preferir, sobrescreva por variaveis de ambiente:
   - `MAP_AUDIT_MOUNT_GMOD`
   - `MAP_AUDIT_MOUNT_HL2`
   - `MAP_AUDIT_MOUNT_CSS`
   - `MAP_AUDIT_MOUNT_TF2`
   - `MAP_AUDIT_MOUNT_CUSTOM`

Formato das variaveis:
- Windows: separado por `;`
- Linux: separado por `:`

### 2) Rodar auditoria (comando unico)

```bash
npm --prefix server run audit:map-assets:evocity
```

### 3) Saida

- Relatorio JSON: `reports/audit-report.json`
- Gate obrigatorio:
  - o comando retorna erro se `missingAssetsSummary.critical > 0`.
- Prioridade de resolucao de assets:
  - `pakfile` interno do BSP (mount virtual, sem extrair em disco)
  - mapa extraido (`--map-root`)
  - mounts externos (`gmod/hl2/css/tf2/custom`)

O relatorio inclui:
- `missingAssetsSummary` (`critical` / `major` / `minor`)
- lista `missingAssets` com tipo (`mdl`, `vmt`, `vtf`, `patch-include`, `skybox`, `world-material`), referencias e sugestao de mount
- contadores obrigatorios:
  - `staticProps.uniqueMissingModels`
  - `staticProps.affectedInstances`
  - `usedMaterialsTotal`
  - `usedWorldMaterialsWithoutResolvedBaseTexture`
  - `vmtPatchIncludesMissingUnique`
  - `pakfileScanned`
  - `pakfileFilesCount`
  - `skyboxInvalid`

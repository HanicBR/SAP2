# Ingestão de logs – Sandbox (Garry's Mod)

Este documento define o formato recomendado para enviar eventos do servidor **Sandbox** para o backend do Backstabber via endpoint de ingestão.

## Endpoint

- URL: `POST /api/ingest/logs`
- Header de autenticação:
  - `X-Server-Key: <apiKey_do_servidor>`
  - A chave é a mesma mostrada na tela de **Servidores** (painel admin). No backend, ela é validada contra o `apiKeyHash` do `GameServer`.

## Estrutura geral do payload

```jsonc
{
  "events": [
    {
      "gameMode": "SANDBOX",
      "type": "CHAT",              // ver lista de tipos abaixo
      "timestamp": "2025-12-05T00:00:03Z",
      "steamId": "STEAM_0:0:197779187",
      "playerName": "caiomarquezine",
      "rawText": "caiomarquezine: po q bom!",     // linha humana/exibível
      "metadata": { /* campos específicos do tipo */ },

      // Campos extras recomendados (já suportados pelo backend)
      "sessionId": "sess_abc123",                // opcional, ajuda playtime real
      "map": "gm_construct",                     // game.GetMap()
      "serverName": "Backstabber Sandbox #1",    // GetHostName()
      "playerCount": 12                          // jogadores online no momento
    }
  ]
}
```

Observações:

- `events` deve ser um array (pode enviar 1 ou vários por requisição).
- `gameMode` deve ser `"SANDBOX"` para esse servidor (o backend converte para enum interno).
- `rawText` é armazenado e mostrado “como veio”; use algo legível para staff.
- `metadata` é um JSON livre; o backend não valida chave a chave, apenas persiste e usa alguns campos padrão (`ip`, `sessionId`, `map`, `playerCount` etc.).

## Tipos de evento (type)

Os tipos abaixo já existem no backend (`LogType`) e são entendidos pela UI:

- `CHAT`
- `CONNECT`
- `DISCONNECT`
- `PROP_SPAWN` (props, SENTs, NPCs)
- `TOOL_USE`
- `GAME_EVENT` (eventos gerais de player)
- `KILL` / `DAMAGE` (mortes/dano, caso queira detalhar)
- `COMMAND` (comandos de chat ou console)
- `ULX` (comandos administrativos pelo ULX)

### 1. CHAT

Linha típica do log:

```text
[00:00:03] [CHAT] nick [STEAM_0:0:ID|user] [GLOBAL/ALIVE] mensagem
```

Payload sugerido:

```json
{
  "type": "CHAT",
  "gameMode": "SANDBOX",
  "steamId": "STEAM_0:0:ID",
  "playerName": "nick",
  "rawText": "nick: mensagem",
  "metadata": {
    "message": "mensagem",
    "chatScope": "GLOBAL",        // GLOBAL, TEAM, LOCAL, etc.
    "lifeState": "ALIVE",         // ALIVE / DEAD
    "group": "user"               // user, vip, admin, operator, etc.
  }
}
```

### 2. CONNECT / DISCONNECT

Linhas típicas:

```text
[00:00:23] [CONNECT] Leo_pera [STEAM_0:0:954710776|user] authed steamid=STEAM_0:0:954710776 uniqueid=2110188157
[00:00:23] [CONNECT] Leo_pera [STEAM_0:0:954710776|user] initial spawn ip=177.116.248.170:48878
[00:00:37] [CONNECT] pkzin151 [STEAM_0:0:414938207|user] disconnected reason=unknown
```

CONNECT (primeiro spawn):

```json
{
  "type": "CONNECT",
  "gameMode": "SANDBOX",
  "steamId": "STEAM_0:0:954710776",
  "playerName": "Leo_pera",
  "metadata": {
    "ip": "177.116.248.170",      // sem porta
    "port": 48878,
    "authType": "steam",
    "group": "user"
  }
}
```

DISCONNECT:

```json
{
  "type": "DISCONNECT",
  "gameMode": "SANDBOX",
  "steamId": "STEAM_0:0:414938207",
  "playerName": "pkzin151",
  "metadata": {
    "reason": "unknown"
  }
}
```

> Observação: `metadata.ip` é usado pelo backend na detecção de contas duplicadas, então é bom enviar sempre que possível.

### 3. PROP / SENT / NPC SPAWN (`PROP_SPAWN`)

Linhas típicas:

```text
[SPAWN] ARTMO2.0 [STEAM_0:0:765153795|user] spawned SENT item_healthkit[655] model=models/items/healthkit.mdl
[SPAWN] Doom Reaper [STEAM_0:0:884677794|user] spawned PROP prop_physics[661] model=models/props_phx/cannonball_solid.mdl
[SPAWN] Eazy-E [STEAM_0:0:872630237|user] spawned NPC npc_fastzombie[634] model=models/zombie/fast.mdl
```

Payload sugerido:

```json
{
  "type": "PROP_SPAWN",
  "gameMode": "SANDBOX",
  "steamId": "STEAM_0:0:765153795",
  "playerName": "ARTMO2.0",
  "metadata": {
    "spawnKind": "SENT",                     // "PROP" | "SENT" | "NPC"
    "entityClass": "item_healthkit",
    "entIndex": 655,
    "propModel": "models/items/healthkit.mdl"
  }
}
```

NPC:

```json
{
  "type": "PROP_SPAWN",
  "gameMode": "SANDBOX",
  "steamId": "STEAM_0:0:872630237",
  "playerName": "Eazy-E",
  "metadata": {
    "spawnKind": "NPC",
    "entityClass": "npc_fastzombie",
    "entIndex": 634,
    "propModel": "models/zombie/fast.mdl"
  }
}
```

### 4. TOOLS (`TOOL_USE`)

Linha típica:

```text
[TOOLS] nick [STEAM_0:1:93967975|operator] used tool 'material' on prop_dynamic[757] model=models/hunter/tubes/tube4x4x05c.mdl @ 103.0 9080.4 -347.7
```

Payload:

```json
{
  "type": "TOOL_USE",
  "gameMode": "SANDBOX",
  "steamId": "STEAM_0:1:93967975",
  "playerName": "nick",
  "metadata": {
    "toolName": "material",
    "targetClass": "prop_dynamic",
    "entIndex": 757,
    "propModel": "models/hunter/tubes/tube4x4x05c.mdl",
    "position": { "x": 103.0, "y": 9080.4, "z": -347.7 }
  }
}
```

### 5. Eventos gerais de player (`GAME_EVENT`)

Use `GAME_EVENT` para spawns, troca de time, entrar/sair de veículo, etc.

Exemplos:

- Spawn:

```json
{
  "type": "GAME_EVENT",
  "gameMode": "SANDBOX",
  "steamId": "STEAM_0:0:643563004",
  "playerName": "AltF4",
  "metadata": {
    "eventKind": "SPAWN",
    "hp": 100,
    "armor": 0
  }
}
```

- Troca de time:

```json
{
  "type": "GAME_EVENT",
  "gameMode": "SANDBOX",
  "steamId": "STEAM_0:0:954710776",
  "playerName": "Leo_pera",
  "metadata": {
    "eventKind": "TEAM_CHANGE",
    "fromTeam": "Joining/Connecting",
    "toTeam": "Unassigned"
  }
}
```

- Entrou em veículo:

```json
{
  "type": "GAME_EVENT",
  "gameMode": "SANDBOX",
  "steamId": "STEAM_0:0:765153795",
  "playerName": "ARTMO2.0",
  "metadata": {
    "eventKind": "ENTER_VEHICLE",
    "vehicleClass": "prop_vehicle_prisoner_pod",
    "vehicleIndex": 864,
    "vehicleModel": "models/nova/airboat_seat.mdl",
    "seat": 0
  }
}
```

### 6. Mortes / dano (`KILL` / `DAMAGE`)

Para Sandbox, isso é opcional, mas pode ajudar spam detection ou highlight de mortes estranhas.

Exemplo de morte por prop:

```json
{
  "type": "KILL",
  "gameMode": "SANDBOX",
  "steamId": "STEAM_0:0:765153795",
  "playerName": "ARTMO2.0",
  "metadata": {
    "eventKind": "DEATH",
    "victimName": "ARTMO2.0",
    "victimSteamId": "STEAM_0:0:765153795",
    "attackerName": "prop_physics[827]",
    "attackerSteamId": null,
    "weapon": "prop_physics",
    "propModel": "models/props_phx/cannonball_solid.mdl"
  }
}
```

### 7. ULX / COMMAND (administrativos)

Se o logger capturar comandos de admin, envie como `ULX` ou `COMMAND`:

```json
{
  "type": "ULX",
  "gameMode": "SANDBOX",
  "steamId": "STEAM_0:1:868670659",
  "playerName": "pietroom",
  "metadata": {
    "command": "!ban",
    "args": ["STEAM_0:1:123456", "60", "RDM"],
    "targetSteamId": "STEAM_0:1:123456",
    "targetName": "TrollMaster"
  }
}
```

## Campos recomendados para o futuro

- `sessionId`: ID de sessão por conexão (CONNECT → DISCONNECT). O backend já entende isso e usa para playtime exato.
- `map`: sempre que possível (já usado em MapStats e no live feed).
- `playerCount`: pode ser enviado junto com eventos importantes (ou via heartbeat separado, já implementado em `/api/servers/heartbeat`).
- `metadata.ip` / `metadata.geo`: alimentam o sistema de duplicatas e o mapa de detecção.

Com esse contrato, basta o servidor Sandbox disparar os eventos na hora certa (hooks do Lua) montando esse JSON e chamando o endpoint; o backend já armazena tudo, o painel de Logs/Detecção/Analytics passa a usar dados reais, e você não precisa mais ler `.txt` manualmente.


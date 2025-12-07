-- Backstabber Sandbox Ingest Example
-- Coloque algo assim em um addon do servidor (lua/autorun/server/backstabber_sandbox_ingest.lua)

local BACKSTABBER_URL = "http://localhost:4000/api/ingest/logs"
local BACKSTABBER_API_KEY = "SUA_API_KEY_AQUI"      -- copie do painel /admin/servers
local BACKSTABBER_MODE = "SANDBOX"

local function nowIso()
    return os.date("!%Y-%m-%dT%H:%M:%SZ")
end

local function buildBaseEvent(ply)
    if not IsValid(ply) or not ply:IsPlayer() then return {} end
    return {
        gameMode = BACKSTABBER_MODE,
        steamId = ply:SteamID(),
        playerName = ply:Nick()
    }
end

local function sendEvents(events)
    if #events == 0 then return end

    -- Enriquecer com dados do servidor (mapa, playerCount, serverName)
    local enriched = {}
    local map = game.GetMap()
    local hostname = GetHostName and GetHostName() or nil
    local playerCount = player.GetCount and player.GetCount() or #player.GetAll()

    for _, ev in ipairs(events) do
        ev.gameMode = ev.gameMode or BACKSTABBER_MODE
        ev.timestamp = ev.timestamp or nowIso()
        ev.map = ev.map or map
        ev.serverName = ev.serverName or hostname
        ev.playerCount = ev.playerCount or playerCount
        table.insert(enriched, ev)
    end

    local payload = util.TableToJSON({ events = enriched }, false, true)

    HTTP({
        url = BACKSTABBER_URL,
        method = "POST",
        headers = {
            ["Content-Type"] = "application/json",
            ["X-Server-Key"] = BACKSTABBER_API_KEY,
        },
        body = payload,
        success = function(code, body, headers)
            -- opcional: logar sucesso/erros
            -- print("[Backstabber] ingest ok", code, body)
        end,
        failed = function(err)
            print("[Backstabber] ingest failed:", err)
        end
    })
end

-- CHAT / COMMANDS ------------------------------------------------------------
hook.Add("PlayerSay", "Backstabber_ChatLog", function(ply, text)
    -- Detectar comandos de chat (ex: !rtv, !menu, /noclip)
    if string.sub(text, 1, 1) == "!" or string.sub(text, 1, 1) == "/" then
        local cmd = string.match(text, "^([!/][^%s]+)") or text
        local argsStr = string.sub(text, #cmd + 2) or ""
        local args = {}
        for token in string.gmatch(argsStr, "%S+") do
            table.insert(args, token)
        end

        local evCmd = buildBaseEvent(ply)
        evCmd.type = "COMMAND"
        evCmd.timestamp = nowIso()
        evCmd.rawText = text
        evCmd.metadata = {
            command = cmd,
            args = args,
        }
        sendEvents({ evCmd })
        -- não damos return aqui para também registrar como CHAT normal
    end

    local ev = buildBaseEvent(ply)
    ev.type = "CHAT"
    ev.timestamp = nowIso()
    ev.rawText = ply:Nick() .. ": " .. text
    ev.metadata = {
        message = text,
        chatScope = "GLOBAL",   -- adapte se usar chat por time/região
        lifeState = ply:Alive() and "ALIVE" or "DEAD"
    }
    sendEvents({ ev })
end)

-- CONNECT / DISCONNECT -------------------------------------------------------
hook.Add("PlayerInitialSpawn", "Backstabber_Connect", function(ply)
    local ev = buildBaseEvent(ply)
    ev.type = "CONNECT"
    ev.timestamp = nowIso()

    local ip = string.Explode(":", ply:IPAddress() or "")[1] or nil
    ev.metadata = {
        ip = ip,
        authType = "steam"
    }

    sendEvents({ ev })
end)

hook.Add("PlayerDisconnected", "Backstabber_Disconnect", function(ply)
    local ev = buildBaseEvent(ply)
    ev.type = "DISCONNECT"
    ev.timestamp = nowIso()
    ev.metadata = {
        reason = "unknown"  -- se tiver motivo real, use aqui
    }
    sendEvents({ ev })
end)

-- PLAYER SPAWN / TEAM / VEÍCULO / MORTE -------------------------------------
hook.Add("PlayerSpawn", "Backstabber_PlayerSpawn", function(ply)
    local ev = buildBaseEvent(ply)
    ev.type = "GAME_EVENT"
    ev.timestamp = nowIso()
    ev.metadata = {
        eventKind = "SPAWN",
        hp = ply:Health(),
        armor = ply:Armor()
    }
    ev.rawText = string.format("%s spawned (hp=%d armor=%d)", ev.playerName, ev.metadata.hp, ev.metadata.armor)
    sendEvents({ ev })
end)

hook.Add("OnPlayerChangedTeam", "Backstabber_TeamChange", function(ply, oldTeam, newTeam)
    if not IsValid(ply) then return end
    local ev = buildBaseEvent(ply)
    ev.type = "GAME_EVENT"
    ev.timestamp = nowIso()

    local fromName = team.GetName and team.GetName(oldTeam) or tostring(oldTeam)
    local toName = team.GetName and team.GetName(newTeam) or tostring(newTeam)

    ev.metadata = {
        eventKind = "TEAM_CHANGE",
        fromTeam = fromName,
        toTeam = toName
    }
    ev.rawText = string.format("%s changed team %s -> %s", ev.playerName, fromName, toName)
    sendEvents({ ev })
end)

hook.Add("PlayerEnteredVehicle", "Backstabber_EnterVehicle", function(ply, veh, role)
    if not IsValid(ply) then return end
    local ev = buildBaseEvent(ply)
    ev.type = "GAME_EVENT"
    ev.timestamp = nowIso()

    ev.metadata = {
        eventKind = "ENTER_VEHICLE",
        vehicleClass = IsValid(veh) and veh:GetClass() or nil,
        vehicleIndex = IsValid(veh) and veh:EntIndex() or nil,
        vehicleModel = IsValid(veh) and veh:GetModel() or nil,
        seat = role
    }
    ev.rawText = string.format("%s entered vehicle %s", ev.playerName, ev.metadata.vehicleClass or "unknown")
    sendEvents({ ev })
end)

hook.Add("PlayerLeaveVehicle", "Backstabber_LeaveVehicle", function(ply, veh)
    if not IsValid(ply) then return end
    local ev = buildBaseEvent(ply)
    ev.type = "GAME_EVENT"
    ev.timestamp = nowIso()

    ev.metadata = {
        eventKind = "LEAVE_VEHICLE",
        vehicleClass = IsValid(veh) and veh:GetClass() or nil,
        vehicleIndex = IsValid(veh) and veh:EntIndex() or nil,
        vehicleModel = IsValid(veh) and veh:GetModel() or nil
    }
    ev.rawText = string.format("%s left vehicle %s", ev.playerName, ev.metadata.vehicleClass or "unknown")
    sendEvents({ ev })
end)

hook.Add("PlayerDeath", "Backstabber_PlayerDeath", function(victim, inflictor, attacker)
    if not IsValid(victim) or not victim:IsPlayer() then return end

    local ev = buildBaseEvent(victim)
    ev.type = "KILL"
    ev.timestamp = nowIso()

    local meta = {
        eventKind = "DEATH",
        victimName = victim:Nick(),
        victimSteamId = victim:SteamID()
    }

    if IsValid(attacker) and attacker:IsPlayer() then
        meta.attackerName = attacker:Nick()
        meta.attackerSteamId = attacker:SteamID()
    else
        meta.attackerName = IsValid(attacker) and attacker:GetClass() or "world"
    end

    if IsValid(inflictor) then
        meta.weapon = inflictor:GetClass()
        meta.propModel = inflictor:GetModel()
    end

    ev.metadata = meta
    ev.rawText = string.format("%s died (attacker: %s)", meta.victimName, meta.attackerName or "world")
    sendEvents({ ev })
end)

-- PROP / SENT / NPC SPAWN ----------------------------------------------------
local function sendSpawnEvent(ply, kind, class, ent)
    local ev = buildBaseEvent(ply)
    ev.type = "PROP_SPAWN"
    ev.timestamp = nowIso()
    ev.metadata = {
        spawnKind = kind,                 -- "PROP" | "SENT" | "NPC"
        entityClass = class,
        entIndex = IsValid(ent) and ent:EntIndex() or nil,
        propModel = IsValid(ent) and ent:GetModel() or nil
    }
    sendEvents({ ev })
end

hook.Add("PlayerSpawnedProp", "Backstabber_SpawnProp", function(ply, model, ent)
    sendSpawnEvent(ply, "PROP", ent:GetClass(), ent)
end)

hook.Add("PlayerSpawnedSENT", "Backstabber_SpawnSENT", function(ply, ent)
    sendSpawnEvent(ply, "SENT", ent:GetClass(), ent)
end)

hook.Add("PlayerSpawnedNPC", "Backstabber_SpawnNPC", function(ply, ent)
    sendSpawnEvent(ply, "NPC", ent:GetClass(), ent)
end)

-- TOOLS ----------------------------------------------------------------------
hook.Add("CanTool", "Backstabber_ToolUse", function(ply, trace, tool)
    if not IsValid(ply) or not trace or not trace.Entity then return end

    local ev = buildBaseEvent(ply)
    ev.type = "TOOL_USE"
    ev.timestamp = nowIso()

    local ent = trace.Entity
    ev.metadata = {
        toolName = tool,
        targetClass = ent:GetClass(),
        entIndex = ent:EntIndex(),
        propModel = ent:GetModel(),
        position = {
            x = math.Round(trace.HitPos.x, 1),
            y = math.Round(trace.HitPos.y, 1),
            z = math.Round(trace.HitPos.z, 1),
        }
    }

    sendEvents({ ev })
end)

-- ULX/ULib logging (opcional, apenas se ULib estiver instalado)
if ULib and hook then
    hook.Add("ULib_PostAutoLog", "Backstabber_ULXLog", function(msg)
        local text = tostring(msg or "")
        local steam = string.match(text, "(STEAM_%d:%d:%d+)")
        local ply = nil
        if steam then
            for _, p in ipairs(player.GetAll()) do
                if p:SteamID() == steam then
                    ply = p
                    break
                end
            end
        end

        local ev = buildBaseEvent(ply)
        ev.type = "ULX"
        ev.timestamp = nowIso()
        ev.rawText = text
        ev.metadata = {
            message = text
        }
        sendEvents({ ev })
    end)
end

-- Opcional: adicionar logs de EntityTakeDamage, etc., seguindo o contrato de docs/sandbox-ingest.md

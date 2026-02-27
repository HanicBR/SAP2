if CLIENT then return end

local sam = sam
local math_floor = math.floor
local math_min = math.min
local math_max = math.max
local math_random = math.random
local string_format = string.format
local string_match = string.match
local string_lower = string.lower
local string_upper = string.upper
local table_concat = table.concat
local table_maxn = table.maxn or function(tbl)
	local max_index = 0
	for key in pairs(tbl or {}) do
		if isnumber(key) and key > max_index then
			max_index = key
		end
	end
	return max_index
end

local INGEST_MODE = "SANDBOX"
local INGEST_SCHEMA_VERSION = 1

local c_enable = CreateConVar("bsb_ingest_enable", "0", FCVAR_ARCHIVE, "Enable Backstabber Sandbox MVP ingest.")
local c_ingest_url = CreateConVar("bsb_ingest_url", "http://127.0.0.1:4000/api/ingest/logs", FCVAR_ARCHIVE, "Backstabber ingest endpoint.")
local c_heartbeat_url = CreateConVar("bsb_heartbeat_url", "http://127.0.0.1:4000/api/servers/heartbeat", FCVAR_ARCHIVE, "Backstabber heartbeat endpoint.")
local c_actions_url = CreateConVar("bsb_actions_url", "http://127.0.0.1:4000/api/servers/actions/pull", FCVAR_ARCHIVE, "Backstabber server actions pull endpoint.")
local c_server_key = CreateConVar("bsb_server_key", "", FCVAR_ARCHIVE, "Backstabber server API key.")
local c_batch_size = CreateConVar("bsb_batch_size", "100", FCVAR_ARCHIVE, "Max events per ingest request.")
local c_flush_seconds = CreateConVar("bsb_flush_seconds", "2", FCVAR_ARCHIVE, "Batch flush interval in seconds.")
local c_heartbeat_seconds = CreateConVar("bsb_heartbeat_seconds", "30", FCVAR_ARCHIVE, "Heartbeat interval in seconds.")
local c_actions_enable = CreateConVar("bsb_actions_enable", "1", FCVAR_ARCHIVE, "Enable server-side action pull (punishments from panel).")
local c_actions_seconds = CreateConVar("bsb_actions_seconds", "3", FCVAR_ARCHIVE, "Actions poll interval in seconds.")
local c_max_payload_bytes = CreateConVar("bsb_max_payload_bytes", "524288", FCVAR_ARCHIVE, "Max JSON body bytes per ingest request.")
local c_max_retry_attempts = CreateConVar("bsb_max_retry_attempts", "0", FCVAR_ARCHIVE, "Max retry attempts for ingest batches (0 = infinite).")
local c_queue_warn_size = CreateConVar("bsb_queue_warn_size", "1000", FCVAR_ARCHIVE, "Warn when ingest queue backlog reaches this size.")
local c_prop_spawn_enable = CreateConVar("bsb_prop_spawn_enable", "1", FCVAR_ARCHIVE, "Enable PROP_SPAWN ingest events.")
local c_prop_spawn_max_per_window = CreateConVar("bsb_prop_spawn_max_per_window", "0", FCVAR_ARCHIVE, "Max PROP_SPAWN events per player per window (0 = unlimited).")
local c_prop_spawn_window_seconds = CreateConVar("bsb_prop_spawn_window_seconds", "10", FCVAR_ARCHIVE, "PROP_SPAWN rate-limit window in seconds.")
local c_debug = CreateConVar("bsb_ingest_debug", "0", FCVAR_ARCHIVE, "Enable debug logs for ingest addon.")

local ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
local last_ulid_ms = -1
local last_ulid_random = nil

local queue = {}
local send_in_flight = false
local last_enqueue_realtime = 0
local sending_batch = nil
local flush_if_needed
local discarded_batches_total = 0
local discarded_events_total = 0
local queue_warn_next = 0
local prop_spawn_window_by_steamid = {}

local sessions_by_steamid = {}
local pending_disconnect_reason_by_steamid = {}
local sam_command_counts = setmetatable({}, {__mode = "k"})

local staff_groups = {
	superadmin = true,
	admin = true,
	operator = true,
	ajudante = true,
	moderator = true,
	mod = true,
	staff = true,
}

local punish_from_command = {
	kick = "KICK",
	warn = "WARN",
	awarn = "WARN",
	mute = "MUTE",
	unmute = "MUTE",
	gag = "GAG",
	ungag = "GAG",
}

local skip_punish_command = {
	ban = true,
	unban = true,
}

math.randomseed(os.time() + math_floor((SysTime() % 1) * 1000000))
math_random(); math_random(); math_random()

local function debug_log(msg)
	if not c_debug:GetBool() then return end
	print("[BSB-INGEST] " .. tostring(msg))
end

local function is_configured()
	if not c_enable:GetBool() then return false end
	local key = c_server_key:GetString()
	local url = c_ingest_url:GetString()
	return key ~= nil and key ~= "" and url ~= nil and url ~= ""
end

local function now_iso_utc()
	return os.date("!%Y-%m-%dT%H:%M:%SZ")
end

local function now_ms()
	return os.time() * 1000 + math_floor((SysTime() % 1) * 1000)
end

local function ulid_encode_time(ms)
	local chars = {}
	local value = ms
	for i = 10, 1, -1 do
		local mod = value % 32
		chars[i] = ULID_ALPHABET:sub(mod + 1, mod + 1)
		value = math_floor(value / 32)
	end
	return table_concat(chars, "")
end

local function ulid_random_string(random_values)
	local chars = {}
	for i = 1, 16 do
		local value = random_values[i] or 0
		chars[i] = ULID_ALPHABET:sub(value + 1, value + 1)
	end
	return table_concat(chars, "")
end

local function ulid_increment_random(random_values)
	for i = 16, 1, -1 do
		local next_value = (random_values[i] or 0) + 1
		if next_value <= 31 then
			random_values[i] = next_value
			return random_values
		end
		random_values[i] = 0
	end
	return random_values
end

local function new_ulid()
	local ms = now_ms()
	local random_values = {}

	if ms == last_ulid_ms and last_ulid_random ~= nil then
		random_values = ulid_increment_random(last_ulid_random)
	else
		for i = 1, 16 do
			random_values[i] = math_random(0, 31)
		end
		last_ulid_ms = ms
	end

	last_ulid_random = random_values
	return ulid_encode_time(ms) .. ulid_random_string(random_values)
end

local function parse_ip_and_port(raw_ip)
	local raw = tostring(raw_ip or "")
	raw = raw:gsub("^%s+", ""):gsub("%s+$", "")
	local lower = string_lower(raw)
	if raw == "" or lower == "loopback" or lower == "none" or lower == "unknown" or lower == "error!" then
		return nil, nil
	end

	local ip, port = string_match(raw, "^([^:]+):(%d+)$")
	if not ip then
		ip = string_match(raw, "^([^:]+)$")
	end

	if not ip or ip == "" then return nil, nil end
	if port then
		return ip, tonumber(port)
	end
	return ip, nil
end

local function normalize_steamid(steamid)
	local raw = tostring(steamid or "")
	raw = raw:gsub("^%s+", ""):gsub("%s+$", "")
	if raw == "" then return nil end

	local upper = string_upper(raw)
	if upper == "BOT" or upper == "UNKNOWN" or upper == "NULL" then
		return nil
	end

	return raw
end

local function normalize_disconnect_reason(reason)
	local raw = tostring(reason or "")
	raw = raw:gsub("^%s+", ""):gsub("%s+$", "")
	if raw == "" then return nil end

	local lower = string_lower(raw)
	if lower == "unknown" or lower == "none" or lower == "nenhum" or lower == "n/a" then
		return nil
	end

	return raw
end

local function set_pending_disconnect_reason(steamid, reason)
	local sid = normalize_steamid(steamid)
	local parsed_reason = normalize_disconnect_reason(reason)
	if not sid or not parsed_reason then return end

	pending_disconnect_reason_by_steamid[sid] = {
		reason = parsed_reason,
		expires_at = RealTime() + 20,
	}
end

local function take_pending_disconnect_reason(steamid)
	local sid = normalize_steamid(steamid)
	if not sid then return nil end

	local record = pending_disconnect_reason_by_steamid[sid]
	if not record then return nil end

	pending_disconnect_reason_by_steamid[sid] = nil
	if record.expires_at and record.expires_at < RealTime() then
		return nil
	end
	return record.reason
end

local function clear_pending_disconnect_reason(steamid)
	local sid = normalize_steamid(steamid)
	if not sid then return end
	pending_disconnect_reason_by_steamid[sid] = nil
end

local function is_console_actor(actor)
	if actor == nil then return true end
	if sam and sam.isconsole and sam.isconsole(actor) then return true end
	if isstring(actor) and string_lower(actor) == "console" then return true end
	return false
end

local function is_valid_player(ply)
	if ply == nil then return false end
	if not isentity or not isentity(ply) then return false end
	if not IsValid(ply) then return false end
	if not ply.IsPlayer then return false end
	return ply:IsPlayer()
end

local function is_bot_player(ply)
	if not is_valid_player(ply) then return false end
	if ply.IsBot and ply:IsBot() then return true end
	return normalize_steamid(ply:SteamID()) == nil
end

local function get_actor_group(ply)
	if not is_valid_player(ply) then return nil end
	local group = tostring(ply:GetUserGroup() or "")
	if group == "" then return nil end
	return group
end

local function is_staff_player(ply)
	if not is_valid_player(ply) then return false end
	local group = string_lower(tostring(ply:GetUserGroup() or ""))
	return staff_groups[group] == true
end

local function ensure_session_id(ply)
	if not is_valid_player(ply) then return nil end
	local steamid = normalize_steamid(ply:SteamID())
	if not steamid then return nil end

	local current = sessions_by_steamid[steamid]
	if current and current ~= "" then
		return current
	end

	local sid = "sbx_" .. steamid .. "_" .. new_ulid()
	sessions_by_steamid[steamid] = sid
	return sid
end

local function get_session_id(ply)
	if not is_valid_player(ply) then return nil end
	local steamid = normalize_steamid(ply:SteamID())
	if not steamid then return nil end
	return sessions_by_steamid[steamid]
end

local function clear_session_id(ply)
	if not is_valid_player(ply) then return end
	local steamid = normalize_steamid(ply:SteamID())
	if not steamid then return end
	sessions_by_steamid[steamid] = nil
end

local function describe_argument(arg)
	if is_valid_player(arg) then
		return string_format("%s [%s|%s]", arg:Nick(), arg:SteamID(), arg:GetUserGroup())
	end

	if istable(arg) then
		local values = {}
		local count = 0
		for _, entry in pairs(arg) do
			count = count + 1
			if #values < 4 then
				values[#values + 1] = describe_argument(entry)
			end
		end
		if #values == 0 then
			return string_format("table(count=%d)", count)
		end
		local suffix = count > #values and ", ..." or ""
		return string_format("table(count=%d) %s%s", count, table_concat(values, ", "), suffix)
	end

	return tostring(arg)
end

local function normalize_raw_args(raw_args)
	local out = {}
	if not istable(raw_args) then return out end
	for i = 1, #raw_args do
		out[#out + 1] = tostring(raw_args[i])
	end
	return out
end

local function normalize_parsed_args(parsed_args)
	local out = {}
	if not istable(parsed_args) then return out end
	for i = 1, table_maxn(parsed_args) do
		local value = parsed_args[i]
		if value ~= nil then
			out[#out + 1] = describe_argument(value)
		end
	end
	return out
end

local function extract_steamid_from_value(value)
	local as_string = tostring(value or "")
	local steamid = string_match(as_string, "(STEAM_%d:%d:%d+)")
	return steamid
end

local function equals_ignore_case(a, b)
	return string_lower(tostring(a or "")) == string_lower(tostring(b or ""))
end

local function extract_target_steamid(parsed_args, raw_args, actor_ply)
	local actor_steamid = nil
	if is_valid_player(actor_ply) then
		actor_steamid = normalize_steamid(actor_ply:SteamID())
	end
	local raw_target = nil
	if istable(raw_args) and raw_args[1] ~= nil then
		local raw = tostring(raw_args[1] or "")
		raw = raw:gsub("^%s+", ""):gsub("%s+$", "")
		local lower = string_lower(raw)
		if raw ~= "" and lower ~= "none" and lower ~= "unknown" and lower ~= "nenhum" and lower ~= "n/a" then
			raw_target = raw
		end
	end

	local matched_sid = nil
	local first_non_actor_sid = nil
	local first_any_sid = nil

	local function register_sid(sid)
		local normalized = normalize_steamid(sid)
		if not normalized then return end

		if first_any_sid == nil then
			first_any_sid = normalized
		end
		if actor_steamid == nil or normalized ~= actor_steamid then
			if first_non_actor_sid == nil then
				first_non_actor_sid = normalized
			end
		end
		if raw_target and (equals_ignore_case(normalized, raw_target)) then
			matched_sid = normalized
		end
	end

	local function register_player(ply)
		if not is_valid_player(ply) then return end
		local sid = normalize_steamid(ply:SteamID())
		if not sid then return end
		register_sid(sid)
		if raw_target and equals_ignore_case(ply:Nick(), raw_target) then
			matched_sid = sid
		end
	end

	if istable(parsed_args) then
		for i = 1, table_maxn(parsed_args) do
			local value = parsed_args[i]
			if value ~= nil then
				if is_valid_player(value) then
					register_player(value)
				end

				if istable(value) then
					for _, nested in pairs(value) do
						if is_valid_player(nested) then
							register_player(nested)
						end
						local nested_steamid = extract_steamid_from_value(nested)
						if nested_steamid then
							register_sid(nested_steamid)
						end
					end
				end

				local parsed_steamid = extract_steamid_from_value(value)
				if parsed_steamid then
					register_sid(parsed_steamid)
				end
			end
		end
	end

	if istable(raw_args) then
		for i = 1, #raw_args do
			local raw_steamid = extract_steamid_from_value(raw_args[i])
			if raw_steamid then
				register_sid(raw_steamid)
			end
		end
	end

	if matched_sid ~= nil then return matched_sid end
	if first_non_actor_sid ~= nil then return first_non_actor_sid end
	return first_any_sid
end

local function normalize_target_label(label)
	local raw = tostring(label or "")
	raw = raw:gsub("^%s+", ""):gsub("%s+$", "")
	if raw == "" then return nil end

	local lower = string_lower(raw)
	if lower == "none" or lower == "unknown" or lower == "nenhum" or lower == "n/a" then
		return nil
	end

	return raw
end

local function extract_target_label(parsed_args, raw_args, actor_ply)
	local actor_steamid = nil
	if is_valid_player(actor_ply) then
		actor_steamid = normalize_steamid(actor_ply:SteamID())
	end
	local raw_target = nil
	if istable(raw_args) and raw_args[1] ~= nil then
		raw_target = normalize_target_label(raw_args[1])
	end
	local self_requested = raw_target and (equals_ignore_case(raw_target, "me") or equals_ignore_case(raw_target, "self")) or false

	if istable(parsed_args) then
		local names = {}
		local seen = {}

		local function push_name(name, steamid)
			local normalized_sid = normalize_steamid(steamid)
			if normalized_sid and actor_steamid and normalized_sid == actor_steamid and not self_requested then
				local is_actor_explicit_target =
					raw_target ~= nil and (equals_ignore_case(raw_target, normalized_sid) or equals_ignore_case(raw_target, name))
				if not is_actor_explicit_target then
					return
				end
			end

			local normalized = normalize_target_label(name)
			if not normalized then return end
			if seen[normalized] then return end
			seen[normalized] = true
			names[#names + 1] = normalized
		end

		for i = 1, table_maxn(parsed_args) do
			local value = parsed_args[i]
			if value ~= nil then
				if is_valid_player(value) then
					push_name(value:Nick(), value:SteamID())
				elseif istable(value) then
					for _, nested in pairs(value) do
						if is_valid_player(nested) then
							push_name(nested:Nick(), nested:SteamID())
						end
					end
				end
			end
		end

		if #names == 1 then return names[1] end
		if #names > 1 then
			local first = names[1]
			local second = names[2]
			if #names > 2 then
				return string_format("%s, %s (+%d)", first, second, #names - 2)
			end
			return first .. ", " .. second
		end
	end

	if istable(raw_args) and raw_args[1] ~= nil then
		return normalize_target_label(raw_args[1])
	end

	return nil
end

local function build_base_event(log_type, source_tag, actor_type)
	local event = {
		gameMode = INGEST_MODE,
		type = log_type,
		timestamp = now_iso_utc(),
		map = game.GetMap(),
		serverName = (GetHostName and GetHostName()) or "Sandbox",
		playerCount = (player.GetCount and player.GetCount()) or #player.GetAll(),
		rawText = log_type,
		metadata = {
			eventId = new_ulid(),
			schemaVersion = INGEST_SCHEMA_VERSION,
			source = "sam",
			sourceTag = source_tag,
			actorType = actor_type,
		}
	}
	return event
end

local function apply_player_actor(event, ply)
	if not is_valid_player(ply) then return end
	local steamid = normalize_steamid(ply:SteamID())
	if steamid then
		event.steamId = steamid
	end
	event.playerName = ply:Nick()
	local group = get_actor_group(ply)
	if group then
		event.metadata.actorGroup = group
	end
	local session_id = get_session_id(ply)
	if session_id then
		event.sessionId = session_id
		event.metadata.sessionId = session_id
	end
end

local function apply_console_actor(event)
	event.playerName = "Console"
end

local function push_event(event)
	if not is_configured() then return end
	if not event or not event.type or not event.metadata then return end

	queue[#queue + 1] = event
	last_enqueue_realtime = RealTime()
	local warn_size = math_max(1, c_queue_warn_size:GetInt())
	if queue_warn_next < warn_size then
		queue_warn_next = warn_size
	end
	if #queue >= queue_warn_next then
		print(string_format(
			"[BSB-INGEST] queue backlog high size=%d inFlight=%s",
			#queue,
			tostring(send_in_flight)
		))
		queue_warn_next = #queue + 100
	end
	if #queue >= math_max(1, math_min(200, c_batch_size:GetInt())) then
		debug_log("batch threshold reached: " .. tostring(#queue))
	end
end

local function pop_batch()
	if #queue == 0 then return nil end
	local max_batch = math_max(1, math_min(200, c_batch_size:GetInt()))
	local max_payload_bytes = math_max(65536, c_max_payload_bytes:GetInt())

	local batch = {}
	for i = 1, math_min(max_batch, #queue) do
		batch[#batch + 1] = queue[i]
		local candidate_body = util.TableToJSON({events = batch}, false, true)
		if candidate_body and #candidate_body > max_payload_bytes then
			batch[#batch] = nil
			break
		end
	end

	if #batch == 0 then
		batch[1] = queue[1]
	end

	for _ = 1, #batch do
		table.remove(queue, 1)
	end
	if #queue < math_max(1, c_queue_warn_size:GetInt()) then
		queue_warn_next = math_max(1, c_queue_warn_size:GetInt())
	end

	return batch
end

local function retry_delay_seconds(attempt)
	local exp = math_min(attempt, 5)
	local base = math_min(30, 2 ^ exp)
	local jitter = math_random() * (base * 0.25)
	return base + jitter
end

local function get_max_retry_attempts()
	return math_max(0, c_max_retry_attempts:GetInt())
end

local function mark_batch_discarded(batch, attempt, reason)
	local batch_size = (batch and #batch) or 0
	discarded_batches_total = discarded_batches_total + 1
	discarded_events_total = discarded_events_total + batch_size
	print(string_format(
		"[BSB-INGEST] discarded after max retries attempt=%d reason=%s batchSize=%d discardedBatches=%d discardedEvents=%d",
		attempt,
		tostring(reason or "unknown"),
		batch_size,
		discarded_batches_total,
		discarded_events_total
	))
end

local function dispatch_batch(batch, attempt)
	if not batch or #batch == 0 then
		send_in_flight = false
		sending_batch = nil
		return
	end

	local body = util.TableToJSON({events = batch}, false, true)
	if not body then
		send_in_flight = false
		sending_batch = nil
		return
	end

	local key = c_server_key:GetString()
	local url = c_ingest_url:GetString()
	if key == "" or url == "" then
		send_in_flight = false
		sending_batch = nil
		return
	end

	debug_log(string_format("sending batch size=%d attempt=%d", #batch, attempt))

	HTTP({
		url = url,
		method = "POST",
		headers = {
			["Content-Type"] = "application/json",
			["X-Server-Key"] = key,
		},
		body = body,
		success = function(code, response_body)
			if code >= 200 and code < 300 then
				debug_log(string_format("batch ok code=%d body=%s", code, tostring(response_body or "")))
				send_in_flight = false
				sending_batch = nil
				flush_if_needed(true)
				return
			end

			local next_attempt = attempt + 1
			local max_retry_attempts = get_max_retry_attempts()
			if max_retry_attempts > 0 and next_attempt > max_retry_attempts then
				mark_batch_discarded(batch, next_attempt, "http_" .. tostring(code))
				send_in_flight = false
				sending_batch = nil
				flush_if_needed(true)
				return
			end
			local delay = retry_delay_seconds(next_attempt)
			debug_log(string_format("batch http error=%d retry in %.2fs", code, delay))
			timer.Simple(delay, function()
				dispatch_batch(batch, next_attempt)
			end)
		end,
		failed = function(err)
			local next_attempt = attempt + 1
			local max_retry_attempts = get_max_retry_attempts()
			if max_retry_attempts > 0 and next_attempt > max_retry_attempts then
				mark_batch_discarded(batch, next_attempt, tostring(err))
				send_in_flight = false
				sending_batch = nil
				flush_if_needed(true)
				return
			end
			local delay = retry_delay_seconds(next_attempt)
			debug_log(string_format("batch failed err=%s retry in %.2fs", tostring(err), delay))
			timer.Simple(delay, function()
				dispatch_batch(batch, next_attempt)
			end)
		end
	})
end

flush_if_needed = function(force)
	if send_in_flight then return end
	if not is_configured() then return end
	if #queue == 0 then return end

	local flush_seconds = math_max(1, c_flush_seconds:GetFloat())
	local ready_by_time = (RealTime() - last_enqueue_realtime) >= flush_seconds
	local ready_by_size = #queue >= math_max(1, math_min(200, c_batch_size:GetInt()))
	if not force and not ready_by_time and not ready_by_size then
		return
	end

	local batch = pop_batch()
	if not batch or #batch == 0 then return end

	send_in_flight = true
	sending_batch = batch
	dispatch_batch(batch, 0)
end

local function send_heartbeat()
	if not is_configured() then return end
	local heartbeat_url = c_heartbeat_url:GetString()
	if heartbeat_url == "" then return end

	local body = util.TableToJSON({
		map = game.GetMap(),
		playerCount = (player.GetCount and player.GetCount()) or #player.GetAll(),
	}, false, true)

	if not body then return end

	HTTP({
		url = heartbeat_url,
		method = "POST",
		headers = {
			["Content-Type"] = "application/json",
			["X-Server-Key"] = c_server_key:GetString(),
		},
		body = body,
		success = function(code, response_body)
			if code >= 200 and code < 300 then return end
			debug_log(string_format("heartbeat http error=%d body=%s", code, tostring(response_body or "")))
		end,
		failed = function(err)
			debug_log("heartbeat failed: " .. tostring(err))
		end
	})
end

local function poll_server_actions()
	if not c_enable:GetBool() then return end
	if not c_actions_enable:GetBool() then return end

	local actions_url = c_actions_url:GetString()
	local key = c_server_key:GetString()
	if actions_url == "" or key == "" then return end

	HTTP({
		url = actions_url,
		method = "POST",
		headers = {
			["Content-Type"] = "application/json",
			["X-Server-Key"] = key,
		},
		body = "{\"limit\":20}",
		success = function(code, response_body)
			if code < 200 or code >= 300 then
				debug_log(string_format("actions http error=%d body=%s", code, tostring(response_body or "")))
				return
			end

			local parsed = util.JSONToTable(tostring(response_body or ""))
			if not parsed or not istable(parsed.actions) then return end

			for i = 1, #parsed.actions do
				local action = parsed.actions[i]
				if istable(action) then
					local command = tostring(action.command or "")
					command = command:gsub("^%s+", ""):gsub("%s+$", "")
					if command ~= "" then
						debug_log(string_format("executing action id=%s cmd=%s", tostring(action.id or "?"), command))
						game.ConsoleCommand(command .. "\n")
					end
				end
			end
		end,
		failed = function(err)
			debug_log("actions poll failed: " .. tostring(err))
		end
	})
end

local function is_sam_chat_command(text)
	if not sam or not sam.command or not sam.command.get_command then return false end
	if not text or text == "" then return false end
	if text:sub(1, 1) ~= "!" then return false end

	local cmd_name = text:match("^!(%S+)")
	if not cmd_name then return false end
	cmd_name = string_lower(cmd_name)
	return sam.command.get_command(cmd_name) ~= nil
end

local function get_entity_class(ent)
	if ent == nil then return nil end
	if not isentity or not isentity(ent) then return nil end
	if not IsValid(ent) then return nil end
	if not ent.GetClass then return nil end
	local class_name = tostring(ent:GetClass() or "")
	if class_name == "" then return nil end
	return class_name
end

local function get_entity_model(ent)
	if ent == nil then return nil end
	if not isentity or not isentity(ent) then return nil end
	if not IsValid(ent) then return nil end
	if not ent.GetModel then return nil end
	local model = tostring(ent:GetModel() or "")
	if model == "" then return nil end
	return model
end

local function get_entity_index(ent)
	if ent == nil then return nil end
	if not isentity or not isentity(ent) then return nil end
	if not IsValid(ent) then return nil end
	if not ent.EntIndex then return nil end
	local idx = tonumber(ent:EntIndex() or "")
	if not idx then return nil end
	return idx
end

local function get_entity_position(ent)
	if ent == nil then return nil end
	if not isentity or not isentity(ent) then return nil end
	if not IsValid(ent) then return nil end
	if not ent.GetPos then return nil end
	local pos = ent:GetPos()
	if not pos then return nil end
	return {
		x = tonumber(pos.x or 0) or 0,
		y = tonumber(pos.y or 0) or 0,
		z = tonumber(pos.z or 0) or 0,
	}
end

local function get_prop_spawn_max_per_window()
	return math_max(0, c_prop_spawn_max_per_window:GetInt())
end

local function get_prop_spawn_window_seconds()
	return math_max(1, c_prop_spawn_window_seconds:GetFloat())
end

local function summarize_spawn_kind(kind_counts)
	local unique = 0
	local first_kind = nil
	for kind, count in pairs(kind_counts or {}) do
		if (tonumber(count) or 0) > 0 then
			unique = unique + 1
			if first_kind == nil then
				first_kind = tostring(kind)
			end
		end
	end

	if unique == 0 then return "UNKNOWN" end
	if unique == 1 then return first_kind or "UNKNOWN" end
	return "MIXED"
end

local function describe_spawn_kind_pt(kind)
	local normalized = string_upper(tostring(kind or "UNKNOWN"))
	if normalized == "PROP" then return "props" end
	if normalized == "SENT" then return "entidades scriptadas" end
	if normalized == "NPC" then return "NPCs" end
	if normalized == "VEHICLE" then return "veiculos" end
	if normalized == "MIXED" then return "tipos mistos" end
	return "tipo desconhecido"
end

local function flush_prop_spawn_window(steamid, force)
	local sid = normalize_steamid(steamid)
	if not sid then return end

	local record = prop_spawn_window_by_steamid[sid]
	if not record then return end
	local now = RealTime()
	if not force and (now - (record.window_started_at or now)) < (record.window_seconds or 1) then
		return
	end

	prop_spawn_window_by_steamid[sid] = nil

	if (record.dropped_count or 0) <= 0 then return end

	local kind_counts = {}
	for kind, count in pairs(record.kind_counts or {}) do
		kind_counts[tostring(kind)] = tonumber(count) or 0
	end

	local event = build_base_event("GAME_EVENT", "SPAWN", "player")
	event.steamId = sid
	event.playerName = tostring(record.player_name or ("SteamID " .. sid))
	event.metadata.eventKind = "PROP_SPAWN_BURST"
	event.metadata.windowSeconds = tonumber(record.window_seconds) or get_prop_spawn_window_seconds()
	event.metadata.limitPerWindow = tonumber(record.max_per_window) or get_prop_spawn_max_per_window()
	event.metadata.allowedCount = tonumber(record.allowed_count) or 0
	event.metadata.droppedCount = tonumber(record.dropped_count) or 0
	event.metadata.totalObserved = event.metadata.allowedCount + event.metadata.droppedCount
	event.metadata.spawnKind = summarize_spawn_kind(kind_counts)
	event.metadata.spawnKinds = kind_counts
	event.rawText = string_format(
		"%s ultrapassou o limite de logs por spawn de props: %d bloqueados e %d registrados nos ultimos %.1f segundos (limite: %d, tipo: %s).",
		event.playerName or "Jogador",
		event.metadata.droppedCount,
		event.metadata.allowedCount,
		event.metadata.windowSeconds,
		event.metadata.limitPerWindow,
		describe_spawn_kind_pt(event.metadata.spawnKind)
	)
	push_event(event)
end

local function start_prop_spawn_window(ply, sid)
	local window_seconds = get_prop_spawn_window_seconds()
	local max_per_window = get_prop_spawn_max_per_window()
	local window_token = new_ulid()
	local record = {
		window_started_at = RealTime(),
		window_seconds = window_seconds,
		max_per_window = max_per_window,
		allowed_count = 0,
		dropped_count = 0,
		kind_counts = {},
		player_name = is_valid_player(ply) and ply:Nick() or ("SteamID " .. sid),
		window_token = window_token,
	}
	prop_spawn_window_by_steamid[sid] = record

	timer.Simple(window_seconds + 0.05, function()
		local current = prop_spawn_window_by_steamid[sid]
		if not current then return end
		if current.window_token ~= window_token then return end
		flush_prop_spawn_window(sid, false)
	end)

	return record
end

local function consume_prop_spawn_token(ply, spawn_kind)
	local max_per_window = get_prop_spawn_max_per_window()
	if max_per_window <= 0 then
		return true
	end

	local sid = normalize_steamid(is_valid_player(ply) and ply:SteamID() or nil)
	if not sid then
		return true
	end

	local record = prop_spawn_window_by_steamid[sid]
	local now = RealTime()
	if record and (now - (record.window_started_at or now)) >= (record.window_seconds or 1) then
		flush_prop_spawn_window(sid, true)
		record = nil
	end
	if not record then
		record = start_prop_spawn_window(ply, sid)
	end

	local kind = tostring(spawn_kind or "UNKNOWN")
	record.kind_counts[kind] = (record.kind_counts[kind] or 0) + 1
	record.player_name = is_valid_player(ply) and ply:Nick() or record.player_name

	if (record.allowed_count or 0) < (record.max_per_window or max_per_window) then
		record.allowed_count = (record.allowed_count or 0) + 1
		return true
	end

	record.dropped_count = (record.dropped_count or 0) + 1
	if record.dropped_count == 1 then
		debug_log(string_format(
			"prop spawn throttled sid=%s window=%.1fs limit=%d",
			sid,
			tonumber(record.window_seconds) or 0,
			tonumber(record.max_per_window) or 0
		))
	end
	return false
end

local function add_spawn_event(ply, spawn_kind, ent, explicit_model)
	if not c_enable:GetBool() then return end
	if not c_prop_spawn_enable:GetBool() then return end
	if not is_valid_player(ply) then return end
	if is_bot_player(ply) then return end
	if not consume_prop_spawn_token(ply, spawn_kind) then return end

	local class_name = get_entity_class(ent) or "unknown"
	local model_name = tostring(explicit_model or get_entity_model(ent) or "unknown")
	local ent_index = get_entity_index(ent)
	local position = get_entity_position(ent)

	local event = build_base_event("PROP_SPAWN", "SPAWN", "player")
	apply_player_actor(event, ply)
	event.metadata.spawnKind = tostring(spawn_kind or "UNKNOWN")
	event.metadata.entityClass = class_name
	event.metadata.propModel = model_name
	event.metadata.entIndex = ent_index
	event.metadata.position = position
	if model_name ~= "unknown" then
		event.metadata.model = model_name
	end
	event.rawText = string_format(
		"%s spawned %s %s[%s] model=%s",
		event.playerName or "Unknown",
		tostring(spawn_kind or "UNKNOWN"),
		class_name,
		tostring(ent_index or "?"),
		model_name
	)
	push_event(event)
end

local function add_chat_event(ply, text, team_chat, is_dead)
	local event = build_base_event("CHAT", "CHAT", "player")
	apply_player_actor(event, ply)

	local scope = team_chat and "TEAM" or "GLOBAL"
	local life_state = (is_dead == true or (is_valid_player(ply) and not ply:Alive())) and "DEAD" or "ALIVE"

	event.rawText = string_format("%s [%s/%s] %s", event.playerName or "Unknown", scope, life_state, tostring(text or ""))
	event.metadata.message = tostring(text or "")
	event.metadata.chatScope = scope
	event.metadata.lifeState = life_state

	push_event(event)
end

hook.Add("PlayerSay", "bsb_ingest_chat", function(ply, text, team_chat, is_dead)
	if not c_enable:GetBool() then return end
	if not text or text == "" then return end
	if not is_valid_player(ply) then return end
	if is_bot_player(ply) then return end

	if is_sam_chat_command(text) then
		local snapshot = sam_command_counts[ply] or 0
		timer.Simple(0, function()
			if not is_valid_player(ply) then return end
			if (sam_command_counts[ply] or 0) ~= snapshot then return end
			add_chat_event(ply, text, team_chat, is_dead)
		end)
		return
	end

	add_chat_event(ply, text, team_chat, is_dead)
end)

hook.Add("PlayerSpawnedProp", "bsb_ingest_prop_spawn_prop", function(ply, model, ent)
	add_spawn_event(ply, "PROP", ent, model)
end)

hook.Add("PlayerSpawnedSENT", "bsb_ingest_prop_spawn_sent", function(ply, ent)
	add_spawn_event(ply, "SENT", ent, nil)
end)

hook.Add("PlayerSpawnedNPC", "bsb_ingest_prop_spawn_npc", function(ply, ent)
	add_spawn_event(ply, "NPC", ent, nil)
end)

hook.Add("PlayerSpawnedVehicle", "bsb_ingest_prop_spawn_vehicle", function(ply, ent)
	add_spawn_event(ply, "VEHICLE", ent, nil)
end)

hook.Add("PlayerInitialSpawn", "bsb_ingest_connect", function(ply)
	if not c_enable:GetBool() then return end
	if not is_valid_player(ply) then return end
	if is_bot_player(ply) then return end

	local session_id = ensure_session_id(ply)
	if not session_id then return end
	clear_pending_disconnect_reason(ply:SteamID())
	local ip, port = parse_ip_and_port(ply:IPAddress())

	local event = build_base_event("CONNECT", "CONNECT", "player")
	apply_player_actor(event, ply)
	event.sessionId = session_id
	event.metadata.sessionId = session_id
	event.metadata.connectionStage = "initial_spawn"
	if ip then event.metadata.ip = ip end
	if port then event.metadata.port = port end
	event.rawText = string_format("%s connected", ply:Nick())

	push_event(event)
end)

hook.Add("PlayerDisconnected", "bsb_ingest_disconnect", function(ply, reason)
	if not c_enable:GetBool() then return end
	if not is_valid_player(ply) then return end
	if is_bot_player(ply) then
		clear_session_id(ply)
		sam_command_counts[ply] = nil
		return
	end

	local steamid = normalize_steamid(ply:SteamID())
	if not steamid then
		clear_session_id(ply)
		sam_command_counts[ply] = nil
		return
	end
	local session_id = get_session_id(ply)
	if not session_id then
		session_id = "sbx_" .. steamid .. "_recovered"
	end

	local normalized_reason = normalize_disconnect_reason(reason)
	if not normalized_reason then
		normalized_reason = take_pending_disconnect_reason(steamid) or "unknown"
	else
		clear_pending_disconnect_reason(steamid)
	end

	local event = build_base_event("DISCONNECT", "CONNECT", "player")
	apply_player_actor(event, ply)
	event.sessionId = session_id
	event.metadata.sessionId = session_id
	event.metadata.connectionStage = "disconnect"
	event.metadata.reason = normalized_reason
	event.rawText = string_format("%s disconnected reason=%s", ply:Nick(), normalized_reason)

	push_event(event)
	clear_session_id(ply)
	sam_command_counts[ply] = nil
end)

hook.Add("SAM.BannedPlayer", "bsb_ingest_punish_player", function(target, unban_date, reason, admin_steamid)
	if not c_enable:GetBool() then return end
	if not is_valid_player(target) then return end
	if is_bot_player(target) then return end

	local target_steamid = normalize_steamid(target:SteamID())
	if not target_steamid then return end
	local parsed_reason = normalize_disconnect_reason(reason)

	local event = build_base_event("PUNISH", "PUNISH", "system")
	event.metadata.punishmentType = "BAN"
	event.metadata.action = "BAN"
	event.metadata.targetSteamId = target_steamid
	event.metadata.reason = parsed_reason
	event.metadata.durationText = tostring(unban_date or "permanent")
	if unban_date and unban_date > 0 then
		event.metadata.durationMinutes = math_max(math_floor((unban_date - os.time()) / 60), 0)
	else
		event.metadata.durationMinutes = nil
	end

	if admin_steamid and admin_steamid ~= "" then
		local admin = player.GetBySteamID(admin_steamid)
		if is_valid_player(admin) then
			event.metadata.actorType = "player"
			apply_player_actor(event, admin)
		else
			event.metadata.actorType = "player"
			event.steamId = admin_steamid
			event.playerName = "SteamID " .. admin_steamid
		end
	else
		event.metadata.actorType = "console"
		apply_console_actor(event)
	end

	set_pending_disconnect_reason(target_steamid, parsed_reason)
	event.rawText = string_format("%s banned %s reason=%s", event.playerName or "Console", target:Nick(), tostring(parsed_reason or ""))
	push_event(event)
end)

hook.Add("SAM.BannedSteamID", "bsb_ingest_punish_steamid", function(steamid, unban_date, reason, admin_steamid)
	if not c_enable:GetBool() then return end

	local target_steamid = normalize_steamid(steamid)
	if not target_steamid then return end
	local parsed_reason = normalize_disconnect_reason(reason)

	local event = build_base_event("PUNISH", "PUNISH", "system")
	event.metadata.punishmentType = "BAN"
	event.metadata.action = "BAN"
	event.metadata.targetSteamId = target_steamid
	event.metadata.reason = parsed_reason
	event.metadata.durationText = tostring(unban_date or "permanent")
	if unban_date and unban_date > 0 then
		event.metadata.durationMinutes = math_max(math_floor((unban_date - os.time()) / 60), 0)
	else
		event.metadata.durationMinutes = nil
	end

	if admin_steamid and admin_steamid ~= "" then
		local admin = player.GetBySteamID(admin_steamid)
		if is_valid_player(admin) then
			event.metadata.actorType = "player"
			apply_player_actor(event, admin)
		else
			event.metadata.actorType = "player"
			event.steamId = admin_steamid
			event.playerName = "SteamID " .. admin_steamid
		end
	else
		event.metadata.actorType = "console"
		apply_console_actor(event)
	end

	set_pending_disconnect_reason(target_steamid, parsed_reason)
	event.rawText = string_format("%s banned SteamID %s reason=%s", event.playerName or "Console", target_steamid, tostring(parsed_reason or ""))
	push_event(event)
end)

hook.Add("SAM.UnbannedSteamID", "bsb_ingest_unban", function(steamid, admin)
	if not c_enable:GetBool() then return end

	local target_steamid = normalize_steamid(steamid)
	if not target_steamid then return end

	local event = build_base_event("PUNISH", "PUNISH", "system")
	event.metadata.punishmentType = "BAN"
	event.metadata.action = "UNBAN"
	event.metadata.targetSteamId = target_steamid
	event.metadata.reason = nil
	event.metadata.durationText = nil
	event.metadata.durationMinutes = nil

	if is_console_actor(admin) then
		event.metadata.actorType = "console"
		apply_console_actor(event)
	elseif is_valid_player(admin) then
		event.metadata.actorType = "player"
		apply_player_actor(event, admin)
	else
		event.metadata.actorType = "system"
		event.playerName = tostring(admin or "System")
	end

	event.rawText = string_format("%s unbanned SteamID %s", event.playerName or "Console", target_steamid)
	push_event(event)
end)

hook.Add("SAM.RanCommand", "bsb_ingest_command", function(ply, cmd_name, raw_args, cmd, parsed_args)
	if not c_enable:GetBool() then return end

	local command_name = string_lower(tostring(cmd_name or ""))
	local actor_type = "console"
	local actor_is_staff = true
	if is_valid_player(ply) then
		actor_type = "player"
		actor_is_staff = is_staff_player(ply)
	end

	if actor_type == "player" and not actor_is_staff then
		return
	end

	local raw_normalized = normalize_raw_args(raw_args)
	local parsed_normalized = normalize_parsed_args(parsed_args)
	local permission = (cmd and cmd.permission) or "none"

	local punish_type = punish_from_command[command_name]
	local is_punish_command = punish_type ~= nil and not skip_punish_command[command_name]

	if is_punish_command then
		local event = build_base_event("PUNISH", "COMMAND", actor_type)
		if actor_type == "player" then
			apply_player_actor(event, ply)
		else
			apply_console_actor(event)
		end

		local target_steamid = extract_target_steamid(parsed_args, raw_args, ply)
		local target_label = extract_target_label(parsed_args, raw_args, ply)
		local parsed_reason = nil
		if #raw_normalized >= 2 then
			parsed_reason = normalize_disconnect_reason(raw_normalized[#raw_normalized])
		end

		event.metadata.punishmentType = punish_type
		event.metadata.action = string_upper(command_name)
		event.metadata.command = "!" .. tostring(cmd_name or "")
		event.metadata.permission = tostring(permission)
		event.metadata.argsRaw = raw_normalized
		event.metadata.argsParsed = parsed_normalized
		event.metadata.targetSteamId = target_steamid
		event.metadata.targetName = target_label
		event.metadata.reason = parsed_reason

		if punish_type == "MUTE" or punish_type == "GAG" then
			event.metadata.durationText = raw_normalized[2]
			local duration_candidate = tonumber(raw_normalized[2] or "")
			event.metadata.durationMinutes = duration_candidate
		else
			event.metadata.durationText = nil
			event.metadata.durationMinutes = nil
		end

		if (punish_type == "KICK" or punish_type == "BAN") and target_steamid then
			set_pending_disconnect_reason(target_steamid, parsed_reason)
		end

		local target_suffix = target_label and (" em " .. target_label) or ""
		event.rawText = string_format("%s executed !%s%s", event.playerName or "Console", tostring(cmd_name or ""), target_suffix)
		push_event(event)
	else
		local event = build_base_event("COMMAND", "COMMAND", actor_type)
		if actor_type == "player" then
			apply_player_actor(event, ply)
		else
			apply_console_actor(event)
		end

		local target_label = extract_target_label(parsed_args, raw_args, ply)

		event.metadata.command = "!" .. tostring(cmd_name or "")
		event.metadata.permission = tostring(permission)
		event.metadata.argsRaw = raw_normalized
		event.metadata.argsParsed = parsed_normalized
		event.metadata.targetName = target_label
		event.metadata.isStaffAction = true
		local target_suffix = target_label and (" em " .. target_label) or ""
		event.rawText = string_format("%s executed !%s%s", event.playerName or "Console", tostring(cmd_name or ""), target_suffix)
		push_event(event)
	end

	if is_valid_player(ply) then
		sam_command_counts[ply] = (sam_command_counts[ply] or 0) + 1
	end
end)

timer.Create("bsb_ingest_flush", 1, 0, function()
	flush_if_needed(false)
end)

timer.Create("bsb_ingest_heartbeat", math_max(5, c_heartbeat_seconds:GetFloat()), 0, function()
	send_heartbeat()
end)

timer.Create("bsb_ingest_actions_poll", math_max(2, c_actions_seconds:GetFloat()), 0, function()
	poll_server_actions()
end)

hook.Add("ShutDown", "bsb_ingest_shutdown_flush", function()
	flush_if_needed(true)
	-- TODO: disk spool could be added later if guaranteed delivery is needed.
end)

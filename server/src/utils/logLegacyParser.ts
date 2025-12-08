// @ts-nocheck
import { GameMode } from '../domain';

export type LegacyFormat = 'ULX' | 'TAGGED';

export interface LegacyParseOptions {
  defaultGameMode?: GameMode | string;
  timezoneOffsetMinutes?: number | undefined;
  baseDate?: string | undefined; // ISO yyyy-mm-dd; se ausente, usa hoje ou data inferida
}

export interface LegacyParseError {
  line: number;
  text: string;
  reason: string;
}

export interface LegacyParseResult {
  format: LegacyFormat;
  linesParsed: number;
  events: any[];
  byType: Record<string, number>;
  errors: LegacyParseError[];
}

const TIME_RE = /^\[(\d{2}):(\d{2}):(\d{2})]/;

const ulxHeaderRe =
  /^<Logging continued from "data\/ulx_logs\/(\d{2})-(\d{2})-(\d{2})\.txt">/;

const trimBom = (s: string) =>
  s && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;

const buildTimestamp = (
  hh: string | undefined,
  mm: string | undefined,
  ss: string | undefined,
  baseDate?: string | undefined,
  timezoneOffsetMinutes?: number | undefined,
): string => {
  const now = new Date();
  let date: Date;

  if (baseDate) {
    // Interpretamos baseDate como data local e ajustamos hora manualmente
    date = new Date(baseDate + 'T00:00:00');
  } else {
    date = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0,
      0,
      0,
      0,
    );
  }

  const safeH = hh ?? '00';
  const safeM = mm ?? '00';
  const safeS = ss ?? '00';

  date.setHours(Number(safeH), Number(safeM), Number(safeS), 0);

  if (typeof timezoneOffsetMinutes === 'number') {
    // timezoneOffsetMinutes representa offset local (ex.: -180 para BRT).
    // Ajuste para UTC subtraindo o offset.
    date = new Date(date.getTime() - timezoneOffsetMinutes * 60_000);
  }

  return date.toISOString();
};

const inferBaseDateFromUlxHeader = (lines: string[]): string | undefined => {
  for (const raw of lines) {
    const line = trimBom(raw).trim();
    const m = ulxHeaderRe.exec(line);
    if (m) {
      const mm = parseInt(m[1], 10);
      const dd = parseInt(m[2], 10);
      const yy = parseInt(m[3], 10);
      if (
        Number.isFinite(mm) &&
        Number.isFinite(dd) &&
        Number.isFinite(yy) &&
        mm >= 1 &&
        mm <= 12 &&
        dd >= 1 &&
        dd <= 31
      ) {
        const year = 2000 + yy;
        const mmStr = String(mm).padStart(2, '0');
        const ddStr = String(dd).padStart(2, '0');
        return `${year}-${mmStr}-${ddStr}`;
      }
    }
  }
  return undefined;
};

export const detectLegacyFormat = (content: string): LegacyFormat => {
  const lines = content.split(/\r?\n/);
  for (const raw of lines) {
    const line = trimBom(raw).trim();
    if (!line) continue;
    if (ulxHeaderRe.test(line)) {
      return 'ULX';
    }
    if (/^\[\d{2}:\d{2}:\d{2}]\s+\[[A-Z]+]/.test(line)) {
      return 'TAGGED';
    }
    if (/^\[\d{2}:\d{2}:\d{2}]/.test(line)) {
      // Linha com tempo mas sem tag explícita => típico ULX
      return 'ULX';
    }
  }
  // Fallback razoável: ULX
  return 'ULX';
};

export const parseUlxLog = (
  content: string,
  opts: LegacyParseOptions,
): LegacyParseResult => {
  const defaultMode =
    (opts.defaultGameMode as GameMode | undefined) ?? GameMode.TTT;
  const rawLines = content.split(/\r?\n/);
  const lines = rawLines.map((l) => trimBom(l));

  const baseDate: string | undefined =
    opts.baseDate || inferBaseDateFromUlxHeader(lines) || undefined;

  const nameToSteam = new Map<string, string>();
  const byType: Record<string, number> = {};
  const errors: LegacyParseError[] = [];
  const events: any[] = [];

  let currentMap: string | undefined;

  // Sessões de player por steamId (ou nome, se steamId desconhecido)
  const sessions: Record<string, { sessionId: string; startIso: string }> = {};

  const getKeyForPlayer = (name: string, steamId?: string) =>
    steamId || `NAME:${name}`;

  const getSteamId = (name: string | undefined): string | undefined => {
    if (!name) return undefined;
    return nameToSteam.get(name);
  };

  // Primeiro pass: mapear nome -> steamId
  const spawnedRe =
    /^\[\d{2}:\d{2}:\d{2}]\s+Client\s+"(.+)"\s+spawned in server <(STEAM_[^>]+)>/;
  const droppedRe =
    /^\[\d{2}:\d{2}:\d{2}]\s+Dropped\s+"(.+)"\s+from server<(STEAM_[^>]+)>/;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    let m = spawnedRe.exec(line);
    if (m) {
      nameToSteam.set(m[1], m[2]);
      continue;
    }
    m = droppedRe.exec(line);
    if (m) {
      nameToSteam.set(m[1], m[2]);
    }
  }

  // Segundo pass: construir eventos
  const newMapRe =
    /^\[(\d{2}):(\d{2}):(\d{2})]\s+New map:\s+(.+)\s*$/;
  const serverChangingRe =
    /^\[(\d{2}):(\d{2}):(\d{2})]\s+Server is shutting down\/changing levels\./;
  const clientConnectedRe =
    /^\[(\d{2}):(\d{2}):(\d{2})]\s+Client\s+"(.+)"\s+connected\./;
  const chatGlobalRe =
    /^\[(\d{2}):(\d{2}):(\d{2})]\s+([^:]+?):\s+(.+)$/;
  const chatTeamRe =
    /^\[(\d{2}):(\d{2}):(\d{2})]\s+\(TEAM\)\s+([^:]+?):\s+(.+)$/;
  const chatAdminsRe =
    /^\[(\d{2}):(\d{2}):(\d{2})]\s+([^:]+?)\s+to admins:\s+(.+)$/;
  const chatTsayRe =
    /^\[(\d{2}):(\d{2}):(\d{2})]\s+\(tsay from ([^)]+)\)\s+(.+)$/;
  const killRe =
    /^\[(\d{2}):(\d{2}):(\d{2})]\s+(.+)\s+killed\s+(.+)\s+using\s+(.+)$/;
  const suicidedRe =
    /^\[(\d{2}):(\d{2}):(\d{2})]\s+(.+)\s+suicided!$/;

  const ensureSession = (
    name: string,
    steamId: string | undefined,
    isoTs: string,
  ): string => {
    const key = getKeyForPlayer(name, steamId);
    const existing = sessions[key];
    if (existing) return existing.sessionId;
    const sessionId = `legacy:${steamId || name}:${isoTs}`;
    sessions[key] = { sessionId, startIso: isoTs };
    return sessionId;
  };

  const closeSession = (
    name: string,
    steamId: string | undefined,
  ): string | undefined => {
    const key = getKeyForPlayer(name, steamId);
    const existing = sessions[key];
    if (!existing) return undefined;
    delete sessions[key];
    return existing.sessionId;
  };

  lines.forEach((raw, index) => {
    const line = raw.trim();
    const lineNumber = index + 1;
    if (!line) return;

    // Ignorar header ULX
    if (ulxHeaderRe.test(line)) {
      return;
    }

    const timeMatch = TIME_RE.exec(line);
    if (!timeMatch) {
      return;
    }

    const [, hh, mm, ss] = timeMatch;
    const isoTs = buildTimestamp(
      hh,
      mm,
      ss,
      baseDate,
      opts.timezoneOffsetMinutes,
    );

    const makeEvent = (type: string, data: any) => {
      const ev = {
        type,
        timestamp: isoTs,
        gameMode: defaultMode,
        rawText: line,
        ...data,
      };
      events.push(ev);
      byType[type] = (byType[type] || 0) + 1;
    };

    let m: RegExpExecArray | null;

    // Map change / server changing
    m = newMapRe.exec(line);
    if (m) {
      const [, th, tm, ts, mapName] = m;
      const tsIso = buildTimestamp(
        th,
        tm,
        ts,
        baseDate,
        opts.timezoneOffsetMinutes,
      );
      const safeMapName = (mapName ?? '').trim();
      currentMap = safeMapName || currentMap;
      makeEvent('GAME_EVENT', {
        timestamp: tsIso,
        metadata: {
          eventKind: 'MAP_CHANGE',
          map: currentMap,
        },
      });
      return;
    }

    m = serverChangingRe.exec(line);
    if (m) {
      const [, th, tm, ts] = m;
      const tsIso = buildTimestamp(
        th,
        tm,
        ts,
        baseDate,
        opts.timezoneOffsetMinutes,
      );
      makeEvent('GAME_EVENT', {
        timestamp: tsIso,
        metadata: {
          eventKind: 'MAP_CYCLE_END',
          map: currentMap,
        },
      });
      return;
    }

    // CONNECT
    m = clientConnectedRe.exec(line);
    if (m) {
      const [, th, tm, ts, name] = m;
      const tsIso = buildTimestamp(
        th,
        tm,
        ts,
        baseDate,
        opts.timezoneOffsetMinutes,
      );
      const steamId = getSteamId(name);
      const sessionId = ensureSession(name, steamId, tsIso);
      makeEvent('CONNECT', {
        timestamp: tsIso,
        steamId: steamId || null,
        playerName: name,
        metadata: {
          sessionId,
          sessionStart: tsIso,
          map: currentMap,
        },
      });
      return;
    }

    // DISCONNECT
    m = droppedRe.exec(line);
    if (m) {
      const [, name, steam] = m;
      const steamId = steam || getSteamId(name);
      const sessionId = closeSession(name, steamId);
      makeEvent('DISCONNECT', {
        steamId: steamId || null,
        playerName: name,
        metadata: {
          sessionId,
          map: currentMap,
        },
      });
      return;
    }

    // CHAT variants
    m = chatTeamRe.exec(line);
    if (m) {
      const [, th, tm, ts, name, msg] = m;
      const tsIso = buildTimestamp(
        th,
        tm,
        ts,
        baseDate,
        opts.timezoneOffsetMinutes,
      );
      const steamId = getSteamId(name);
      const text = (msg ?? '').trim();
      makeEvent('CHAT', {
        timestamp: tsIso,
        steamId: steamId || null,
        playerName: name,
        metadata: {
          message: text,
          chatChannel: 'TEAM',
          map: currentMap,
        },
      });
      return;
    }

    m = chatAdminsRe.exec(line);
    if (m) {
      const [, th, tm, ts, name, msg] = m;
      const tsIso = buildTimestamp(
        th,
        tm,
        ts,
        baseDate,
        opts.timezoneOffsetMinutes,
      );
      const steamId = getSteamId(name);
      const text = (msg ?? '').trim();
      makeEvent('CHAT', {
        timestamp: tsIso,
        steamId: steamId || null,
        playerName: name,
        metadata: {
          message: text,
          chatChannel: 'ADMINS',
          map: currentMap,
        },
      });
      return;
    }

    m = chatTsayRe.exec(line);
    if (m) {
      const [, th, tm, ts, name, msg] = m;
      const tsIso = buildTimestamp(
        th,
        tm,
        ts,
        baseDate,
        opts.timezoneOffsetMinutes,
      );
      const steamId = getSteamId(name);
      const text = (msg ?? '').trim();
      makeEvent('CHAT', {
        timestamp: tsIso,
        steamId: steamId || null,
        playerName: name,
        metadata: {
          message: text,
          chatChannel: 'TSAY',
          map: currentMap,
        },
      });
      return;
    }

    m = chatGlobalRe.exec(line);
    if (m) {
      const [, th, tm, ts, name, msg] = m;
      const tsIso = buildTimestamp(
        th,
        tm,
        ts,
        baseDate,
        opts.timezoneOffsetMinutes,
      );
      const steamId = getSteamId(name);
      const text = (msg ?? '').trim();

      // Se começar com ! ou /, também registramos COMMAND
      if (text.startsWith('!') || text.startsWith('/')) {
        const tokens = text.split(/\s+/);
        const command = tokens[0];
        const args = tokens.slice(1);
        makeEvent('COMMAND', {
          timestamp: tsIso,
          steamId: steamId || null,
          playerName: name,
          metadata: {
            command,
            args,
            map: currentMap,
          },
        });
      }

      makeEvent('CHAT', {
        timestamp: tsIso,
        steamId: steamId || null,
        playerName: name,
        metadata: {
          message: text,
          chatChannel: 'GLOBAL',
          map: currentMap,
        },
      });
      return;
    }

    // KILL
    m = killRe.exec(line);
    if (m) {
      const [, th, tm, ts, attackerName, victimName, weapon] = m;
      const tsIso = buildTimestamp(
        th,
        tm,
        ts,
        baseDate,
        opts.timezoneOffsetMinutes,
      );
      const attackerSteam = getSteamId(attackerName);
      const victimSteam = getSteamId(victimName);
      const weaponText = (weapon ?? '').trim();

      makeEvent('KILL', {
        timestamp: tsIso,
        steamId: victimSteam || null,
        playerName: victimName,
        metadata: {
          attackerName,
          attackerSteamId: attackerSteam,
          victimName,
          victimSteamId: victimSteam,
          weapon: weaponText,
          map: currentMap,
        },
      });
      return;
    }

    // SUICIDE
    m = suicidedRe.exec(line);
    if (m) {
      const [, th, tm, ts, name] = m;
      const tsIso = buildTimestamp(
        th,
        tm,
        ts,
        baseDate,
        opts.timezoneOffsetMinutes,
      );
      const steamId = getSteamId(name);
      makeEvent('KILL', {
        timestamp: tsIso,
        steamId: steamId || null,
        playerName: name,
        metadata: {
          attackerName: 'world',
          attackerSteamId: undefined,
          victimName: name,
          victimSteamId: steamId,
          weapon: 'suicide',
          map: currentMap,
        },
      });
      return;
    }

    // Outros tipos que não tratamos especificamente: ignorar silenciosamente
    // (poderíamos registrar em errors se quiséssemos debugar)
  });

  return {
    format: 'ULX',
    linesParsed: lines.length,
    events,
    byType,
    errors,
  };
};

export const parseTaggedLog = (
  content: string,
  opts: LegacyParseOptions,
): LegacyParseResult => {
  const defaultMode =
    (opts.defaultGameMode as GameMode | undefined) ?? GameMode.SANDBOX;
  const rawLines = content.split(/\r?\n/);
  const lines = rawLines.map((l) => trimBom(l));

  const baseDate: string | undefined = opts.baseDate ?? undefined;
  const byType: Record<string, number> = {};
  const errors: LegacyParseError[] = [];
  const events: any[] = [];

  const nameSteamRe = /^(.+)\s+\[(STEAM_[^|\]]+)[^]]*]/;
  let currentMap: string | undefined;

  lines.forEach((raw, index) => {
    const line = raw.trim();
    const lineNumber = index + 1;
    if (!line) return;

    const timeMatch = TIME_RE.exec(line);
    if (!timeMatch) return;
    const [, hh, mm, ss] = timeMatch;
    const isoTs = buildTimestamp(
      hh,
      mm,
      ss,
      baseDate,
      opts.timezoneOffsetMinutes,
    );

    const rest = line.replace(TIME_RE, '').trim();
    const tagMatch = /^\[([A-Z_]+)]\s+(.*)$/.exec(rest);
    if (!tagMatch) return;
    const [, tag, payload] = tagMatch;

    const makeEvent = (type: string, data: any) => {
      const ev = {
        type,
        timestamp: isoTs,
        gameMode: defaultMode,
        rawText: line,
        ...data,
      };
      events.push(ev);
      byType[type] = (byType[type] || 0) + 1;
    };

    if (tag === 'CHAT') {
      const m = /^(.+)\s+\[(STEAM_[^|\]]+)[^]]*]\s+\[[^\]]*]\s+(.*)$/.exec(
        payload,
      );
      if (m) {
        const [, name, steamId, msg] = m;
        const text = (msg ?? '').trim();
        makeEvent('CHAT', {
          steamId,
          playerName: name,
          metadata: {
            message: text,
            map: currentMap,
          },
        });
      }
      return;
    }

    if (tag === 'CONNECT') {
      if (/disconnected/.test(payload)) {
        // Desconexão
        const m = nameSteamRe.exec(payload);
        const name = m ? m[1] : undefined;
        const steamId = m ? m[2] : undefined;
        makeEvent('DISCONNECT', {
          steamId: steamId || null,
          playerName: name,
          metadata: {
            reason: /reason=(\w+)/.exec(payload)?.[1],
            map: currentMap,
          },
        });
      } else if (/initial spawn/.test(payload)) {
        const m = nameSteamRe.exec(payload);
        const name = m ? m[1] : undefined;
        const steamId = m ? m[2] : undefined;
        const ipMatch = /ip=([\d.]+):\d+/.exec(payload);
        makeEvent('CONNECT', {
          steamId: steamId || null,
          playerName: name,
          metadata: {
            ip: ipMatch ? ipMatch[1] : undefined,
            map: currentMap,
          },
        });
      } else {
        // authed / connection attempt etc.
        const m = nameSteamRe.exec(payload);
        const name = m ? m[1] : undefined;
        const steamId = m ? m[2] : undefined;
        makeEvent('CONNECT', {
          steamId: steamId || null,
          playerName: name,
          metadata: {
            raw: payload,
            map: currentMap,
          },
        });
      }
      return;
    }

    if (tag === 'SPAWN') {
      // SPAWN AltF4 [STEAM_...|user] spawned PROP prop_physics[661] model=models/...
      const m =
        /^(.+)\s+\[(STEAM_[^|\]]+)[^]]*]\s+spawned\s+\w+\s+[^\s]+\[(\d+)]]?\s+model=([^\s]+).*$/.exec(
          payload,
        ) ||
        /^(.+)\s+\[(STEAM_[^|\]]+)[^]]*]\s+spawned\s+\w+\s+[^\s]+\s+model=([^\s]+).*$/.exec(
          payload,
        );
      if (m) {
        const name = m[1];
        const steamId = m[2];
        const entIndex = m[3] ? Number(m[3]) : undefined;
        const model = m[4] || m[3];
        makeEvent('PROP_SPAWN', {
          steamId,
          playerName: name,
          metadata: {
            propModel: model,
            entIndex,
            map: currentMap,
          },
        });
      } else {
        makeEvent('PROP_SPAWN', {
          metadata: {
            raw: payload,
            map: currentMap,
          },
        });
      }
      return;
    }

    if (tag === 'TOOLS') {
      // TOOLS Name [STEAM_...|user] used property 'drive' on ...
      const m =
        /^(.+)\s+\[(STEAM_[^|\]]+)[^]]*]\s+used property '([^']+)'/.exec(
          payload,
        );
      if (m) {
        const [, name, steamId, toolName] = m;
        makeEvent('TOOL_USE', {
          steamId,
          playerName: name,
          metadata: {
            toolName,
            map: currentMap,
          },
        });
      } else {
        makeEvent('TOOL_USE', {
          metadata: {
            raw: payload,
            map: currentMap,
          },
        });
      }
      return;
    }

    if (tag === 'COMMAND') {
      // COMMAND Name [STEAM_...|rank] executed !cmd ...
      const m =
        /^(.+)\s+\[(STEAM_[^|\]]+)[^]]*]\s+executed\s+(\S+)\s+perm=([^ ]+)\s+raw=\[(.*)]/.exec(
          payload,
        ) ||
        /^(.+)\s+\[(STEAM_[^|\]]+)[^]]*]\s+executed\s+(\S+)/.exec(payload);
      if (m) {
        const name = m[1];
        const steamId = m[2];
        const command = m[3];
        const perm = m[4];
        makeEvent('COMMAND', {
          steamId,
          playerName: name,
          metadata: {
            command,
            perm,
            map: currentMap,
          },
        });
      } else {
        makeEvent('COMMAND', {
          metadata: {
            raw: payload,
            map: currentMap,
          },
        });
      }
      return;
    }

    if (tag === 'PLAYER') {
      // PLAYER Name [STEAM...] died to Other [STEAM...] via ...
      const diedRe =
        /^(.+)\s+\[(STEAM_[^|\]]+)[^]]*]\s+died to\s+(.+?)\s+\[(STEAM_[^|\]]+)[^]]*]\s+via.*model=([^\s]+).*/;
      const m = diedRe.exec(payload);
      if (m) {
        const victimName = m[1];
        const victimSteam = m[2];
        const attackerName = m[3];
        const attackerSteam = m[4];
        const model = m[5];
        makeEvent('KILL', {
          steamId: victimSteam,
          playerName: victimName,
          metadata: {
            attackerName,
            attackerSteamId: attackerSteam,
            victimName,
            victimSteamId: victimSteam,
            weapon: model,
            map: currentMap,
          },
        });
      } else {
        makeEvent('GAME_EVENT', {
          metadata: {
            eventKind: 'PLAYER_EVENT',
            raw: payload,
            map: currentMap,
          },
        });
      }
      return;
    }

    // Qualquer outra tag: armazenar como GAME_EVENT generic
    makeEvent('GAME_EVENT', {
      metadata: {
        tag,
        raw: payload,
        map: currentMap,
      },
    });
  });

  return {
    format: 'TAGGED',
    linesParsed: lines.length,
    events,
    byType,
    errors,
  };
};

export const parseLegacyLog = (
  content: string,
  opts: LegacyParseOptions & { formatHint?: 'AUTO' | 'ULX' | 'TAGGED' },
): LegacyParseResult => {
  const format =
    opts.formatHint && opts.formatHint !== 'AUTO'
      ? (opts.formatHint as LegacyFormat)
      : detectLegacyFormat(content);

  if (format === 'TAGGED') {
    return parseTaggedLog(content, opts);
  }
  return parseUlxLog(content, opts);
};

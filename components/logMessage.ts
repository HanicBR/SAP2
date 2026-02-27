import { LogEntry, LogType } from '../types';

const normalizeText = (value: unknown): string | undefined => {
  const raw = String(value ?? '').trim();
  return raw.length > 0 ? raw : undefined;
};

const getActorName = (log: LogEntry): string => {
  return normalizeText(log.playerName) || (log.metadata.actorType === 'console' ? 'Console' : 'Sistema');
};

const getTargetLabel = (log: LogEntry): string | undefined => {
  const targetName = normalizeText((log.metadata as any).targetName);
  if (targetName) return targetName;
  return normalizeText(log.metadata.targetSteamId);
};

const getReason = (log: LogEntry): string | undefined => {
  return normalizeText(log.metadata.reason);
};

export const formatLogMessage = (log: LogEntry): string => {
  const actor = getActorName(log);
  const target = getTargetLabel(log);
  const reason = getReason(log);

  if (log.type === LogType.CONNECT) {
    return `${actor} conectou`;
  }

  if (log.type === LogType.DISCONNECT) {
    return reason ? `${actor} desconectou (${reason})` : `${actor} desconectou`;
  }

  if (log.type === LogType.COMMAND) {
    const command = normalizeText(log.metadata.command) || 'comando';
    return target ? `${actor} executou ${command} em ${target}` : `${actor} executou ${command}`;
  }

  if (log.type === LogType.PUNISH) {
    const action = normalizeText(log.metadata.action) || normalizeText(log.metadata.punishmentType) || 'PUNIÇÃO';
    const details = reason ? ` (${reason})` : '';
    if (target) {
      return `${actor} aplicou ${action} em ${target}${details}`;
    }
    return `${actor} aplicou ${action}${details}`;
  }

  return normalizeText(log.rawText) || `${actor} (${log.type})`;
};


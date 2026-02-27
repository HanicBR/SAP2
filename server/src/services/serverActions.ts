export interface ServerAction {
  id: string;
  command: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

const actionsByServerId = new Map<string, ServerAction[]>();
const MAX_ACTIONS_PER_SERVER = 200;

const newActionId = () =>
  `act_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export const enqueueServerAction = (
  serverId: string,
  command: string,
  metadata?: Record<string, unknown>,
): ServerAction | null => {
  const parsedServerId = String(serverId || '').trim();
  const parsedCommand = String(command || '').trim();
  if (!parsedServerId || !parsedCommand) return null;

  const queue = actionsByServerId.get(parsedServerId) || [];
  const action: ServerAction = {
    id: newActionId(),
    command: parsedCommand,
    createdAt: new Date().toISOString(),
    ...(metadata ? { metadata } : {}),
  };

  queue.push(action);
  if (queue.length > MAX_ACTIONS_PER_SERVER) {
    queue.splice(0, queue.length - MAX_ACTIONS_PER_SERVER);
  }

  actionsByServerId.set(parsedServerId, queue);
  return action;
};

export const drainServerActions = (serverId: string, limit = 20): ServerAction[] => {
  const parsedServerId = String(serverId || '').trim();
  if (!parsedServerId) return [];

  const queue = actionsByServerId.get(parsedServerId) || [];
  if (!queue.length) return [];

  const take = Math.max(1, Math.min(100, Math.floor(limit)));
  const actions = queue.splice(0, take);
  if (!queue.length) {
    actionsByServerId.delete(parsedServerId);
  } else {
    actionsByServerId.set(parsedServerId, queue);
  }
  return actions;
};

import { prisma } from '../db/client';
import { compareApiKey } from '../utils/apiKey';

export interface AuthenticatedGameServer {
  id: string;
  ip: string;
  name: string;
  mode: string;
  status: string;
  lastHeartbeat: Date | null;
}

export const findServerByApiKey = async (
  apiKey?: string,
): Promise<AuthenticatedGameServer | null> => {
  const parsedApiKey = String(apiKey || '').trim();
  if (!parsedApiKey) return null;

  const allServers = await prisma.gameServer.findMany({
    select: {
      id: true,
      apiKeyHash: true,
      ip: true,
      name: true,
      mode: true,
      status: true,
      lastHeartbeat: true,
    },
  });

  const matched = allServers.find((server) =>
    server.apiKeyHash ? compareApiKey(parsedApiKey, server.apiKeyHash) : false,
  );

  if (!matched) return null;

  const { apiKeyHash, ...sanitized } = matched;
  void apiKeyHash;
  return sanitized;
};


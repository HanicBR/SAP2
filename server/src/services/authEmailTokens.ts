import crypto from 'crypto';
import { UserEmailTokenType } from '@prisma/client';
import { prisma } from '../db/client';

const hashToken = (rawToken: string): string =>
  crypto.createHash('sha256').update(rawToken).digest('hex');

const buildRawToken = (): string => crypto.randomBytes(32).toString('hex');

export interface IssueUserEmailTokenInput {
  userId: string;
  type: UserEmailTokenType;
  ttlMinutes: number;
  metadata?: Record<string, unknown>;
  invalidatePrevious?: boolean;
}

export interface IssuedUserEmailToken {
  rawToken: string;
  tokenHash: string;
  expiresAt: Date;
}

export const issueUserEmailToken = async (
  input: IssueUserEmailTokenInput,
): Promise<IssuedUserEmailToken> => {
  const now = new Date();
  const ttlMinutes = Math.max(1, Number(input.ttlMinutes || 0));
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);
  const rawToken = buildRawToken();
  const tokenHash = hashToken(rawToken);

  if (input.invalidatePrevious !== false) {
    await prisma.userEmailToken.updateMany({
      where: {
        userId: input.userId,
        type: input.type,
        usedAt: null,
      },
      data: {
        usedAt: now,
      },
    });
  }

  await prisma.userEmailToken.create({
    data: {
      userId: input.userId,
      type: input.type,
      tokenHash,
      expiresAt,
      ...(input.metadata ? { metadata: input.metadata as any } : {}),
    },
  });

  return {
    rawToken,
    tokenHash,
    expiresAt,
  };
};

export interface ConsumeUserEmailTokenInput {
  type: UserEmailTokenType;
  rawToken: string;
}

export const consumeUserEmailToken = async (input: ConsumeUserEmailTokenInput) => {
  const rawToken = String(input.rawToken || '').trim();
  if (!rawToken) return null;
  const tokenHash = hashToken(rawToken);

  const token = await prisma.userEmailToken.findUnique({
    where: { tokenHash },
    include: {
      user: true,
    },
  });

  if (!token) return null;
  if (token.type !== input.type) return null;
  if (token.usedAt) return null;
  if (token.expiresAt.getTime() <= Date.now()) return null;

  const updated = await prisma.userEmailToken.updateMany({
    where: {
      id: token.id,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: {
      usedAt: new Date(),
    },
  });

  if (updated.count !== 1) return null;
  return token;
};

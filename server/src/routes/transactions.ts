import { Router } from 'express';
import { prisma } from '../db/client';
import { authMiddleware, requireRole } from '../middleware/auth';
import { UserRole } from '../domain';
import { TransactionType, TransactionCategory } from '@prisma/client';

const router = Router();

router.use(authMiddleware);
router.use(requireRole(UserRole.ADMIN));

router.get('/', async (_req, res) => {
  const transactions = await prisma.transaction.findMany({
    orderBy: { date: 'desc' },
  });

  return res.json(
    transactions.map((t) => ({
      ...t,
      date: t.date.toISOString(),
      createdAt: t.createdAt.toISOString(),
    })),
  );
});

router.post('/', async (req, res) => {
  const {
    date,
    amount,
    type,
    category,
    description,
    proofUrl,
    relatedSteamId,
    relatedPlayerName,
    vipPlan,
    vipDurationDays,
  } = req.body as {
    date?: string;
    amount?: number;
    type?: TransactionType;
    category?: TransactionCategory;
    description?: string;
    proofUrl?: string;
    relatedSteamId?: string;
    relatedPlayerName?: string;
    vipPlan?: string;
    vipDurationDays?: number;
  };

  if (
    amount === undefined ||
    !type ||
    !category ||
    !description ||
    isNaN(Number(amount))
  ) {
    return res.status(400).json({ error: 'Missing or invalid fields' });
  }

  if (!Object.values(TransactionType).includes(type)) {
    return res.status(400).json({ error: 'Invalid type' });
  }

  if (!Object.values(TransactionCategory).includes(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }

  // Only SUPERADMIN can create expenses
  if (type === 'EXPENSE' && req.user?.role !== UserRole.SUPERADMIN) {
    return res.status(403).json({ error: 'Only SUPERADMIN can create expenses' });
  }

  const createdBy = req.user?.id;
  if (!createdBy) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const creator = await prisma.user.findUnique({ where: { id: createdBy } });
  if (!creator) {
    return res.status(401).json({ error: 'Invalid user token (user not found)' });
  }

  const tx = await prisma.transaction.create({
    data: {
      date: date ? new Date(date) : new Date(),
      amount: Number(amount),
      type,
      category,
      description,
      proofUrl: proofUrl || null,
      relatedSteamId: relatedSteamId || null,
      relatedPlayerName: relatedPlayerName || null,
      vipPlan: vipPlan || null,
      vipDurationDays: vipDurationDays || null,
      createdBy,
    },
  });

  // Se for venda de VIP, marca player como VIP
  if (type === 'INCOME' && relatedSteamId && vipPlan) {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + (vipDurationDays || 30));
    await prisma.playerProfile.upsert({
      where: { steamId: relatedSteamId },
      create: {
        steamId: relatedSteamId,
        name: relatedPlayerName || relatedSteamId,
        avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(
          relatedSteamId,
        )}`,
        firstSeen: new Date(),
        lastSeen: new Date(),
        totalConnections: 0,
        playTimeHours: 0,
        isVip: true,
        vipPlan,
        vipExpiry: expiry,
      },
      update: {
        ...(relatedPlayerName ? { name: relatedPlayerName } : {}),
        isVip: true,
        vipPlan,
        vipExpiry: expiry,
      },
    });
  }

  return res.status(201).json({
    ...tx,
    date: tx.date.toISOString(),
    createdAt: tx.createdAt.toISOString(),
  });
});

// Update transaction (ADMIN can update income; SUPERADMIN required for expense)
router.patch('/:id', async (req, res) => {
  const { id } = req.params as { id: string };
  const {
    amount,
    type,
    category,
    description,
    proofUrl,
    relatedSteamId,
    relatedPlayerName,
    vipPlan,
    vipDurationDays,
    date,
  } = req.body as any;

  if (type && !Object.values(TransactionType).includes(type)) {
    return res.status(400).json({ error: 'Invalid type' });
  }
  if (category && !Object.values(TransactionCategory).includes(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  if (type === 'EXPENSE' && req.user?.role !== UserRole.SUPERADMIN) {
    return res.status(403).json({ error: 'Only SUPERADMIN can update expenses' });
  }

  try {
    const data: any = {};
    if (amount !== undefined) data.amount = { set: Number(amount) };
    if (type) data.type = type;
    if (category) data.category = category;
    if (description !== undefined) data.description = description;
    if (proofUrl !== undefined) data.proofUrl = proofUrl ?? null;
    if (relatedSteamId !== undefined) data.relatedSteamId = relatedSteamId ?? null;
    if (relatedPlayerName !== undefined) data.relatedPlayerName = relatedPlayerName ?? null;
    if (vipPlan !== undefined) data.vipPlan = vipPlan ?? null;
    if (vipDurationDays !== undefined) data.vipDurationDays = vipDurationDays ?? null;
    if (date) data.date = new Date(date) as any;

    const updated = await prisma.transaction.update({
      where: { id },
      data,
    });

    return res.json({
      ...updated,
      date: updated.date.toISOString(),
      createdAt: updated.createdAt.toISOString(),
    });
  } catch {
    return res.status(404).json({ error: 'Transaction not found' });
  }
});

// Delete transaction (SUPERADMIN only)
router.delete('/:id', requireRole(UserRole.SUPERADMIN), async (req, res) => {
  const { id } = req.params as { id: string };
  try {
    await prisma.transaction.delete({ where: { id } });
    return res.status(204).send();
  } catch {
    return res.status(404).json({ error: 'Transaction not found' });
  }
});

export default router;

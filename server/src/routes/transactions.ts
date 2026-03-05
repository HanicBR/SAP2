import { Router } from 'express';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import multer from 'multer';
import { prisma } from '../db/client';
import { authMiddleware, requireRole } from '../middleware/auth';
import { UserRole } from '../domain';
import { TransactionType, TransactionCategory } from '@prisma/client';
import { dispatchVipAutomationAction } from '../services/vipAutomation';
import { sendTransactionalEmail } from '../services/email';
import { buildVipPurchaseReceiptTemplate } from '../services/emailTemplates';

const router = Router();
const proofUploadDir =
  process.env.PROOF_UPLOAD_DIR || path.resolve(process.cwd(), 'uploads', 'proofs');
const maxProofUploadMb = Math.max(1, Number(process.env.PROOF_UPLOAD_MAX_MB || 5));
const allowedProofMimeTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);

fs.mkdirSync(proofUploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, proofUploadDir),
  filename: (_req, file, cb) => {
    const safeOriginal = path.basename(file.originalname || '').toLowerCase();
    const originalExt = path.extname(safeOriginal).replace(/[^a-z0-9.]/g, '');
    const fallbackExt = file.mimetype === 'image/png'
      ? '.png'
      : file.mimetype === 'image/webp'
      ? '.webp'
      : file.mimetype === 'image/gif'
      ? '.gif'
      : '.jpg';
    const extension = originalExt || fallbackExt;
    const random = crypto.randomBytes(8).toString('hex');
    cb(null, `${Date.now()}_${random}${extension}`);
  },
});

const uploadProof = multer({
  storage,
  limits: {
    fileSize: maxProofUploadMb * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (!allowedProofMimeTypes.has(String(file.mimetype || '').toLowerCase())) {
      return cb(new Error('INVALID_FILE_TYPE'));
    }
    return cb(null, true);
  },
});

const serializeTransaction = (t: any) => {
  const { user, ...rest } = t;
  return {
    ...rest,
    date: t.date.toISOString(),
    createdAt: t.createdAt.toISOString(),
    createdByName: user?.username,
  };
};

const parseBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const parsePositiveInt = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

router.use(authMiddleware);
router.use(requireRole(UserRole.SUPERADMIN));

router.post('/proof-upload', (req, res) => {
  uploadProof.single('file')(req as any, res as any, (err: any) => {
    if (err) {
      if (err?.code === 'LIMIT_FILE_SIZE') {
        return res
          .status(413)
          .json({ error: `Proof image exceeds ${maxProofUploadMb}MB limit` });
      }
      if (err?.message === 'INVALID_FILE_TYPE') {
        return res
          .status(400)
          .json({ error: 'Unsupported file type. Use PNG, JPG, WEBP or GIF' });
      }
      return res.status(400).json({ error: 'Failed to upload proof image' });
    }

    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      return res.status(400).json({ error: 'Missing file' });
    }

    return res.status(201).json({
      url: `/api/uploads/proofs/${encodeURIComponent(file.filename)}`,
      filename: file.filename,
      size: file.size,
      mime: file.mimetype,
    });
  });
});

router.get('/', async (_req, res) => {
  const transactions = await prisma.transaction.findMany({
    orderBy: { date: 'desc' },
    include: {
      user: {
        select: {
          username: true,
        },
      },
    },
  });

  return res.json(transactions.map(serializeTransaction));
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
    enqueue,
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
    vipDurationDays?: number | string | null;
    enqueue?: boolean | string | number;
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

  const normalizedSteamId = String(relatedSteamId || '').trim();
  const normalizedPlayerName = String(relatedPlayerName || '').trim();
  const normalizedVipPlan = String(vipPlan || '').trim();
  const parsedVipDurationDays = parsePositiveInt(vipDurationDays);
  const shouldEnqueueVipAutomation = parseBoolean(enqueue, true);
  const isVipSale = type === TransactionType.INCOME && !!normalizedSteamId && !!normalizedVipPlan;

  if (
    vipDurationDays !== undefined &&
    vipDurationDays !== null &&
    vipDurationDays !== '' &&
    parsedVipDurationDays === null
  ) {
    return res.status(400).json({ error: 'vipDurationDays must be a positive integer' });
  }

  const resolvedVipDurationDays = isVipSale ? parsedVipDurationDays || 30 : parsedVipDurationDays;

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
      relatedSteamId: normalizedSteamId || null,
      relatedPlayerName: normalizedPlayerName || null,
      vipPlan: normalizedVipPlan || null,
      vipDurationDays: resolvedVipDurationDays,
      createdBy,
    },
    include: {
      user: {
        select: {
          username: true,
        },
      },
    },
  });

  let vipDispatch:
    | {
        queued: boolean;
        skipped?: boolean;
        reason?: string;
        serverId?: string;
        actionId?: string;
        vipActionId?: string;
      }
    | undefined;

  // Se for venda de VIP, marca player como VIP
  if (isVipSale) {
    const existingPlayer = await prisma.playerProfile.findUnique({
      where: { steamId: normalizedSteamId },
      select: { vipExpiry: true },
    });
    const now = new Date();
    const expiryBase =
      existingPlayer?.vipExpiry && existingPlayer.vipExpiry.getTime() > now.getTime()
        ? existingPlayer.vipExpiry
        : now;
    const expiry = new Date(
      expiryBase.getTime() + Number(resolvedVipDurationDays || 30) * 24 * 60 * 60 * 1000,
    );

    await prisma.playerProfile.upsert({
      where: { steamId: normalizedSteamId },
      create: {
        steamId: normalizedSteamId,
        name: normalizedPlayerName || normalizedSteamId,
        avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(
          normalizedSteamId,
        )}`,
        firstSeen: new Date(),
        lastSeen: new Date(),
        totalConnections: 0,
        playTimeHours: 0,
        isVip: true,
        vipPlan: normalizedVipPlan,
        vipExpiry: expiry,
      },
      update: {
        ...(normalizedPlayerName ? { name: normalizedPlayerName } : {}),
        isVip: true,
        vipPlan: normalizedVipPlan,
        vipExpiry: expiry,
      },
    });

    if (shouldEnqueueVipAutomation) {
      try {
        const dispatch = await dispatchVipAutomationAction({
          action: 'GRANT',
          steamId: normalizedSteamId,
          vipPlan: normalizedVipPlan,
          vipExpiry: expiry,
          metadata: {
            trigger: 'transaction_create',
            transactionId: tx.id,
            category,
          },
        });

        vipDispatch = {
          queued: dispatch.queued,
          ...(dispatch.skipped ? { skipped: true } : {}),
          ...(dispatch.reason ? { reason: dispatch.reason } : {}),
          ...(dispatch.serverId ? { serverId: dispatch.serverId } : {}),
          ...(dispatch.actionId ? { actionId: dispatch.actionId } : {}),
          ...(dispatch.vipActionId ? { vipActionId: dispatch.vipActionId } : {}),
        };
      } catch (err: any) {
        console.error('VIP automation dispatch failed', err);
        vipDispatch = {
          queued: false,
          reason: 'dispatch_error',
        };
      }
    } else {
      vipDispatch = {
        queued: false,
        skipped: true,
        reason: 'manual_enqueue_disabled',
      };
    }
  }

  // Email notifications are best-effort and must never break transaction creation.
  const emailJobs: Promise<any>[] = [];

  if (creator.email) {
    emailJobs.push(
      sendTransactionalEmail({
        to: creator.email,
        subject: `Transacao registrada [${tx.type}] - ${tx.id}`,
        text: [
          `Uma transacao foi registrada no painel Backstabber Brasil.`,
          `ID: ${tx.id}`,
          `Tipo: ${tx.type}`,
          `Categoria: ${tx.category}`,
          `Valor: R$ ${Number(tx.amount).toFixed(2)}`,
          `Descricao: ${tx.description}`,
          `Data: ${tx.date.toISOString()}`,
          normalizedSteamId ? `SteamID relacionado: ${normalizedSteamId}` : 'SteamID relacionado: -',
          normalizedPlayerName ? `Jogador relacionado: ${normalizedPlayerName}` : 'Jogador relacionado: -',
        ].join('\n'),
      }),
    );
  }

  if (isVipSale) {
    const linkedUser = await prisma.user.findFirst({
      where: {
        steamId64: normalizedSteamId,
      },
      select: {
        email: true,
        username: true,
      },
    });

    if (linkedUser?.email) {
      const receipt = buildVipPurchaseReceiptTemplate({
        username: linkedUser.username,
        plan: normalizedVipPlan,
        ...(resolvedVipDurationDays ? { durationDays: Number(resolvedVipDurationDays) } : {}),
        amount: Number(tx.amount),
        transactionDateIso: tx.date.toISOString(),
      });
      emailJobs.push(
        sendTransactionalEmail({
          to: linkedUser.email,
          subject: receipt.subject,
          text: receipt.text,
          html: receipt.html,
        }),
      );
    }
  }

  if (emailJobs.length > 0) {
    Promise.allSettled(emailJobs).catch(() => undefined);
  }

  return res.status(201).json({
    ...serializeTransaction(tx),
    ...(vipDispatch ? { dispatch: vipDispatch } : {}),
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
      include: {
        user: {
          select: {
            username: true,
          },
        },
      },
    });

    return res.json(serializeTransaction(updated));
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

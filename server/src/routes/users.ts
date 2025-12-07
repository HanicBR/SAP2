import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../db/client';
import { User, UserRole } from '../domain';
import { authMiddleware, requireRole } from '../middleware/auth';

const router = Router();

const toPublicUser = (record: any): User => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash, ...rest } = record;
  return rest as User;
};

router.use(authMiddleware);
router.use(requireRole(UserRole.ADMIN));

router.get('/', async (_req, res) => {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
  });
  return res.json(users.map(toPublicUser));
});

router.post('/', requireRole(UserRole.SUPERADMIN), async (req, res) => {
  const { username, email, password, role } = req.body as {
    username?: string;
    email?: string;
    password?: string;
    role?: UserRole;
  };

  if (!username || !email || !password || !role) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  if (!Object.values(UserRole).includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  const existing = await prisma.user.findFirst({
    where: {
      OR: [{ email }, { username }],
    },
  });
  if (existing) {
    return res.status(409).json({ error: 'User already exists' });
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  const avatarUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(
    username,
  )}`;

  const created = await prisma.user.create({
    data: {
      username,
      email,
      role,
      avatarUrl,
      passwordHash,
    },
  });

  return res.status(201).json(toPublicUser(created));
});

router.patch('/:id/role', requireRole(UserRole.SUPERADMIN), async (req, res) => {
  const { id } = req.params as { id: string };
  const role = (req.body as { role?: UserRole }).role;

  if (!role || !Object.values(UserRole).includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  try {
    const updated = await prisma.user.update({
      where: { id },
      data: { role },
    });
    return res.json(toPublicUser(updated));
  } catch (err) {
    return res.status(404).json({ error: 'User not found' });
  }
});

export default router;

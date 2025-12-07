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

// Update user (username, email, role, password) - SUPERADMIN only
router.patch('/:id', requireRole(UserRole.SUPERADMIN), async (req, res) => {
  const { id } = req.params as { id: string };
  const { username, email, role, password } = req.body as {
    username?: string;
    email?: string;
    role?: UserRole;
    password?: string;
  };

  // Prevent superadmin from deleting or downgrading themselves via this endpoint
  if (req.user?.id === id && role && role !== UserRole.SUPERADMIN) {
    return res.status(400).json({ error: 'Cannot change your own role' });
  }

  const data: any = {};
  if (username) data.username = username;
  if (email) data.email = email;
  if (role) {
    if (!Object.values(UserRole).includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    data.role = role;
  }
  if (password) {
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    data.passwordHash = bcrypt.hashSync(password, 10);
  }

  // Unique checks if username/email provided
  if (username || email) {
    const existing = await prisma.user.findFirst({
      where: {
        AND: [
          { id: { not: id } },
          {
            OR: [
              ...(username ? [{ username }] : []),
              ...(email ? [{ email }] : []),
            ],
          },
        ],
      },
    });
    if (existing) {
      return res.status(409).json({ error: 'Username or email already in use' });
    }
  }

  try {
    const updated = await prisma.user.update({
      where: { id },
      data,
    });
    return res.json(toPublicUser(updated));
  } catch (err) {
    return res.status(404).json({ error: 'User not found' });
  }
});

// Delete user - SUPERADMIN only
router.delete('/:id', requireRole(UserRole.SUPERADMIN), async (req, res) => {
  const { id } = req.params as { id: string };

  if (req.user?.id === id) {
    return res.status(400).json({ error: 'Cannot delete yourself' });
  }

  try {
    await prisma.user.delete({ where: { id } });
    return res.status(204).send();
  } catch (err) {
    return res.status(404).json({ error: 'User not found' });
  }
});

export default router;

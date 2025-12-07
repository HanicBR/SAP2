import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../db/client';
import { User, UserRole } from '../domain';
import { authMiddleware } from '../middleware/auth';

const router = Router();

const getJwtSecret = () => process.env.JWT_SECRET || 'dev-secret-change-me';
const getJwtExpiresIn = () => process.env.JWT_EXPIRES_IN || '7d';

const signToken = (payload: object): string => {
  // Cast options to any to avoid friction with overloaded typings
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: getJwtExpiresIn(),
  } as any);
};

const toPublicUser = (record: any): User => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash, ...rest } = record;
  return rest as User;
};

router.post('/login', async (req, res) => {
  const { emailOrUser, password } = req.body as {
    emailOrUser?: string;
    password?: string;
  };

  if (!emailOrUser || !password) {
    return res.status(400).json({ error: 'Missing credentials' });
  }

  const userRecord = await prisma.user.findFirst({
    where: {
      OR: [
        { email: emailOrUser },
        { username: emailOrUser },
      ],
    },
  });

  if (!userRecord) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const ok = bcrypt.compareSync(password, userRecord.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const payload = {
    id: userRecord.id,
    username: userRecord.username,
    email: userRecord.email,
    role: userRecord.role,
  };

  const token = signToken(payload);
  return res.json({ user: toPublicUser(userRecord), token });
});

router.post('/register', async (req, res) => {
  const { username, email, password } = req.body as {
    username?: string;
    email?: string;
    password?: string;
  };

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
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

  const record = await prisma.user.create({
    data: {
      username,
      email,
      role: UserRole.USER,
      avatarUrl,
      passwordHash,
      mustChangePassword: false,
    },
  });

  const payload = {
    id: record.id,
    username: record.username,
    email: record.email,
    role: record.role,
  };

  const token = signToken(payload);
  return res.status(201).json({ user: toPublicUser(record), token });
});

router.get('/me', (req, res) => {
  // For simplicity this endpoint can be implemented later using authMiddleware
  return res.status(501).json({ error: 'Not implemented' });
});

// Change password (autenticado)
router.post('/change-password', authMiddleware, async (req, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { currentPassword, newPassword } = req.body as {
    currentPassword?: string;
    newPassword?: string;
  };

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const userRecord = await prisma.user.findUnique({ where: { id: user.id } });
  if (!userRecord) {
    return res.status(404).json({ error: 'User not found' });
  }

  const ok = bcrypt.compareSync(currentPassword, userRecord.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: 'Invalid current password' });
  }

  const newHash = bcrypt.hashSync(newPassword, 10);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: newHash, mustChangePassword: false },
  });

  return res.json({ user: toPublicUser(updated) });
});

export default router;

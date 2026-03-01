import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { UserEmailTokenType } from '@prisma/client';
import { prisma } from '../db/client';
import { User, UserRole } from '../domain';
import { authMiddleware } from '../middleware/auth';
import {
  consumeUserEmailToken,
  issueUserEmailToken,
  validateUserEmailToken,
} from '../services/authEmailTokens';
import { buildFrontendAppUrl, sendTransactionalEmail } from '../services/email';
import {
  buildEmailVerificationTemplate,
  buildPasswordChangedTemplate,
  buildPasswordResetTemplate,
} from '../services/emailTemplates';

const router = Router();

const getJwtSecret = () => process.env.JWT_SECRET || 'dev-secret-change-me';
const getJwtExpiresIn = () => process.env.JWT_EXPIRES_IN || '7d';

const parseIntEnv = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const parseBoolEnv = (value: string | undefined, fallback: boolean): boolean => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
};

const normalizeEmail = (value: string | undefined): string => String(value || '').trim().toLowerCase();
const normalizeUsername = (value: string | undefined): string => String(value || '').trim();
const isValidEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const isPublicRegisterEnabled = (): boolean => {
  const fallback = process.env.NODE_ENV !== 'production';
  return parseBoolEnv(process.env.AUTH_REGISTER_ENABLED, fallback);
};

const isEmailVerificationRequired = (): boolean =>
  parseBoolEnv(process.env.AUTH_REQUIRE_EMAIL_VERIFICATION, false);

const getVerifyTokenTtlMinutes = (): number =>
  parseIntEnv(process.env.AUTH_VERIFY_EMAIL_TTL_MINUTES, 60 * 24);

const getResetTokenTtlMinutes = (): number =>
  parseIntEnv(process.env.AUTH_RESET_PASSWORD_TTL_MINUTES, 30);

const loginLimiter = rateLimit({
  windowMs: parseIntEnv(process.env.AUTH_LOGIN_RATE_WINDOW_MS, 60_000),
  max: parseIntEnv(process.env.AUTH_LOGIN_RATE_MAX, 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait and try again.' },
});

const resendVerifyLimiter = rateLimit({
  windowMs: parseIntEnv(process.env.AUTH_RESEND_VERIFY_RATE_WINDOW_MS, 10 * 60_000),
  max: parseIntEnv(process.env.AUTH_RESEND_VERIFY_RATE_MAX, 5),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait before trying again.' },
});

const requestPasswordResetLimiter = rateLimit({
  windowMs: parseIntEnv(process.env.AUTH_RESET_REQUEST_RATE_WINDOW_MS, 10 * 60_000),
  max: parseIntEnv(process.env.AUTH_RESET_REQUEST_RATE_MAX, 8),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait before trying again.' },
});

const signToken = (payload: object): string => {
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: getJwtExpiresIn(),
  } as any);
};

const toPublicUser = (record: any): User => ({
  id: String(record.id),
  username: String(record.username),
  email: String(record.email),
  ...(record.emailVerifiedAt instanceof Date
    ? { emailVerifiedAt: record.emailVerifiedAt.toISOString() }
    : {}),
  role: record.role as UserRole,
  ...(record.mustChangePassword !== undefined
    ? { mustChangePassword: Boolean(record.mustChangePassword) }
    : {}),
  createdAt:
    record.createdAt instanceof Date
      ? record.createdAt.toISOString()
      : String(record.createdAt || new Date().toISOString()),
  ...(record.avatarUrl ? { avatarUrl: String(record.avatarUrl) } : {}),
  ...(record.steamId64 ? { steamId64: String(record.steamId64) } : {}),
  ...(record.steamProfileUrl ? { steamProfileUrl: String(record.steamProfileUrl) } : {}),
  ...(record.steamAvatarUrl ? { steamAvatarUrl: String(record.steamAvatarUrl) } : {}),
  ...(record.steamPersonaName ? { steamPersonaName: String(record.steamPersonaName) } : {}),
  ...(record.steamLinkedAt instanceof Date
    ? { steamLinkedAt: record.steamLinkedAt.toISOString() }
    : {}),
  ...(record.steamLastSyncAt instanceof Date
    ? { steamLastSyncAt: record.steamLastSyncAt.toISOString() }
    : {}),
});

const sendEmailVerificationForUser = async (userRecord: {
  id: string;
  email: string;
  username: string;
}) => {
  const email = normalizeEmail(userRecord.email);
  if (!email) return { ok: false, error: 'missing_email' };

  const ttlMinutes = getVerifyTokenTtlMinutes();
  const issued = await issueUserEmailToken({
    userId: userRecord.id,
    type: UserEmailTokenType.EMAIL_VERIFY,
    ttlMinutes,
    invalidatePrevious: true,
  });

  const verifyUrl = buildFrontendAppUrl('/verify-email', { token: issued.rawToken });
  const template = buildEmailVerificationTemplate({
    username: userRecord.username,
    verifyUrl,
    expiresMinutes: ttlMinutes,
  });

  return sendTransactionalEmail({
    to: email,
    subject: template.subject,
    text: template.text,
    html: template.html,
  });
};

const sendPasswordResetForUser = async (userRecord: {
  id: string;
  email: string;
  username: string;
}) => {
  const email = normalizeEmail(userRecord.email);
  if (!email) return { ok: false, error: 'missing_email' };

  const ttlMinutes = getResetTokenTtlMinutes();
  const issued = await issueUserEmailToken({
    userId: userRecord.id,
    type: UserEmailTokenType.PASSWORD_RESET,
    ttlMinutes,
    invalidatePrevious: true,
  });

  const resetUrl = buildFrontendAppUrl('/reset-password', { token: issued.rawToken });
  const template = buildPasswordResetTemplate({
    username: userRecord.username,
    resetUrl,
    expiresMinutes: ttlMinutes,
  });

  return sendTransactionalEmail({
    to: email,
    subject: template.subject,
    text: template.text,
    html: template.html,
  });
};

const sendPasswordChangedNotice = async (userRecord: { email: string; username: string }) => {
  const email = normalizeEmail(userRecord.email);
  if (!email) return;
  const template = buildPasswordChangedTemplate({ username: userRecord.username });
  await sendTransactionalEmail({
    to: email,
    subject: template.subject,
    text: template.text,
    html: template.html,
  });
};

router.post('/login', loginLimiter, async (req, res) => {
  const { emailOrUser, password } = req.body as {
    emailOrUser?: string;
    password?: string;
  };

  const identifier = String(emailOrUser || '').trim();
  if (!identifier || !password) {
    return res.status(400).json({ error: 'Missing credentials' });
  }

  const normalizedEmail = normalizeEmail(identifier);
  const userRecord = await prisma.user.findFirst({
    where: {
      OR: [
        { email: identifier },
        { email: normalizedEmail },
        { username: identifier },
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

  if (isEmailVerificationRequired() && userRecord.role === UserRole.USER && !userRecord.emailVerifiedAt) {
    return res.status(403).json({
      error: 'Email not verified. Please confirm your email before login.',
      code: 'EMAIL_NOT_VERIFIED',
    });
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
  if (!isPublicRegisterEnabled()) {
    return res.status(403).json({ error: 'Public registration is disabled' });
  }

  const { username, email, password } = req.body as {
    username?: string;
    email?: string;
    password?: string;
  };

  const normalizedUsername = normalizeUsername(username);
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedUsername || !normalizedEmail || !password) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  if (!isValidEmail(normalizedEmail)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const existing = await prisma.user.findFirst({
    where: {
      OR: [{ email: normalizedEmail }, { username: normalizedUsername }],
    },
  });
  if (existing) {
    return res.status(409).json({ error: 'User already exists' });
  }

  const requireVerified = isEmailVerificationRequired();
  const passwordHash = bcrypt.hashSync(password, 10);
  const avatarUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(
    normalizedUsername,
  )}`;

  const record = await prisma.user.create({
    data: {
      username: normalizedUsername,
      email: normalizedEmail,
      role: UserRole.USER,
      avatarUrl,
      passwordHash,
      ...(requireVerified ? {} : { emailVerifiedAt: new Date() }),
      mustChangePassword: false,
    },
  });

  const verificationResult = await sendEmailVerificationForUser({
    id: record.id,
    username: record.username,
    email: record.email,
  });

  if (requireVerified) {
    return res.status(201).json({
      user: toPublicUser(record),
      token: null,
      requiresEmailVerification: true,
      verificationEmailSent: verificationResult.ok,
    });
  }

  const payload = {
    id: record.id,
    username: record.username,
    email: record.email,
    role: record.role,
  };

  const token = signToken(payload);
  return res.status(201).json({
    user: toPublicUser(record),
    token,
    requiresEmailVerification: false,
    verificationEmailSent: verificationResult.ok,
  });
});

router.post('/resend-verification', resendVerifyLimiter, async (req, res) => {
  const { emailOrUser } = req.body as { emailOrUser?: string };
  const identifier = String(emailOrUser || '').trim();
  if (!identifier) {
    return res.status(200).json({ ok: true, message: 'If the account exists, an email was sent.' });
  }

  const normalizedEmail = normalizeEmail(identifier);
  const userRecord = await prisma.user.findFirst({
    where: {
      OR: [{ email: identifier }, { email: normalizedEmail }, { username: identifier }],
    },
    select: {
      id: true,
      email: true,
      username: true,
      emailVerifiedAt: true,
    },
  });

  if (userRecord && !userRecord.emailVerifiedAt) {
    await sendEmailVerificationForUser({
      id: userRecord.id,
      email: userRecord.email,
      username: userRecord.username,
    });
  }

  return res.status(200).json({ ok: true, message: 'If the account exists, an email was sent.' });
});

const handleVerifyEmail = async (rawToken: string) => {
  const token = await consumeUserEmailToken({
    type: UserEmailTokenType.EMAIL_VERIFY,
    rawToken,
  });

  if (!token) return null;

  return prisma.user.update({
    where: { id: token.userId },
    data: {
      emailVerifiedAt: new Date(),
    },
  });
};

router.get('/verify-email', async (req, res) => {
  const token = String(req.query.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Missing token' });

  const updated = await handleVerifyEmail(token);
  if (!updated) {
    return res.status(400).json({ error: 'Invalid or expired token' });
  }

  return res.json({ ok: true, user: toPublicUser(updated) });
});

router.post('/verify-email', async (req, res) => {
  const token = String((req.body as { token?: string })?.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Missing token' });

  const updated = await handleVerifyEmail(token);
  if (!updated) {
    return res.status(400).json({ error: 'Invalid or expired token' });
  }

  return res.json({ ok: true, user: toPublicUser(updated) });
});

router.post('/request-password-reset', requestPasswordResetLimiter, async (req, res) => {
  const { emailOrUser } = req.body as { emailOrUser?: string };
  const identifier = String(emailOrUser || '').trim();

  if (!identifier) {
    return res.status(200).json({ ok: true, message: 'If the account exists, an email was sent.' });
  }

  const normalizedEmail = normalizeEmail(identifier);
  const userRecord = await prisma.user.findFirst({
    where: {
      OR: [{ email: identifier }, { email: normalizedEmail }, { username: identifier }],
    },
    select: {
      id: true,
      email: true,
      username: true,
    },
  });

  if (userRecord) {
    await sendPasswordResetForUser(userRecord);
  }

  return res.status(200).json({ ok: true, message: 'If the account exists, an email was sent.' });
});

router.get('/reset-password/validate', async (req, res) => {
  const token = String(req.query.token || '').trim();
  const validation = await validateUserEmailToken(UserEmailTokenType.PASSWORD_RESET, token);
  return res.json({
    ok: validation.valid,
    ...(validation.reason ? { reason: validation.reason } : {}),
  });
});

router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body as {
    token?: string;
    newPassword?: string;
  };

  const rawToken = String(token || '').trim();
  const parsedPassword = String(newPassword || '');

  if (!rawToken || !parsedPassword) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  if (parsedPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const consumed = await consumeUserEmailToken({
    type: UserEmailTokenType.PASSWORD_RESET,
    rawToken,
  });

  if (!consumed) {
    return res.status(400).json({ error: 'Invalid or expired token' });
  }

  const newHash = bcrypt.hashSync(parsedPassword, 10);
  const updated = await prisma.user.update({
    where: { id: consumed.userId },
    data: {
      passwordHash: newHash,
      mustChangePassword: false,
    },
  });

  await sendPasswordChangedNotice({
    email: updated.email,
    username: updated.username,
  });

  return res.json({ ok: true, user: toPublicUser(updated) });
});

router.get('/me', authMiddleware, async (req, res) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const userRecord = await prisma.user.findUnique({ where: { id: user.id } });
  if (!userRecord) {
    return res.status(404).json({ error: 'User not found' });
  }

  return res.json({ user: toPublicUser(userRecord) });
});

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

  await sendPasswordChangedNotice({
    email: updated.email,
    username: updated.username,
  });

  return res.json({ user: toPublicUser(updated) });
});

export default router;

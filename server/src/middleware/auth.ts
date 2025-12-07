import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UserRole } from '../domain';
import { prisma } from '../db/client';

export interface AuthUserPayload {
  id: string;
  username: string;
  email: string;
  role: UserRole;
}

declare module 'express-serve-static-core' {
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Request {
    user?: AuthUserPayload;
  }
}

const getJwtSecret = () => process.env.JWT_SECRET || 'dev-secret-change-me';

export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }

  const token = header.slice('Bearer '.length);

  try {
    const payload = jwt.verify(token, getJwtSecret()) as AuthUserPayload;

    // Validate user still exists in DB
    const user = await prisma.user.findUnique({ where: { id: payload.id } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid token (user not found)' });
    }

    req.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role as unknown as UserRole,
    };
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export const requireRole =
  (minRole: UserRole) => (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const order = [UserRole.USER, UserRole.ADMIN, UserRole.SUPERADMIN];
    const userIndex = order.indexOf(user.role);
    const minIndex = order.indexOf(minRole);

    if (userIndex < minIndex) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    return next();
  };

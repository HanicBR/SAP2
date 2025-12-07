import { Router } from 'express';
import { prisma } from '../db/client';
import { SiteConfig, UserRole } from '../domain';
import { authMiddleware, requireRole } from '../middleware/auth';
import { bootstrap } from '../bootstrap';

const router = Router();

router.get('/', async (_req, res) => {
  // Ensure there is at least one config
  const existing = await prisma.siteConfig.findUnique({ where: { id: 1 } });
  if (!existing) {
    await bootstrap();
  }
  const config = await prisma.siteConfig.findUnique({ where: { id: 1 } });
  return res.json((config?.data as unknown as SiteConfig) || ({} as SiteConfig));
});

router.put('/', authMiddleware, requireRole(UserRole.ADMIN), async (req, res) => {
  const body = req.body as SiteConfig;
  const updated = await prisma.siteConfig.upsert({
    where: { id: 1 },
    update: { data: body as any },
    create: { id: 1, data: body as any },
  });
  return res.json(updated.data as unknown as SiteConfig);
});

export default router;

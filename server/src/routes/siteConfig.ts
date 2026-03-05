import { Router } from 'express';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import multer from 'multer';
import { prisma } from '../db/client';
import { SiteConfig, UserRole } from '../domain';
import { authMiddleware, requireRole } from '../middleware/auth';
import { bootstrap } from '../bootstrap';

const router = Router();
const siteAssetsUploadDir =
  process.env.SITE_ASSETS_UPLOAD_DIR || path.resolve(process.cwd(), 'uploads', 'site-assets');
const maxSiteLogoUploadMb = Math.max(1, Number(process.env.SITE_LOGO_UPLOAD_MAX_MB || 5));
const allowedSiteLogoMimeTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
]);

fs.mkdirSync(siteAssetsUploadDir, { recursive: true });

const logoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, siteAssetsUploadDir),
  filename: (_req, file, cb) => {
    const safeOriginal = path.basename(file.originalname || '').toLowerCase();
    const originalExt = path.extname(safeOriginal).replace(/[^a-z0-9.]/g, '');
    const fallbackExt = file.mimetype === 'image/png'
      ? '.png'
      : file.mimetype === 'image/webp'
      ? '.webp'
      : file.mimetype === 'image/gif'
      ? '.gif'
      : file.mimetype === 'image/svg+xml'
      ? '.svg'
      : file.mimetype === 'image/x-icon' || file.mimetype === 'image/vnd.microsoft.icon'
      ? '.ico'
      : '.jpg';
    const extension = originalExt || fallbackExt;
    const random = crypto.randomBytes(8).toString('hex');
    cb(null, `${Date.now()}_${random}${extension}`);
  },
});

const uploadLogo = multer({
  storage: logoStorage,
  limits: {
    fileSize: maxSiteLogoUploadMb * 1024 * 1024,
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (!allowedSiteLogoMimeTypes.has(String(file.mimetype || '').toLowerCase())) {
      return cb(new Error('INVALID_FILE_TYPE'));
    }
    return cb(null, true);
  },
});

router.post('/logo-upload', authMiddleware, requireRole(UserRole.ADMIN), (req, res) => {
  uploadLogo.single('file')(req as any, res as any, (err: any) => {
    if (err) {
      if (err?.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: `Logo exceeds ${maxSiteLogoUploadMb}MB limit` });
      }
      if (err?.message === 'INVALID_FILE_TYPE') {
        return res
          .status(400)
          .json({ error: 'Unsupported logo file type. Use PNG, JPG, WEBP, GIF, SVG or ICO' });
      }
      return res.status(400).json({ error: 'Failed to upload logo image' });
    }

    const file = (req as any).file as Express.Multer.File | undefined;
    if (!file) {
      return res.status(400).json({ error: 'Missing file' });
    }

    return res.status(201).json({
      url: `/api/uploads/site-assets/${encodeURIComponent(file.filename)}`,
      filename: file.filename,
      size: file.size,
      mime: file.mimetype,
    });
  });
});

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

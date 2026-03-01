import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import authRoutes from './routes/auth';
import usersRoutes from './routes/users';
import siteConfigRoutes from './routes/siteConfig';
import loadingScreensRoutes from './routes/loadingScreens';
import loadingTelemetryRoutes from './routes/loadingTelemetry';
import serversRoutes from './routes/servers';
import dashboardRoutes from './routes/dashboard';
import playersRoutes from './routes/players';
import logsRoutes from './routes/logs';
import ingestRoutes from './routes/ingest';
import transactionsRoutes from './routes/transactions';
import suspiciousRoutes from './routes/suspicious';
import legacyLogsRoutes from './routes/legacyLogs';
import vipsRoutes from './routes/vips';
import { bootstrap } from './bootstrap';
import { startVipExpiryReconcilerJob } from './services/vipExpiryReconciler';
import { initializeServerWebSocket } from './services/serverWs';

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

// Trust only the first proxy hop (Nginx) so rate limiting sees correct client IPs
app.set('trust proxy', 1);

const parseBoolEnv = (value: string | undefined, fallback: boolean): boolean => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
};

const parseCsvEnv = (value: string | undefined): string[] =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const allowedOrigins = parseCsvEnv(process.env.CORS_ALLOWED_ORIGINS || process.env.CORS_ORIGINS);
const allowAnyOrigin = parseBoolEnv(process.env.CORS_ALLOW_ANY_ORIGIN, allowedOrigins.length === 0);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowAnyOrigin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
  }),
);
app.use(express.json());
app.use(helmet());

const proofUploadsDir =
  process.env.PROOF_UPLOAD_DIR || path.resolve(process.cwd(), 'uploads', 'proofs');
fs.mkdirSync(proofUploadsDir, { recursive: true });
const loadingMediaUploadsDir =
  process.env.LOADING_MEDIA_UPLOAD_DIR || path.resolve(process.cwd(), 'uploads', 'loading-media');
fs.mkdirSync(loadingMediaUploadsDir, { recursive: true });

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 2000, // 15x mais: 1800 req/min por IP nas rotas gerais
  standardHeaders: true,
  legacyHeaders: false,
});

const ingestLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 5000, // 15x mais: 3600 req/min para ingest
  standardHeaders: true,
  legacyHeaders: false,
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api', apiLimiter);
app.use(
  '/api/uploads/proofs',
  express.static(proofUploadsDir, {
    index: false,
    maxAge: '7d',
    dotfiles: 'deny',
  }),
);
app.use(
  '/api/uploads/loading-media',
  express.static(loadingMediaUploadsDir, {
    index: false,
    maxAge: '30d',
    dotfiles: 'deny',
  }),
);
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/site-config', siteConfigRoutes);
app.use('/api/loading-screens', loadingScreensRoutes);
app.use('/api/loading-telemetry', loadingTelemetryRoutes);
app.use('/api/servers', serversRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/players', playersRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/suspicious', suspiciousRoutes);
app.use('/api/ingest', ingestLimiter, ingestRoutes);
app.use('/api/admin/legacy-logs', apiLimiter, legacyLogsRoutes);
app.use('/api/transactions', transactionsRoutes);
app.use('/api/vips', vipsRoutes);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error', err);
  res.status(500).json({ error: 'Internal server error' });
});

const start = async () => {
  await bootstrap();
  const stopVipExpiryReconciler = startVipExpiryReconcilerJob();

  process.once('SIGTERM', () => stopVipExpiryReconciler());
  process.once('SIGINT', () => stopVipExpiryReconciler());

  const httpServer = http.createServer(app);
  initializeServerWebSocket(httpServer);

  httpServer.listen(port, () => {
    console.log(`API server listening on port ${port}`);
  });
};

start().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});

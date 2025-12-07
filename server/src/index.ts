import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import authRoutes from './routes/auth';
import usersRoutes from './routes/users';
import siteConfigRoutes from './routes/siteConfig';
import serversRoutes from './routes/servers';
import dashboardRoutes from './routes/dashboard';
import playersRoutes from './routes/players';
import logsRoutes from './routes/logs';
import ingestRoutes from './routes/ingest';
import transactionsRoutes from './routes/transactions';
import suspiciousRoutes from './routes/suspicious';
import { bootstrap } from './bootstrap';

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

// Trust upstream proxy (Nginx) so rate limiting sees correct client IPs
app.set('trust proxy', true);

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use(helmet());

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
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/site-config', siteConfigRoutes);
app.use('/api/servers', serversRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/players', playersRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/suspicious', suspiciousRoutes);
app.use('/api/ingest', ingestLimiter, ingestRoutes);
app.use('/api/transactions', transactionsRoutes);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error', err);
  res.status(500).json({ error: 'Internal server error' });
});

const start = async () => {
  await bootstrap();
  app.listen(port, () => {
    console.log(`API server listening on port ${port}`);
  });
};

start().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});

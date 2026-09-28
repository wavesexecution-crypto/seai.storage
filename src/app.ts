import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from './config/env.js';
import type { DbClient } from './db/pool.js';
import type { StorageProvider } from './providers/StorageProvider.js';
import { apiRouter } from './api/router.js';
import { errorHandler } from './middleware/errorHandler.js';
import { getLogger } from './utils/logger.js';

export interface AppDeps {
  cfg: AppConfig;
  db: DbClient;
  provider: StorageProvider;
}

export function createApp({ cfg, db, provider }: AppDeps): Express {
  const app = express();
  app.set('trust proxy', true);
  app.disable('x-powered-by');

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    next();
  });

  const corsOrigins =
    cfg.NODE_ENV === 'production'
      ? ['https://dash.seai.store', 'https://seai.store']
      : ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://127.0.0.1:5173'];
  app.use(
    cors({
      origin: corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Request-ID',
        'X-Seai-Service',
        'X-Seai-Service-Key',
        'X-On-Behalf-Of-Customer',
        'X-On-Behalf-Of-Website',
      ],
    }),
  );

  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = (req.headers['x-request-id'] as string) || randomUUID();
    (req as any).requestId = requestId;
    res.setHeader('X-Request-ID', requestId);
    const start = Date.now();
    res.on('finish', () => {
      getLogger().info(
        { requestId, method: req.method, path: req.path, statusCode: res.statusCode, durationMs: Date.now() - start },
        `${req.method} ${req.path} ${res.statusCode}`,
      );
    });
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'seai.storage', version: '1.0.0', provider: provider.name });
  });

  app.use(express.json({ limit: '1mb' }));
  app.use('/api/v1', apiRouter(cfg, db, provider));

  app.use((_req, res) => {
    res.status(404).json({ ok: false, error: 'Not found' });
  });
  app.use(errorHandler);
  return app;
}

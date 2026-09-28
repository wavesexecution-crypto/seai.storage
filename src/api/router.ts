import { Router } from 'express';
import type { AppConfig } from '../config/env.js';
import type { DbClient } from '../db/pool.js';
import type { StorageProvider } from '../providers/StorageProvider.js';
import { uploadsRouter } from './v1/uploads.js';
import { filesRouter } from './v1/files.js';
import { localDownloadRouter } from './v1/localDownload.js';

export function apiRouter(cfg: AppConfig, db: DbClient, provider: StorageProvider): Router {
  const r = Router();
  r.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'seai.storage', provider: provider.name });
  });
  r.use('/uploads', uploadsRouter(cfg, db, provider));
  r.use('/files', filesRouter(cfg, db, provider));
  r.use('/local-download', localDownloadRouter(cfg, db, provider));
  return r;
}

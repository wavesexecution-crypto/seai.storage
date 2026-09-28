import { Router } from 'express';
import type { AppConfig } from '../../config/env.js';
import type { DbClient } from '../../db/pool.js';
import type { StorageProvider } from '../../providers/StorageProvider.js';
import { authMiddleware, requireAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import {
  getFileScoped,
  createDownloadUrl,
  softDeleteFile,
  publishFile,
  unpublishFile,
  purgeFile,
  publicUrlFor,
} from '../../services/storageService.js';

export function filesRouter(cfg: AppConfig, db: DbClient, provider: StorageProvider): Router {
  const r = Router();
  r.use(authMiddleware(cfg));

  r.get('/:id', async (req, res, next) => {
    try {
      const auth = requireAuth(req);
      const file = await getFileScoped(db, auth, req.params.id);
      if (!file) {
        res.status(404).json({ ok: false, error: 'Not found' });
        return;
      }
      res.json({ ok: true, file: { ...file, publicUrl: publicUrlFor(cfg, file) } });
    } catch (err) {
      next(err);
    }
  });

  r.get('/:id/download', rateLimit(cfg, 'downloads'), async (req, res, next) => {
    try {
      const auth = requireAuth(req);
      const result = await createDownloadUrl(db, provider, cfg, auth, req.params.id);
      res.json({ ok: true, ...result });
    } catch (err) {
      next(err);
    }
  });

  r.delete('/:id', rateLimit(cfg, 'deletes'), async (req, res, next) => {
    try {
      const auth = requireAuth(req);
      const file = await softDeleteFile(db, auth, req.params.id);
      res.json({ ok: true, file });
    } catch (err) {
      next(err);
    }
  });

  r.post('/:id/publish', rateLimit(cfg, 'deletes'), async (req, res, next) => {
    try {
      const auth = requireAuth(req);
      const file = await publishFile(db, auth, req.params.id);
      res.json({ ok: true, file: { ...file, publicUrl: publicUrlFor(cfg, file) } });
    } catch (err) {
      next(err);
    }
  });

  r.post('/:id/unpublish', rateLimit(cfg, 'deletes'), async (req, res, next) => {
    try {
      const auth = requireAuth(req);
      const file = await unpublishFile(db, auth, req.params.id);
      res.json({ ok: true, file: { ...file, publicUrl: publicUrlFor(cfg, file) } });
    } catch (err) {
      next(err);
    }
  });

  r.post('/:id/purge', rateLimit(cfg, 'deletes'), async (req, res, next) => {
    try {
      const auth = requireAuth(req);
      await purgeFile(db, provider, cfg, auth, req.params.id);
      res.json({ ok: true, purged: true });
    } catch (err) {
      next(err);
    }
  });

  return r;
}

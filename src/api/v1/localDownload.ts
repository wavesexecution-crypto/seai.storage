import { Router } from 'express';
import type { AppConfig } from '../../config/env.js';
import type { DbClient } from '../../db/pool.js';
import type { StorageProvider } from '../../providers/StorageProvider.js';
import { getStorageObjectById } from '../../db/repositories.js';
import { verifyLocalDownloadToken } from '../../services/storageService.js';

/**
 * Bearer-token download for memory/local providers.
 * S3 downloads use presigned S3 URLs and never hit this route.
 */
export function localDownloadRouter(cfg: AppConfig, db: DbClient, provider: StorageProvider): Router {
  const r = Router();

  r.get('/:id', async (req, res, next) => {
    try {
      if (provider.name === 's3') {
        res.status(400).json({ ok: false, error: 'Use the signed download URL' });
        return;
      }
      const { id } = req.params;
      const exp = Number(req.query.exp);
      const token = String(req.query.token ?? '');
      if (!Number.isFinite(exp)) {
        res.status(400).json({ ok: false, error: 'Missing exp' });
        return;
      }
      if (exp * 1000 < Date.now()) {
        res.status(410).json({ ok: false, error: 'Download URL expired' });
        return;
      }
      if (!verifyLocalDownloadToken(cfg, id, exp, token)) {
        res.status(401).json({ ok: false, error: 'Invalid download token' });
        return;
      }
      const object = await getStorageObjectById(db, id);
      if (!object || object.status === 'DELETED' || object.deletedAt) {
        res.status(404).json({ ok: false, error: 'Not found' });
        return;
      }
      if (object.status !== 'READY') {
        res.status(409).json({ ok: false, error: 'File is not ready' });
        return;
      }
      if (typeof provider.getObjectBytes !== 'function') {
        res.status(500).json({ ok: false, error: 'Provider cannot serve bytes' });
        return;
      }
      const bytes = await provider.getObjectBytes(object.storageKey);
      if (!bytes) {
        res.status(404).json({ ok: false, error: 'Not found' });
        return;
      }
      res.setHeader('Content-Type', object.mimeType);
      res.setHeader('Content-Length', String(bytes.length));
      res.setHeader('Cache-Control', 'private, max-age=60');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(bytes);
    } catch (err) {
      next(err);
    }
  });

  return r;
}

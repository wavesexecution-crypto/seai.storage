import { Router } from 'express';
import express from 'express';
import type { AppConfig } from '../../config/env.js';
import type { DbClient } from '../../db/pool.js';
import type { StorageProvider } from '../../providers/StorageProvider.js';
import { authMiddleware, requireAuth } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { createUpload, completeUpload } from '../../services/storageService.js';
import { maxBytesForCategory } from '../../config/limits.js';
import { getStorageObjectScoped, getStorageObjectById } from '../../db/repositories.js';
import type { FileCategory } from '../../domain/types.js';

export function uploadsRouter(cfg: AppConfig, db: DbClient, provider: StorageProvider): Router {
  const r = Router();
  r.use(authMiddleware(cfg));

  r.post('/', rateLimit(cfg, 'uploads'), async (req, res, next) => {
    try {
      const auth = requireAuth(req);
      const result = await createUpload(db, provider, cfg, auth, req.body);
      res.status(201).json({
        ok: true,
        object: result.object,
        uploadSessionId: result.uploadSessionId,
        uploadUrl: result.uploadUrl,
        expiresAt: result.expiresAt,
      });
    } catch (err) {
      next(err);
    }
  });

  r.post('/:id/complete', rateLimit(cfg, 'uploads'), async (req, res, next) => {
    try {
      const auth = requireAuth(req);
      const object = await completeUpload(db, provider, cfg, auth, req.params.id);
      res.json({ ok: true, object });
    } catch (err) {
      next(err);
    }
  });

  // Direct byte transfer for memory/local providers (dev/test).
  // Production (s3) clients PUT directly to the presigned S3 URL instead.
  r.put(
    '/:id/bytes',
    rateLimit(cfg, 'uploads'),
    express.raw({ type: '*/*', limit: '115mb' }),
    async (req, res, next) => {
      try {
        if (provider.name === 's3') {
          res.status(400).json({ ok: false, error: 'Use the signed upload URL for s3 provider' });
          return;
        }
        const auth = requireAuth(req);
        const objectId = req.params.id;
        const object =
          auth.type === 'user'
            ? await getStorageObjectScoped(db, objectId, auth.customerId)
            : await getStorageObjectById(db, objectId);
        if (!object) {
          res.status(404).json({ ok: false, error: 'Not found' });
          return;
        }
        if (auth.type === 'service' && auth.customerId && object.customerId !== auth.customerId) {
          res.status(403).json({ ok: false, error: 'Forbidden' });
          return;
        }
        const bytes = req.body as Buffer;
        if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
          res.status(400).json({ ok: false, error: 'Empty body' });
          return;
        }
        const max = Math.min(maxBytesForCategory(cfg, object.category as FileCategory), cfg.MAX_FILE_SIZE_BYTES);
        if (bytes.length > max) {
          res.status(413).json({ ok: false, error: `Body exceeds limit of ${max} bytes` });
          return;
        }
        if (typeof provider.putObjectForTesting !== 'function') {
          res.status(500).json({ ok: false, error: 'Provider does not support direct transfer' });
          return;
        }
        await provider.putObjectForTesting(object.storageKey, bytes, object.mimeType);
        res.json({ ok: true, receivedBytes: bytes.length });
      } catch (err) {
        next(err);
      }
    },
  );

  return r;
}

import type { Request, Response, NextFunction } from 'express';
import { getLogger } from '../utils/logger.js';

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction): void {
  if (err?.name === 'ZodError') {
    const requestId = (req as any).requestId ?? 'unknown';
    res.status(400).json({ ok: false, error: 'Invalid request', details: err.issues, requestId });
    return;
  }
  const statusCode = typeof err?.statusCode === 'number' ? err.statusCode : 500;
  const requestId = (req as any).requestId ?? 'unknown';
  if (statusCode >= 500) {
    getLogger().error({ requestId, err: err?.message, stack: err?.stack }, 'Unhandled error');
  }
  if (res.headersSent) return;
  const message = statusCode === 500 ? 'Internal server error' : (err?.message ?? 'Request failed');
  res.status(statusCode).json({ ok: false, error: message, requestId });
}

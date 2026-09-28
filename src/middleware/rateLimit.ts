import type { Request, Response, NextFunction } from 'express';
import type { AppConfig } from '../config/env.js';

export type RateLimitGroup = 'uploads' | 'downloads' | 'deletes' | 'default';

const buckets = new Map<string, number[]>();

function limitFor(cfg: AppConfig, group: RateLimitGroup): number {
  switch (group) {
    case 'uploads':
      return cfg.RATE_LIMIT_MAX_UPLOADS;
    case 'downloads':
      return cfg.RATE_LIMIT_MAX_DOWNLOADS;
    case 'deletes':
      return cfg.RATE_LIMIT_MAX_DELETES;
    default:
      return 200;
  }
}

function keyFor(req: Request): string {
  const auth = req.auth;
  if (auth?.type === 'user') return `user:${auth.customerId}`;
  if (auth?.type === 'service') return `svc:${auth.serviceName}`;
  return `ip:${req.ip}`;
}

export function rateLimit(cfg: AppConfig, group: RateLimitGroup) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const windowMs = cfg.RATE_LIMIT_WINDOW_MS;
    const max = limitFor(cfg, group);
    const key = `${group}:${keyFor(req)}`;
    const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
    if (hits.length >= max) {
      res.status(429).json({ ok: false, error: 'Rate limit exceeded' });
      return;
    }
    hits.push(now);
    buckets.set(key, hits);
    next();
  };
}

/** Test-only reset. */
export function __resetRateLimitsForTests(): void {
  buckets.clear();
}

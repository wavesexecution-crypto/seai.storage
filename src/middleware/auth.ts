import type { Request, Response, NextFunction } from 'express';
import type { AppConfig } from '../config/env.js';
import type { AuthContext } from '../auth/context.js';
import { verifyUserToken } from '../auth/userAuth.js';
import { verifyServiceAuth } from '../auth/serviceAuth.js';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export function authMiddleware(cfg: AppConfig) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Service auth takes precedence when service headers are present.
    const svc = verifyServiceAuth(cfg, req.headers as Record<string, string | string[] | undefined>);
    if (svc) {
      req.auth = {
        type: 'service',
        serviceName: svc.serviceName,
        customerId: svc.onBehalfOfCustomerId,
        websiteId: svc.onBehalfOfWebsiteId,
      };
      next();
      return;
    }
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
    const token = header.slice('Bearer '.length).trim();
    // Local-download HMAC tokens are handled by their own route, not here.
    try {
      const claims = verifyUserToken(cfg, token);
      req.auth = { type: 'user', customerId: claims.customerId, websiteIds: claims.websiteIds };
      next();
    } catch {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
  };
}

export function requireAuth(req: Request): AuthContext {
  if (!req.auth) throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
  return req.auth;
}

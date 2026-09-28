import jwt from 'jsonwebtoken';
import type { AppConfig } from '../config/env.js';

export interface UserClaims {
  customerId: string;
  websiteIds: string[] | null;
}

export function verifyUserToken(cfg: AppConfig, token: string): UserClaims {
  const payload = jwt.verify(token, cfg.STORAGE_JWT_SECRET, { algorithms: ['HS256'] }) as Record<string, unknown>;
  const customerId = (payload.sub ?? payload.customerId ?? payload.customer_id) as unknown;
  if (typeof customerId !== 'string' || !customerId) {
    throw Object.assign(new Error('Invalid token subject'), { statusCode: 401 });
  }
  const rawWebsites = payload.websiteIds ?? payload.website_ids ?? null;
  const websiteIds = Array.isArray(rawWebsites) ? (rawWebsites.filter((w) => typeof w === 'string') as string[]) : null;
  return { customerId, websiteIds };
}

/** Test helper: mint a user JWT. Production tokens are issued by CDF/auth, not here. */
export function mintUserTokenForTests(cfg: AppConfig, customerId: string, websiteIds: string[] | null = null): string {
  return jwt.sign({ sub: customerId, websiteIds }, cfg.STORAGE_JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' });
}

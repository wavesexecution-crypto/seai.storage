import type { AppConfig } from '../config/env.js';

export interface ServiceCredentials {
  serviceName: string;
  onBehalfOfCustomerId: string | null;
  onBehalfOfWebsiteId: string | null;
}

/**
 * Service-to-service auth. Service keys are server-side only and must NEVER
 * be exposed to frontend JavaScript.
 */
export function verifyServiceAuth(
  cfg: AppConfig,
  headers: Record<string, string | string[] | undefined>,
): ServiceCredentials | null {
  const name = first(headers['x-seai-service']);
  const key = first(headers['x-seai-service-key']);
  if (!name || !key) return null;
  const expected = cfg.serviceKeys.get(name);
  if (!expected || !timingSafeEqual(expected, key)) return null;
  const onBehalfOfCustomerId = first(headers['x-on-behalf-of-customer']) ?? null;
  const onBehalfOfWebsiteId = first(headers['x-on-behalf-of-website']) ?? null;
  return { serviceName: name, onBehalfOfCustomerId, onBehalfOfWebsiteId };
}

function first(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  if (typeof v === 'string' && v.length > 0) return v;
  return null;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

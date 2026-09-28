export type AuthContext =
  | { type: 'user'; customerId: string; websiteIds: string[] | null }
  | { type: 'service'; serviceName: string; customerId: string | null; websiteId: string | null };

export function actorOf(auth: AuthContext): { actorType: 'user' | 'service'; actorId: string } {
  if (auth.type === 'user') return { actorType: 'user', actorId: auth.customerId };
  return { actorType: 'service', actorId: auth.serviceName };
}

/** Effective tenant scope every query must enforce. Null = service without delegated scope (must supply per-request). */
export function effectiveCustomerId(auth: AuthContext): string | null {
  if (auth.type === 'user') return auth.customerId;
  return auth.customerId;
}

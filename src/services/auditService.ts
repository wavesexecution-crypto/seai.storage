import type { DbClient } from '../db/pool.js';
import { insertAuditEvent } from '../db/repositories.js';
import type { ActorType } from '../domain/types.js';
import { getLogger } from '../utils/logger.js';

export async function recordAudit(
  db: DbClient,
  e: {
    objectId?: string | null;
    customerId?: string | null;
    websiteId?: string | null;
    actorType: ActorType;
    actorId: string;
    action: string;
    details?: Record<string, unknown> | null;
  },
): Promise<void> {
  await insertAuditEvent(db, e);
  // Log without secrets (repositories already strips URL/token-like keys).
  getLogger().info(
    {
      action: e.action,
      objectId: e.objectId ?? undefined,
      customerId: e.customerId ?? undefined,
      actorType: e.actorType,
      actorId: e.actorId,
    },
    `storage audit: ${e.action}`,
  );
}

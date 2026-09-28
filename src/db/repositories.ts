import { randomUUID } from 'node:crypto';
import type { DbClient } from './pool.js';
import type { StorageObject, UploadSession, AuditEvent, ActorType } from '../domain/types.js';

function rowToObject(r: any): StorageObject {
  return {
    id: r.id,
    customerId: r.customer_id,
    websiteId: r.website_id ?? null,
    storageKey: r.storage_key,
    originalFilename: r.original_filename,
    mimeType: r.mime_type,
    sizeBytes: Number(r.size_bytes),
    checksumSha256: r.checksum_sha256 ?? null,
    status: r.status,
    scanStatus: r.scan_status,
    visibility: r.visibility,
    category: r.category,
    publishedAt: r.published_at ? new Date(r.published_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
    deletedAt: r.deleted_at ? new Date(r.deleted_at).toISOString() : null,
  };
}

export interface CreateObjectInput {
  id?: string;
  customerId: string;
  websiteId: string | null;
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string | null;
  category: StorageObject['category'];
}

export async function insertStorageObject(db: DbClient, input: CreateObjectInput): Promise<StorageObject> {
  const id = input.id ?? randomUUID();
  const res = await db.query(
    `INSERT INTO storage_objects
      (id, customer_id, website_id, storage_key, original_filename, mime_type, size_bytes, checksum_sha256, status, scan_status, visibility, category)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'UPLOADING','PENDING','PRIVATE',$9)
     RETURNING *`,
    [id, input.customerId, input.websiteId, input.storageKey, input.originalFilename, input.mimeType, input.sizeBytes, input.checksumSha256, input.category],
  );
  return rowToObject(res.rows[0]);
}

/** Tenant-scoped fetch. Returns null (not 403) for foreign/missing rows to avoid leaking existence. */
export async function getStorageObjectScoped(
  db: DbClient,
  id: string,
  customerId: string,
): Promise<StorageObject | null> {
  const res = await db.query(`SELECT * FROM storage_objects WHERE id = $1 AND customer_id = $2`, [id, customerId]);
  if (res.rows.length === 0) return null;
  return rowToObject(res.rows[0]);
}

export async function getStorageObjectById(db: DbClient, id: string): Promise<StorageObject | null> {
  const res = await db.query(`SELECT * FROM storage_objects WHERE id = $1`, [id]);
  if (res.rows.length === 0) return null;
  return rowToObject(res.rows[0]);
}

export async function updateStorageObjectStatus(
  db: DbClient,
  id: string,
  patch: Partial<Pick<StorageObject, 'status' | 'scanStatus' | 'visibility'>> & { publishedAt?: string | null; deletedAt?: string | null },
): Promise<StorageObject | null> {
  const sets: string[] = ['updated_at = now()'];
  const params: any[] = [];
  let i = 1;
  if (patch.status) {
    sets.push(`status = $${i++}`);
    params.push(patch.status);
  }
  if (patch.scanStatus) {
    sets.push(`scan_status = $${i++}`);
    params.push(patch.scanStatus);
  }
  if (patch.visibility) {
    sets.push(`visibility = $${i++}`);
    params.push(patch.visibility);
  }
  if (patch.publishedAt !== undefined) {
    sets.push(`published_at = $${i++}`);
    params.push(patch.publishedAt);
  }
  if (patch.deletedAt !== undefined) {
    sets.push(`deleted_at = $${i++}`);
    params.push(patch.deletedAt);
  }
  params.push(id);
  const res = await db.query(`UPDATE storage_objects SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, params);
  if (res.rows.length === 0) return null;
  return rowToObject(res.rows[0]);
}

export async function createUploadSession(
  db: DbClient,
  objectId: string,
  customerId: string,
  expiresAt: string,
): Promise<UploadSession> {
  const id = randomUUID();
  const res = await db.query(
    `INSERT INTO upload_sessions (id, object_id, customer_id, status, expires_at)
     VALUES ($1,$2,$3,'PENDING',$4) RETURNING *`,
    [id, objectId, customerId, expiresAt],
  );
  const r = res.rows[0];
  return {
    id: r.id,
    objectId: r.object_id,
    customerId: r.customer_id,
    status: r.status,
    expiresAt: new Date(r.expires_at).toISOString(),
    completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export async function getLatestUploadSession(db: DbClient, objectId: string): Promise<UploadSession | null> {
  const res = await db.query(`SELECT * FROM upload_sessions WHERE object_id = $1 ORDER BY created_at DESC LIMIT 1`, [objectId]);
  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    id: r.id,
    objectId: r.object_id,
    customerId: r.customer_id,
    status: r.status,
    expiresAt: new Date(r.expires_at).toISOString(),
    completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export async function completeUploadSession(db: DbClient, sessionId: string): Promise<void> {
  await db.query(`UPDATE upload_sessions SET status = 'COMPLETED', completed_at = now() WHERE id = $1`, [sessionId]);
}

export async function insertAuditEvent(
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
): Promise<AuditEvent> {
  // Never persist secrets: strip URL/token-like fields defensively.
  const details = e.details ? { ...e.details } : null;
  if (details) {
    for (const k of Object.keys(details)) {
      if (/url|token|secret|key|credential/i.test(k)) delete (details as any)[k];
    }
  }
  const res = await db.query(
    `INSERT INTO storage_events (id, object_id, customer_id, website_id, actor_type, actor_id, action, details)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [randomUUID(), e.objectId ?? null, e.customerId ?? null, e.websiteId ?? null, e.actorType, e.actorId, e.action, details ? JSON.stringify(details) : null],
  );
  const r = res.rows[0];
  // pg-mem may return details as string or object; normalize.
  let outDetails: Record<string, unknown> | null = null;
  if (r.details !== null && r.details !== undefined) {
    outDetails = typeof r.details === 'string' ? (JSON.parse(r.details) as Record<string, unknown>) : (r.details as Record<string, unknown>);
  }
  return {
    id: r.id,
    objectId: r.object_id ?? null,
    customerId: r.customer_id ?? null,
    websiteId: r.website_id ?? null,
    actorType: r.actor_type,
    actorId: r.actor_id,
    action: r.action,
    details: outDetails,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export async function listAuditEventsForObject(db: DbClient, objectId: string): Promise<AuditEvent[]> {
  const res = await db.query(`SELECT * FROM storage_events WHERE object_id = $1 ORDER BY created_at ASC`, [objectId]);
  return res.rows.map((r: any) => ({
    id: r.id,
    objectId: r.object_id ?? null,
    customerId: r.customer_id ?? null,
    websiteId: r.website_id ?? null,
    actorType: r.actor_type,
    actorId: r.actor_id,
    action: r.action,
    details: r.details === null || r.details === undefined ? null : typeof r.details === 'string' ? JSON.parse(r.details) : r.details,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

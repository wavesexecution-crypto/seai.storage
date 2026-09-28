import { createHash, createHmac, randomUUID, timingSafeEqual as nodeTimingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { AppConfig } from '../config/env.js';
import { maxBytesForCategory } from '../config/limits.js';
import type { DbClient } from '../db/pool.js';
import {
  insertStorageObject,
  getStorageObjectScoped,
  getStorageObjectById,
  updateStorageObjectStatus,
  createUploadSession,
  getLatestUploadSession,
  completeUploadSession,
} from '../db/repositories.js';
import { FILE_CATEGORIES } from '../domain/types.js';
import type { StorageObject, FileCategory } from '../domain/types.js';
import { buildStorageKey } from '../domain/objectKeys.js';
import { validateMimeForCategory, validateExtensionForMime, inspectMagicBytes } from '../domain/validation.js';
import { assertTransition } from '../domain/lifecycle.js';
import { sanitizeFilenameForDisplay } from '../utils/filenames.js';
import type { AuthContext } from '../auth/context.js';
import { actorOf } from '../auth/context.js';
import type { StorageProvider } from '../providers/StorageProvider.js';
import { recordAudit } from './auditService.js';

export const createUploadSchema = z.object({
  websiteId: z.string().min(1).max(128).nullable().optional(),
  originalFilename: z.string().min(1).max(512),
  mimeType: z.string().min(1).max(128),
  sizeBytes: z.number().int().positive(),
  checksumSha256: z.string().regex(/^[a-fA-F0-9]{64}$/).nullable().optional(),
  category: z.enum(FILE_CATEGORIES as unknown as [string, ...string[]]),
  // customerId may be supplied by services; users must not rely on it (derived from JWT).
  customerId: z.string().min(1).max(128).optional(),
});

function httpError(statusCode: number, message: string): Error {
  return Object.assign(new Error(message), { statusCode });
}

/** Resolve the tenant scope for a request. Users: JWT. Services: body.customerId or on-behalf-of header. */
export function resolveCustomerScope(auth: AuthContext, bodyCustomerId?: string | null): string {
  if (auth.type === 'user') return auth.customerId;
  const headerScoped = auth.customerId;
  const resolved = bodyCustomerId ?? headerScoped;
  if (!resolved) throw httpError(400, 'customerId is required for service requests');
  if (headerScoped && bodyCustomerId && headerScoped !== bodyCustomerId) {
    throw httpError(400, 'customerId mismatch between header and body');
  }
  return resolved;
}

export function resolveWebsiteScope(auth: AuthContext, bodyWebsiteId?: string | null): string | null {
  if (bodyWebsiteId !== undefined && bodyWebsiteId !== null) return bodyWebsiteId;
  if (auth.type === 'service') return auth.websiteId;
  return null;
}

function enforceWebsiteAllowlist(auth: AuthContext, websiteId: string | null): void {
  if (auth.type === 'user' && auth.websiteIds && websiteId) {
    if (!auth.websiteIds.includes(websiteId)) throw httpError(403, 'Forbidden');
  }
}

export interface CreateUploadResult {
  object: StorageObject;
  uploadSessionId: string;
  uploadUrl: string;
  expiresAt: string;
}

export async function createUpload(
  db: DbClient,
  provider: StorageProvider,
  cfg: AppConfig,
  auth: AuthContext,
  input: z.infer<typeof createUploadSchema>,
): Promise<CreateUploadResult> {
  const parsed = createUploadSchema.parse(input);
  const customerId = resolveCustomerScope(auth, parsed.customerId ?? null);
  const websiteId = resolveWebsiteScope(auth, parsed.websiteId ?? null);
  enforceWebsiteAllowlist(auth, websiteId);

  // --- Filename safety: reject traversal/null bytes, sanitize rest for display. ---
  if (parsed.originalFilename.includes('\0')) throw httpError(400, 'Invalid filename');
  if (/(^|[\\/])\.\.([\\/]|$)/.test(parsed.originalFilename) || /^[\\/]/.test(parsed.originalFilename)) {
    throw httpError(400, 'Invalid filename');
  }
  const displayName = sanitizeFilenameForDisplay(parsed.originalFilename);

  const category = parsed.category as FileCategory;
  const mimeErr = validateMimeForCategory(parsed.mimeType, category);
  if (mimeErr) throw httpError(400, mimeErr);
  const extErr = validateExtensionForMime(displayName, parsed.mimeType);
  if (extErr) throw httpError(400, extErr);

  const maxForCategory = maxBytesForCategory(cfg, category);
  if (parsed.sizeBytes > maxForCategory) {
    throw httpError(413, `File exceeds category limit of ${maxForCategory} bytes`);
  }
  if (parsed.sizeBytes > cfg.MAX_FILE_SIZE_BYTES) {
    throw httpError(413, `File exceeds global limit of ${cfg.MAX_FILE_SIZE_BYTES} bytes`);
  }

  const objectId = randomUUID();
  const storageKey = buildStorageKey(customerId, websiteId, objectId);

  const object = await insertStorageObject(db, {
    id: objectId,
    customerId,
    websiteId,
    storageKey,
    originalFilename: displayName,
    mimeType: parsed.mimeType,
    sizeBytes: parsed.sizeBytes,
    checksumSha256: parsed.checksumSha256 ?? null,
    category,
  });

  const expiresAt = new Date(Date.now() + cfg.UPLOAD_URL_TTL_SECONDS * 1000).toISOString();
  const session = await createUploadSession(db, objectId, customerId, expiresAt);
  const signed = await provider.createSignedUploadUrl({
    key: storageKey,
    mimeType: parsed.mimeType,
    sizeBytes: parsed.sizeBytes,
    expiresInSeconds: cfg.UPLOAD_URL_TTL_SECONDS,
  });

  const actor = actorOf(auth);
  await recordAudit(db, {
    objectId,
    customerId,
    websiteId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    action: 'upload_initiated',
    details: { category, mimeType: parsed.mimeType, sizeBytes: parsed.sizeBytes, sessionId: session.id },
  });

  return { object, uploadSessionId: session.id, uploadUrl: signed.uploadUrl, expiresAt };
}

export async function completeUpload(
  db: DbClient,
  provider: StorageProvider,
  cfg: AppConfig,
  auth: AuthContext,
  objectId: string,
): Promise<StorageObject> {
  const actor = actorOf(auth);
  // User scope is strict; service is privileged but audited (and must match on-behalf-of if declared).
  let object: StorageObject | null;
  if (auth.type === 'user') {
    object = await getStorageObjectScoped(db, objectId, auth.customerId);
    if (!object) {
      await recordAudit(db, {
        objectId,
        customerId: auth.customerId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: 'authorization_failure',
        details: { reason: 'complete_unknown_or_foreign' },
      });
      throw httpError(404, 'Not found');
    }
  } else {
    object = await getStorageObjectById(db, objectId);
    if (!object) throw httpError(404, 'Not found');
    if (auth.customerId && object.customerId !== auth.customerId) {
      throw httpError(403, 'Forbidden');
    }
  }

  // Idempotent completion.
  if (object.status === 'READY') return object;
  if (object.status === 'DELETED' || object.status === 'REJECTED') {
    throw httpError(409, `Cannot complete upload in status ${object.status}`);
  }

  const session = await getLatestUploadSession(db, objectId);
  if (!session) throw httpError(409, 'No upload session for object');
  if (session.status === 'COMPLETED' && object.status === 'UPLOADED') {
    const fresh = await getStorageObjectById(db, objectId);
    if (fresh) return fresh;
  }
  if (new Date(session.expiresAt).getTime() < Date.now() && object.status === 'UPLOADING') {
    throw httpError(410, 'Upload session expired');
  }

  const exists = await provider.objectExists(object.storageKey);
  if (!exists) throw httpError(409, 'Upload bytes not received yet');

  const meta = await provider.getObjectMetadata(object.storageKey);
  if (meta && meta.sizeBytes !== object.sizeBytes) {
    await updateStorageObjectStatus(db, objectId, { status: 'REJECTED', scanStatus: 'SKIPPED' });
    await recordAudit(db, {
      objectId,
      customerId: object.customerId,
      websiteId: object.websiteId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: 'file_rejected',
      details: { reason: 'size_mismatch', expected: object.sizeBytes, actual: meta.sizeBytes },
    });
    throw httpError(422, 'Uploaded size does not match declared size');
  }

  // Magic-byte + checksum verification where bytes are available.
  if (typeof provider.getObjectBytes === 'function') {
    const bytes = await provider.getObjectBytes(object.storageKey);
    if (bytes) {
      const magicErr = inspectMagicBytes(bytes, object.mimeType);
      if (magicErr) {
        await updateStorageObjectStatus(db, objectId, { status: 'REJECTED', scanStatus: 'SKIPPED' });
        await recordAudit(db, {
          objectId,
          customerId: object.customerId,
          websiteId: object.websiteId,
          actorType: actor.actorType,
          actorId: actor.actorId,
          action: 'file_rejected',
          details: { reason: 'magic_byte_mismatch' },
        });
        throw httpError(422, magicErr);
      }
      if (object.checksumSha256) {
        const actual = createHash('sha256').update(bytes).digest('hex');
        if (actual.toLowerCase() !== object.checksumSha256.toLowerCase()) {
          await updateStorageObjectStatus(db, objectId, { status: 'REJECTED', scanStatus: 'SKIPPED' });
          await recordAudit(db, {
            objectId,
            customerId: object.customerId,
            websiteId: object.websiteId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            action: 'file_rejected',
            details: { reason: 'checksum_mismatch' },
          });
          throw httpError(422, 'Checksum mismatch');
        }
      }
    }
  }

  // Lifecycle: UPLOADING -> UPLOADED -> SCANNING -> READY.
  // No real AV scanner is integrated (see docs/MALWARE_SCANNING.md): we pass
  // through SCANNING transiently and land READY with scanStatus=PENDING.
  if (object.status === 'UPLOADING') {
    assertTransition(object.status, 'UPLOADED');
    await updateStorageObjectStatus(db, objectId, { status: 'UPLOADED' });
    object = (await getStorageObjectById(db, objectId)) ?? object;
  }
  if (object.status === 'UPLOADED') {
    assertTransition(object.status, 'SCANNING');
    await updateStorageObjectStatus(db, objectId, { status: 'SCANNING', scanStatus: 'PENDING' });
    await recordAudit(db, {
      objectId,
      customerId: object.customerId,
      websiteId: object.websiteId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: 'scan_pending',
      details: { scannerEnabled: cfg.SCANNER_ENABLED },
    });
    object = (await getStorageObjectById(db, objectId)) ?? object;
  }
  if (object.status === 'SCANNING') {
    assertTransition(object.status, 'READY');
    await updateStorageObjectStatus(db, objectId, { status: 'READY', scanStatus: 'PENDING' });
    object = (await getStorageObjectById(db, objectId)) ?? object;
  }

  await completeUploadSession(db, session.id);
  await recordAudit(db, {
    objectId,
    customerId: object.customerId,
    websiteId: object.websiteId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    action: 'upload_completed',
    details: { sessionId: session.id },
  });

  const fresh = await getStorageObjectById(db, objectId);
  return fresh ?? object;
}

export async function getFileScoped(
  db: DbClient,
  auth: AuthContext,
  objectId: string,
): Promise<StorageObject | null> {
  if (auth.type === 'user') {
    const o = await getStorageObjectScoped(db, objectId, auth.customerId);
    if (!o || o.status === 'DELETED' || o.deletedAt) return null;
    enforceWebsiteAllowlist(auth, o.websiteId);
    return o;
  }
  const o = await getStorageObjectById(db, objectId);
  if (!o || o.status === 'DELETED' || o.deletedAt) return null;
  if (auth.customerId && o.customerId !== auth.customerId) return null;
  return o;
}

export function publicUrlFor(cfg: AppConfig, object: StorageObject): string | null {
  if (object.visibility !== 'PUBLIC') return null;
  if (!cfg.PUBLIC_BASE_URL) return null;
  const base = cfg.PUBLIC_BASE_URL.replace(/\/$/, '');
  return `${base}/${object.storageKey}`;
}

/** Mint an HMAC-signed local download token (memory/local providers). */
export function mintLocalDownloadToken(cfg: AppConfig, objectId: string, ttlSeconds?: number): { exp: number; token: string; expiresAt: string } {
  const ttl = ttlSeconds ?? cfg.STORAGE_SIGNED_URL_TTL_SECONDS;
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const token = createHmac('sha256', cfg.STORAGE_JWT_SECRET).update(`${objectId}.${exp}`).digest('hex');
  return { exp, token, expiresAt: new Date(exp * 1000).toISOString() };
}

export function verifyLocalDownloadToken(cfg: AppConfig, objectId: string, exp: number, token: string): boolean {
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  if (!/^[a-f0-9]{64}$/i.test(token)) return false;
  const expected = createHmac('sha256', cfg.STORAGE_JWT_SECRET).update(`${objectId}.${exp}`).digest('hex');
  try {
    return nodeTimingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(token, 'hex'));
  } catch {
    return false;
  }
}

export async function createDownloadUrl(
  db: DbClient,
  provider: StorageProvider,
  cfg: AppConfig,
  auth: AuthContext,
  objectId: string,
): Promise<{ downloadUrl: string; expiresAt: string; mimeType: string }> {
  const actor = actorOf(auth);
  const object = await getFileScoped(db, auth, objectId);
  if (!object) {
    await recordAudit(db, {
      objectId,
      customerId: auth.type === 'user' ? auth.customerId : (auth.customerId ?? null),
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: 'authorization_failure',
      details: { reason: 'download_unknown_or_foreign' },
    });
    throw httpError(404, 'Not found');
  }
  if (object.status !== 'READY') throw httpError(409, `File is not ready (status ${object.status})`);

  let downloadUrl: string;
  let expiresAt: string;
  if (provider.name === 's3') {
    const signed = await provider.createSignedDownloadUrl({
      key: object.storageKey,
      expiresInSeconds: cfg.STORAGE_SIGNED_URL_TTL_SECONDS,
    });
    downloadUrl = signed.downloadUrl;
    expiresAt = signed.expiresAt;
  } else {
    const { exp, token, expiresAt: e } = mintLocalDownloadToken(cfg, object.id);
    downloadUrl = `/api/v1/local-download/${object.id}?exp=${exp}&token=${token}`;
    expiresAt = e;
  }

  await recordAudit(db, {
    objectId,
    customerId: object.customerId,
    websiteId: object.websiteId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    action: 'download_url_generated',
    details: { ttlSeconds: cfg.STORAGE_SIGNED_URL_TTL_SECONDS },
  });

  return { downloadUrl, expiresAt, mimeType: object.mimeType };
}

export async function softDeleteFile(db: DbClient, auth: AuthContext, objectId: string): Promise<StorageObject> {
  const actor = actorOf(auth);
  const object = await getFileScoped(db, auth, objectId);
  if (!object) {
    await recordAudit(db, {
      objectId,
      customerId: auth.type === 'user' ? auth.customerId : (auth.customerId ?? null),
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: 'authorization_failure',
      details: { reason: 'delete_unknown_or_foreign' },
    });
    throw httpError(404, 'Not found');
  }
  if (object.status === 'DELETED') return object;
  assertTransition(object.status, 'DELETED');
  const now = new Date().toISOString();
  const updated = await updateStorageObjectStatus(db, objectId, { status: 'DELETED', deletedAt: now });
  await recordAudit(db, {
    objectId,
    customerId: object.customerId,
    websiteId: object.websiteId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    action: 'file_deleted',
    details: { soft: true },
  });
  return updated ?? object;
}

export async function publishFile(db: DbClient, auth: AuthContext, objectId: string): Promise<StorageObject> {
  const actor = actorOf(auth);
  const object = await getFileScoped(db, auth, objectId);
  if (!object) throw httpError(404, 'Not found');
  if (object.status !== 'READY') throw httpError(409, 'Only READY files can be published');
  const now = new Date().toISOString();
  const updated = await updateStorageObjectStatus(db, objectId, { visibility: 'PUBLIC', publishedAt: now });
  await recordAudit(db, {
    objectId,
    customerId: object.customerId,
    websiteId: object.websiteId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    action: 'file_made_public',
    details: {},
  });
  return updated ?? object;
}

export async function unpublishFile(db: DbClient, auth: AuthContext, objectId: string): Promise<StorageObject> {
  const actor = actorOf(auth);
  const object = await getFileScoped(db, auth, objectId);
  if (!object) throw httpError(404, 'Not found');
  const updated = await updateStorageObjectStatus(db, objectId, { visibility: 'PRIVATE', publishedAt: null });
  await recordAudit(db, {
    objectId,
    customerId: object.customerId,
    websiteId: object.websiteId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    action: 'file_made_private',
    details: {},
  });
  return updated ?? object;
}

/** Service-only hard purge of bytes after retention. Metadata row is retained for audit. */
export async function purgeFile(
  db: DbClient,
  provider: StorageProvider,
  cfg: AppConfig,
  auth: AuthContext,
  objectId: string,
): Promise<void> {
  if (auth.type !== 'service') throw httpError(403, 'Purge requires service authentication');
  const object = await getStorageObjectById(db, objectId);
  if (!object) throw httpError(404, 'Not found');
  if (object.status !== 'DELETED' || !object.deletedAt) {
    throw httpError(409, 'Object must be soft-deleted before purge');
  }
  const retentionMs = cfg.RETENTION_DAYS * 24 * 3600 * 1000;
  if (Date.now() - new Date(object.deletedAt).getTime() < retentionMs) {
    throw httpError(409, `Retention period of ${cfg.RETENTION_DAYS} days not met`);
  }
  await provider.deleteObject(object.storageKey);
  await recordAudit(db, {
    objectId,
    customerId: object.customerId,
    websiteId: object.websiteId,
    actorType: 'service',
    actorId: auth.serviceName,
    action: 'file_purged',
    details: {},
  });
}

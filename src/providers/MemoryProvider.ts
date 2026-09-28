import { createHash, randomUUID } from 'node:crypto';
import type { ObjectMetadata, SignedDownloadUrl, SignedUploadUrl, StorageProvider } from './StorageProvider.js';

/**
 * In-memory provider for unit tests. No persistence, no network.
 * Signed URLs are opaque tokens resolved by the API's local-transfer endpoints.
 */
export class MemoryProvider implements StorageProvider {
  readonly name = 'memory' as const;
  private objects = new Map<string, { bytes: Buffer; contentType: string; etag: string }>();
  /** baseUrl is injected by the app so signed URLs point at local-transfer routes. */
  constructor(private baseUrl = 'http://localhost') {}

  setBaseUrl(url: string): void {
    this.baseUrl = url;
  }

  async createSignedUploadUrl(args: { key: string; mimeType: string; sizeBytes: number; expiresInSeconds: number }): Promise<SignedUploadUrl> {
    const expiresAt = new Date(Date.now() + args.expiresInSeconds * 1000).toISOString();
    // The actual byte transfer happens via PUT /api/v1/uploads/:id/bytes in tests/dev.
    return {
      uploadUrl: `${this.baseUrl}/api/v1/transfer/memory-upload?key=${encodeURIComponent(args.key)}&token=${randomUUID()}`,
      expiresAt,
      requiredHeaders: { 'Content-Type': args.mimeType },
    };
  }

  async createSignedDownloadUrl(args: { key: string; expiresInSeconds: number }): Promise<SignedDownloadUrl> {
    // Real HMAC-signed local download URLs are minted by StorageService; this is a fallback.
    const expiresAt = new Date(Date.now() + args.expiresInSeconds * 1000).toISOString();
    return { downloadUrl: `${this.baseUrl}/api/v1/local-download/fallback?key=${encodeURIComponent(args.key)}`, expiresAt };
  }

  async objectExists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  async getObjectMetadata(key: string): Promise<ObjectMetadata | null> {
    const o = this.objects.get(key);
    if (!o) return null;
    return { sizeBytes: o.bytes.length, etag: o.etag, contentType: o.contentType };
  }

  async deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async getObjectBytes(key: string): Promise<Buffer | null> {
    return this.objects.get(key)?.bytes ?? null;
  }

  async putObjectForTesting(key: string, bytes: Buffer, contentType = 'application/octet-stream'): Promise<void> {
    const etag = createHash('sha256').update(bytes).digest('hex');
    this.objects.set(key, { bytes: Buffer.from(bytes), contentType, etag });
  }

  /** Test helper: number of stored objects. */
  size(): number {
    return this.objects.size;
  }
}

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { ObjectMetadata, SignedDownloadUrl, SignedUploadUrl, StorageProvider } from './StorageProvider.js';

/**
 * Filesystem provider for local development (no MinIO/S3 required).
 * Keys are namespaced under LOCAL_STORAGE_DIR; traversal is blocked by
 * rejecting any key containing `..`, absolute paths, or backslashes.
 */
export class LocalFilesystemProvider implements StorageProvider {
  readonly name = 'local' as const;
  constructor(
    private dir: string,
    private baseUrl = 'http://localhost:4100',
  ) {}

  setBaseUrl(url: string): void {
    this.baseUrl = url;
  }

  private filePathFor(key: string): string {
    if (key.includes('..') || path.isAbsolute(key) || key.includes('\\')) {
      throw Object.assign(new Error('Unsafe object key'), { statusCode: 400 });
    }
    return path.join(this.dir, ...key.split('/'));
  }

  async createSignedUploadUrl(args: { key: string; mimeType: string; sizeBytes: number; expiresInSeconds: number }): Promise<SignedUploadUrl> {
    const expiresAt = new Date(Date.now() + args.expiresInSeconds * 1000).toISOString();
    return {
      uploadUrl: `${this.baseUrl}/api/v1/transfer/local-upload?key=${encodeURIComponent(args.key)}&token=${randomUUID()}`,
      expiresAt,
      requiredHeaders: { 'Content-Type': args.mimeType },
    };
  }

  async createSignedDownloadUrl(args: { key: string; expiresInSeconds: number }): Promise<SignedDownloadUrl> {
    const expiresAt = new Date(Date.now() + args.expiresInSeconds * 1000).toISOString();
    return { downloadUrl: `${this.baseUrl}/api/v1/local-download/fallback?key=${encodeURIComponent(args.key)}`, expiresAt };
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await fs.stat(this.filePathFor(key));
      return true;
    } catch {
      return false;
    }
  }

  async getObjectMetadata(key: string): Promise<ObjectMetadata | null> {
    try {
      const [stat, meta] = await Promise.all([
        fs.stat(this.filePathFor(key)),
        fs.readFile(this.metaPathFor(key), 'utf8').catch(() => null),
      ]);
      let contentType: string | null = null;
      let etag: string | null = null;
      if (meta) {
        try {
          const parsed = JSON.parse(meta) as { contentType?: string; etag?: string };
          contentType = parsed.contentType ?? null;
          etag = parsed.etag ?? null;
        } catch {
          contentType = null;
        }
      }
      return { sizeBytes: stat.size, etag, contentType };
    } catch {
      return null;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await fs.rm(this.filePathFor(key), { force: true });
    await fs.rm(this.metaPathFor(key), { force: true });
  }

  async getObjectBytes(key: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.filePathFor(key));
    } catch {
      return null;
    }
  }

  async putObjectForTesting(key: string, bytes: Buffer, contentType = 'application/octet-stream'): Promise<void> {
    const file = this.filePathFor(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes);
    const etag = createHash('sha256').update(bytes).digest('hex');
    await fs.writeFile(this.metaPathFor(key), JSON.stringify({ contentType, etag }));
  }

  private metaPathFor(key: string): string {
    return this.filePathFor(key) + '.meta.json';
  }
}

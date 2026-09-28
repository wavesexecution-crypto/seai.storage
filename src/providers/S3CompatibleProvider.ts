import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ObjectMetadata, SignedDownloadUrl, SignedUploadUrl, StorageProvider } from './StorageProvider.js';

export interface S3ProviderOptions {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

/**
 * S3-compatible provider (AWS S3, MinIO, R2-style endpoints).
 * All provider-specific SDK usage stays in this file.
 */
export class S3CompatibleProvider implements StorageProvider {
  readonly name = 's3' as const;
  private client: S3Client;
  constructor(private opts: S3ProviderOptions) {
    if (!opts.bucket) throw new Error('S3_BUCKET is required for s3 provider');
    this.client = new S3Client({
      endpoint: opts.endpoint || undefined,
      region: opts.region,
      credentials:
        opts.accessKeyId && opts.secretAccessKey
          ? { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey }
          : undefined,
      forcePathStyle: opts.forcePathStyle,
    });
  }

  async createSignedUploadUrl(args: { key: string; mimeType: string; sizeBytes: number; expiresInSeconds: number }): Promise<SignedUploadUrl> {
    const cmd = new PutObjectCommand({
      Bucket: this.opts.bucket,
      Key: args.key,
      ContentType: args.mimeType,
      ContentLength: args.sizeBytes,
    });
    const uploadUrl = await getSignedUrl(this.client, cmd, { expiresIn: args.expiresInSeconds });
    return {
      uploadUrl,
      expiresAt: new Date(Date.now() + args.expiresInSeconds * 1000).toISOString(),
      requiredHeaders: { 'Content-Type': args.mimeType },
    };
  }

  async createSignedDownloadUrl(args: { key: string; expiresInSeconds: number }): Promise<SignedDownloadUrl> {
    const cmd = new GetObjectCommand({ Bucket: this.opts.bucket, Key: args.key });
    const downloadUrl = await getSignedUrl(this.client, cmd, { expiresIn: args.expiresInSeconds });
    return { downloadUrl, expiresAt: new Date(Date.now() + args.expiresInSeconds * 1000).toISOString() };
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.opts.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async getObjectMetadata(key: string): Promise<ObjectMetadata | null> {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.opts.bucket, Key: key }));
      return {
        sizeBytes: head.ContentLength ?? 0,
        etag: head.ETag?.replace(/"/g, '') ?? null,
        contentType: head.ContentType ?? null,
      };
    } catch {
      return null;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.opts.bucket, Key: key }));
  }

  async getObjectBytes(key: string): Promise<Buffer | null> {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.opts.bucket, Key: key }));
      if (!out.Body) return null;
      const chunks: Buffer[] = [];
      // Body is a stream in Node.js runtime.
      const stream = out.Body as unknown as AsyncIterable<Uint8Array>;
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks);
    } catch {
      return null;
    }
  }
}

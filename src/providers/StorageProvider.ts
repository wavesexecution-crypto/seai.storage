/**
 * Storage provider abstraction — keeps application code decoupled from any
 * single object-store vendor. Provider-specific code must stay in ./providers.
 */

export interface SignedUploadUrl {
  uploadUrl: string;
  expiresAt: string;
  requiredHeaders?: Record<string, string>;
}

export interface SignedDownloadUrl {
  downloadUrl: string;
  expiresAt: string;
}

export interface ObjectMetadata {
  sizeBytes: number;
  etag: string | null;
  contentType: string | null;
}

export interface StorageProvider {
  readonly name: 'memory' | 'local' | 's3';

  createSignedUploadUrl(args: {
    key: string;
    mimeType: string;
    sizeBytes: number;
    expiresInSeconds: number;
  }): Promise<SignedUploadUrl>;

  createSignedDownloadUrl(args: { key: string; expiresInSeconds: number }): Promise<SignedDownloadUrl>;

  objectExists(key: string): Promise<boolean>;

  getObjectMetadata(key: string): Promise<ObjectMetadata | null>;

  deleteObject(key: string): Promise<void>;

  /** Optional: providers that can expose bytes server-side (memory/local/s3). */
  getObjectBytes?(key: string): Promise<Buffer | null>;

  /** Optional: test/dev helper to simulate a direct-to-storage PUT. */
  putObjectForTesting?(key: string, bytes: Buffer, contentType?: string): Promise<void>;
}

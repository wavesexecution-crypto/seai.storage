import type { AppConfig } from '../config/env.js';
import type { StorageProvider } from './StorageProvider.js';
import { MemoryProvider } from './MemoryProvider.js';
import { LocalFilesystemProvider } from './LocalFilesystemProvider.js';
import { S3CompatibleProvider } from './S3CompatibleProvider.js';

export * from './StorageProvider.js';
export { MemoryProvider } from './MemoryProvider.js';
export { LocalFilesystemProvider } from './LocalFilesystemProvider.js';
export { S3CompatibleProvider } from './S3CompatibleProvider.js';

export function createProviderFromConfig(cfg: AppConfig): StorageProvider {
  switch (cfg.STORAGE_PROVIDER) {
    case 'memory':
      return new MemoryProvider(cfg.LOCAL_PUBLIC_BASE_URL);
    case 'local':
      return new LocalFilesystemProvider(cfg.LOCAL_STORAGE_DIR, cfg.LOCAL_PUBLIC_BASE_URL);
    case 's3':
      return new S3CompatibleProvider({
        endpoint: cfg.S3_ENDPOINT || undefined,
        region: cfg.S3_REGION,
        bucket: cfg.S3_BUCKET,
        accessKeyId: cfg.S3_ACCESS_KEY_ID,
        secretAccessKey: cfg.S3_SECRET_ACCESS_KEY,
        forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
      });
    default:
      throw new Error(`Unknown STORAGE_PROVIDER: ${cfg.STORAGE_PROVIDER}`);
  }
}

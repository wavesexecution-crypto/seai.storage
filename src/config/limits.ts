import type { AppConfig } from './env.js';
import type { FileCategory } from '../domain/types.js';

export function maxBytesForCategory(cfg: AppConfig, category: FileCategory): number {
  switch (category) {
    case 'logo':
    case 'image':
    case 'brand_asset':
    case 'website_asset':
    case 'generated_asset':
      return Math.min(cfg.MAX_IMAGE_SIZE_BYTES, cfg.MAX_FILE_SIZE_BYTES);
    case 'document':
    case 'intake_attachment':
      return Math.min(cfg.MAX_DOCUMENT_SIZE_BYTES, cfg.MAX_FILE_SIZE_BYTES);
    case 'video':
      return Math.min(cfg.MAX_VIDEO_SIZE_BYTES, cfg.MAX_FILE_SIZE_BYTES);
    case 'font':
      return Math.min(cfg.MAX_FONT_SIZE_BYTES, cfg.MAX_FILE_SIZE_BYTES);
    case 'other':
    default:
      return cfg.MAX_FILE_SIZE_BYTES;
  }
}

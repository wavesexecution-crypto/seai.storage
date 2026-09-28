import type { FileCategory } from './types.js';
import { extensionOf } from '../utils/filenames.js';

/**
 * MIME + extension allowlists per category.
 * Browser-provided Content-Type/filename are hints only — magic bytes are
 * inspected at completion time where the provider exposes bytes.
 */

const CATEGORY_MIME: Record<FileCategory, string[]> = {
  logo: ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'],
  image: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'],
  document: [
    'application/pdf',
    'text/plain',
    'text/markdown',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  video: ['video/mp4', 'video/webm'],
  font: ['font/woff', 'font/woff2', 'font/ttf', 'font/otf', 'application/font-woff'],
  brand_asset: ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp', 'application/pdf'],
  website_asset: [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    'text/css',
    'text/javascript',
    'application/javascript',
  ],
  intake_attachment: [
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/pdf',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  generated_asset: [
    'image/png',
    'image/jpeg',
    'image/webp',
    'text/html',
    'text/css',
    'application/zip',
  ],
  other: ['application/octet-stream', 'image/png', 'image/jpeg', 'application/pdf', 'text/plain'],
};

const EXTENSION_MIME: Record<string, string[]> = {
  png: ['image/png'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  gif: ['image/gif'],
  webp: ['image/webp'],
  svg: ['image/svg+xml'],
  pdf: ['application/pdf'],
  txt: ['text/plain'],
  md: ['text/markdown', 'text/plain'],
  doc: ['application/msword'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  mp4: ['video/mp4'],
  webm: ['video/webm'],
  woff: ['font/woff', 'application/font-woff'],
  woff2: ['font/woff2'],
  ttf: ['font/ttf'],
  otf: ['font/otf'],
  css: ['text/css'],
  js: ['text/javascript', 'application/javascript'],
  html: ['text/html'],
  zip: ['application/zip'],
  bin: ['application/octet-stream'],
};

export function allowedMimesForCategory(category: FileCategory): string[] {
  return CATEGORY_MIME[category] ?? CATEGORY_MIME.other;
}

export function validateMimeForCategory(mimeType: string, category: FileCategory): string | null {
  const allowed = allowedMimesForCategory(category);
  if (!allowed.includes(mimeType)) {
    return `MIME type ${mimeType} is not allowed for category ${category}`;
  }
  return null;
}

export function validateExtensionForMime(filename: string, mimeType: string): string | null {
  const ext = extensionOf(filename);
  if (!ext) return 'File must have an extension';
  const mimes = EXTENSION_MIME[ext];
  if (!mimes) return `Extension .${ext} is not allowed`;
  if (!mimes.includes(mimeType)) {
    return `Extension .${ext} does not match MIME type ${mimeType}`;
  }
  return null;
}

/** Minimal magic-byte inspection for common types. Returns error string or null. */
export function inspectMagicBytes(bytes: Buffer, mimeType: string): string | null {
  if (bytes.length < 4) return 'File is too small to verify';
  const head = bytes.subarray(0, 12);
  switch (mimeType) {
    case 'image/png':
      if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return null;
      return 'Content does not match image/png signature';
    case 'image/jpeg':
      if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return null;
      return 'Content does not match image/jpeg signature';
    case 'image/gif':
      if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) return null;
      return 'Content does not match image/gif signature';
    case 'image/webp':
      if (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46) return null;
      return 'Content does not match image/webp signature';
    case 'application/pdf':
      if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return null;
      return 'Content does not match application/pdf signature';
    default:
      // For types without a cheap signature check, do not block — scanner stage owns deeper checks.
      return null;
  }
}

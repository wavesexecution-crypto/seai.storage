/**
 * Filename sanitization for display only.
 * Original filenames are NEVER used as object keys.
 */

const TRAVERSAL = /(^|[\\/])\.\.([\\/]|$)/;
// Intentionally matches control chars (incl. null bytes) to reject unsafe filenames.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

export function sanitizeFilenameForDisplay(input: string): string {
  let name = (input ?? '').trim();
  // Strip any directory components (both separators).
  name = name.split(/[\\/]/).pop() ?? '';
  name = name.replace(CONTROL, '');
  // Collapse whitespace.
  name = name.replace(/\s+/g, ' ').trim();
  // Limit length for display/DB.
  if (name.length > 255) {
    const ext = name.includes('.') ? '.' + (name.split('.').pop() ?? '') : '';
    name = name.slice(0, 255 - ext.length - 1) + '…' + ext;
  }
  if (!name || name === '.' || name === '..') return 'file';
  return name;
}

export function isSuspiciousFilename(input: string): boolean {
  if (!input) return true;
  if (input.includes('\0')) return true;
  if (TRAVERSAL.test(input)) return true;
  if (/^[\\/]/.test(input)) return true;
  if (CONTROL.test(input)) return true;
  return false;
}

export function extensionOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const idx = base.lastIndexOf('.');
  if (idx <= 0 || idx === base.length - 1) return '';
  return base.slice(idx + 1).toLowerCase();
}

import type { FileStatus } from './types.js';

/**
 * UPLOADING -> UPLOADED -> SCANNING -> READY | REJECTED
 * Any live state -> DELETED (soft delete preserves the row).
 * READY <-> published visibility is orthogonal (see visibility field).
 */

const TRANSITIONS: Record<FileStatus, FileStatus[]> = {
  UPLOADING: ['UPLOADED', 'REJECTED', 'DELETED'],
  UPLOADED: ['SCANNING', 'READY', 'REJECTED', 'DELETED'],
  SCANNING: ['READY', 'REJECTED', 'DELETED'],
  READY: ['DELETED'],
  REJECTED: ['DELETED'],
  DELETED: [],
};

export function canTransition(from: FileStatus, to: FileStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from: FileStatus, to: FileStatus): void {
  if (!canTransition(from, to)) {
    throw Object.assign(new Error(`Invalid status transition ${from} -> ${to}`), { statusCode: 409 });
  }
}

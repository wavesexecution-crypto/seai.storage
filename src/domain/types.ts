export const FILE_STATUSES = [
  'UPLOADING',
  'UPLOADED',
  'SCANNING',
  'READY',
  'REJECTED',
  'DELETED',
] as const;
export type FileStatus = (typeof FILE_STATUSES)[number];

export const SCAN_STATUSES = ['PENDING', 'CLEAN', 'INFECTED', 'SKIPPED'] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export const VISIBILITIES = ['PRIVATE', 'PUBLIC'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const FILE_CATEGORIES = [
  'logo',
  'image',
  'document',
  'video',
  'font',
  'brand_asset',
  'website_asset',
  'intake_attachment',
  'generated_asset',
  'other',
] as const;
export type FileCategory = (typeof FILE_CATEGORIES)[number];

export interface StorageObject {
  id: string;
  customerId: string;
  websiteId: string | null;
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string | null;
  status: FileStatus;
  scanStatus: ScanStatus;
  visibility: Visibility;
  category: FileCategory;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface UploadSession {
  id: string;
  objectId: string;
  customerId: string;
  status: 'PENDING' | 'COMPLETED' | 'EXPIRED';
  expiresAt: string;
  completedAt: string | null;
  createdAt: string;
}

export type ActorType = 'user' | 'service';

export interface AuditEvent {
  id: string;
  objectId: string | null;
  customerId: string | null;
  websiteId: string | null;
  actorType: ActorType;
  actorId: string;
  action: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}

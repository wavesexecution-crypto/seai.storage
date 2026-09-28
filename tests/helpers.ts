import { newDb } from 'pg-mem';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import type { AppConfig } from '../src/config/env.js';
import { MemoryProvider } from '../src/providers/MemoryProvider.js';
import { mintUserTokenForTests } from '../src/auth/userAuth.js';
import { __resetRateLimitsForTests } from '../src/middleware/rateLimit.js';
import type { DbClient } from '../src/db/pool.js';

const TEST_DDL = `
CREATE TABLE storage_objects (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  website_id TEXT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  checksum_sha256 TEXT NULL,
  status TEXT NOT NULL DEFAULT 'UPLOADING',
  scan_status TEXT NOT NULL DEFAULT 'PENDING',
  visibility TEXT NOT NULL DEFAULT 'PRIVATE',
  category TEXT NOT NULL DEFAULT 'other',
  published_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL
);
CREATE TABLE upload_sessions (
  id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE storage_events (
  id TEXT PRIMARY KEY,
  object_id TEXT NULL,
  customer_id TEXT NULL,
  website_id TEXT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  details JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    PORT: 4100,
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    DATABASE_URL: 'postgresql://test/test',
    STORAGE_JWT_SECRET: 'test-secret-that-is-at-least-32-chars-long!!',
    SERVICE_API_KEYS: 'cdf:test-service-key',
    STORAGE_PROVIDER: 'memory',
    LOCAL_STORAGE_DIR: './data/objects',
    LOCAL_PUBLIC_BASE_URL: 'http://localhost',
    S3_ENDPOINT: '',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'test',
    S3_ACCESS_KEY_ID: '',
    S3_SECRET_ACCESS_KEY: '',
    S3_FORCE_PATH_STYLE: false,
    S3_PUBLIC_BASE_URL: '',
    UPLOAD_URL_TTL_SECONDS: 900,
    STORAGE_SIGNED_URL_TTL_SECONDS: 300,
    RETENTION_DAYS: 0,
    SCANNER_ENABLED: false,
    MAX_FILE_SIZE_BYTES: 26_214_400,
    MAX_IMAGE_SIZE_BYTES: 10_485_760,
    MAX_DOCUMENT_SIZE_BYTES: 15_728_640,
    MAX_VIDEO_SIZE_BYTES: 104_857_600,
    MAX_FONT_SIZE_BYTES: 5_242_880,
    RATE_LIMIT_WINDOW_MS: 60_000,
    RATE_LIMIT_MAX_UPLOADS: 1000,
    RATE_LIMIT_MAX_DOWNLOADS: 1000,
    RATE_LIMIT_MAX_DELETES: 1000,
    PUBLIC_BASE_URL: 'https://cdn.test',
    serviceKeys: new Map([['cdf', 'test-service-key']]),
    isProduction: false,
    ...overrides,
  };
}

export interface TestContext {
  app: Express;
  cfg: AppConfig;
  db: DbClient;
  provider: MemoryProvider;
  userToken: (customerId: string, websiteIds?: string[] | null) => string;
  serviceHeaders: (overrides?: { customer?: string; website?: string }) => Record<string, string>;
}

export function createTestContext(overrides: Partial<AppConfig> = {}): TestContext {
  __resetRateLimitsForTests();
  const cfg = testConfig(overrides);
  const mem = newDb();
  mem.public.none(TEST_DDL);
  const pg = mem.adapters.createPg();
  const pool = new pg.Pool();
  const db: DbClient = {
    query: (text: string, params?: any[]) => pool.query(text, params),
  };
  const provider = new MemoryProvider('http://localhost');
  const app = createApp({ cfg, db, provider });
  return {
    app,
    cfg,
    db,
    provider,
    userToken: (customerId: string, websiteIds: string[] | null = null) => mintUserTokenForTests(cfg, customerId, websiteIds),
    serviceHeaders: (o) => ({
      'x-seai-service': 'cdf',
      'x-seai-service-key': 'test-service-key',
      ...(o?.customer ? { 'x-on-behalf-of-customer': o.customer } : {}),
      ...(o?.website ? { 'x-on-behalf-of-website': o.website } : {}),
    }),
  };
}

export const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01,
]);

export const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

export const PDF_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);

export async function createReadyFile(
  ctx: TestContext,
  opts: {
    customerId?: string;
    websiteId?: string | null;
    filename?: string;
    mimeType?: string;
    bytes?: Buffer;
    category?: string;
  } = {},
): Promise<{ objectId: string; token: string }> {
  const request = (await import('supertest')).default;
  const customerId = opts.customerId ?? 'cust-a';
  const bytes = opts.bytes ?? PNG_BYTES;
  const token = ctx.userToken(customerId);
  const create = await request(ctx.app)
    .post('/api/v1/uploads')
    .set('Authorization', `Bearer ${token}`)
    .send({
      websiteId: opts.websiteId ?? 'site-1',
      originalFilename: opts.filename ?? 'logo.png',
      mimeType: opts.mimeType ?? 'image/png',
      sizeBytes: bytes.length,
      category: opts.category ?? 'logo',
    });
  if (create.status !== 201) throw new Error(`setup create failed: ${create.status} ${JSON.stringify(create.body)}`);
  const objectId = create.body.object.id as string;
  const put = await request(ctx.app)
    .put(`/api/v1/uploads/${objectId}/bytes`)
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/octet-stream')
    .send(bytes);
  if (put.status !== 200) throw new Error(`setup put failed: ${put.status} ${JSON.stringify(put.body)}`);
  const complete = await request(ctx.app)
    .post(`/api/v1/uploads/${objectId}/complete`)
    .set('Authorization', `Bearer ${token}`)
    .send({});
  if (complete.status !== 200) throw new Error(`setup complete failed: ${complete.status} ${JSON.stringify(complete.body)}`);
  return { objectId, token };
}

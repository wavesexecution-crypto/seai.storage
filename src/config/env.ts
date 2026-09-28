import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4100),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  STORAGE_JWT_SECRET: z.string().min(32, 'STORAGE_JWT_SECRET must be at least 32 chars'),
  SERVICE_API_KEYS: z.string().default(''),

  STORAGE_PROVIDER: z.enum(['memory', 'local', 's3']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('./data/objects'),
  LOCAL_PUBLIC_BASE_URL: z.string().default('http://localhost:4100'),

  S3_ENDPOINT: z.string().default(''),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('seai-storage'),
  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(false),
  S3_PUBLIC_BASE_URL: z.string().default(''),

  UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  STORAGE_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  RETENTION_DAYS: z.coerce.number().int().min(0).default(30),
  SCANNER_ENABLED: z.coerce.boolean().default(false),

  MAX_FILE_SIZE_BYTES: z.coerce.number().int().positive().default(26_214_400),
  MAX_IMAGE_SIZE_BYTES: z.coerce.number().int().positive().default(10_485_760),
  MAX_DOCUMENT_SIZE_BYTES: z.coerce.number().int().positive().default(15_728_640),
  MAX_VIDEO_SIZE_BYTES: z.coerce.number().int().positive().default(104_857_600),
  MAX_FONT_SIZE_BYTES: z.coerce.number().int().positive().default(5_242_880),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX_UPLOADS: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_MAX_DOWNLOADS: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_MAX_DELETES: z.coerce.number().int().positive().default(30),

  PUBLIC_BASE_URL: z.string().default(''),
});

export type Env = z.infer<typeof envSchema>;

function parseServiceKeys(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw.trim()) return map;
  for (const pair of raw.split(',')) {
    const idx = pair.indexOf(':');
    if (idx <= 0) continue;
    const name = pair.slice(0, idx).trim();
    const key = pair.slice(idx + 1).trim();
    if (name && key) map.set(name, key);
  }
  return map;
}

export interface AppConfig extends Env {
  serviceKeys: Map<string, string>;
  isProduction: boolean;
}

let cached: AppConfig | null = null;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse({
    PORT: env.PORT,
    NODE_ENV: env.NODE_ENV,
    LOG_LEVEL: env.LOG_LEVEL,
    DATABASE_URL: env.DATABASE_URL,
    STORAGE_JWT_SECRET: env.STORAGE_JWT_SECRET,
    SERVICE_API_KEYS: env.SERVICE_API_KEYS,
    STORAGE_PROVIDER: env.STORAGE_PROVIDER,
    LOCAL_STORAGE_DIR: env.LOCAL_STORAGE_DIR,
    LOCAL_PUBLIC_BASE_URL: env.LOCAL_PUBLIC_BASE_URL,
    S3_ENDPOINT: env.S3_ENDPOINT,
    S3_REGION: env.S3_REGION,
    S3_BUCKET: env.S3_BUCKET,
    S3_ACCESS_KEY_ID: env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: env.S3_SECRET_ACCESS_KEY,
    S3_FORCE_PATH_STYLE: env.S3_FORCE_PATH_STYLE,
    S3_PUBLIC_BASE_URL: env.S3_PUBLIC_BASE_URL,
    UPLOAD_URL_TTL_SECONDS: env.UPLOAD_URL_TTL_SECONDS,
    STORAGE_SIGNED_URL_TTL_SECONDS: env.STORAGE_SIGNED_URL_TTL_SECONDS,
    RETENTION_DAYS: env.RETENTION_DAYS,
    SCANNER_ENABLED: env.SCANNER_ENABLED,
    MAX_FILE_SIZE_BYTES: env.MAX_FILE_SIZE_BYTES,
    MAX_IMAGE_SIZE_BYTES: env.MAX_IMAGE_SIZE_BYTES,
    MAX_DOCUMENT_SIZE_BYTES: env.MAX_DOCUMENT_SIZE_BYTES,
    MAX_VIDEO_SIZE_BYTES: env.MAX_VIDEO_SIZE_BYTES,
    MAX_FONT_SIZE_BYTES: env.MAX_FONT_SIZE_BYTES,
    RATE_LIMIT_WINDOW_MS: env.RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_MAX_UPLOADS: env.RATE_LIMIT_MAX_UPLOADS,
    RATE_LIMIT_MAX_DOWNLOADS: env.RATE_LIMIT_MAX_DOWNLOADS,
    RATE_LIMIT_MAX_DELETES: env.RATE_LIMIT_MAX_DELETES,
    PUBLIC_BASE_URL: env.PUBLIC_BASE_URL,
  });
  return {
    ...parsed,
    serviceKeys: parseServiceKeys(parsed.SERVICE_API_KEYS),
    isProduction: parsed.NODE_ENV === 'production',
  };
}

export function getConfig(): AppConfig {
  if (!cached) cached = loadConfig();
  return cached;
}

/** Test-only override. */
export function __setConfigForTests(c: AppConfig): void {
  cached = c;
}

export function __resetConfigForTests(): void {
  cached = null;
}

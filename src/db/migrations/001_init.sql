-- 001_init.sql — seai.storage metadata schema.
--
-- Ownership note: customers/websites are owned by CDF (seai). Storage keeps
-- only identifier columns (customer_id, website_id as TEXT) so it never
-- creates a conflicting customer system. No FK to external tables.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS storage_objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id TEXT NOT NULL,
  website_id TEXT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  checksum_sha256 TEXT NULL,
  status TEXT NOT NULL DEFAULT 'UPLOADING'
    CHECK (status IN ('UPLOADING','UPLOADED','SCANNING','READY','REJECTED','DELETED')),
  scan_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (scan_status IN ('PENDING','CLEAN','INFECTED','SKIPPED')),
  visibility TEXT NOT NULL DEFAULT 'PRIVATE'
    CHECK (visibility IN ('PRIVATE','PUBLIC')),
  category TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('logo','image','document','video','font','brand_asset','website_asset','intake_attachment','generated_asset','other')),
  published_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_storage_objects_customer ON storage_objects (customer_id);
CREATE INDEX IF NOT EXISTS idx_storage_objects_customer_website ON storage_objects (customer_id, website_id);
CREATE INDEX IF NOT EXISTS idx_storage_objects_status ON storage_objects (status);
CREATE INDEX IF NOT EXISTS idx_storage_objects_visibility ON storage_objects (visibility);

CREATE TABLE IF NOT EXISTS upload_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id UUID NOT NULL REFERENCES storage_objects(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','COMPLETED','EXPIRED')),
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_upload_sessions_object ON upload_sessions (object_id);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_expires ON upload_sessions (expires_at);

CREATE TABLE IF NOT EXISTS storage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id UUID NULL REFERENCES storage_objects(id) ON DELETE SET NULL,
  customer_id TEXT NULL,
  website_id TEXT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user','service')),
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  details JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_storage_events_object ON storage_events (object_id);
CREATE INDEX IF NOT EXISTS idx_storage_events_customer ON storage_events (customer_id);
CREATE INDEX IF NOT EXISTS idx_storage_events_action ON storage_events (action);

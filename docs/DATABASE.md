# Database schema

PostgreSQL holds metadata only. Migration: `src/db/migrations/001_init.sql`
(run with `npm run db:migrate`). Ownership: customers/websites belong to CDF;
storage keeps `customer_id`/`website_id` as `TEXT` identifiers with no FK to
external tables.

## `storage_objects`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | server-generated (`randomUUID`) |
| `customer_id` | TEXT NOT NULL | tenant owner, from auth context |
| `website_id` | TEXT NULL | optional project scope |
| `storage_key` | TEXT UNIQUE NOT NULL | opaque server key, never user input |
| `original_filename` | TEXT NOT NULL | sanitized display name only |
| `mime_type` | TEXT NOT NULL | validated against category allowlist |
| `size_bytes` | BIGINT NOT NULL | declared size; verified at completion |
| `checksum_sha256` | TEXT NULL | optional, verified when bytes available |
| `status` | TEXT | `UPLOADING→UPLOADED→SCANNING→READY`, plus `REJECTED`, `DELETED` |
| `scan_status` | TEXT | `PENDING` (default) / `CLEAN` / `INFECTED` / `SKIPPED` |
| `visibility` | TEXT | `PRIVATE` (default) / `PUBLIC` |
| `category` | TEXT | one of 10 allowlisted categories |
| `published_at` | TIMESTAMPTZ NULL | set on publish |
| `created_at` / `updated_at` | TIMESTAMPTZ | |
| `deleted_at` | TIMESTAMPTZ NULL | soft-delete marker |

Indexes: `(customer_id)`, `(customer_id, website_id)`, `(status)`, `(visibility)`.

## `upload_sessions`

One row per `POST /uploads` (repeated inits create distinct rows — safe).
`object_id → storage_objects.id`, `status PENDING→COMPLETED`, `expires_at`
from `UPLOAD_URL_TTL_SECONDS`. Completion checks expiry (`410` when expired).

## `storage_events` (audit)

`object_id` (nullable), `customer_id`, `website_id`, `actor_type`
(`user`/`service`), `actor_id`, `action`, `details` (JSONB, secrets stripped),
`created_at`. Actions: `upload_initiated`, `scan_pending`,
`upload_completed`, `download_url_generated`, `file_deleted`,
`file_made_public`, `file_made_private`, `file_rejected`, `file_purged`,
`authorization_failure`.

## Query discipline

- User paths use `getStorageObjectScoped` (`WHERE id AND customer_id`).
- Service paths use `getStorageObjectById` then enforce on-behalf-of match.
- No `DELETE FROM` on metadata; deletion is status + `deleted_at` updates.
- Tests run the same repository code against `pg-mem` (see `tests/helpers.ts`).

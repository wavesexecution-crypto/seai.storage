# seai.storage — Architecture

Production storage backend/control plane for SEAI. Durable file/object storage
with tenant isolation, signed-URL transfers, and lifecycle management.

NOT in scope: public website UI (`seai.public`), CDF UI/flows (`seai`),
payments (`seai.payments`). Those systems integrate via the API contract in
`docs/API_CONTRACT.md`.

## Logical model

```text
PostgreSQL            metadata / ownership / permissions / lifecycle
Object Storage        actual file bytes (S3-compatible)
Storage API (this)    authentication + authorization + signed URLs
CDF / SEAI services   authenticated storage operations (service keys)
Browser               only ever sees short-lived signed URLs, never credentials
```

The database stores metadata. The object store stores bytes. Large binaries
are never stored in PostgreSQL.

## Tenancy

```text
customer
  └── website (optional)
        └── files (storage_objects)
```

- Every `storage_objects` row carries `customer_id` + nullable `website_id`.
- Server derives ownership from authenticated context (user JWT `sub`, or
  service on-behalf-of headers/body). Browser `customerId` is ignored for
  user auth.
- Cross-tenant access returns `404` (no existence leak), with an
  `authorization_failure` audit event.
- Customers/websites are owned by CDF (`seai`). Storage keeps identifier
  columns only — no competing customer tables, no FK to external systems.

## Components

| Area | Location |
|---|---|
| Config (zod-parsed env) | `src/config/env.ts`, `src/config/limits.ts` |
| Domain (keys, validation, lifecycle) | `src/domain/` |
| Providers (memory/local/s3) | `src/providers/` |
| DB (pool, migrations, repositories) | `src/db/` |
| Auth (JWT users, service keys) | `src/auth/`, `src/middleware/auth.ts` |
| Rate limiting | `src/middleware/rateLimit.ts` |
| Business logic | `src/services/storageService.ts`, `src/services/auditService.ts` |
| HTTP API v1 | `src/api/` |
| App factory / bootstrap | `src/app.ts`, `src/server.ts` |

## Key decisions

- **Direct-to-storage uploads** via short-lived signed URLs; the app server
  never proxies large bytes (except the local/memory dev transfer route).
- **Opaque server-generated keys**: `customers/{c}/websites/{w}/objects/{o}`
  (or `customers/{c}/objects/{o}`). Filenames are display metadata only.
- **Explicit public transition**: uploads are always `PRIVATE`; `POST
  /files/:id/publish` is the only path to `PUBLIC`.
- **Soft delete + retention-gated purge**: user delete hides immediately;
  bytes are removed only by service-authenticated purge after `RETENTION_DAYS`.
- **Scanning-ready, not scanning-claimed**: lifecycle passes through
  `SCANNING` with `scanStatus=PENDING`; no AV vendor is integrated
  (see `docs/MALWARE_SCANNING.md`).

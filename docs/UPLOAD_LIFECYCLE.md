# Upload lifecycle

```text
POST /api/v1/uploads            → status UPLOADING, session PENDING, signed upload URL
PUT <signed upload URL>         → bytes land directly in object storage
  (memory/local dev: PUT /api/v1/uploads/:id/bytes)
POST /api/v1/uploads/:id/complete → verify → UPLOADED → SCANNING → READY
```

## Create (`POST /api/v1/uploads`)

Validates: filename safety (rejects `\0`/traversal), category allowlist, MIME
allowlist per category, extension↔MIME match, size vs category + global
limits, checksum format. Derives `customerId`/`websiteId` from auth (user JWT
wins; services supply `customerId` in body or `x-on-behalf-of-*` headers).
Generates opaque `storageKey`, inserts `storage_objects` + `upload_sessions`,
mints short-lived upload URL (`UPLOAD_URL_TTL_SECONDS`, default 15 min),
audits `upload_initiated` (URL never logged).

## Complete (`POST /api/v1/uploads/:id/complete`)

1. Tenant-scoped fetch (`404` for foreign/missing).
2. Idempotency: `READY` returns immediately; `DELETED`/`REJECTED` → `409`.
3. Session expiry check → `410` when expired.
4. `objectExists` → `409` when bytes missing.
5. Size match vs declared → `REJECTED` + `422` on mismatch.
6. Magic-byte + checksum verification where bytes are exposed → `REJECTED` +
   `422` + `file_rejected` audit on failure.
7. `UPLOADING→UPLOADED→SCANNING→READY` with `scanStatus=PENDING`
   (see `MALWARE_SCANNING.md`), session `COMPLETED`, audit
   `upload_completed`.

Repeated inits are safe (distinct UUIDs/keys, no overwrite). Repeated
completions never duplicate state.

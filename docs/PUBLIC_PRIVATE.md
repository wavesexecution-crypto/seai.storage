# Public / private asset model

- Every upload starts `PRIVATE`. Uploading never publishes.
- `POST /api/v1/files/:id/publish` (owner or scoped service, `READY` only)
  transitions to `PUBLIC`, sets `published_at`, audits `file_made_public`.
- `POST /api/v1/files/:id/unpublish` reverts to `PRIVATE` (`file_made_private`).
- `GET /api/v1/files/:id` includes `publicUrl` only when `PUBLIC` **and**
  `PUBLIC_BASE_URL` is configured: `{PUBLIC_BASE_URL}/{storageKey}`.
  With no `PUBLIC_BASE_URL`, `publicUrl` is `null` (CDN not wired — a
  documented pending integration, not a silent public bucket).
- Downloads of `PRIVATE` files always use expiring signed URLs.

# Retention / deletion strategy

- `DELETE /api/v1/files/:id` is a **soft delete**: `status=DELETED` +
  `deleted_at=now()`, audited as `file_deleted`. The object immediately becomes
  `404` for reads/downloads (idempotent; second delete stays safe).
- Provider bytes are **retained** after soft delete for recovery/audit and for
  any active website/deployment references to be resolved by the owning system.
- `POST /api/v1/files/:id/purge` is **service-only** and retention-gated: it
  requires `status=DELETED` and `now - deleted_at ≥ RETENTION_DAYS`
  (default 30 days), then deletes provider bytes and audits `file_purged`.
  The metadata row is kept for audit. There is no uncontrolled permanent-delete
  endpoint.
- Tests use `RETENTION_DAYS=0` to exercise purge deterministically.

# Production deployment

1. Provision managed PostgreSQL; run `npm run db:migrate` from a migration job.
2. Provision an S3-compatible bucket (private, no public access, versioning +
   KMS/SSE per policy); create a least-privilege IAM user (Put/Get/Head/Delete
   on the bucket only).
3. Set env: `NODE_ENV=production`, `DATABASE_URL`, `STORAGE_JWT_SECRET`
   (≥32 random chars, shared verifier with CDF-issued JWTs), `SERVICE_API_KEYS`,
   `STORAGE_PROVIDER=s3` + `S3_*`, short TTLs, `RETENTION_DAYS=30`,
   `SCANNER_ENABLED=false`, `PUBLIC_BASE_URL` (only when the CDN origin is live).
4. Run `npm ci --omit=dev && npm run build && node dist/server.js`
   (production audit of runtime deps is clean: `npm audit --omit=dev` → 0).
5. Terminate TLS at the load balancer; restrict CORS (already limited to
   `https://dash.seai.store` + `https://seai.store` in production).
6. Ship logs (`storage_events` + pino) to the SIEM; alert on
   `authorization_failure` spikes and `file_rejected` bursts.

**Do not go live before**: real `DATABASE_URL`, real S3 bucket + credentials,
`STORAGE_JWT_SECRET` + CDF JWT contract, `SERVICE_API_KEYS` rotation runbook,
and an explicit decision on malware scanning (still `PENDING` — see
`MALWARE_SCANNING.md`). Those are the current production blockers by design:
no fake production wiring is included.

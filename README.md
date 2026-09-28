# seai.storage

Production storage backend/control plane for SEAI — durable object storage
with tenant isolation, signed-URL transfers, and lifecycle management.

- Stack: TypeScript + Express 4 + PostgreSQL (`pg`) + S3-compatible SDK,
  `zod` validation, `pino` logging, `vitest` + `supertest` + `pg-mem` tests
  (same conventions as `seai` / `seai.payments`).
- This is **not** the public site, CDF, or payments. It changes none of those
  systems; they integrate later via `docs/API_CONTRACT.md`.

## Quickstart

```powershell
Copy-Item .env.example .env
docker compose up -d postgres
npm install
npm run db:migrate
npm run dev        # :4100
npm test           # 47 tests, no Docker needed
```

## Layout

- `src/config/` env + limits · `src/domain/` keys, validation, lifecycle
- `src/providers/` memory / local / s3 (`StorageProvider` interface)
- `src/db/` pool, migrations, repositories
- `src/auth/` + `src/middleware/` JWT users, service keys, rate limits
- `src/services/` business logic + audit · `src/api/` versioned routes
- `tests/` authorization, uploads, downloads, deletion, tenancy, security,
  idempotency, public/private · `docs/` full documentation set

## Status

Working backend on local/memory providers with 47/47 tests green, clean
typecheck/build, lint 0 errors, runtime `npm audit` 0 vulnerabilities.
**Not production-live**: no real database/S3 credentials, no CDF JWT/service
contract, no CDN origin, no malware scanner (`scanStatus=PENDING` by design).
See `docs/DEPLOYMENT.md` and the final report for blockers.

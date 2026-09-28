# Local development

Prereqs: Node ≥20, Docker (for Postgres/MinIO).

```powershell
Copy-Item .env.example .env
# edit .env: set STORAGE_JWT_SECRET (≥32 chars), SERVICE_API_KEYS
docker compose up -d postgres        # pg on localhost:5434
# optional S3-compatible backend:
docker compose up -d minio           # API :9000, console :9001
npm install
npm run db:migrate
npm run dev                          # http://localhost:4100
```

- Default `STORAGE_PROVIDER=local` needs no MinIO (bytes under `./data/`).
- For MinIO: create bucket `seai-storage-dev`, set `STORAGE_PROVIDER=s3`,
  `S3_ENDPOINT=http://localhost:9000`, `S3_REGION=us-east-1`,
  `S3_BUCKET=seai-storage-dev`, `S3_ACCESS_KEY_ID=minioadmin`,
  `S3_SECRET_ACCESS_KEY=minioadmin123`, `S3_FORCE_PATH_STYLE=true`.
- `npm test` runs the 47-test suite (pg-mem + memory provider, no Docker needed).
- `npm run typecheck`, `npm run build`, `npm run lint` for verification.

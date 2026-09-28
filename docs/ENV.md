# Environment variables

See `.env.example`. All provider credentials are server-side only.

| Var | Purpose | Default |
|---|---|---|
| `PORT` / `NODE_ENV` / `LOG_LEVEL` | runtime | `4100` / `development` / `info` |
| `DATABASE_URL` | PostgreSQL metadata | (required) |
| `STORAGE_JWT_SECRET` | verify user JWTs + sign local URLs (≥32 chars) | (required) |
| `SERVICE_API_KEYS` | `name:key,...` service credentials | empty |
| `STORAGE_PROVIDER` | `memory` \| `local` \| `s3` | `local` |
| `LOCAL_STORAGE_DIR` / `LOCAL_PUBLIC_BASE_URL` | local provider | `./data/objects` |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_FORCE_PATH_STYLE` / `S3_PUBLIC_BASE_URL` | S3-compatible | bucket `seai-storage` |
| `UPLOAD_URL_TTL_SECONDS` | signed upload TTL | `900` |
| `STORAGE_SIGNED_URL_TTL_SECONDS` | signed download TTL | `300` |
| `RETENTION_DAYS` | soft-delete retention before purge | `30` |
| `SCANNER_ENABLED` | must stay `false` until a real scanner exists | `false` |
| `MAX_FILE_SIZE_BYTES` + per-category (`IMAGE`, `DOCUMENT`, `VIDEO`, `FONT`) | size limits | 25MB global / 10MB image / 15MB doc / 100MB video / 5MB font |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX_{UPLOADS,DOWNLOADS,DELETES}` | abuse protection | 60s / 30 / 120 / 30 |
| `PUBLIC_BASE_URL` | CDN origin for `PUBLIC` assets | empty (not configured) |

Never commit real values. No fake production credentials are included.

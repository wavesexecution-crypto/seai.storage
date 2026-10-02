# Production activation runbook — seai.storage

Status until every step passes: **STORAGE_BLOCKED_EXTERNAL_ACCESS**.
Mark **STORAGE_PRODUCTION_LIVE** only after `npm run verify:production`
exits 0 against the real host + real bucket.

No step prints or commits secrets. All secrets travel via environment
variables and hosting dashboards only.

## 0. Prerequisites (external — the only manual boundary)

1. **Backblaze B2 bucket** `seai-storage-prod` (Backblaze console → Buckets;
   private, no public access — B2 buckets are private by default, do not
   enable public access or attach a public domain). Use the existing
   `seai-storage-prod` bucket — do not create another bucket, do not migrate
   to R2. Create a scoped application key: App Keys → Add a New Application
   Key scoped to `seai-storage-prod` only (Object Read & Write). Note the
   bucket's S3 endpoint `https://s3.<region>.backblazeb2.com` and region (2nd
   part of the endpoint, e.g. `us-west-004`). If the key is bucket-restricted,
   include the `listAllBucketNames` capability for AWS SDK compatibility.
2. **Persistent Node host** (VPS / Render / Railway / Fly — NOT Vercel
   serverless: function payload caps conflict with the raw-upload route).
   Node 20+, HTTPS terminated at the host/LB, tides to
   `https://storage.seai.store` (or the chosen hostname).

## 1. Bucket CORS (exact artifact)

Backblaze console → bucket → CORS settings → paste (or via S3 API
`PutBucketCors` against the B2 S3 endpoint with
`--endpoint-url https://s3.<region>.backblazeb2.com`):

```json
[
  {
    "AllowedOrigins": ["https://seai.store", "https://dash.seai.store"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type", "Content-Length"],
    "ExposeHeaders": ["ETag", "Content-Length"],
    "MaxAgeSeconds": 3600
  }
]
```

AWS S3 equivalent via CLI against B2 (no wildcard origin; B2 has no
`put-public-access-block` — privacy comes from the bucket staying private in
the Backblaze console):

```bash
aws s3api put-bucket-cors --bucket seai-storage-prod \
  --endpoint-url https://s3.<region>.backblazeb2.com --region <region> \
  --cors-configuration '{
  "CORSRules": [{
    "AllowedOrigins": ["https://seai.store", "https://dash.seai.store"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type", "Content-Length"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }]
}'
# Keep the bucket private in the Backblaze console (private ACL only).
# Do not attach a public domain. Do not use canned ACL `public-read`.
```

## 2. Host environment (exact names — values from the secret handoff)

```bash
DATABASE_URL=<production Neon seai_storage URL>
STORAGE_PROVIDER=s3
S3_ENDPOINT=https://s3.<region>.backblazeb2.com
S3_REGION=<region, e.g. us-west-004 — must match the endpoint, never `auto`>
S3_BUCKET=seai-storage-prod
S3_ACCESS_KEY_ID=<scoped key>
S3_SECRET_ACCESS_KEY=<scoped secret>
S3_FORCE_PATH_STYLE=false
STORAGE_JWT_SECRET=<64-hex secret>
SERVICE_API_KEYS=cdf:<key>,seai-public:<key>
PUBLIC_BASE_URL=https://storage.seai.store   # CDN origin when live; empty until then
STORAGE_SIGNED_URL_TTL_SECONDS=300
UPLOAD_URL_TTL_SECONDS=900
RETENTION_DAYS=30
SCANNER_ENABLED=false                         # real scanner only — never flip otherwise
PORT=4100
NODE_ENV=production
LOG_LEVEL=info
```

`DATABASE_URL` for the existing Neon database (no second database):

```bash
neon connection-string --project-id lively-feather-90661744 \
  --branch main --database-name seai_storage --role-name neondb_owner
```

## 3. Deploy

```bash
npm ci --omit=dev
npm run db:migrate        # 001_init.sql is idempotent (IF NOT EXISTS)
npm run build
node dist/server.js       # or pm2 / systemd (see below)
```

Minimal systemd unit (`/etc/systemd/system/seai-storage.service`):

```ini
[Unit]
Description=seai.storage control plane
After=network.target

[Service]
Type=simple
User=seai
WorkingDirectory=/srv/seai.storage
EnvironmentFile=/srv/seai.storage/.env.production
ExecStart=/usr/bin/node dist/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Then: `GET https://<host>/health` must return
`{"ok":true,"service":"seai.storage",...}`.

## 4. Wire CDF + public intake

```bash
# CDF (Vercel project seai1234) — URL only; secrets already set:
echo "https://<storage-host>" | vercel env add STORAGE_SERVICE_URL production --project seai1234
# Redeploy CDF from commit 4e2af61, then run its db:migrate (applies schema-storage.sql).

# Public intake proxy host env (same secret handoff, server-side only):
# SEAI_STORAGE_API_BASE=https://<storage-host>
# SEAI_STORAGE_SERVICE_NAME=seai-public
# SEAI_STORAGE_SERVICE_KEY=<seai-public key>
# ALLOWED_ORIGIN=https://seai.store
```

Browsers must only ever receive signed URLs + file IDs (audited clean).

## 5. Activate (single command, real bytes, self-cleaning)

```bash
STORAGE_API_URL=https://<storage-host> \
STORAGE_JWT_SECRET=<secret> \
SERVICE_API_KEYS='cdf:<key>,seai-public:<key>' \
S3_ENDPOINT=... S3_REGION=<region> S3_BUCKET=seai-storage-prod \
S3_ACCESS_KEY_ID=<key> S3_SECRET_ACCESS_KEY=<secret> \
PUBLIC_BASE_URL=https://<storage-host-or-cdn> \
  npm run verify:production
```

The script (`scripts/verify-production.mjs`) runs the A–M matrix:
upload → complete → READY → signed download with byte comparison →
cross-tenant 404s → publish/unpublish → delete → expiry 410 →
anonymous-URL denial (unsigned GET must 403/404) → intake-scope upload →
service-delegation (CDF Modify path) → soft-deletes everything it created
and reports the DELETED rows for post-retention purge. Exit 0 = all pass
(SKIPs reported, never silent). It never logs secret values.

## 6. Rollback

Host: redeploy previous artifact / stop service. CDF/public: Vercel
rollback to the pre-storage deployments (baselines `d9ac827` / `5b10e48`
recorded). Database: migrations are additive (`IF NOT EXISTS`) — nothing to
roll back. Retention-gated purge is service-only; no data loss path exists
in normal operation.

## 7. Scanner + publicity posture

`SCANNER_ENABLED=false` until a real AV worker exists (see
`docs/MALWARE_SCANNING.md`). Uploaded files carry MIME/extension/size
limits, magic-byte and checksum verification — documented as validation,
never as malware scanning. `PUBLIC_BASE_URL` empty ⇒ `publicUrl: null`;
set it only when the CDN origin actually serves the bucket.

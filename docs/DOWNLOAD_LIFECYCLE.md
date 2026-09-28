# Download lifecycle

Private files have **no permanent public URLs**. Every download is a
short-lived signed URL minted after authorization.

```text
GET /api/v1/files/:id/download → authz → READY check → signed URL (TTL)
GET <signed URL>                → bytes (S3 directly, or local-download route)
```

- `GET /api/v1/files/:id` returns metadata; `PRIVATE` files include
  `publicUrl: null`.
- `GET /api/v1/files/:id/download` (`downloads` rate-limit group) returns
  `{ downloadUrl, expiresAt, mimeType }`; TTL is
  `STORAGE_SIGNED_URL_TTL_SECONDS` (default 5 min). Audits
  `download_url_generated` without storing the URL.
- Only `READY` files are downloadable (`409` otherwise); soft-deleted files
  are `404`.
- s3: presigned S3 GET. memory/local: HMAC-signed
  `/api/v1/local-download/:id?exp=&token=` (expiry → `410`, tamper → `401`).
- Provider credentials never leave the server; browsers see only the signed URL.

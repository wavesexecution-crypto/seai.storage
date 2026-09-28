# API contract (v1)

Base: `/api/v1`. Auth: user Bearer JWT or service headers (see `AUTH.md`).
Errors: `{ ok: false, error, requestId }` (`400` validation, `401` unauth,
`403` forbidden, `404` not-found incl. foreign tenants, `409` state conflict,
`410` expired upload/URL, `413` oversize, `429` rate-limited).

## Uploads

`POST /uploads` → `201 { ok, object, uploadSessionId, uploadUrl, expiresAt }`

```json
{ "websiteId": "site-1", "originalFilename": "logo.png", "mimeType": "image/png",
  "sizeBytes": 12345, "checksumSha256": null, "category": "logo",
  "customerId": "(services only)" }
```

`POST /uploads/:id/complete` → `200 { ok, object }` (idempotent)
`PUT /uploads/:id/bytes` (memory/local only, `application/octet-stream`) →
`200 { ok, receivedBytes }`; on s3 the client PUTs to `uploadUrl` instead.

## Files

- `GET /files/:id` → `200 { ok, file }` (`file` includes `publicUrl` or `null`).
- `GET /files/:id/download` → `200 { ok, downloadUrl, expiresAt, mimeType }`.
- `DELETE /files/:id` → soft delete → `200 { ok, file }`.
- `POST /files/:id/publish` / `/unpublish` → visibility transition.
- `POST /files/:id/purge` (service-only, post-retention) → `200 { ok, purged: true }`.

## Transfer

- `GET /local-download/:id?exp=&token=` (memory/local signed downloads).
- `GET /health`, `GET /api/v1/health` (no auth).

## Integration contract with CDF / public site (FINAL — implemented)

See `docs/INTEGRATION_CONTRACT_FINAL.md` (binding) and
`docs/PUBLIC_CDF_INTEGRATION.md` (implemented wiring).

1. CDF issues HS256 user JWTs (`sub`=CDF `users.id`, `websiteIds`=
   `customer_websites.id` list, 5-min expiry) from its backend only —
   implemented in CDF `src/storage/tokens.ts`.
2. Service auth `x-seai-service` = `cdf` / `seai-public` with per-request
   on-behalf-of delegation — implemented in CDF `src/storage/client.ts` and
   public `server/storage-proxy.js`. Keys still provisioned out-of-band.
3. Public site talks to storage only through the intake proxy; browsers see
   signed URLs + file IDs. CDN origin still not configured (`publicUrl: null`
   until `PUBLIC_BASE_URL` is set).
4. Generation reads via service auth constrained to `(customerId, websiteId)`
   IDs resolved from CDF's mapping table — no bucket-wide access.

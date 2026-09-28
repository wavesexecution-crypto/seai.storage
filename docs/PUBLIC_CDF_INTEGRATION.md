# Public-site + CDF integration (implemented)

Binding contract: `docs/INTEGRATION_CONTRACT_FINAL.md`. This document
describes the implemented wiring. No storage features were added — CDF lists
from its own `customer_files` mapping table, never by scanning the bucket.

## Public site (`seai.store` intake → storage)

`server/storage-proxy.js` (standalone, same-origin with the payment proxy).
Browser receives only signed upload URLs + file IDs.

```text
intake step 3 (logo/photos)
  → POST /api/storage/intake/uploads (proxy mints intake:<uuid> scope)
  → PUT <uploadUrl> directly (S3) or PUT .../bytes (proxy relay)
  → POST .../complete → file READY, fileId kept in page memory
  → payment metadata carries intakeSessionId + storageFileIds[] (IDs only)
```

- Scope is server-minted per `seai_intake` httpOnly cookie; browser
  `customerId` is dropped. Oversize (>5MB) and off-allowlist categories are
  rejected at the proxy before storage is touched.
- `public/intake.js` uploads before `initiatePayment`; failures abort submit
  with an error (no silent loss). Minimal repairs included: `intake.html`
  loads `/intake.js`, stray dead lines removed, local `showError` added.

## CDF (`dash.seai.store` ↔ storage)

`src/storage/` in CDF: `client.ts` (service headers + safe error mapping),
`tokens.ts` (HS256 minter, 5-min, session-bound), `router.ts` (proxy).
Mounted at `/api/storage` behind the session guard (`src/app.ts`).

- `POST /api/storage/uploads` → service initiate with on-behalf-of delegation;
  records `customer_files` mapping; returns upload URL + short-lived direct
  token. `PUT /api/storage/uploads/:id/bytes` relays ≤5MB files;
  `POST .../complete` marks mapping READY.
- `GET /api/storage/files[?websiteId=]` lists from the mapping table.
  Metadata/download/delete/publish/unpublish verify mapping ownership first,
  then call storage with delegation. Cross-tenant → `404`.
- Modify flow: composer uploads via the proxy, links with
  `POST /requests/:id/attachments/storage { fileId }` → `attachments` row
  carries `file_id`, `data_url` NULL. Legacy byte endpoint untouched.
- Intake adoption: `PUT /api/customer/website` accepts `intakeFileIds[]` +
  `orderRef`; each file is verified (privileged read: READY, `intake:` scope,
  intake category) then mapped to `(user, website)`.
- Generation (when built): resolve IDs from `customer_files WHERE user +
  website + READY`, fetch per-ID via service auth. Never bucket-wide.

## AuthN/Z summary

Users: CDF session cookie → proxy derives `users.id` / owned
`customer_websites.id`; JWTs minted server-side only (HS256, sub=user,
websiteIds allowlist, 5-min). Services: `x-seai-service` (`cdf`,
`seai-public`) + key + on-behalf-of delegation. Secrets exist only in
server env (`STORAGE_*` / `SEAI_STORAGE_*`); both browser bundles audited
clean (no `STORAGE_JWT_SECRET`, `SERVICE_API_KEYS`, `S3_*`, `DATABASE_URL`).

## Production env (still to provision)

Storage: `DATABASE_URL`, `STORAGE_JWT_SECRET`, `SERVICE_API_KEYS`
(`cdf:`, `seai-public:`), `STORAGE_PROVIDER=s3` + `S3_*`,
`PUBLIC_BASE_URL`/CDN. CDF: `STORAGE_SERVICE_URL`, `STORAGE_SERVICE_NAME`,
`STORAGE_SERVICE_KEY`, `STORAGE_JWT_SECRET`. Proxy: `SEAI_STORAGE_API_BASE`,
`SEAI_STORAGE_SERVICE_NAME`, `SEAI_STORAGE_SERVICE_KEY`, `ALLOWED_ORIGIN`.
Plus pre-existing breakage outside storage scope: `server/payment-proxy.js`
was repaired against the seai.payments contract during this integration
(valid syntax, Bearer auth, server-authoritative plan allowlist); live
payments still require the provisioned `SEAI_PUBLIC_SERVICE_KEY` and
Razorpay credentials in seai.payments.

## Text-to-site generation TODO (pipeline not built yet)

When the generation system is built, it must implement exactly the retrieval
pattern from `INTEGRATION_CONTRACT_FINAL.md` §6:

1. Accept only `(customerId, websiteId)` from the website job record — never
   from model output or user text.
2. `SELECT storage_file_id FROM customer_files WHERE user_id AND website_id
   AND status='READY'` (CDF side; add category filter for
   `website_asset,image,logo,brand_asset,generated_asset`).
3. Fetch each object via storage service-auth metadata/download calls.
4. Reject the job if any referenced file fails the ownership check.
5. Publish only explicitly approved assets (`publish` endpoint); deploy reads
   `publicUrl` via CDN.

No new storage endpoints are needed for this. The remaining work is entirely
in the future generation service plus CDN provisioning.

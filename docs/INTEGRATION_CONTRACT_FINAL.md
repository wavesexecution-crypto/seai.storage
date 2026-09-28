# INTEGRATION CONTRACT — FINAL (CDF + public site ↔ seai.storage)

Status: binding. Derived from audits of the actual code (no assumptions).
Storage backend unchanged; this contract is implemented by CDF (`D:\seai`)
and the public intake proxy (`D:\seai.public/server/storage-proxy.js`).

Evidence: CDF sessions `D:\seai\src\auth\routes.ts:33-57`, identity
`D:\seai\src\customer\routes.ts:21-23`, website row
`D:\seai\src\customer\routes.ts:77-86`, attachments
`D:\seai\src\customer\routes.ts:270-297`; public intake
`D:\seai.public\public\intake.js`, payment metadata
`D:\seai.public\public\payment.js:31-68`, proxy
`D:\seai.public\server\payment-proxy.js`.

---

## 1. JWT contract (CDF-issued user tokens for storage)

Used for: browser→storage direct calls that need user scope without service
keys (byte PUT to `/uploads/:id/bytes` on memory/local providers, future
direct reads). Primary flows use service-auth proxying instead; the JWT path
exists so bytes never transit app servers unnecessarily.

| Field | Exact value |
|---|---|
| `alg` | `HS256` only (storage rejects all else) |
| `iss` / `aud` | none required; storage verifies signature + `exp` only — do not add |
| `sub` | CDF `users.id` (UUID v4) = storage `customerId`. No prefixes |
| `websiteIds` | JSON array of `customer_websites.id` (UUID v4) for this user; `[]` when the user has no website row yet |
| `exp` | `iat + 300s` (5 min). Never more than 900s |
| `STORAGE_JWT_SECRET` | ≥32 cryptographically random bytes, shared by CDF backend and storage out-of-band. Server-side only — never in browser bundles, never in responses except inside a minted token |

Minter lives in CDF backend only (`src/storage/tokens.ts`), fed by the
validated session (`req.user.id`); website list read from
`customer_websites WHERE user_id`. Endpoint `POST /api/storage/token`
(session-authenticated) returns `{ token, expiresAt }`.

## 2. Service authentication

Headers (exact names, matched case-insensitively by Express):

- `x-seai-service: cdf` — CDF backend (`D:\seai`)
- `x-seai-service: seai-public` — public intake proxy (`D:\seai.public/server`)
- `x-seai-service-key: <key>` — ≥32-char random per service, server-side only
- Delegation (server-generated only, never from browsers):
  `x-on-behalf-of-customer: <users.id>`,
  `x-on-behalf-of-website: <customer_websites.id>`

Storage `SERVICE_API_KEYS` format: `cdf:<key1>,seai-public:<key2>`
(comma-separated `name:key`, keys provisioned out-of-band).

CDF operations using service auth (all via `POST/GET/DELETE /api/storage/*`
proxy, each deriving scope from the session): initiate upload, complete
upload, file metadata, download URL, list (from CDF mapping table), soft
delete, publish/unpublish, Modify-attachment link. Purge is never called by
CDF (retention-owned by storage ops).

Public proxy operations (service `seai-public`, provisional scope only):
intake initiate + complete (+ byte relay for non-S3 providers).

## 3. Tenant isolation

- `customerId` format: UUID v4, exactly CDF `users.id`. CDF mapping:
  session cookie `seai_session` → `validateSession` → `req.user.id`
  (`src/auth/middleware.ts:17-26`, `src/customer/routes.ts:21-23`).
- `websiteId` format: UUID v4, exactly `customer_websites.id`, or `null`
  pre-intake. Website ownership validation (mandatory before scoping):
  `db.list('customer_websites', { id: websiteId, user_id: req.user.id }, 1)` —
  empty result means forbidden (surface as `404`).
- CDF never forwards a browser-supplied `customerId`/`websiteId` to storage;
  both are re-derived server-side per request.
- Public intake (anonymous, pre-payment, no CDF user exists): proxy mints a
  server-side UUID intake session (`seai_intake` httpOnly cookie) and uses
  provisional scope `customerId = "intake:<uuid>"`, `websiteId = null`.
  This scope is how intake files are isolated from every real customer.
  Adoption (§5) moves references, never raw scope.

## 4. Storage categories (canonical for SEAI)

Required: `logo`, `image`, `brand_asset`, `intake_attachment`, `document`,
`website_asset`, `generated_asset`. Storage also accepts `video`, `font`,
`other` but SEAI flows must not use them (CDF proxy allowlists the seven;
anything else → `400` before reaching storage).

- Intake (public): `logo`, `image`, `brand_asset`, `document`,
  `intake_attachment`.
- Modify attachments (CDF): `image`, `document`, `intake_attachment`.
- Website assets (CDF/generation): `website_asset`, `image`, `logo`,
  `brand_asset`, `generated_asset`.

## 5. Intake → payment → CDF adoption (no second identity system)

1. Intake step 3 uploads via public proxy under `intake:<uuid>` scope; proxy
   returns storage `fileId`s; browser keeps them in memory only.
2. `createPaymentOrder` metadata (server-merged by the proxy at verify time,
   client-carried before that) includes `intakeSessionId` + `storageFileIds[]`
   — IDs only, never bytes, never keys.
3. Payment stays in `seai.payments` (untouched). No storage coupling to
   Razorpay; no customer creation on payment in CDF (unchanged).
4. After signup, CDF `PUT /api/customer/website` accepts optional
   `intakeFileIds[]` + `orderRef`. CDF backend verifies each file via
   privileged service read: must exist, `status READY`, scope starts with
   `intake:`, category in §4 intake set. Verified IDs are recorded in CDF's
   `customer_files` mapping table under the real `(user_id, website_id)`.
   Unverified IDs are rejected; intake-scoped bytes are never re-keyed.
5. Modify flow: `POST /requests/:id/attachments/storage { fileId }` verifies
   mapping ownership + `READY`, then inserts an `attachments` row with
   `file_id` (no `data_url` bytes). Legacy `data_url` endpoint untouched.

## 6. Website generation asset retrieval

No generation pipeline for customer sites exists in CDF today
(`creation/` builds Shopify stores; `gateway/` proxies Shopify; `brain/` is
markdown). When one is built, it must:

- Run server-side with service auth (`cdf`), never in a browser/agent prompt.
- Input exactly `(customerId, websiteId)`; resolve file IDs from CDF's
  `customer_files WHERE user_id AND website_id AND status='READY'`.
- Fetch each file via service-auth metadata/download calls only.
- Restrict to categories `website_asset, image, logo, brand_asset,
  generated_asset` and `status READY`.
- Never list or scan the storage bucket; never accept file IDs from
  untrusted input without the ownership check above. Customer A assets must
  be unreachable from a `(customerB, *)` generation context by construction.

## 7. Public assets (PRIVATE → PUBLIC)

- Intake/completed uploads are always `PRIVATE`. Nothing auto-publishes.
- Publish path: CDF-authenticated owner → `POST /api/storage/files/:id/publish`
  (mapping ownership verified; `website_asset` recommended) → storage
  `file_made_public` audit → response carries `publicUrl`.
- Deployed website embeds only `publicUrl` (CDN origin). Unpublish reverts to
  `PRIVATE` (`publicUrl: null`). Storage bucket itself is never public.

## 8. Production infrastructure (all still to configure)

| Item | Needed |
|---|---|
| PostgreSQL for storage | managed instance + `DATABASE_URL` + `npm run db:migrate` |
| S3-compatible bucket | private bucket + least-privilege key pair (`S3_*`) |
| `STORAGE_JWT_SECRET` | ≥32 random bytes, shared CDF↔storage, server-side only |
| `SERVICE_API_KEYS` | `cdf:` + `seai-public:` keys, provisioned out-of-band |
| `PUBLIC_BASE_URL`/CDN | origin for `PUBLIC` assets (unset = `publicUrl: null`) |
| CDF env | `STORAGE_SERVICE_URL`, `STORAGE_SERVICE_NAME=cdf`, `STORAGE_SERVICE_KEY`, `STORAGE_JWT_SECRET` |
| Public proxy env | `SEAI_STORAGE_API_BASE`, `SEAI_STORAGE_SERVICE_NAME=seai-public`, `SEAI_STORAGE_SERVICE_KEY`, `ALLOWED_ORIGIN` |
| Pre-existing breakage (not storage) | `server/payment-proxy.js` mangled template literals + `SEPAYMENT_*` typo; `intake.js` not loaded by `intake.html` (fixed minimally, see integration notes) |

Malware scanning stays disabled (`scanStatus=PENDING`); no readiness claimed.

# Authentication, authorization, customer isolation

## Authentication (two separate mechanisms)

**User auth** — `Authorization: Bearer <JWT>` (HS256, `STORAGE_JWT_SECRET`).
Claims: `sub` (or `customerId`) = customer, optional `websiteIds` allowlist.
Production tokens are issued by CDF/auth; this service only verifies.
`mintUserTokenForTests` exists for tests only.

**Service auth** — `x-seai-service: <name>` + `x-seai-service-key: <key>`
matched against server-side `SERVICE_API_KEYS` (`name:key,...`). Optional
delegation: `x-on-behalf-of-customer`, `x-on-behalf-of-website`. Service keys
are server-to-server secrets and must never ship in frontend JavaScript.

Service headers take precedence when present; otherwise the Bearer JWT path
applies. Token-authenticated local downloads (`exp`+HMAC `token`) are handled
by their own route.

## Authorization

- `customerId` for users always comes from the JWT — body values are ignored
  (forged `customerId` test proves this).
- Services must declare their tenant scope (body `customerId` or on-behalf-of
  headers; mismatch → `400`).
- Optional JWT `websiteIds` allowlist is enforced (`403` outside it).
- `purge` is service-only (`403` for users).

## Customer isolation

- All user reads/writes go through tenant-scoped queries
  (`WHERE id AND customer_id`); service paths verify on-behalf-of match.
- Foreign/missing objects return `404` with no owner details, plus an
  `authorization_failure` audit event.
- Object keys embed the tenant
  (`customers/{c}/websites/{w}/objects/{o}`); keys are server-generated and
  never accepted from request bodies.
- Rate limits are bucketed per user/service key and operation group.

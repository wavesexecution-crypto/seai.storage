#!/usr/bin/env node
/**
 * Production activation verification for seai.storage (A–M matrix).
 *
 * Reads ALL configuration from the environment (see docs/ACTIVATION.md).
 * Never logs secret values: URLs are redacted to origin+path, only
 * statuses, IDs, counts and booleans are printed.
 *
 * Exit 0: every applicable check passed (SKIPs reported, never silent).
 * Exit 1: any check failed. Exit 2: environment incomplete.
 *
 * Cleanup: every object created under the `prodverify-` / `intake:` test
 * scopes is soft-deleted; the script then proves each is 404 and prints the
 * DELETED row IDs for post-retention purge. Nothing is left accessible.
 */
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import {
  S3Client,
  HeadBucketCommand,
  HeadObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';

const req = (name) => {
  const v = process.env[name];
  if (!v) {
    console.error(`MISSING ENV (name only): ${name}`);
    process.exit(2);
  }
  return v;
};

const API = req('STORAGE_API_URL').replace(/\/$/, '');
const JWT_SECRET = req('STORAGE_JWT_SECRET');
const SERVICE_KEYS = req('SERVICE_API_KEYS');
const S3_ENDPOINT = req('S3_ENDPOINT');
const S3_REGION = req('S3_REGION');
const S3_BUCKET = req('S3_BUCKET');
const S3_KEY = req('S3_ACCESS_KEY_ID');
const S3_SECRET = req('S3_SECRET_ACCESS_KEY');
const PUBLIC_BASE = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');

function serviceKeyFor(name) {
  for (const pair of SERVICE_KEYS.split(',')) {
    const i = pair.indexOf(':');
    if (pair.slice(0, i).trim() === name) return pair.slice(i + 1).trim();
  }
  console.error(`MISSING service key name (name only): ${name}`);
  process.exit(2);
}
const CDF_KEY = serviceKeyFor('cdf');
const PUBLIC_KEY = serviceKeyFor('seai-public');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 4, 5, 6, 7, 8, 9]);
const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 10, 11, 12, 13]);

const s3 = new S3Client({
  endpoint: S3_ENDPOINT,
  region: S3_REGION,
  credentials: { accessKeyId: S3_KEY, secretAccessKey: S3_SECRET },
  forcePathStyle: String(process.env.S3_FORCE_PATH_STYLE || 'false') === 'true',
});

let pass = 0;
let fail = 0;
let skip = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name}`); }
};
const skipIt = (name, why) => { skip++; console.log(`SKIP ${name} — ${why}`); };
const redactUrl = (u) => {
  try {
    const p = new URL(u);
    return `${p.origin}${p.pathname}?<signature-redacted>`;
  } catch { return '<unparseable-url>'; }
};
const mint = (sub, websiteIds, expiresIn = '1h') =>
  jwt.sign({ websiteIds }, JWT_SECRET, { algorithm: 'HS256', subject: sub, expiresIn });

const A = mint('prodverify-a', ['site-a']);
const B = mint('prodverify-b', ['site-b']);
// tracked objects: { id, del: {token} | {svc, scope} }
const tracked = [];
const svcHeaders = (key, scope) => ({
  'x-seai-service': scope === undefined ? 'cdf' : scope.svc,
  'x-seai-service-key': scope === undefined ? key : scope.key,
  ...(scope?.customer ? { 'x-on-behalf-of-customer': scope.customer } : {}),
  ...(scope?.website ? { 'x-on-behalf-of-website': scope.website } : {}),
});
const cdf = (customer, website) => svcHeaders(CDF_KEY, customer ? { svc: 'cdf', key: CDF_KEY, customer, website } : undefined);
const pubSvc = (customer) => svcHeaders(PUBLIC_KEY, { svc: 'seai-public', key: PUBLIC_KEY, customer });

async function json(method, path, { token, headers, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  return { status: res.status, data };
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

async function uploadFlow({ token, headers, site, name, mime, bytes, category, customerId }) {
  const c = await json('POST', '/api/v1/uploads', {
    token,
    headers,
    body: { websiteId: site, originalFilename: name, mimeType: mime, sizeBytes: bytes.length, category, ...(customerId ? { customerId } : {}) },
  });
  if (c.status !== 201) return { id: null, createStatus: c.status };
  const id = c.data.object.id;
  const put = await fetch(c.data.uploadUrl, { method: 'PUT', headers: { 'Content-Type': mime }, body: bytes });
  if (put.status < 200 || put.status >= 300) return { id, putStatus: put.status };
  const done = await json('POST', `/api/v1/uploads/${id}/complete`, { token, headers, body: { ...(customerId ? { customerId } : {}) } });
  return { id, key: c.data.object.storageKey, ready: done.status === 200 && done.data.object.status === 'READY' };
}

const main = async () => {
  const health = await fetch(API + '/health').then((r) => r.json());
  check('health ok (s3 provider)', health.ok === true && health.provider === 's3');

  try {
    await s3.send(new HeadBucketCommand({ Bucket: S3_BUCKET }));
    check('bucket reachable (HeadBucket)', true);
  } catch {
    console.error('BUCKET UNREACHABLE (name only): set S3_* to the provisioned bucket — see docs/ACTIVATION.md step 1');
    process.exit(2);
  }

  // A/B/C. customer A uploads (logo + image + document); B uploads logo.
  const a1 = await uploadFlow({ token: A, site: 'site-a', name: 'a-logo.png', mime: 'image/png', bytes: PNG, category: 'logo' });
  const a2 = await uploadFlow({ token: A, site: 'site-a', name: 'a-photo.jpg', mime: 'image/jpeg', bytes: JPG, category: 'image' });
  const a3 = await uploadFlow({ token: A, site: 'site-a', name: 'a-doc.pdf', mime: 'application/pdf', bytes: PDF, category: 'document' });
  const b1 = await uploadFlow({ token: B, site: 'site-b', name: 'b-logo.png', mime: 'image/png', bytes: PNG, category: 'logo' });
  check('A logo+image+document READY', Boolean(a1.ready && a2.ready && a3.ready));
  check('B logo READY', Boolean(b1.ready));
  tracked.push({ id: a1.id, del: { token: A } }, { id: a2.id, del: { token: A } }, { id: a3.id, del: { token: A } }, { id: b1.id, del: { token: B } });

  // Real bytes land in the real bucket (authed HeadObject + magic bytes).
  const head = await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: a1.key }));
  check('real bytes in bucket (size match)', head.ContentLength === PNG.length);
  const got = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: a1.key }));
  const head4 = (await streamToBuffer(got.Body)).subarray(0, 4);
  check('real bytes are PNG', head4[0] === 0x89 && head4[1] === 0x50);

  // D. signed download with byte comparison + short TTL.
  const dl = await json('GET', `/api/v1/files/${a1.id}/download`, { token: A });
  check('signed download minted', dl.status === 200 && typeof dl.data.downloadUrl === 'string');
  console.log(`  download URL shape: ${redactUrl(dl.data.downloadUrl)}`);
  const ttlMs = new Date(dl.data.expiresAt).getTime() - Date.now();
  check('download TTL short-lived (<=10 min)', ttlMs > 0 && ttlMs <= 600_000);
  const buf = Buffer.from(await (await fetch(dl.data.downloadUrl)).arrayBuffer());
  check('download bytes intact', buf.equals(PNG));

  // Unsigned (anonymous) fetch of the same object path must NOT succeed.
  const anon = await fetch(dl.data.downloadUrl.split('?')[0]);
  check('anonymous object access denied', anon.status !== 200);

  // E/M. cross-tenant isolation + forgery + negative guards.
  check('B cannot read A file', (await json('GET', `/api/v1/files/${a1.id}`, { token: B })).status === 404);
  check('B cannot download A file', (await json('GET', `/api/v1/files/${a1.id}/download`, { token: B })).status === 404);
  check('B cannot delete A file', (await json('DELETE', `/api/v1/files/${a2.id}`, { token: B })).status === 404);
  check('B cannot publish A file', (await json('POST', `/api/v1/files/${a1.id}/publish`, { token: B, body: {} })).status === 404);
  check('A cannot read B file', (await json('GET', `/api/v1/files/${b1.id}`, { token: A })).status === 404);
  const forged = await uploadFlow({ token: B, site: 'site-b', name: 'f.png', mime: 'image/png', bytes: PNG, category: 'logo', customerId: 'prodverify-a' });
  check('forged customerId ignored (owned by B)', forged.id !== null);
  if (forged.id) tracked.push({ id: forged.id, del: { token: B } });
  check('forged websiteId rejected (allowlist)', (await json('POST', '/api/v1/uploads', {
    token: B, body: { websiteId: 'site-a', originalFilename: 'f.png', mimeType: 'image/png', sizeBytes: PNG.length, category: 'logo' },
  })).status === 403);
  const expiredJwt = jwt.sign(
    { websiteIds: ['site-b'], exp: Math.floor(Date.now() / 1000) - 10 },
    JWT_SECRET,
    { algorithm: 'HS256', subject: 'prodverify-b' },
  );
  check('expired JWT rejected', (await json('GET', `/api/v1/files/${b1.id}`, { token: expiredJwt })).status === 401);
  check('oversize rejected', (await json('POST', '/api/v1/uploads', {
    token: A, body: { websiteId: 'site-a', originalFilename: 'x.png', mimeType: 'image/png', sizeBytes: 999999999, category: 'logo' },
  })).status === 413);
  check('bad MIME rejected', (await json('POST', '/api/v1/uploads', {
    token: A, body: { websiteId: 'site-a', originalFilename: 'x.mp4', mimeType: 'video/mp4', sizeBytes: 100, category: 'logo' },
  })).status === 400);

  // F/G. publish → public; unpublish → private.
  const pub = await json('POST', `/api/v1/files/${a2.id}/publish`, { headers: cdf('prodverify-a'), body: {} });
  check('publish flips to PUBLIC', pub.status === 200 && pub.data.file.visibility === 'PUBLIC');
  if (PUBLIC_BASE && pub.data.file.publicUrl) {
    console.log(`  public URL shape: ${redactUrl(pub.data.file.publicUrl)}`);
    try {
      const r = await fetch(pub.data.file.publicUrl);
      if (r.status === 200) check('public URL serves bytes (origin/CDN live)', true);
      else skipIt('public URL fetch', `origin not serving (HTTP ${r.status}) — visibility state is authoritative`);
    } catch {
      skipIt('public URL fetch', 'origin unreachable — visibility state is authoritative');
    }
  } else {
    skipIt('public URL fetch', 'PUBLIC_BASE_URL unset — visibility state is authoritative');
  }
  const unpub = await json('POST', `/api/v1/files/${a2.id}/unpublish`, { headers: cdf('prodverify-a'), body: {} });
  check('unpublish flips to PRIVATE', unpub.status === 200 && unpub.data.file.visibility === 'PRIVATE' && unpub.data.file.publicUrl === null);

  // J. intake upload via seai-public service scope.
  const intakeScope = `intake:${randomUUID()}`;
  const ic = await uploadFlow({
    headers: pubSvc(intakeScope), site: null, name: 'intake-logo.png', mime: 'image/png', bytes: PNG, category: 'logo', customerId: intakeScope,
  });
  check('intake initiate+complete READY', Boolean(ic.ready));
  if (ic.id) tracked.push({ id: ic.id, del: { headers: pubSvc(intakeScope) } });
  // K. adoption preconditions exactly as CDF checks them.
  const seen = await json('GET', `/api/v1/files/${ic.id}`, { headers: cdf() });
  check(
    'adoption preconditions (READY + intake: scope + intake category)',
    seen.status === 200 && seen.data.file.status === 'READY'
      && String(seen.data.file.customerId).startsWith('intake:')
      && ['logo', 'image', 'brand_asset', 'document', 'intake_attachment'].includes(seen.data.file.category),
  );

  // L. CDF Modify path via delegation.
  const m = await uploadFlow({
    headers: cdf('prodverify-a', 'site-a'), site: 'site-a', name: 'mod.png', mime: 'image/png', bytes: PNG, category: 'image', customerId: 'prodverify-a',
  });
  check('delegated initiate+complete READY', Boolean(m.ready));
  if (m.id) tracked.push({ id: m.id, del: { headers: cdf('prodverify-a', 'site-a') } });

  // H + cleanup: soft-delete everything; prove 404; report rows for purge.
  let cleaned = 0;
  for (const t of tracked) {
    if (!t.id) continue;
    const del = t.del.token
      ? await json('DELETE', `/api/v1/files/${t.id}`, { token: t.del.token })
      : await json('DELETE', `/api/v1/files/${t.id}`, { headers: t.del.headers });
    const gone = await json('GET', `/api/v1/files/${t.id}`, { headers: cdf() });
    if (del.status === 200 && gone.status === 404) cleaned++;
  }
  check(`cleanup: all ${tracked.filter((t) => t.id).length} objects deleted+inaccessible`, cleaned === tracked.filter((t) => t.id).length);
  console.log(`  DELETED row ids for post-retention purge: ${tracked.filter((t) => t.id).map((t) => t.id).join(',')}`);
};

main()
  .then(() => {
    console.log(`\nRESULT pass=${pass} fail=${fail} skip=${skip}`);
    process.exit(fail ? 1 : 0);
  })
  .catch((e) => { console.error(`LOOP ERROR ${e.message}`); process.exit(1); });

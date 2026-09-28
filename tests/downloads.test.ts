import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestContext, createReadyFile } from './helpers.js';

describe('downloads', () => {
  it('authorized download returns a short-lived URL that serves bytes', async () => {
    const ctx = createTestContext();
    const { objectId, token } = await createReadyFile(ctx);
    const res = await request(ctx.app).get(`/api/v1/files/${objectId}/download`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.downloadUrl).toContain('/api/v1/local-download/');
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const dl = await request(ctx.app).get(res.body.downloadUrl);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toBe('image/png');
  });

  it('unauthorized download returns 404 (no existence leak)', async () => {
    const ctx = createTestContext();
    const { objectId } = await createReadyFile(ctx, { customerId: 'cust-a' });
    const other = ctx.userToken('cust-b');
    const res = await request(ctx.app).get(`/api/v1/files/${objectId}/download`).set('Authorization', `Bearer ${other}`);
    expect(res.status).toBe(404);
  });

  it('expired signed URL is rejected', async () => {
    const ctx = createTestContext();
    const { objectId } = await createReadyFile(ctx);
    const { mintLocalDownloadToken } = await import('../src/services/storageService.js');
    const { exp: _e, token: _t } = mintLocalDownloadToken(ctx.cfg, objectId, -10);
    void _e;
    void _t;
    // Craft an already-expired token manually (mint with negative TTL).
    const expired = mintLocalDownloadToken(ctx.cfg, objectId, -60);
    const res = await request(ctx.app).get(`/api/v1/local-download/${objectId}?exp=${expired.exp}&token=${expired.token}`);
    expect(res.status).toBe(410);
  });

  it('tampered download token is rejected', async () => {
    const ctx = createTestContext();
    const { objectId, token } = await createReadyFile(ctx);
    const res = await request(ctx.app).get(`/api/v1/files/${objectId}/download`).set('Authorization', `Bearer ${token}`);
    const url = new URL(res.body.downloadUrl, 'http://localhost');
    const exp = url.searchParams.get('exp');
    const bad = await request(ctx.app).get(`/api/v1/local-download/${objectId}?exp=${exp}&token=${'0'.repeat(64)}`);
    expect(bad.status).toBe(401);
  });

  it('non-ready file cannot be downloaded', async () => {
    const ctx = createTestContext();
    const token = ctx.userToken('cust-a');
    const create = await request(ctx.app)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${token}`)
      .send({ websiteId: 'site-1', originalFilename: 'a.png', mimeType: 'image/png', sizeBytes: 20, category: 'logo' });
    const res = await request(ctx.app).get(`/api/v1/files/${create.body.object.id}/download`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(409);
  });

  it('private files expose no permanent public URL', async () => {
    const ctx = createTestContext();
    const { objectId, token } = await createReadyFile(ctx);
    const meta = await request(ctx.app).get(`/api/v1/files/${objectId}`).set('Authorization', `Bearer ${token}`);
    expect(meta.status).toBe(200);
    expect(meta.body.file.visibility).toBe('PRIVATE');
    expect(meta.body.file.publicUrl).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestContext, PNG_BYTES, JPEG_BYTES } from './helpers.js';

describe('uploads', () => {
  it('accepts a valid upload end-to-end', async () => {
    const ctx = createTestContext();
    const token = ctx.userToken('cust-a');
    const create = await request(ctx.app)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${token}`)
      .send({ websiteId: 'site-1', originalFilename: 'logo.png', mimeType: 'image/png', sizeBytes: PNG_BYTES.length, category: 'logo' });
    expect(create.status).toBe(201);
    expect(create.body.object.storageKey).toMatch(/^customers\/cust-a\/websites\/site-1\/objects\//);
    expect(create.body.object.originalFilename).toBe('logo.png');
    expect(create.body.object.visibility).toBe('PRIVATE');
    expect(create.body.uploadUrl).toBeTruthy();

    const put = await request(ctx.app)
      .put(`/api/v1/uploads/${create.body.object.id}/bytes`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/octet-stream')
      .send(PNG_BYTES);
    expect(put.status).toBe(200);

    const complete = await request(ctx.app)
      .post(`/api/v1/uploads/${create.body.object.id}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(complete.status).toBe(200);
    expect(complete.body.object.status).toBe('READY');
    expect(complete.body.object.scanStatus).toBe('PENDING');
  });

  it('rejects MIME/category mismatch', async () => {
    const ctx = createTestContext();
    const token = ctx.userToken('cust-a');
    const res = await request(ctx.app)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${token}`)
      .send({ websiteId: 'site-1', originalFilename: 'video.mp4', mimeType: 'video/mp4', sizeBytes: 100, category: 'logo' });
    expect(res.status).toBe(400);
  });

  it('rejects extension/MIME mismatch', async () => {
    const ctx = createTestContext();
    const token = ctx.userToken('cust-a');
    const res = await request(ctx.app)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${token}`)
      .send({ websiteId: 'site-1', originalFilename: 'logo.png', mimeType: 'application/pdf', sizeBytes: 100, category: 'document' });
    expect(res.status).toBe(400);
  });

  it('rejects oversized file', async () => {
    const ctx = createTestContext({ MAX_IMAGE_SIZE_BYTES: 10, MAX_FILE_SIZE_BYTES: 100 });
    const token = ctx.userToken('cust-a');
    const res = await request(ctx.app)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${token}`)
      .send({ websiteId: 'site-1', originalFilename: 'big.png', mimeType: 'image/png', sizeBytes: 50, category: 'image' });
    expect(res.status).toBe(413);
  });

  it('expired upload cannot be completed', async () => {
    const ctx = createTestContext({ UPLOAD_URL_TTL_SECONDS: 1 });
    const token = ctx.userToken('cust-a');
    const create = await request(ctx.app)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${token}`)
      .send({ websiteId: 'site-1', originalFilename: 'a.png', mimeType: 'image/png', sizeBytes: PNG_BYTES.length, category: 'logo' });
    const id = create.body.object.id;
    await ctx.provider.putObjectForTesting(create.body.object.storageKey, PNG_BYTES, 'image/png');
    // Force expiry.
    await ctx.db.query(`UPDATE upload_sessions SET expires_at = now() - interval '1 hour' WHERE object_id = $1`, [id]);
    const complete = await request(ctx.app).post(`/api/v1/uploads/${id}/complete`).set('Authorization', `Bearer ${token}`).send({});
    expect(complete.status).toBe(410);
  });

  it('duplicate completion is idempotent', async () => {
    const ctx = createTestContext();
    const token = ctx.userToken('cust-a');
    const create = await request(ctx.app)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${token}`)
      .send({ websiteId: 'site-1', originalFilename: 'a.png', mimeType: 'image/png', sizeBytes: PNG_BYTES.length, category: 'logo' });
    const id = create.body.object.id;
    await request(ctx.app).put(`/api/v1/uploads/${id}/bytes`).set('Authorization', `Bearer ${token}`).set('Content-Type', 'application/octet-stream').send(PNG_BYTES);
    const c1 = await request(ctx.app).post(`/api/v1/uploads/${id}/complete`).set('Authorization', `Bearer ${token}`).send({});
    const c2 = await request(ctx.app).post(`/api/v1/uploads/${id}/complete`).set('Authorization', `Bearer ${token}`).send({});
    expect(c1.status).toBe(200);
    expect(c2.status).toBe(200);
    expect(c2.body.object.status).toBe('READY');
  });

  it('completing an unknown object returns 404', async () => {
    const ctx = createTestContext();
    const token = ctx.userToken('cust-a');
    const res = await request(ctx.app).post('/api/v1/uploads/00000000-0000-0000-0000-000000000000/complete').set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(404);
  });

  it('completing without bytes returns 409', async () => {
    const ctx = createTestContext();
    const token = ctx.userToken('cust-a');
    const create = await request(ctx.app)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${token}`)
      .send({ websiteId: 'site-1', originalFilename: 'a.png', mimeType: 'image/png', sizeBytes: PNG_BYTES.length, category: 'logo' });
    const res = await request(ctx.app).post(`/api/v1/uploads/${create.body.object.id}/complete`).set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(409);
  });

  it('rejects content that fails magic-byte check', async () => {
    const ctx = createTestContext();
    const token = ctx.userToken('cust-a');
    const create = await request(ctx.app)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${token}`)
      .send({ websiteId: 'site-1', originalFilename: 'fake.png', mimeType: 'image/png', sizeBytes: JPEG_BYTES.length, category: 'logo' });
    const id = create.body.object.id;
    await request(ctx.app).put(`/api/v1/uploads/${id}/bytes`).set('Authorization', `Bearer ${token}`).set('Content-Type', 'application/octet-stream').send(JPEG_BYTES);
    const res = await request(ctx.app).post(`/api/v1/uploads/${id}/complete`).set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(422);
  });

  it('rejects arbitrary categories', async () => {
    const ctx = createTestContext();
    const token = ctx.userToken('cust-a');
    const res = await request(ctx.app)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${token}`)
      .send({ websiteId: 'site-1', originalFilename: 'a.png', mimeType: 'image/png', sizeBytes: 10, category: 'superuser' });
    expect(res.status).toBe(400);
  });
});

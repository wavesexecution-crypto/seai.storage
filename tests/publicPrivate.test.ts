import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestContext, createReadyFile } from './helpers.js';

describe('public/private asset model', () => {
  it('uploads start PRIVATE with no public URL', async () => {
    const ctx = createTestContext();
    const { objectId, token } = await createReadyFile(ctx);
    const res = await request(ctx.app).get(`/api/v1/files/${objectId}`).set('Authorization', `Bearer ${token}`);
    expect(res.body.file.visibility).toBe('PRIVATE');
    expect(res.body.file.publicUrl).toBeNull();
  });

  it('explicit publish transitions to PUBLIC with stable URL; unpublish reverts', async () => {
    const ctx = createTestContext();
    const { objectId, token } = await createReadyFile(ctx);
    const pub = await request(ctx.app).post(`/api/v1/files/${objectId}/publish`).set('Authorization', `Bearer ${token}`);
    expect(pub.status).toBe(200);
    expect(pub.body.file.visibility).toBe('PUBLIC');
    expect(pub.body.file.publicUrl).toContain('https://cdn.test');

    const unpub = await request(ctx.app).post(`/api/v1/files/${objectId}/unpublish`).set('Authorization', `Bearer ${token}`);
    expect(unpub.status).toBe(200);
    expect(unpub.body.file.visibility).toBe('PRIVATE');
    expect(unpub.body.file.publicUrl).toBeNull();
  });

  it('non-ready files cannot be published', async () => {
    const ctx = createTestContext();
    const token = ctx.userToken('cust-a');
    const create = await request(ctx.app)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${token}`)
      .send({ websiteId: 'site-1', originalFilename: 'a.png', mimeType: 'image/png', sizeBytes: 20, category: 'logo' });
    const res = await request(ctx.app).post(`/api/v1/files/${create.body.object.id}/publish`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(409);
  });
});

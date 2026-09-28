import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestContext, createReadyFile, PNG_BYTES } from './helpers.js';

describe('authorization', () => {
  it('authenticated customer can access own file', async () => {
    const ctx = createTestContext();
    const { objectId, token } = await createReadyFile(ctx);
    const res = await request(ctx.app).get(`/api/v1/files/${objectId}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.file.id).toBe(objectId);
  });

  it('unauthenticated access is rejected', async () => {
    const ctx = createTestContext();
    const { objectId } = await createReadyFile(ctx);
    const res = await request(ctx.app).get(`/api/v1/files/${objectId}`);
    expect(res.status).toBe(401);
  });

  it('invalid token is rejected', async () => {
    const ctx = createTestContext();
    const res = await request(ctx.app)
      .post('/api/v1/uploads')
      .set('Authorization', 'Bearer invalid')
      .send({ originalFilename: 'a.png', mimeType: 'image/png', sizeBytes: 10, category: 'logo' });
    expect(res.status).toBe(401);
  });

  it('service authorization works with on-behalf-of headers', async () => {
    const ctx = createTestContext();
    const create = await request(ctx.app)
      .post('/api/v1/uploads')
      .set(ctx.serviceHeaders({ customer: 'cust-svc', website: 'site-svc' }))
      .send({ originalFilename: 'doc.pdf', mimeType: 'application/pdf', sizeBytes: 8, category: 'document' });
    expect(create.status).toBe(201);
    expect(create.body.object.customerId).toBe('cust-svc');
  });

  it('service request without customer scope is rejected', async () => {
    const ctx = createTestContext();
    const create = await request(ctx.app)
      .post('/api/v1/uploads')
      .set(ctx.serviceHeaders())
      .send({ originalFilename: 'doc.pdf', mimeType: 'application/pdf', sizeBytes: 8, category: 'document' });
    expect(create.status).toBe(400);
  });

  it('service key is not accepted as user bearer', async () => {
    const ctx = createTestContext();
    const res = await request(ctx.app)
      .get('/api/v1/files/some-id')
      .set('Authorization', 'Bearer test-service-key');
    expect(res.status).toBe(401);
  });

  it('purge requires service authentication', async () => {
    const ctx = createTestContext();
    const { objectId, token } = await createReadyFile(ctx);
    await request(ctx.app).delete(`/api/v1/files/${objectId}`).set('Authorization', `Bearer ${token}`);
    const res = await request(ctx.app).post(`/api/v1/files/${objectId}/purge`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('wrong service key is rejected', async () => {
    const ctx = createTestContext();
    const res = await request(ctx.app)
      .post('/api/v1/uploads')
      .set({ 'x-seai-service': 'cdf', 'x-seai-service-key': 'wrong' })
      .send({ customerId: 'x', originalFilename: 'a.png', mimeType: 'image/png', sizeBytes: PNG_BYTES.length, category: 'logo' });
    expect(res.status).toBe(401);
  });
});

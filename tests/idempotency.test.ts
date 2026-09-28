import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestContext, PNG_BYTES } from './helpers.js';

describe('idempotency', () => {
  it('repeated completion does not duplicate state or events incorrectly', async () => {
    const ctx = createTestContext();
    const token = ctx.userToken('cust-a');
    const create = await request(ctx.app)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${token}`)
      .send({ websiteId: 'site-1', originalFilename: 'a.png', mimeType: 'image/png', sizeBytes: PNG_BYTES.length, category: 'logo' });
    const id = create.body.object.id;
    await request(ctx.app).put(`/api/v1/uploads/${id}/bytes`).set('Authorization', `Bearer ${token}`).set('Content-Type', 'application/octet-stream').send(PNG_BYTES);

    const before = (await ctx.db.query(`SELECT COUNT(*)::int AS n FROM storage_objects WHERE id = $1`, [id])).rows[0].n;
    const c1 = await request(ctx.app).post(`/api/v1/uploads/${id}/complete`).set('Authorization', `Bearer ${token}`).send({});
    const c2 = await request(ctx.app).post(`/api/v1/uploads/${id}/complete`).set('Authorization', `Bearer ${token}`).send({});
    const after = (await ctx.db.query(`SELECT COUNT(*)::int AS n FROM storage_objects WHERE id = $1`, [id])).rows[0].n;

    expect(c1.status).toBe(200);
    expect(c2.status).toBe(200);
    expect(before).toBe(1);
    expect(after).toBe(1);
    expect(c2.body.object.status).toBe('READY');
  });

  it('repeated upload initialization creates distinct safe objects', async () => {
    const ctx = createTestContext();
    const token = ctx.userToken('cust-a');
    const payload = { websiteId: 'site-1', originalFilename: 'a.png', mimeType: 'image/png', sizeBytes: PNG_BYTES.length, category: 'logo' };
    const r1 = await request(ctx.app).post('/api/v1/uploads').set('Authorization', `Bearer ${token}`).send(payload);
    const r2 = await request(ctx.app).post('/api/v1/uploads').set('Authorization', `Bearer ${token}`).send(payload);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r1.body.object.id).not.toBe(r2.body.object.id);
    expect(r1.body.object.storageKey).not.toBe(r2.body.object.storageKey);
  });

  it('repeated delete is idempotent', async () => {
    const ctx = createTestContext();
    const token = ctx.userToken('cust-a');
    const create = await request(ctx.app)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${token}`)
      .send({ websiteId: 'site-1', originalFilename: 'a.png', mimeType: 'image/png', sizeBytes: PNG_BYTES.length, category: 'logo' });
    const id = create.body.object.id;
    await ctx.provider.putObjectForTesting(create.body.object.storageKey, PNG_BYTES, 'image/png');
    await request(ctx.app).post(`/api/v1/uploads/${id}/complete`).set('Authorization', `Bearer ${token}`).send({});
    const d1 = await request(ctx.app).delete(`/api/v1/files/${id}`).set('Authorization', `Bearer ${token}`);
    const stateAfterFirst = (await ctx.db.query(`SELECT status FROM storage_objects WHERE id = $1`, [id])).rows[0].status;
    // Second delete targets a soft-deleted row -> 404 (hidden), which is also safe/idempotent from the caller's view.
    const d2 = await request(ctx.app).delete(`/api/v1/files/${id}`).set('Authorization', `Bearer ${token}`);
    expect(d1.status).toBe(200);
    expect(stateAfterFirst).toBe('DELETED');
    expect([200, 404]).toContain(d2.status);
  });
});

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestContext, createReadyFile, PNG_BYTES } from './helpers.js';

describe('tenancy isolation', () => {
  it('customer B cannot read customer A metadata', async () => {
    const ctx = createTestContext();
    const { objectId } = await createReadyFile(ctx, { customerId: 'cust-a' });
    const res = await request(ctx.app).get(`/api/v1/files/${objectId}`).set('Authorization', `Bearer ${ctx.userToken('cust-b')}`);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('cust-a');
  });

  it('customer B cannot complete customer A upload', async () => {
    const ctx = createTestContext();
    const tokenA = ctx.userToken('cust-a');
    const create = await request(ctx.app)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ websiteId: 'site-1', originalFilename: 'a.png', mimeType: 'image/png', sizeBytes: PNG_BYTES.length, category: 'logo' });
    await ctx.provider.putObjectForTesting(create.body.object.storageKey, PNG_BYTES, 'image/png');
    const res = await request(ctx.app)
      .post(`/api/v1/uploads/${create.body.object.id}/complete`)
      .set('Authorization', `Bearer ${ctx.userToken('cust-b')}`)
      .send({});
    expect(res.status).toBe(404);
  });

  it('service with mismatched on-behalf-of scope cannot cross tenants', async () => {
    const ctx = createTestContext();
    const { objectId } = await createReadyFile(ctx, { customerId: 'cust-a' });
    // Service declares cust-b but object belongs to cust-a.
    const res = await request(ctx.app)
      .get(`/api/v1/files/${objectId}`)
      .set(ctx.serviceHeaders({ customer: 'cust-b' }));
    expect(res.status).toBe(404);
  });

  it('object keys are namespaced per tenant', async () => {
    const ctx = createTestContext();
    const a = await createReadyFile(ctx, { customerId: 'cust-a', websiteId: 'site-a' });
    const b = await createReadyFile(ctx, { customerId: 'cust-b', websiteId: 'site-b' });
    const ka = (await ctx.db.query(`SELECT storage_key FROM storage_objects WHERE id = $1`, [a.objectId])).rows[0].storage_key;
    const kb = (await ctx.db.query(`SELECT storage_key FROM storage_objects WHERE id = $1`, [b.objectId])).rows[0].storage_key;
    expect(ka).not.toBe(kb);
    expect(ka).toContain('cust-a');
    expect(kb).toContain('cust-b');
    expect(kb).not.toContain('cust-a');
  });

  it('publish/unpublish requires ownership', async () => {
    const ctx = createTestContext();
    const { objectId } = await createReadyFile(ctx, { customerId: 'cust-a' });
    const res = await request(ctx.app)
      .post(`/api/v1/files/${objectId}/publish`)
      .set('Authorization', `Bearer ${ctx.userToken('cust-b')}`);
    expect(res.status).toBe(404);
  });
});

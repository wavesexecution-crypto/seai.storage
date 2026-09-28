import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestContext, createReadyFile } from './helpers.js';

describe('deletion / retention', () => {
  it('owner can soft-delete; object becomes unretrievable', async () => {
    const ctx = createTestContext();
    const { objectId, token } = await createReadyFile(ctx);
    const del = await request(ctx.app).delete(`/api/v1/files/${objectId}`).set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);
    expect(del.body.file.status).toBe('DELETED');

    const get = await request(ctx.app).get(`/api/v1/files/${objectId}`).set('Authorization', `Bearer ${token}`);
    expect(get.status).toBe(404);

    const dl = await request(ctx.app).get(`/api/v1/files/${objectId}/download`).set('Authorization', `Bearer ${token}`);
    expect(dl.status).toBe(404);
  });

  it('foreign customer cannot delete', async () => {
    const ctx = createTestContext();
    const { objectId } = await createReadyFile(ctx, { customerId: 'cust-a' });
    const other = ctx.userToken('cust-b');
    const res = await request(ctx.app).delete(`/api/v1/files/${objectId}`).set('Authorization', `Bearer ${other}`);
    expect(res.status).toBe(404);
  });

  it('purge after retention removes bytes but keeps audit row', async () => {
    const ctx = createTestContext({ RETENTION_DAYS: 0 });
    const { objectId, token } = await createReadyFile(ctx);
    const key = (await ctx.db.query(`SELECT storage_key FROM storage_objects WHERE id = $1`, [objectId])).rows[0].storage_key;
    expect(await ctx.provider.objectExists(key)).toBe(true);

    await request(ctx.app).delete(`/api/v1/files/${objectId}`).set('Authorization', `Bearer ${token}`);
    const purge = await request(ctx.app).post(`/api/v1/files/${objectId}/purge`).set(ctx.serviceHeaders());
    expect(purge.status).toBe(200);
    expect(await ctx.provider.objectExists(key)).toBe(false);

    const events = await ctx.db.query(`SELECT action FROM storage_events WHERE object_id = $1`, [objectId]);
    const actions = events.rows.map((r: any) => r.action);
    expect(actions).toContain('file_deleted');
    expect(actions).toContain('file_purged');
  });

  it('purge before retention is blocked', async () => {
    const ctx = createTestContext({ RETENTION_DAYS: 30 });
    const { objectId, token } = await createReadyFile(ctx);
    await request(ctx.app).delete(`/api/v1/files/${objectId}`).set('Authorization', `Bearer ${token}`);
    const purge = await request(ctx.app).post(`/api/v1/files/${objectId}/purge`).set(ctx.serviceHeaders());
    expect(purge.status).toBe(409);
  });

  it('purge requires prior soft-delete', async () => {
    const ctx = createTestContext({ RETENTION_DAYS: 0 });
    const { objectId } = await createReadyFile(ctx);
    const purge = await request(ctx.app).post(`/api/v1/files/${objectId}/purge`).set(ctx.serviceHeaders());
    expect(purge.status).toBe(409);
  });
});

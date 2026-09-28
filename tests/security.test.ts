import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createTestContext, PNG_BYTES } from './helpers.js';

describe('security', () => {
  it('rejects path traversal filenames', async () => {
    const ctx = createTestContext();
    const token = ctx.userToken('cust-a');
    for (const name of ['../../etc/passwd', '..\\windows\\system32', '/absolute.png', 'a/b.png']) {
      const res = await request(ctx.app)
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${token}`)
        .send({ websiteId: 'site-1', originalFilename: name, mimeType: 'image/png', sizeBytes: 10, category: 'logo' });
      // Either rejected outright or sanitized to a safe display name (never used as key).
      if (res.status === 201) {
        expect(res.body.object.storageKey).not.toContain('..');
        expect(res.body.object.storageKey).not.toContain('/absolute');
        expect(res.body.object.originalFilename).not.toContain('/');
      } else {
        expect([400, 413]).toContain(res.status);
      }
    }
  });

  it('rejects null-byte filenames', async () => {
    const ctx = createTestContext();
    const token = ctx.userToken('cust-a');
    const res = await request(ctx.app)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${token}`)
      .send({ websiteId: 'site-1', originalFilename: 'evil.png\0.jpg', mimeType: 'image/png', sizeBytes: 10, category: 'logo' });
    expect(res.status).toBe(400);
  });

  it('ignores forged browser customerId (derives from JWT)', async () => {
    const ctx = createTestContext();
    const token = ctx.userToken('cust-real');
    const res = await request(ctx.app)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId: 'cust-forged', websiteId: 'site-1', originalFilename: 'a.png', mimeType: 'image/png', sizeBytes: PNG_BYTES.length, category: 'logo' });
    expect(res.status).toBe(201);
    expect(res.body.object.customerId).toBe('cust-real');
  });

  it('forged websiteId outside JWT allowlist is forbidden', async () => {
    const ctx = createTestContext();
    const token = ctx.userToken('cust-a', ['site-allowed']);
    const res = await request(ctx.app)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${token}`)
      .send({ websiteId: 'site-evil', originalFilename: 'a.png', mimeType: 'image/png', sizeBytes: PNG_BYTES.length, category: 'logo' });
    expect(res.status).toBe(403);
  });

  it('object keys cannot be manipulated (no user key input accepted)', async () => {
    const ctx = createTestContext();
    const token = ctx.userToken('cust-a');
    const res = await request(ctx.app)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${token}`)
      .send({
        websiteId: 'site-1',
        originalFilename: 'a.png',
        mimeType: 'image/png',
        sizeBytes: PNG_BYTES.length,
        category: 'logo',
        storageKey: 'customers/cust-b/objects/evil',
      });
    expect(res.status).toBe(201);
    expect(res.body.object.storageKey).toMatch(/^customers\/cust-a\/websites\/site-1\/objects\//);
  });

  it('unsafe websiteId characters are rejected', async () => {
    const ctx = createTestContext();
    const token = ctx.userToken('cust-a');
    const res = await request(ctx.app)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${token}`)
      .send({ websiteId: '../evil', originalFilename: 'a.png', mimeType: 'image/png', sizeBytes: PNG_BYTES.length, category: 'logo' });
    expect(res.status).toBe(400);
  });

  it('audit log never stores signed URLs or secrets', async () => {
    const ctx = createTestContext();
    const token = ctx.userToken('cust-a');
    const create = await request(ctx.app)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${token}`)
      .send({ websiteId: 'site-1', originalFilename: 'a.png', mimeType: 'image/png', sizeBytes: PNG_BYTES.length, category: 'logo' });
    const rows = (await ctx.db.query(`SELECT details FROM storage_events WHERE object_id = $1`, [create.body.object.id])).rows;
    for (const r of rows) {
      const s = JSON.stringify(r.details ?? {});
      expect(s).not.toMatch(/uploadUrl|downloadUrl|secret|token/i);
    }
  });
});

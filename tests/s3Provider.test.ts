import { describe, it, expect } from 'vitest';
import { S3CompatibleProvider } from '../src/providers/S3CompatibleProvider.js';

// Offline wiring tests: presigning is pure cryptography (no network), so URL
// minting is verifiable without provisioned infrastructure. Live bucket
// verification (PUT/GET/HEAD/DELETE against a real endpoint) requires
// provisioned S3 credentials — see docs/DEPLOYMENT.md.
function provider(): S3CompatibleProvider {
  return new S3CompatibleProvider({
    endpoint: 'https://s3.example.test',
    region: 'us-east-1',
    bucket: 'seai-storage-prod',
    accessKeyId: 'test-key',
    secretAccessKey: 'test-secret-that-is-long-enough',
    forcePathStyle: true,
  });
}

describe('s3 provider wiring (offline)', () => {
  it('mints presigned PUT URLs bound to bucket + key', async () => {
    const p = provider();
    const signed = await p.createSignedUploadUrl({
      key: 'customers/c1/objects/o1',
      mimeType: 'image/png',
      sizeBytes: 100,
      expiresInSeconds: 900,
    });
    expect(signed.uploadUrl).toContain('seai-storage-prod');
    expect(signed.uploadUrl).toContain('customers/c1/objects/o1');
    expect(signed.uploadUrl).toMatch(/X-Amz-Signature=[0-9a-f]+/);
    expect(new Date(signed.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(signed.requiredHeaders).toEqual({ 'Content-Type': 'image/png' });
  });

  it('mints presigned GET URLs bound to bucket + key', async () => {
    const p = provider();
    const signed = await p.createSignedDownloadUrl({ key: 'customers/c1/objects/o1', expiresInSeconds: 300 });
    expect(signed.downloadUrl).toContain('seai-storage-prod');
    expect(signed.downloadUrl).toMatch(/X-Amz-Signature=[0-9a-f]+/);
  });

  it('fails closed (false/null) when the endpoint is unreachable', async () => {
    const p = provider();
    await expect(p.objectExists('customers/c1/objects/nope')).resolves.toBe(false);
    await expect(p.getObjectMetadata('customers/c1/objects/nope')).resolves.toBeNull();
    await expect(p.getObjectBytes('customers/c1/objects/nope')).resolves.toBeNull();
  });

  it('requires a bucket', () => {
    expect(
      () =>
        new S3CompatibleProvider({
          region: 'us-east-1',
          bucket: '',
          accessKeyId: 'k',
          secretAccessKey: 's',
          forcePathStyle: false,
        }),
    ).toThrow();
  });
});

import { describe, it, expect } from 'vitest';
import { buildStorageKey, assertSafeScopeId } from '../src/domain/objectKeys.js';

describe('object keys', () => {
  it('accepts provisional intake scopes', () => {
    const key = buildStorageKey('intake:9f8a7b6c-5d4e-3f2a-1b0c-9d8e7f6a5b4c', null, 'obj-1');
    expect(key).toBe('customers/intake:9f8a7b6c-5d4e-3f2a-1b0c-9d8e7f6a5b4c/objects/obj-1');
  });

  it('still rejects traversal and separators', () => {
    for (const bad of ['../x', 'a/b', 'a\\b', '..', '', 'a'.repeat(200)]) {
      expect(() => assertSafeScopeId(bad, 'customerId')).toThrow();
    }
  });
});

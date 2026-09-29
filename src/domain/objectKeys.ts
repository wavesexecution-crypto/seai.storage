/**
 * Server-generated opaque object keys.
 * NEVER use user-provided filenames as keys.
 */

// Colon is allowed for namespaced provisional scopes (e.g. `intake:<uuid>`
// per docs/INTEGRATION_CONTRACT_FINAL.md §3). Path separators and traversal
// remain rejected below; `:` cannot escape the key structure.
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function assertSafeScopeId(value: string, label: string): void {
  if (!SAFE_ID.test(value)) {
    throw Object.assign(new Error(`${label} contains unsafe characters`), { statusCode: 400 });
  }
  if (value.includes('..') || value.includes('/') || value.includes('\\')) {
    throw Object.assign(new Error(`${label} must not contain path separators`), { statusCode: 400 });
  }
}

export function buildStorageKey(customerId: string, websiteId: string | null, objectId: string): string {
  assertSafeScopeId(customerId, 'customerId');
  if (websiteId !== null && websiteId !== undefined) assertSafeScopeId(websiteId, 'websiteId');
  assertSafeScopeId(objectId, 'objectId');
  if (websiteId) {
    return `customers/${customerId}/websites/${websiteId}/objects/${objectId}`;
  }
  return `customers/${customerId}/objects/${objectId}`;
}

/** Ensure a caller-supplied key matches the expected server-generated key (prevents key manipulation). */
export function isKeyForObject(storageKey: string, customerId: string, websiteId: string | null, objectId: string): boolean {
  return storageKey === buildStorageKey(customerId, websiteId, objectId);
}

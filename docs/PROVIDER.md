# Storage provider interface

`src/providers/StorageProvider.ts`. Application code depends only on this
interface; vendor SDKs stay inside `src/providers/`.

```ts
createSignedUploadUrl({ key, mimeType, sizeBytes, expiresInSeconds })
createSignedDownloadUrl({ key, expiresInSeconds })
objectExists(key)
getObjectMetadata(key)   // { sizeBytes, etag, contentType } | null
deleteObject(key)
getObjectBytes?(key)     // memory/local/s3 (for verification + local serving)
putObjectForTesting?(key, bytes, contentType?)  // memory/local only
```

## Implementations

| Name | Class | Use |
|---|---|---|
| `memory` | `MemoryProvider` | unit tests (no I/O) |
| `local` | `LocalFilesystemProvider` | local dev without MinIO (`LOCAL_STORAGE_DIR`) |
| `s3` | `S3CompatibleProvider` | prod + MinIO (`@aws-sdk/client-s3`, presigned PUT/GET) |

Selected by `STORAGE_PROVIDER`. Factory: `createProviderFromConfig` in
`src/providers/index.ts`.

## URL model

- **s3**: real presigned S3 URLs (PUT for upload, GET for download).
- **memory/local**: upload bytes travel via authenticated
  `PUT /api/v1/uploads/:id/bytes` (dev/test convenience); downloads use
  HMAC-signed `GET /api/v1/local-download/:id?exp=&token=` URLs minted by
  `StorageService` (expiry enforced, `410` when expired, `401` on tamper).

Switching vendors later means adding a class implementing the interface —
no service/route changes.

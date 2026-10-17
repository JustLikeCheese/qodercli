# Storage in application Functions

Use [sites-management](../../sites-management/SKILL.md) to request authorized Storage allocation, wait for the operation, and verify `get_site(include: ["storage"])`. Import the platform module from the Function:

```js
import { storage } from './_qoder/storage.mjs';
```

The module is injected at deployment. Keep `_qoder` and platform credentials out of the source package. For local tests inject a credential-free storage fake into the business handler, as with the database preview. Owner CLI file-management tools are for administration; the calls below are for the application runtime.

Use [requireUser](../assets/user-context/auth.mjs) after the trusted-ingress prerequisites are satisfied. Derive a safe directory segment from the server-provided opaque user ID (for example a SHA-256 hex digest), then construct the object path server-side. For an existing object, verify its stored owner equals the current user before download, delete or signed URL issuance; a browser-supplied path or prefix is not ownership proof.

## Methods and results

Before each operation, authenticate and authorize the application user for the exact object or directory. Derive allowed paths on the server; do not trust a browser-provided owner ID or prefix. Public reads must be an explicit application policy. Validate sizes and allowed MIME types before accepting uploads, and require explicit application permission for overwrite or deletion.

| Call | Result |
| --- | --- |
| `storage.list('uploads', { limit: 20, offset: 0, sortBy: { column: 'name', order: 'asc' } })` | Parsed listing JSON from the service; inspect entries and return only application fields. Page with offsets, using an extra page when needed; do not assume the owner CLI `has_more` envelope. |
| `storage.upload(objectPath, bytes, { contentType: 'text/plain', upsert: false })` | Parsed service JSON after a successful upload. `bytes` is a Fetch-compatible body, such as a `Uint8Array` or Blob. |
| `storage.download(objectPath)` | A successful Fetch `Response`; read or stream its body. |
| `storage.remove([objectPath])` | Parsed service JSON after deleting the specified objects; accepts 1–1000 exact paths. |
| `storage.createSignedUploadUrl(objectPath, { upsert: false })` | `{ signedUrl }`, a same-origin relative upload URL. |
| `storage.createSignedUrl(objectPath, 300)` | `{ signedUrl }`, a same-origin relative download URL; expiry is 1–7200 seconds. |

Paths are bucket-relative, such as `uploads/report.txt`; omit the bucket ID and leading slash, and reject traversal. Listing limit is 1–1000 and offset is a nonnegative integer. Listing/upload/remove results are service JSON, not Supabase JS `{ data, error }` wrappers. All methods throw on failure: catch errors and return a fixed application error without credentials, internal URLs or raw provider details.

## Upload, download and delete inside a Function

The following operations belong after application authorization and input validation, not in an unrestricted public file handler:

```js
const objectPath = 'exports/' + crypto.randomUUID() + '.txt';
await storage.upload(objectPath, new TextEncoder().encode(validatedText), {
  contentType: 'text/plain; charset=utf-8', upsert: false,
});

const file = await storage.download(authorizedObjectPath);
// Return approved response headers only, not the entire upstream response.
return new Response(file.body, {
  headers: {
    'content-type': 'application/octet-stream',
    'content-disposition': 'attachment; filename="download"',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  },
});
```

In a separate authorized DELETE handler, call `await storage.remove([authorizedObjectPath])`. Do not delete on GET. Never retry an unknown upload/delete outcome blindly; inspect state and reconcile the intended operation first.

## Browser transfers through signed URLs

After checking user permissions and the intended file path, the Function can return `await storage.createSignedUploadUrl(authorizedObjectPath, { upsert: false })` as JSON with `cache-control: no-store`. The browser uploads the approved file to the returned URL:

```js
// signedUrl comes from the application's authorized signing endpoint.
const response = await fetch(signedUrl, {
  method: 'PUT', credentials: 'same-origin',
  headers: { 'Content-Type': approvedFile.type || 'application/octet-stream' },
  body: approvedFile,
});
if (!response.ok) throw new Error('Upload failed');
```

`Content-Length` is optional for incoming uploads and stored responses. Accept a missing header and enforce the byte limit while reading the actual stream; a declared length may support early rejection but never replace that limit. Do not add a 411 requirement. Prefer the signed-upload flow above; when proxying upload bytes through a Function, bound both body size and read duration before storing them.

Before recording an upload as complete, resolve the object path from the server's upload intent and read it through `storage.download`. Browser-reported size/type and a signed URL are not proof of stored bytes. Copy [storage-validation.mjs](../assets/storage-validation.mjs) into the Function package:

```js
import { verifyUploadedObject } from './storage-validation.mjs';

const actual = await verifyUploadedObject(await storage.download(intent.objectPath), {
  maxBytes: 5 * 1024 * 1024,
  expectedBytes: intent.size,
  allowedContentTypes: ['text/plain'],
});
// Only now persist the attachment record with actual.size and actual.contentType.
```

The helper reads with a byte limit even when Content-Length is absent or inaccurate, checks the stored MIME metadata and closes the body. Body verification has a 15-second timeout (`timeoutMs`, at most 60 seconds). Map failures to safe application errors; keep a rejected upload out of completed records and reconcile cleanup under the original upload intent. MIME metadata alone does not validate file contents; use format validation when the application requires it. Keep timeout/cancellation on the storage request and retain overwrite/path authorization.

For downloading, obtain `{ signedUrl }` from an authorized call to `storage.createSignedUrl(authorizedObjectPath, 300)` and use it as a same-origin download link. Preserve the URL exactly, including its query. Treat signed URLs as short-lived bearer capabilities: do not log them, save them in source or analytics, or share them in the conversation. An expired URL requires a new authorized signing request. Keep publication content restrictions in effect for files that become part of the public site.

## Verification

Follow the [validation scope](../SKILL.md#validation-scope). Check the file operation the user needs with an authorized disposable object; an upload/download flow should return the expected bytes. Reuse that result as the main-flow check and clean up only the disposable object created for it. A signing response alone does not prove that the transfer succeeded.

Use credential-free fixtures if real Storage is unavailable. When changing access control, path validation, size/MIME limits or signed-URL handling, check the affected success/rejection boundary. Other Storage operations and expiration/error cases are not a default regression suite.

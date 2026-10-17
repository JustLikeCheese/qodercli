import { publicConfig } from './site-config.mjs';
// Application example helpers, not a platform authentication framework.
export class ApplicationAuthError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}
export function applicationPath(request) {
  const match = new URL(request.url).pathname.match(/^\/(?:functions\/v1\/)?(?:app|app-d[0-9a-f]{32})(\/.*)?$/);
  if (!match) throw new ApplicationAuthError('not_found', 404);
  return match[1] || '/';
}
export function httpsOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
    return url.origin;
  } catch { throw new ApplicationAuthError('application_auth_not_configured', 503); }
}
export function requireSameOrigin(request, origin) {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.get('origin') !== origin) {
    throw new ApplicationAuthError('origin_forbidden', 403);
  }
}
export function noStore(response) {
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'private, no-store');
  headers.set('referrer-policy', 'no-referrer');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
export async function limitedText(message, maxBytes = 8192) {
  const reader = message.body?.getReader();
  if (!reader) return '';
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxBytes) { await reader.cancel(); throw new ApplicationAuthError('payload_too_large', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
export function applicationError(error, sdkErrorResponse) {
  return noStore(error instanceof ApplicationAuthError
    ? Response.json({ error: error.code }, { status: error.status })
    : sdkErrorResponse(error));
}

// Authentication and business handlers share this resolver; values stay fresh.
export function createEnv(read, config = publicConfig) {
  return name => read(name) || ({ APP_ORIGIN: config.origin,
    APP_GITHUB_CLIENT_ID: config.githubClientId, APP_GOOGLE_CLIENT_ID: config.googleClientId })[name];
}

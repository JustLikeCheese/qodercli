// Copy beside App.tsx, or reuse in any browser calling a same-origin Function.
export class ApiError extends Error {
  constructor(message: string, readonly code: string, readonly status: number = 0) {
    super(message);
    this.name = 'ApiError';
  }
}

// Values are application-owned, localized messages keyed by known public error codes.
// Never render an arbitrary provider/server message. Validate success data at the caller.
export async function requestJson(
  url: string, init: RequestInit = {}, messages: Readonly<Record<string, string>> = {},
): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers, credentials: 'same-origin' });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ApiError('The request could not be completed. Check the current state before retrying a change.', 'network_error');
  }
  if (response.status === 401 || response.status === 403) {
    throw new ApiError(response.status === 401 ? 'Sign in to continue.' : 'You do not have access to this action.', 'access_denied', response.status);
  }
  if (response.redirected || !response.headers.get('content-type')?.includes('application/json')) {
    throw new ApiError('The site service returned an unexpected response. Check your access.', 'invalid_response', response.status);
  }
  let data: unknown;
  try { data = await response.json(); }
  catch { throw new ApiError('The site service returned invalid JSON.', 'invalid_response', response.status); }
  const body = data && typeof data === 'object' ? data as Record<string, unknown> : null;
  // Gateway errors can carry `code`; successful payloads may use it as data.
  const code = typeof body?.error === 'string' ? body.error
    : (!response.ok || body?.ok === false) && typeof body?.code === 'string' ? body.code
    : response.ok ? null : 'request_failed';
  if (!response.ok || body?.ok === false || code) {
    const resolved = code ?? 'request_failed';
    const message = Object.prototype.hasOwnProperty.call(messages, resolved)
      ? messages[resolved]
      : 'The request failed. Check the current state before retrying a change.';
    throw new ApiError(message, resolved, response.status);
  }
  return data;
}

// A lost response cannot establish whether a mutation committed. Never replay it here.
export function isWriteOutcomeUnknown(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status === 401 || error.status === 403) return false;
  // The Function also uses HTTP 503 for an explicit database rejection.
  if (error.code === 'write_rejected') return false;
  return ['network_error', 'invalid_response', 'write_result_unknown'].includes(error.code)
    || (error.status >= 500 && error.status < 600);
}

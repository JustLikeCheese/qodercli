// Never serialize raw Auth.js errors: causes may contain credentials and URLs.
const codes = new Set(['UnknownAction', 'MissingCSRF', 'InvalidCheck', 'OAuthCallbackError',
  'OAuthSignInError', 'CallbackRouteError', 'JWTSessionError', 'MissingSecret', 'InvalidProvider']);
export function authLogger(request, emit = event => console.warn(JSON.stringify(event))) {
  const path = new URL(request.url).pathname;
  const provider = /\/(?:signin|callback)\/(github|google)$/.exec(path)?.[1] ?? 'application';
  const stage = path.includes('/callback/') ? 'callback' : path.includes('/signin') ? 'signin' : 'session';
  const candidate = request.headers.get('x-request-id');
  const requestId = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(candidate ?? '') ? candidate : crypto.randomUUID();
  return {
    error(error) {
      try { emit({ event: 'application_auth_error', code: codes.has(error?.type) ? error.type : 'auth_failed',
        provider, stage, request_id: requestId }); } catch { /* Diagnostics cannot change auth behavior. */ }
    },
    warn() {}, debug() {},
  };
}

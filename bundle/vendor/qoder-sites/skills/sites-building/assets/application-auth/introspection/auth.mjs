import { ApplicationAuthError, limitedText } from '../shared.mjs';

// Adapt this explicit RFC 7662-style contract to your existing service. It is not
// a universal introspection protocol adapter and never sends platform cookies.
export function createExistingAuth({ env, fetch: transport = globalThis.fetch, now = () => Date.now() }) {
  return {
    async requireUser(request) {
      const authorization = request.headers.get('authorization');
      if (!authorization || authorization.length > 8192 || !/^Bearer [A-Za-z0-9._~+\/-]+=*$/.test(authorization)) {
        throw new ApplicationAuthError('login_required', 401);
      }
      let endpoint, serviceToken, issuer, audience;
      try {
        endpoint = new URL(env('APP_AUTH_INTROSPECTION_URL'));
        serviceToken = env('APP_AUTH_SERVICE_TOKEN'); issuer = env('APP_AUTH_ISSUER'); audience = env('APP_AUTH_AUDIENCE');
        if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash || endpoint.search
          || !serviceToken || /[\r\n]/.test(serviceToken) || !issuer || !audience) throw new Error();
      } catch { throw new ApplicationAuthError('application_auth_not_configured', 503); }
      let result;
      try {
        const response = await transport(endpoint.href, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
          headers: { authorization: `Bearer ${serviceToken}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
          body: new URLSearchParams({ token: authorization.slice(7), token_type_hint: 'access_token' }),
        });
        if (!response.ok) { await response.body?.cancel(); throw new Error(); }
        result = JSON.parse(await limitedText(response, 16384));
      } catch { throw new ApplicationAuthError('application_auth_unavailable', 503); }
      if (!result || result.active !== true || typeof result.sub !== 'string' || !result.sub.trim() || result.sub.length > 256
        || /[\u0000-\u001f\u007f]/.test(result.sub) || result.iss !== issuer
        || !(result.aud === audience || Array.isArray(result.aud) && result.aud.includes(audience))
        || !Number.isSafeInteger(result.exp) || result.exp <= Math.floor(now() / 1000)) {
        throw new ApplicationAuthError('login_required', 401);
      }
      return Object.freeze({ id: result.sub });
    },
  };
}

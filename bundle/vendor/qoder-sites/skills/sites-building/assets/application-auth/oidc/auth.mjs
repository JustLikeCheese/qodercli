import { Auth, customFetch as authFetch } from '@auth/core';
import Google from '@auth/core/providers/google';
import GitHub from '@auth/core/providers/github';
import { getToken } from '@auth/core/jwt';
import { createRemoteJWKSet, jwtVerify, customFetch as joseFetch } from 'jose';
import {
  ApplicationAuthError, applicationPath, httpsOrigin, requireSameOrigin, limitedText, noStore,

} from '../shared.mjs';

export const basePath = '/functions/v1/app/auth';
export const sessionCookie = '__Host-app_auth.session';

// 固定端点白名单：只有这些出站地址会被请求，其余一律拒绝。
const googleIssuer = 'https://accounts.google.com';
const googleEndpoints = new Set([
  `${googleIssuer}/.well-known/openid-configuration`,
  'https://oauth2.googleapis.com/token',
  'https://openidconnect.googleapis.com/v1/userinfo',
  'https://www.googleapis.com/oauth2/v3/certs',
]);
const githubEndpoints = new Set([
  'https://github.com/login/oauth/access_token',
  'https://api.github.com/user',
  // GitHub OAuth 应用不使用 OIDC；如库尝试发现文档，同样限定在该固定地址。
  'https://github.com/login/oauth/.well-known/openid-configuration',
]);

import { authLogger } from '../diagnostics.mjs';

function applicationCookies(request) {
  const raw = request.headers.get('cookie') ?? '';
  if (raw.length > 16384) throw new ApplicationAuthError('invalid_credentials', 400);
  const seen = new Set(), selected = [];
  for (const part of raw.split(';')) {
    const value = part.trim(), at = value.indexOf('=');
    if (at < 1) continue;
    const name = value.slice(0, at).trim();
    if (!name.startsWith('__Host-app_auth.')) continue;
    if (seen.has(name) || !/^__Host-app_auth\.[a-z_]+(?:\.\d+)?$/.test(name)) throw new ApplicationAuthError('invalid_credentials', 400);
    seen.add(name); selected.push(value);
  }
  return selected.join('; ');
}

const providerSubject = (provider, accountId) => {
  if (provider === 'google') {
    return typeof accountId === 'string' && accountId && accountId.length <= 256 ? `google:${accountId}` : null;
  }
  if (provider === 'github') {
    // GitHub 身份使用数字 ID，不按邮箱合并账号。
    return typeof accountId === 'string' && /^[0-9]{1,20}$/.test(accountId) ? `github:${accountId}` : null;
  }
  return null;
};

export function createAppAuth({ env, fetch: transport = globalThis.fetch, emit }) {
  const safeFetch = async (input, init, maxBytes = 262144) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (!googleEndpoints.has(url.href) && !githubEndpoints.has(url.href)) {
      throw new ApplicationAuthError('application_auth_unavailable', 503);
    }
    const response = await transport(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(5000) });
    // 在库解析之前先对响应体积设上限。
    const body = await limitedText(response, maxBytes);
    return new Response(body, { status: response.status, headers: response.headers });
  };
  const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'), { [joseFetch]: safeFetch });

  // 每个 Provider 独立启用：缺少 Google 配置不影响 GitHub，反之亦然。
  function configuration(request) {
    const logger = authLogger(request, emit);
    const origin = httpsOrigin(env('APP_ORIGIN'));
    const secret = env('APP_AUTH_SECRET');
    const sessionSecret = typeof secret === 'string' && secret.length >= 32 ? secret : null;

    const googleClientId = env('APP_GOOGLE_CLIENT_ID');
    const googleClientSecret = env('APP_GOOGLE_CLIENT_SECRET');
    const githubClientId = env('APP_GITHUB_CLIENT_ID');
    const githubClientSecret = env('APP_GITHUB_CLIENT_SECRET');

    const providers = [];
    if (googleClientId && googleClientSecret) {
      providers.push(Google({
        clientId: googleClientId, clientSecret: googleClientSecret,
        checks: ['pkce', 'state', 'nonce'],
        authorization: { params: { scope: 'openid profile email', access_type: 'online' } },
        [authFetch]: safeFetch,
        async profile(_claims, tokens) {
          // Auth.js 通过 oauth4webapi 校验 nonce/claims；这里再用 Google 固定 JWKS
          // 校验 ID Token 签名与受众。
          const { payload } = await jwtVerify(tokens.id_token, googleKeys, { issuer: googleIssuer, audience: googleClientId, algorithms: ['RS256'] });
          if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 256) throw new Error('invalid_subject');
          return { id: payload.sub, name: typeof payload.name === 'string' ? payload.name : '' };
        },
      }));
    }
    if (githubClientId && githubClientSecret) {
      providers.push(GitHub({
        clientId: githubClientId, clientSecret: githubClientSecret,
        // GitHub OAuth 应用官方支持 state 与 PKCE(S256)，不支持 OIDC：因此没有 nonce、没有 id_token。
        checks: ['pkce', 'state'],
        // 官方文档只描述在请求体里传 client_id/client_secret，因此显式选择 client_secret_post，
        // 不使用库默认的 HTTP Basic。
        client: { token_endpoint_auth_method: 'client_secret_post' },
        authorization: { params: { scope: 'read:user' } },
        userinfo: {
          // 固定使用 /user 端点：不请求 user:email、不读取邮箱、不按邮箱合并账号。
          url: 'https://api.github.com/user',
          async request({ tokens }) {
            const response = await safeFetch('https://api.github.com/user', {
              headers: {
                authorization: `Bearer ${tokens.access_token}`,
                accept: 'application/vnd.github+json',
                'user-agent': 'sites-oauth-example',
              },
            }, 65536);
            if (!response.ok) throw new ApplicationAuthError('application_auth_unavailable', 503);
            return JSON.parse(await response.text());
          },
        },
        [authFetch]: safeFetch,
        profile(profile) {
          const id = profile?.id;
          if ((typeof id !== 'number' && typeof id !== 'string') || !/^[0-9]{1,20}$/.test(String(id))) {
            throw new Error('invalid_subject');
          }
          // 明确只保留 ID 与显示名：不返回 email。
          return { id: String(id), name: typeof profile?.login === 'string' ? profile.login : '' };
        },
      }));
    }

    // 缺少会话密钥或没有任何可用 Provider 时：整体默认关闭。
    if (!sessionSecret || providers.length === 0) {
      throw new ApplicationAuthError('application_auth_not_configured', 503);
    }

    const cookie = (name) => ({ name: `__Host-app_auth.${name}`, options: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } });
    return { origin, enabled: providers.map((p) => p.id), options: {
      secret: sessionSecret, trustHost: true, basePath, useSecureCookies: true, logger,
      // 沿用示例既有的会话策略（1 小时），不是平台级策略。
      session: { strategy: 'jwt', maxAge: 3600 },
      cookies: { sessionToken: cookie('session'), callbackUrl: cookie('callback'), csrfToken: cookie('csrf'),
        pkceCodeVerifier: cookie('pkce'), state: cookie('state'), nonce: cookie('nonce') },
      providers,
      callbacks: {
        async jwt({ token, account }) {
          if (account) {
            const subject = providerSubject(account.provider, account.providerAccountId);
            if (!subject) throw new Error('unsupported_provider');
            return { sub: subject };
          }
          return { sub: token.sub };
        },
        async session({ session, token }) { return { expires: session.expires, user: { id: token.sub } }; },
        async redirect({ url }) {
          try { const target = new URL(url, origin); if (target.origin === origin) return target.href; } catch {}
          return origin + '/';
        },
      },
    } };
  }

  return {
    async handle(request) {
      const path = applicationPath(request);
      const route = path.match(/^\/auth\/(?:signin(?:\/([a-z]+))?|callback\/([a-z]+)|signout|csrf|session|providers|error)$/);
      if (!route) throw new ApplicationAuthError('not_found', 404);
      const { origin, enabled, options } = configuration(request);
      // Provider 专属路由必须对应一个已启用的 Provider，否则默认关闭。
      const requested = route[1] ?? route[2];
      if (requested && !enabled.includes(requested)) throw new ApplicationAuthError('application_auth_not_configured', 503);
      requireSameOrigin(request, origin);
      if (!['GET','POST'].includes(request.method) || route[2] && request.method !== 'GET') {
        throw new ApplicationAuthError('method_not_allowed', 405);
      }
      const incoming = new URL(request.url);
      for (const key of incoming.searchParams.keys()) if (incoming.searchParams.getAll(key).length !== 1) throw new ApplicationAuthError('invalid_input', 400);
      // 只信任这个配置来源；忽略入口的 Host、Forwarded 以及物理函数名重写后的 URL。
      const target = new URL('/functions/v1/app' + path + incoming.search, origin);
      const headers = new Headers({ cookie: applicationCookies(request) });
      for (const name of ['content-type', 'origin']) if (request.headers.has(name)) headers.set(name, request.headers.get(name));
      const body = request.method === 'POST' ? await limitedText(request) : undefined;
      if (body && headers.get('content-type')?.split(';')[0] === 'application/x-www-form-urlencoded') {
        const form = new URLSearchParams(body);
        for (const key of form.keys()) if (form.getAll(key).length !== 1) throw new ApplicationAuthError('invalid_input', 400);
      }
      const response = await Auth(new Request(target, { method: request.method, headers, ...(body === undefined ? {} : { body }) }), options);
      return noStore(response);
    },
    async requireUser(request) {
      const { origin, options } = configuration(request);
      // 只用 Cookie：不允许 Auth.js getToken 隐式的 Bearer 回退。
      const req = new Request(origin, { headers: { cookie: applicationCookies(request) } });
      const token = await getToken({ req, secret: options.secret, cookieName: sessionCookie, salt: sessionCookie, logger: options.logger });
      const subject = typeof token?.sub === 'string' ? token.sub : '';
      const separator = subject.indexOf(':');
      const provider = subject.slice(0, separator), accountId = subject.slice(separator + 1);
      const identity = providerSubject(provider, accountId);
      if (!identity || !Number.isSafeInteger(token?.exp) || token.exp <= Math.floor(Date.now() / 1000)) {
        throw new ApplicationAuthError('login_required', 401);
      }
      return Object.freeze({ id: identity });
    },
  };
}

// Existing copied Google integrations can keep this export.
export const createGoogleAuth = createAppAuth;

// 真实 Auth.js 的模拟网络测试：Google（回归）与 GitHub（新增）两个 Provider。
// 只替换出站网络为受控 transport，其余全部走真实 @auth/core + jose。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { encode } from '@auth/core/jwt';
import { createAppAuth, sessionCookie, basePath } from '../auth.mjs';
import { createBusiness } from '../../business.mjs';
import { createEnv, applicationError } from '../../shared.mjs';

const origin = 'https://site.test';
const DEFAULT_PUBLIC_ORIGIN = 'https://configured.test';
const defaultGitHubClientId = 'local-client-id';
const publicConfig = { origin: DEFAULT_PUBLIC_ORIGIN, githubClientId: defaultGitHubClientId };
const secret = 'local-test-only-'.repeat(4);
const googleIssuer = 'https://accounts.google.com';
const githubAccount = { id: 987654321, login: 'octo-local', name: 'Local Octo' };

const keys = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(keys.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };

// 使用与部署入口完全相同的解析器（shared.mjs 的 createEnv）：
// omitOrigin 时 values 里没有 APP_ORIGIN，只能依赖非秘密常量兜底——这正是线上只配两个密钥的情形。
function fixture({ patch = {}, google = true, github = true, values: extra = {}, omitOrigin = false } = {}) {
  const publicOrigin = omitOrigin ? DEFAULT_PUBLIC_ORIGIN : origin;
  const values = {
    ...(omitOrigin ? {} : { APP_ORIGIN: publicOrigin }),
    APP_AUTH_SECRET: secret,
    ...(google ? { APP_GOOGLE_CLIENT_ID: 'client', APP_GOOGLE_CLIENT_SECRET: 'local-provider-secret' } : {}),
    ...(github ? { APP_GITHUB_CLIENT_SECRET: 'local-github-secret' } : {}),
    ...extra,
  };
  const env = createEnv((name) => values[name], publicConfig);
  const jar = new Map(); const traffic = [];
  let authorization = null, redeemed = false, githubRedeemed = false;

  const transport = async (input, init) => {
    const url = String(input); traffic.push({ url, init, headers: new Headers(init?.headers ?? {}) });
    if (url === `${googleIssuer}/.well-known/openid-configuration`) {
      return Response.json({
        issuer: googleIssuer, authorization_endpoint: `${googleIssuer}/o/oauth2/v2/auth`,
        token_endpoint: 'https://oauth2.googleapis.com/token', userinfo_endpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
        jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs', response_types_supported: ['code'],
        subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'], code_challenge_methods_supported: ['S256'],
      });
    }
    if (url === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json({ keys: [jwk] });

    if (url === 'https://oauth2.googleapis.com/token') {
      const body = new URLSearchParams(init.body);
      assert.equal(body.get('redirect_uri'), `${publicOrigin}${basePath}/callback/google`);
      const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.get('code_verifier')))).toString('base64url');
      assert.equal(challenge, authorization.searchParams.get('code_challenge'));
      if (patch.timeout) throw new Error('provider secret detail');
      if (redeemed) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      redeemed = true;
      let token = await new SignJWT({ sub: 'subject-a', name: 'User', nonce: authorization.searchParams.get('nonce'), ...patch.claims })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(patch.issuer ?? googleIssuer).setAudience(patch.audience ?? 'client')
        .setIssuedAt().setExpirationTime(patch.expired ? '1s' : '5m').sign(keys.privateKey);
      if (patch.expired) token = await new SignJWT({ sub: 'subject-a', nonce: authorization.searchParams.get('nonce') }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuer(googleIssuer).setAudience('client').setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) - 120).sign(keys.privateKey);
      if (patch.signature) { const parts = token.split('.'); parts[2] = (parts[2][0] === 'a' ? 'b' : 'a') + parts[2].slice(1); token = parts.join('.'); }
      return Response.json({ access_token: 'local-access-token', token_type: 'Bearer', expires_in: 300, id_token: token });
    }

    if (url === 'https://github.com/login/oauth/access_token') {
      const body = new URLSearchParams(init.body);
      // 固定回调地址 + PKCE：code_verifier 的 S256 必须等于授权时的 code_challenge。
      assert.equal(body.get('redirect_uri'), `${publicOrigin}${basePath}/callback/github`);
      // GitHub 官方文档只描述请求体凭据：必须使用 client_secret_post，而不是 HTTP Basic。
      assert.equal(body.get('client_id'), values.APP_GITHUB_CLIENT_ID || defaultGitHubClientId);
      assert.equal(body.get('client_secret'), 'local-github-secret');
      assert.equal(new Headers(init?.headers ?? {}).get('authorization'), null, '不得改用 Basic 认证');
      const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.get('code_verifier')))).toString('base64url');
      assert.equal(challenge, authorization.searchParams.get('code_challenge'));
      if (patch.githubFailure) return Response.json({ error: 'server_error' }, { status: 500 });
      if (githubRedeemed) return Response.json({ error: 'bad_verification_code' }, { status: 400 });
      githubRedeemed = true;
      return Response.json({ access_token: 'local-github-access-token', token_type: 'bearer', scope: 'read:user' });
    }
    if (url === 'https://api.github.com/user') {
      const auth = new Headers(init?.headers ?? {}).get('authorization');
      assert.equal(auth, 'Bearer local-github-access-token');
      return Response.json({ id: githubAccount.id, login: githubAccount.login, name: githubAccount.name, email: 'shared@example.test' });
    }
    throw new Error(`unexpected outbound endpoint: ${url}`);
  };

  const auth = createAppAuth({ env, fetch: transport });

  function request(path, method = 'GET', body, headers = {}) {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    return new Request(`https://provider.internal/functions/v1/app-d${'a'.repeat(32)}${path}`, {
      method,
      headers: { cookie, origin: publicOrigin, 'content-type': 'application/x-www-form-urlencoded', host: 'evil.test', 'x-forwarded-host': 'evil.test', ...headers },
      ...(body === undefined ? {} : { body }),
    });
  }
  function remember(response) {
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(';')[0], at = pair.indexOf('=');
      if (!pair.slice(at + 1)) jar.delete(pair.slice(0, at)); else jar.set(pair.slice(0, at), pair.slice(at + 1));
    }
  }
  async function start(provider = 'google') {
    const csrf = await auth.handle(request('/auth/csrf')); remember(csrf);
    const { csrfToken } = await csrf.json();
    const response = await auth.handle(request(`/auth/signin/${provider}`, 'POST', new URLSearchParams({ csrfToken, callbackUrl: `${origin}/` }).toString()));
    remember(response);
    assert.equal(response.status, 302, `${provider} 授权应重定向`);
    authorization = new URL(response.headers.get('location'));
    return authorization;
  }
  const callback = async (provider = 'google', state = authorization.searchParams.get('state')) => {
    const response = await auth.handle(request(`/auth/callback/${provider}?code=test-code&state=${encodeURIComponent(state)}`));
    remember(response); return response;
  };
  return { auth, env, values, publicOrigin, jar, traffic, request, remember, start, callback, transport, tokenCalls: () => traffic.filter((c) => c.url.includes('/token') || c.url.includes('access_token')).length };
}

// ---------------------------------------------------------------- Google 回归

test('[Google] 真实 Auth.js 流程：PKCE、签名身份、加密会话与退出', async () => {
  const f = fixture();
  const authorization = await f.start('google');
  assert.equal(authorization.origin, googleIssuer);
  assert.equal(authorization.searchParams.get('redirect_uri'), `${origin}${basePath}/callback/google`);
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  assert(authorization.searchParams.get('state'));
  assert(authorization.searchParams.get('nonce'));

  const callback = await f.callback('google');
  assert.equal(callback.headers.get('location'), `${origin}/`);
  assert.equal(callback.headers.get('cache-control'), 'private, no-store');
  const cookie = callback.headers.getSetCookie().find((v) => v.startsWith(`${sessionCookie}=`));
  assert(cookie);
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Lax/);
  assert.deepEqual(await f.auth.requireUser(f.request('/api/me')), { id: 'google:subject-a' });

  const session = await f.auth.handle(f.request('/auth/session')); f.remember(session);
  assert.deepEqual((await session.json()).user, { id: 'google:subject-a' });

  const csrf = await f.auth.handle(f.request('/auth/csrf')); f.remember(csrf);
  const csrfToken = (await csrf.json()).csrfToken;
  const signout = await f.auth.handle(f.request('/auth/signout', 'POST', new URLSearchParams({ csrfToken }).toString()));
  f.remember(signout);
  await assert.rejects(() => f.auth.requireUser(f.request('/api/me')), { status: 401 });
  assert(f.traffic.every((c) => c.init.redirect === 'error'), '所有出站请求都必须禁止重定向');
});

for (const [name, patch] of Object.entries({ nonce: { claims: { nonce: 'wrong' } }, issuer: { issuer: 'https://evil.test' }, audience: { audience: 'other' }, expired: { expired: true }, signature: { signature: true }, timeout: { timeout: true } })) {
  test(`[Google] 拒绝 ${name} 且不建立应用会话`, async () => {
    const f = fixture({ patch }); await f.start('google'); const response = await f.callback('google');
    assert.notEqual(response.headers.get('location'), `${origin}/`);
    assert.equal(f.jar.has(sessionCookie), false);
    await assert.rejects(() => f.auth.requireUser(f.request('/api/me')), { status: 401 });
    assert.equal(f.tokenCalls(), 1);
  });
}

test('[Google] 缺少浏览器绑定或 state 错误时不进行令牌交换', async () => {
  for (const mode of ['state', 'cookie']) {
    const f = fixture(); await f.start('google'); if (mode === 'cookie') f.jar.clear();
    await f.callback('google', mode === 'state' ? 'wrong' : undefined);
    assert.equal(f.tokenCalls(), 0);
    assert.equal(f.jar.has(sessionCookie), false);
  }
});

test('[Google] 重放的授权码无法建立第二个会话', async () => {
  const f = fixture(); await f.start('google'); const browser = new Map(f.jar); await f.callback('google');
  f.jar.clear(); for (const [k, v] of browser) f.jar.set(k, v);
  await f.callback('google'); assert.equal(f.jar.has(sessionCookie), false);
});

test('[Google] 伪造/过期会话与 Bearer 回退都不能通过认证', async () => {
  const f = fixture();
  f.jar.set(sessionCookie, 'forged');
  await assert.rejects(() => f.auth.requireUser(f.request('/api/me')), { status: 401 });
  const expired = await encode({ secret, salt: sessionCookie, token: { sub: 'google:subject-a' }, maxAge: -120 });
  f.jar.set(sessionCookie, expired);
  await assert.rejects(() => f.auth.requireUser(f.request('/api/me')), { status: 401 });
  const valid = await encode({ secret, salt: sessionCookie, token: { sub: 'google:subject-a' }, maxAge: 60 });
  f.jar.clear();
  await assert.rejects(() => f.auth.requireUser(f.request('/api/me', 'GET', undefined, { authorization: `Bearer ${valid}` })), { status: 401 });
  await assert.rejects(() => f.auth.requireUser(f.request('/api/me', 'GET', undefined, { cookie: `${sessionCookie}=${valid}; ${sessionCookie}=${valid}` })), { status: 400 });
});

test('[Google] CSRF、来源校验与不信任 Host', async () => {
  const f = fixture();
  const response = await f.auth.handle(f.request('/auth/signin/google', 'POST', ''));
  assert.match(response.headers.get('location'), /^https:\/\/site\.test\//);
  assert.equal(f.tokenCalls(), 0);
  await assert.rejects(() => f.auth.handle(f.request('/auth/signout', 'POST', '', { origin: 'https://evil.test' })), { status: 403 });
  await assert.rejects(() => f.auth.handle(f.request('/auth/callback/google', 'POST', '')), { status: 405 });
  await assert.rejects(() => f.auth.handle(f.request('/auth/callback/google?state=a&state=b')), { status: 400 });
});

test('[Google] 相同密钥下跨部署/重启会话仍然有效', async () => {
  const f = fixture(); await f.start('google'); await f.callback('google');
  const restarted = createAppAuth({ env: createEnv((name) => f.values[name], publicConfig) });
  assert.deepEqual(await restarted.requireUser(f.request('/api/me')), { id: 'google:subject-a' });
});

test('[Google] 并发回调最多建立一个会话', async () => {
  const f = fixture(); const authorization = await f.start('google');
  const path = `/auth/callback/google?code=test-code&state=${encodeURIComponent(authorization.searchParams.get('state'))}`;
  const responses = await Promise.all([f.request(path), f.request(path)].map((request) => f.auth.handle(request)));
  assert.equal(responses.filter((response) => response.headers.getSetCookie().some((v) => v.startsWith(`${sessionCookie}=`) && !v.startsWith(`${sessionCookie}=;`))).length, 1);
});

test('[Google] 过期或被篡改的 state Cookie 不能进入令牌交换', async () => {
  for (const value of ['tampered', await encode({ secret, salt: '__Host-app_auth.state', token: { value: 'old' }, maxAge: -120 })]) {
    const f = fixture(); await f.start('google'); f.jar.set('__Host-app_auth.state', value);
    await f.callback('google');
    assert.equal(f.tokenCalls(), 0);
    assert.equal(f.jar.has(sessionCookie), false);
  }
});

test('[Google] 授权开始与回调可以跨部署完成', async () => {
  const f = fixture(); const authorization = await f.start('google');
  const deployed = createAppAuth({ env: createEnv((name) => f.values[name], publicConfig), fetch: f.transport });
  const response = await deployed.handle(f.request(`/auth/callback/google?code=test-code&state=${encodeURIComponent(authorization.searchParams.get('state'))}`));
  f.remember(response);
  assert.equal(response.headers.get('location'), `${origin}/`);
  assert.deepEqual(await deployed.requireUser(f.request('/api/me')), { id: 'google:subject-a' });
});

// ---------------------------------------------------------------- GitHub 新增

test('[GitHub] 真实 Auth.js 流程：state + PKCE、身份为 github:数字ID、加密会话与退出', async () => {
  const f = fixture({ google: false });
  const authorization = await f.start('github');
  assert.equal(authorization.origin, 'https://github.com');
  assert.equal(authorization.pathname, '/login/oauth/authorize');
  assert.equal(authorization.searchParams.get('client_id'), defaultGitHubClientId);
  assert.equal(authorization.searchParams.get('redirect_uri'), `${origin}${basePath}/callback/github`);
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorization.searchParams.get('code_challenge').length, 43, 'PKCE challenge 为 43 字符');
  assert(authorization.searchParams.get('state'), '必须带 state');
  assert.equal(authorization.searchParams.get('nonce'), null, 'GitHub 不使用 OIDC，不应有 nonce');
  assert.equal(authorization.searchParams.get('scope'), 'read:user', '只申请 read:user，不申请 repo/user:email');

  const callback = await f.callback('github');
  assert.equal(callback.headers.get('location'), `${origin}/`);
  assert.equal(callback.headers.get('cache-control'), 'private, no-store');
  const cookie = callback.headers.getSetCookie().find((v) => v.startsWith(`${sessionCookie}=`));
  assert(cookie);
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Lax/);
  assert.deepEqual(await f.auth.requireUser(f.request('/api/me')), { id: `github:${githubAccount.id}` });

  const session = await f.auth.handle(f.request('/auth/session')); f.remember(session);
  assert.deepEqual((await session.json()).user, { id: `github:${githubAccount.id}` });

  // 只访问固定 userinfo 端点：不请求 /user/emails。
  assert.equal(f.traffic.filter((c) => c.url.includes('/user/emails')).length, 0);
  assert.equal(f.traffic.filter((c) => c.url === 'https://api.github.com/user').length, 1);

  const csrf = await f.auth.handle(f.request('/auth/csrf')); f.remember(csrf);
  const csrfToken = (await csrf.json()).csrfToken;
  const signout = await f.auth.handle(f.request('/auth/signout', 'POST', new URLSearchParams({ csrfToken }).toString()));
  f.remember(signout);
  await assert.rejects(() => f.auth.requireUser(f.request('/api/me')), { status: 401 }, '退出后会话必须失效');
  assert(f.traffic.every((c) => c.init.redirect === 'error'));
});

test('[GitHub] 令牌交换使用 client_secret 与 PKCE verifier；state 错误不交换', async () => {
  const f = fixture({ google: false });
  await f.start('github');
  const wrong = await f.callback('github', 'wrong-state');
  assert.notEqual(wrong.headers.get('location'), `${origin}/`);
  assert.equal(f.tokenCalls(), 0, 'state 不匹配时不得调用令牌端点');
  assert.equal(f.jar.has(sessionCookie), false);

  const g = fixture({ google: false });
  await g.start('github');
  const tokenCall = g.traffic.find((c) => c.url === 'https://github.com/login/oauth/access_token');
  assert.equal(tokenCall, undefined, '授权阶段不应调用令牌端点');
  const ok = await g.callback('github');
  assert.equal(ok.headers.get('location'), `${origin}/`);
  const body = new URLSearchParams(g.traffic.find((c) => c.url === 'https://github.com/login/oauth/access_token').init.body);
  assert(body.get('code_verifier'), '必须带 PKCE code_verifier');
  assert.equal(body.get('client_secret'), 'local-github-secret');
});

test('[GitHub] Provider 失败时不建立会话，且错误信息不外泄', async () => {
  const f = fixture({ google: false, patch: { githubFailure: true } });
  await f.start('github');
  const response = await f.callback('github');
  assert.notEqual(response.headers.get('location'), `${origin}/`);
  assert.equal(f.jar.has(sessionCookie), false);
  await assert.rejects(() => f.auth.requireUser(f.request('/api/me')), { status: 401 });
  const errorPage = await f.auth.handle(f.request('/auth/error?error=Configuration'));
  assert.equal(errorPage.headers.get('cache-control'), 'private, no-store');
});

test('[GitHub] 重复/重放回调不会建立第二个会话', async () => {
  const f = fixture({ google: false }); await f.start('github');
  const browser = new Map(f.jar); await f.callback('github');
  f.jar.clear(); for (const [k, v] of browser) f.jar.set(k, v);
  await f.callback('github');
  assert.equal(f.jar.has(sessionCookie), false);
});

test('[GitHub] 伪造/过期会话不能通过认证', async () => {
  const f = fixture({ google: false });
  f.jar.set(sessionCookie, 'forged');
  await assert.rejects(() => f.auth.requireUser(f.request('/api/me')), { status: 401 });
  const expired = await encode({ secret, salt: sessionCookie, token: { sub: `github:${githubAccount.id}` }, maxAge: -120 });
  f.jar.set(sessionCookie, expired);
  await assert.rejects(() => f.auth.requireUser(f.request('/api/me')), { status: 401 });
});

test('[GitHub] 不同数字 ID 是不同身份，不按邮箱合并', async () => {
  const f = fixture({ google: false });
  await f.start('github'); await f.callback('github');
  const first = await f.auth.requireUser(f.request('/api/me'));
  const forged = await encode({ secret, salt: sessionCookie, token: { sub: 'github:not-a-number' }, maxAge: 60 });
  f.jar.set(sessionCookie, forged);
  await assert.rejects(() => f.auth.requireUser(f.request('/api/me')), { status: 401 }, '非数字 GitHub 身份必须被拒绝');
  f.jar.set(sessionCookie, await encode({ secret, salt: sessionCookie, token: { sub: 'github:123456789' }, maxAge: 60 }));
  const other = await f.auth.requireUser(f.request('/api/me'));
  assert.notDeepEqual(other, first);
});

// ------------------------------------------------------- 配置缺失与组合行为

test('缺少会话密钥时所有认证路由默认关闭', async () => {
  const f = fixture({ values: { APP_AUTH_SECRET: '' } });
  await assert.rejects(() => f.auth.handle(f.request('/auth/session')), { status: 503, code: 'application_auth_not_configured' });
  await assert.rejects(() => f.auth.handle(f.request('/auth/signin/github', 'POST', '')), { status: 503 });
  await assert.rejects(() => f.auth.requireUser(f.request('/api/me')), { status: 503 });
});

test('缺少 Google 配置不阻塞 GitHub，反向亦然', async () => {
  const githubOnly = fixture({ google: false });
  const authorization = await githubOnly.start('github');
  assert.equal(authorization.origin, 'https://github.com');
  await assert.rejects(() => githubOnly.auth.handle(githubOnly.request('/auth/signin/google', 'POST', '')), { status: 503, code: 'application_auth_not_configured' });
  await assert.rejects(() => githubOnly.auth.handle(githubOnly.request('/auth/callback/google?code=x&state=y')), { status: 503 });
  const providers = await githubOnly.auth.handle(githubOnly.request('/auth/providers'));
  assert.deepEqual(Object.keys(await providers.json()), ['github']);

  const googleOnly = fixture({ github: false });
  await googleOnly.start('google');
  await assert.rejects(() => googleOnly.auth.handle(googleOnly.request('/auth/signin/github', 'POST', '')), { status: 503, code: 'application_auth_not_configured' });
  assert.deepEqual(Object.keys(await (await googleOnly.auth.handle(googleOnly.request('/auth/providers'))).json()), ['google']);
});

test('两个 Provider 同时配置时都可用，身份前缀互不混淆', async () => {
  const f = fixture();
  const providers = await (await f.auth.handle(f.request('/auth/providers'))).json();
  assert.deepEqual(Object.keys(providers).sort(), ['github', 'google']);
  assert.equal(providers.github.signinUrl, `${origin}${basePath}/signin/github`);
  assert.equal(providers.google.signinUrl, `${origin}${basePath}/signin/google`);

  const googleJar = new Map();
  await f.start('google');
  const googleCallback = await f.callback('google');
  assert(googleCallback.headers.getSetCookie().some((v) => v.startsWith(`${sessionCookie}=`)));
  for (const [k, v] of f.jar) googleJar.set(k, v);

  f.jar.clear();
  await f.start('github');
  await f.callback('github');
  const githubIdentity = await f.auth.requireUser(f.request('/api/me'));
  assert.equal(githubIdentity.id, `github:${githubAccount.id}`);

  f.jar.clear(); for (const [k, v] of googleJar) f.jar.set(k, v);
  assert.deepEqual(await f.auth.requireUser(f.request('/api/me')), { id: 'google:subject-a' });
});

test('Provider 专属路由在未启用时返回默认关闭，未知路由 404', async () => {
  const f = fixture({ github: false });
  await assert.rejects(() => f.auth.handle(f.request('/auth/callback/github?code=x&state=y')), { status: 503 });
  await assert.rejects(() => f.auth.handle(f.request('/auth/signin/facebook', 'POST', '')), { status: 503 });
  await assert.rejects(() => f.auth.handle(f.request('/auth/unknown')), { status: 404 });
  assert.equal(f.tokenCalls(), 0);
});

// ------------------------------------------------------- 记录归属隔离（真实 business）

const businessCtx = (f, path, method, body, headers) => ({ request: f.request(path, method, body, headers), requestId: 'local-test' });

// 与 oidc/index.ts 一致：业务处理器抛 ApplicationAuthError，由入口统一转换为响应。
const callBusiness = async (business, ctx) => {
  try { return await business(ctx); }
  catch (error) { return applicationError(error, () => Response.json({ error: 'unexpected' }, { status: 500 })); }
};

function fakeNotesDb() {
  const rows = [];
  const pick = (row, columns) => Object.fromEntries(columns.split(',').map((c) => [c.trim(), row[c.trim()]]));
  const builder = (mode, values) => {
    const filters = []; let columns = '*';
    const run = () => {
      const match = (row) => filters.every(([k, v]) => row[k] === v);
      if (mode === 'read') return { data: rows.filter(match).sort((a, b) => a.id.localeCompare(b.id)).map((r) => pick(r, columns)), error: null };
      if (mode === 'insert') {
        const unique = (values.onConflict ?? '').split(',').map((c) => c.trim()).filter(Boolean);
        if (unique.length && rows.some((r) => unique.every((k) => r[k] === values.row[k]))) return { data: [], error: null };
        rows.push({ ...values.row });
        return { data: [pick(values.row, columns)], error: null };
      }
      const matched = rows.filter(match);
      for (const r of matched) Object.assign(r, values.row);
      return { data: matched.map((r) => pick(r, columns)), error: null };
    };
    const chain = {
      eq(k, v) { filters.push([k, v]); return chain; },
      limit() { return chain; },
      order() { return chain; },
      select(names) { if (typeof names === 'string') columns = names; return chain; },
      then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject); },
    };
    return chain;
  };
  return {
    from() {
      return {
        select: (c) => builder('read', null).select(c),
        insertIfAbsent: (row, o) => builder('insert', { row, onConflict: o?.onConflict }),
        update: (row) => builder('update', { row }),
      };
    },
    all: () => rows.map((r) => ({ ...r })),
  };
}

test('记录按身份隔离：Google 与 GitHub 各自只看自己的记录', async () => {
  const db = fakeNotesDb();
  const g = fixture({ github: false });
  const h = fixture({ google: false });
  const businessOf = (f) => createBusiness({ db, auth: f.auth, env: f.env });

  const googleBusiness = businessOf(g);
  const githubBusiness = businessOf(h);

  await g.start('google'); await g.callback('google');
  await h.start('github'); await h.callback('github');

  const googleId = crypto.randomUUID();
  const createdByGoogle = await callBusiness(googleBusiness, businessCtx(g, '/api/notes', 'POST', JSON.stringify({ title: 'Google 的记录' }), { 'content-type': 'application/json', 'idempotency-key': googleId }));
  assert.equal(createdByGoogle.status, 201);
  assert.deepEqual(await (await callBusiness(googleBusiness, businessCtx(g, '/api/notes'))).json(), [{ id: googleId, title: 'Google 的记录' }]);
  assert.deepEqual(await (await callBusiness(githubBusiness, businessCtx(h, '/api/notes'))).json(), [], 'GitHub 身份不得看到 Google 记录');

  const githubId = crypto.randomUUID();
  await callBusiness(githubBusiness, businessCtx(h, '/api/notes', 'POST', JSON.stringify({ title: 'GitHub 的记录' }), { 'content-type': 'application/json', 'idempotency-key': githubId }));
  assert.deepEqual(await (await callBusiness(googleBusiness, businessCtx(g, '/api/notes'))).json(), [{ id: googleId, title: 'Google 的记录' }], 'GitHub 的写入不影响 Google');
  assert.equal(db.all().length, 2);
  assert.notEqual(db.all()[0].owner_id, db.all()[1].owner_id, '两条记录归属不同身份');

  // 未带会话的请求被拒绝（显式清空 Cookie）。
  assert.equal((await callBusiness(githubBusiness, businessCtx(h, '/api/notes', 'GET', undefined, { cookie: '' }))).status, 401);
});

test('只配置 APP_AUTH_SECRET 与 APP_GITHUB_CLIENT_SECRET 时，GitHub 会话下的 me 与 notes 仍然可用', async () => {
  // 关键：values 里没有 APP_ORIGIN，只有两个必需密钥。
  const db = fakeNotesDb();
  const f = fixture({ google: false, omitOrigin: true });
  assert.equal(f.values.APP_ORIGIN, undefined, '本用例刻意不提供 APP_ORIGIN');
  const business = createBusiness({ db, auth: f.auth, env: f.env });

  await f.start('github');
  const callback = await f.callback('github');
  assert.equal(callback.headers.get('location'), `${DEFAULT_PUBLIC_ORIGIN}/`, '回跳使用站点常量来源');
  const sessionCookieValue = callback.headers.getSetCookie().find((v) => v.startsWith(`${sessionCookie}=`));
  assert(sessionCookieValue, '应建立会话');

  // /api/me：出自 business handler，同样依赖共享的 Origin 解析。
  const me = await callBusiness(business, businessCtx(f, '/api/me'));
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), { user: { id: `github:${githubAccount.id}` } });

  // 写读自己的一条记录。
  const id = crypto.randomUUID();
  const created = await callBusiness(business, businessCtx(f, '/api/notes', 'POST', JSON.stringify({ title: '仅两个密钥也能写' }), {
    'content-type': 'application/json', 'idempotency-key': id,
  }));
  assert.equal(created.status, 201, '缺少 APP_ORIGIN 时写入也必须成功');
  assert.deepEqual(await (await callBusiness(business, businessCtx(f, '/api/notes'))).json(), [{ id, title: '仅两个密钥也能写' }]);
  assert.equal(db.all().length, 1);

  // 未带会话仍然被拒绝。
  const anonymous = await callBusiness(business, businessCtx(f, '/api/notes', 'GET', undefined, { cookie: '' }));
  assert.equal(anonymous.status, 401);
});

// --------------------------------------------- 真实页面点击契约（登录 / 退出）

const pageHtml = readFileSync(new URL('../../web/index.html', import.meta.url), 'utf8');

test('页面契约：登录与退出必须是原生同源表单 POST，不能再用 GET 链接', () => {
  // 回归防线：Auth.js 的 GET /auth/signin/{provider} 会抛 UnknownAction → error=Configuration。
  for (const endpoint of ['/functions/v1/app/auth/signin/github', '/functions/v1/app/auth/signin/google', '/functions/v1/app/auth/signout']) {
    assert.ok(!new RegExp(`<a[^>]+href="${endpoint}"`).test(pageHtml), `不得存在指向 ${endpoint} 的 GET 链接`);
  }
  const forms = [...pageHtml.matchAll(/<form id="(signin-github|signin-google|signout)"([^>]*)>/g)];
  assert.equal(forms.length, 3, '应有三个认证表单');
  for (const [, id, attrs] of forms) {
    assert.match(attrs, /method="post"/, `${id} 必须是 POST`);
    assert.match(attrs, /action="\/functions\/v1\/app\/auth\/(signin\/(github|google)|signout)"/, `${id} 的 action 必须指向认证端点`);
  }
  for (const field of ['csrfToken', 'callbackUrl']) {
    assert.equal((pageHtml.match(new RegExp(`name="${field}"`, 'g')) ?? []).length, 3, `每个表单都要带 ${field}`);
  }
});

test('[GitHub] 页面登录契约：GET 取 CSRF → 原生表单 POST → 302 到固定授权端点', async () => {
  const f = fixture({ google: false });

  // 1) 页面初始化时先取 CSRF 令牌（并下发 CSRF Cookie）。
  const csrfResponse = await f.auth.handle(f.request('/auth/csrf'));
  assert.equal(csrfResponse.status, 200);
  const { csrfToken } = await csrfResponse.json();
  assert.ok(typeof csrfToken === 'string' && csrfToken.length > 0, '必须返回 csrfToken');
  assert.match(csrfResponse.headers.getSetCookie().join(';'), /__Host-app_auth\.csrf=/, '必须下发 CSRF Cookie');
  f.remember(csrfResponse);

  // 2) 原生表单 POST（页面点击后浏览器的真实行为）。
  const response = await f.auth.handle(f.request('/auth/signin/github', 'POST',
    new URLSearchParams({ csrfToken, callbackUrl: `${origin}/` }).toString()));
  f.remember(response);
  assert.equal(response.status, 302, '必须 302 交给浏览器跳转');
  const location = new URL(response.headers.get('location'));
  assert.equal(location.origin, 'https://github.com');
  assert.equal(location.pathname, '/login/oauth/authorize');
  assert.equal(location.searchParams.get('client_id'), defaultGitHubClientId);
  assert.equal(location.searchParams.get('redirect_uri'), `${origin}${basePath}/callback/github`);
  assert.equal(location.searchParams.get('scope'), 'read:user');
  assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(location.searchParams.get('code_challenge').length, 43);
  assert(location.searchParams.get('state'), '必须带 state');
  assert.equal(location.searchParams.get('nonce'), null, '不使用 OIDC nonce');

  // 3) 缺少 CSRF 令牌的 POST 不得放行（CSRF 没有被关闭）。
  const noCsrf = await f.auth.handle(f.request('/auth/signin/github', 'POST',
    new URLSearchParams({ callbackUrl: `${origin}/` }).toString()));
  assert.notEqual(noCsrf.headers.get('location')?.includes('github.com/login/oauth/authorize'), true, '缺少 CSRF 时不得发出授权跳转');

  // 4) 记录被修复的缺陷：GET /auth/signin/{provider} 本来就不受支持。
  const getSignin = await f.auth.handle(f.request('/auth/signin/github'));
  assert.match(String(getSignin.headers.get('location')), /\/auth\/error\?error=Configuration$/, 'GET 版本会落到 error=Configuration（因此页面必须用 POST）');
});

test('[GitHub] 页面退出契约：带 CSRF 的表单 POST 会清空会话并下发清除 Cookie', async () => {
  const f = fixture({ google: false });
  await f.start('github');
  await f.callback('github');
  assert.equal((await f.auth.handle(f.request('/auth/session'))).status, 200, '登录后会话可用');

  const csrf = await f.auth.handle(f.request('/auth/csrf')); f.remember(csrf);
  const { csrfToken } = await csrf.json();
  const signout = await f.auth.handle(f.request('/auth/signout', 'POST',
    new URLSearchParams({ csrfToken, callbackUrl: `${origin}/` }).toString()));
  f.remember(signout);

  const cleared = signout.headers.getSetCookie().find((v) => v.startsWith(`${sessionCookie}=;`) || /Max-Age=0/.test(v));
  assert.ok(cleared, '退出必须下发清除会话 Cookie');
  await assert.rejects(() => f.auth.requireUser(f.request('/api/me')), { status: 401 }, '退出后会话必须失效');
});

test('[GitHub] 页面退出契约：缺少 CSRF 的退出不得清空会话', async () => {
  const f = fixture({ google: false });
  await f.start('github');
  await f.callback('github');

  const signout = await f.auth.handle(f.request('/auth/signout', 'POST',
    new URLSearchParams({ callbackUrl: `${origin}/` }).toString()));
  const cleared = signout.headers.getSetCookie().some((v) => /Max-Age=0/.test(v));
  assert.equal(cleared, false, '缺少 CSRF 时不得清除会话 Cookie');
  assert.deepEqual(await f.auth.requireUser(f.request('/api/me')), { id: `github:${githubAccount.id}` }, '会话应仍然有效');
});

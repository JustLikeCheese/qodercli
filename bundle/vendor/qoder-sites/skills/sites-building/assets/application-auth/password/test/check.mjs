// 本地契约检查：直接调用真实的 functions/ 模块（router / http / validate / passwords /
// sessions / limiter），只替换数据层为凭据无关的假数据库。
// 不证明真实 Provider、网关准入或部署环境行为。
//   node --test dev/check.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplication } from '../functions/router.mjs';
const PUBLIC_ORIGIN = 'https://password.test';
import { PBKDF2_ITERATIONS } from '../functions/passwords.mjs';
import { SESSION_COOKIE, SESSION_TTL_MS, sha256Hex } from '../functions/sessions.mjs';
import { LIMITS } from '../functions/limiter.mjs';
import { createFakeDb } from './fake-db.mjs';

// 每次运行生成的临时口令，不在任何输出中打印；测试结束即丢弃。
const PASSWORD = `pw-${crypto.randomUUID()}-${crypto.randomUUID()}`;

function fixture() {
  const control = { mode: 'ok', dropTable: null, writes: [] };
  const db = createFakeDb(control);
  const handle = createApplication({ db, origin: PUBLIC_ORIGIN });
  return { control, db, handle };
}

// 网关会把 app 段替换成物理函数名；这里同时覆盖物理名与逻辑名两种形态。
function ctx(path, { method = 'GET', body, cookie, origin = PUBLIC_ORIGIN, headers = {}, logical = false } = {}) {
  const merged = { ...headers };
  if (origin !== null) merged.origin = origin;
  if (cookie) merged.cookie = cookie;
  if (body !== undefined) merged['content-type'] = 'application/json';
  const target = logical
    ? `${PUBLIC_ORIGIN}/functions/v1/app${path}`
    : `https://provider.internal/functions/v1/app-d${'a'.repeat(32)}${path}`;
  return {
    request: new Request(target, { method, headers: merged, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
    requestId: 'local-check',
  };
}

const call = async (handle, context) => {
  const response = await handle(context);
  let body = null;
  try { body = await response.clone().json(); } catch { body = null; }
  return { status: response.status, body, setCookie: response.headers.get('set-cookie'), headers: response.headers };
};

const cookiePair = (result) => {
  const header = result.setCookie;
  if (!header) return null;
  return header.split(';')[0];
};

const register = (handle, username, password = PASSWORD) => call(handle, ctx('/api/register', { method: 'POST', body: { username, password } }));
const login = (handle, username, password = PASSWORD) => call(handle, ctx('/api/login', { method: 'POST', body: { username, password } }));
const me = (handle, cookie) => call(handle, ctx('/api/me', { cookie }));
const uniqueName = (prefix = 'user') => `${prefix}${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;

test('注册：规范化用户名、签发会话、只保存派生结果', async () => {
  const { db, handle } = fixture();
  const created = await register(handle, '  Alpha_01  ');
  assert.equal(created.status, 201);
  assert.equal(created.body.user.username, 'alpha_01');
  assert.deepEqual(Object.keys(created.body.user).sort(), ['id', 'username']);

  const cookie = cookiePair(created);
  assert.ok(cookie && cookie.startsWith(`${SESSION_COOKIE}=`), '应签发会话 Cookie');
  assert.match(created.setCookie, /HttpOnly/);
  assert.match(created.setCookie, /Secure/);
  assert.match(created.setCookie, /SameSite=Lax/);
  assert.match(created.setCookie, /Path=\//);
  assert.ok(!/Domain=/i.test(created.setCookie), '__Host- Cookie 不能带 Domain');

  const users = db.dump('users');
  assert.equal(users.length, 1);
  assert.equal(users[0].username, 'alpha_01');
  assert.equal(users[0].password_iterations, PBKDF2_ITERATIONS);
  // 绝不保存明文口令，也不把口令写进会话表或限流表。
  const stored = JSON.stringify([...users, ...db.dump('sessions'), ...db.dump('auth_limiter')]);
  assert.ok(!stored.includes(PASSWORD), '数据库中不得出现明文口令');
  assert.notEqual(users[0].password_hash, PASSWORD);
  assert.ok(users[0].password_salt.length > 0);

  // 会话表只保存摘要：不出现明文令牌。
  const token = cookie.slice(SESSION_COOKIE.length + 1);
  assert.ok(!JSON.stringify(db.dump('sessions')).includes(token), '会话表不得保存明文令牌');
  assert.equal(db.dump('sessions')[0].token_digest, await sha256Hex(token));

  const who = await me(handle, cookie);
  assert.equal(who.status, 200);
  assert.deepEqual(who.body.user, created.body.user);
});

test('注册：用户名唯一（大小写与空白变体并发只有一个成功）', async () => {
  const { db, handle } = fixture();
  const results = await Promise.all([
    register(handle, 'Bravo01'), register(handle, 'bravo01'),
    register(handle, ' BRAVO01 '), register(handle, 'Bravo01'),
  ]);
  assert.equal(results.filter((r) => r.status === 201).length, 1, '只能有一个注册成功');
  assert.equal(results.filter((r) => r.status === 409 && r.body.error === 'username_taken').length, 3);
  const users = db.dump('users').filter((row) => row.username === 'bravo01');
  assert.equal(users.length, 1, '数据库中只能有一行同名账号');
});

test('注册：用户名与口令策略', async () => {
  const { handle } = fixture();
  for (const bad of ['ab', 'x'.repeat(33), '_leading', 'bad name', 'bad@name', '']) {
    const result = await register(handle, bad);
    assert.equal(result.status, 400, `用户名应被拒绝: ${JSON.stringify(bad)}`);
    assert.equal(result.body.error, 'invalid_username');
  }
  assert.equal((await register(handle, uniqueName(), 'short')).body.error, 'invalid_password');
  assert.equal((await register(handle, uniqueName(), 'x'.repeat(257))).body.error, 'invalid_password');
  // 恰好 15 个字符可以通过。
  const ok = await register(handle, uniqueName(), 'a'.repeat(15));
  assert.equal(ok.status, 201);
});

test('登录：未注册账号与错误口令返回相同错误码，成功后读取当前账号', async () => {
  const { handle } = fixture();
  const name = uniqueName();
  await register(handle, name);

  const unknown = await login(handle, uniqueName('ghost'));
  const wrong = await login(handle, name, `${PASSWORD}-wrong`);
  assert.equal(unknown.status, 401);
  assert.equal(wrong.status, 401);
  assert.deepEqual(unknown.body, { error: 'invalid_credentials' });
  assert.deepEqual(wrong.body, { error: 'invalid_credentials' });

  const ok = await login(handle, name.toUpperCase());
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.username, name);
  assert.equal((await me(handle, cookiePair(ok))).body.user.username, name);
});

test('会话：缺失、过期、被撤销、被篡改都返回 401', async () => {
  const { db, handle } = fixture();
  const created = await register(handle, uniqueName());
  const cookie = cookiePair(created);
  const userId = created.body.user.id;

  const missing = await me(handle, null);
  assert.equal(missing.status, 401);
  assert.equal(missing.body.error, 'login_required');
  assert.equal(missing.setCookie, null, '未带 Cookie 时不应下发清除指令');

  // 过期：直接写入一条已过期的会话。
  const expiredToken = 'A'.repeat(43);
  await db.from('sessions').insertIfAbsent({
    token_digest: await sha256Hex(expiredToken), user_id: userId,
    created_at: new Date(Date.now() - SESSION_TTL_MS * 2).toISOString(),
    expires_at: new Date(Date.now() - 1000).toISOString(), revoked_at: null,
  }, { onConflict: 'token_digest' }).select('token_digest');
  const expired = await me(handle, `${SESSION_COOKIE}=${expiredToken}`);
  assert.equal(expired.status, 401);
  assert.match(expired.setCookie ?? '', /Max-Age=0/, '失效会话应顺手清除 Cookie');

  const tampered = await me(handle, `${SESSION_COOKIE}=${'B'.repeat(43)}`);
  assert.equal(tampered.status, 401);

  const logout = await call(handle, ctx('/api/logout', { method: 'POST', cookie }));
  assert.equal(logout.status, 200);
  assert.match(logout.setCookie ?? '', /Max-Age=0/);
  assert.ok(db.dump('sessions').some((row) => row.revoked_at != null), '退出应撤销数据库中的会话');
  assert.equal((await me(handle, cookie)).status, 401, '撤销后旧 Cookie 不得再通过校验');
});

test('CSRF：跨来源的不安全方法被拒绝，即使带着有效会话', async () => {
  const { handle } = fixture();
  const created = await register(handle, uniqueName());
  const cookie = cookiePair(created);

  const foreignLogout = await call(handle, ctx('/api/logout', { method: 'POST', cookie, origin: 'https://evil.test' }));
  assert.equal(foreignLogout.status, 403);
  assert.equal(foreignLogout.body.error, 'origin_forbidden');

  const foreignNote = await call(handle, ctx('/api/notes', {
    method: 'POST', cookie, origin: 'https://evil.test', headers: { 'idempotency-key': crypto.randomUUID() }, body: { title: 'x' },
  }));
  assert.equal(foreignNote.status, 403);

  const noOrigin = await call(handle, ctx('/api/logout', { method: 'POST', cookie, origin: null }));
  assert.equal(noOrigin.status, 403, '缺少 Origin 的写请求同样拒绝');

  // 会话仍然有效（跨来源请求没有产生副作用）。
  assert.equal((await me(handle, cookie)).status, 200);
});

test('记录：归属来自会话，A/B 互相隔离', async () => {
  const { handle } = fixture();
  const a = await register(handle, uniqueName('alpha'));
  const b = await register(handle, uniqueName('bravo'));
  const cookieA = cookiePair(a), cookieB = cookiePair(b);

  const idA = crypto.randomUUID();
  const createdA = await call(handle, ctx('/api/notes', {
    method: 'POST', cookie: cookieA, headers: { 'idempotency-key': idA }, body: { title: 'A 的记录', owner_id: b.body.user.id },
  }));
  assert.equal(createdA.status, 201);
  assert.deepEqual(createdA.body, { id: idA, title: 'A 的记录' });

  assert.deepEqual((await call(handle, ctx('/api/notes', { cookie: cookieA }))).body, [{ id: idA, title: 'A 的记录' }]);
  assert.deepEqual((await call(handle, ctx('/api/notes', { cookie: cookieB }))).body, [], 'B 不得看到 A 的记录（请求体里的 owner_id 无效）');

  const idB = crypto.randomUUID();
  await call(handle, ctx('/api/notes', { method: 'POST', cookie: cookieB, headers: { 'idempotency-key': idB }, body: { title: 'B 的记录' } }));
  assert.equal((await call(handle, ctx('/api/notes', { cookie: cookieA }))).body.length, 1, 'B 的写入不影响 A');

  // 未登录不得读写记录。
  assert.equal((await call(handle, ctx('/api/notes'))).status, 401);
  assert.equal((await call(handle, ctx('/api/notes', { method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() }, body: { title: 'x' } }))).status, 401);
});

test('记录：幂等键语义', async () => {
  const { handle } = fixture();
  const cookie = cookiePair(await register(handle, uniqueName()));
  const id = crypto.randomUUID();
  const post = (title) => call(handle, ctx('/api/notes', { method: 'POST', cookie, headers: { 'idempotency-key': id }, body: { title } }));

  assert.equal((await post('第一条')).status, 201);
  const retry = await post('第一条');
  assert.equal(retry.status, 200);
  assert.deepEqual(retry.body, { id, title: '第一条' });
  const conflict = await post('内容不同');
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, 'idempotency_conflict');
  assert.equal((await call(handle, ctx('/api/notes', { cookie }))).body.length, 1);

  const badKey = await call(handle, ctx('/api/notes', { method: 'POST', cookie, headers: { 'idempotency-key': 'not-a-uuid' }, body: { title: 'x' } }));
  assert.equal(badKey.status, 400);
});

test('限流：连续失败（含不存在的账号）在窗口内被封顶', async () => {
  const { db, handle } = fixture();
  const name = uniqueName();
  await register(handle, name);

  const statuses = [];
  for (let index = 0; index < LIMITS.login.maxAttempts; index += 1) {
    statuses.push((await login(handle, name, `${PASSWORD}-bad`)).status);
  }
  assert.deepEqual(statuses, Array(LIMITS.login.maxAttempts).fill(401));
  const blocked = await login(handle, name, PASSWORD);
  assert.equal(blocked.status, 429, '达到上限后即使口令正确也应被限流');
  assert.equal(blocked.body.error, 'rate_limited');
  assert.ok(Number(blocked.headers.get('retry-after')) > 0, '应给出重试等待时间');

  // 不存在的账号同样受限，不能用失败次数探测账号是否存在。
  const ghost = uniqueName('ghost');
  const ghostStatuses = [];
  for (let index = 0; index < LIMITS.login.maxAttempts + 1; index += 1) {
    ghostStatuses.push((await login(handle, ghost, PASSWORD)).status);
  }
  assert.equal(ghostStatuses.at(-1), 429);
  assert.ok(db.dump('auth_limiter').some((row) => row.key === `login:${ghost}`));
});

test('限流：并发 CAS 不丢计数、不放行超额', async () => {
  const { db, handle } = fixture();
  const name = uniqueName();
  await register(handle, name);

  const results = await Promise.all(
    Array.from({ length: LIMITS.login.maxAttempts * 2 }, () => login(handle, name, `${PASSWORD}-bad`)),
  );
  const passed = results.filter((r) => r.status === 401).length;
  const limited = results.filter((r) => r.status === 429).length;
  const failedClosed = results.filter((r) => r.status === 503).length;

  // 绝不超额放行：通过的次数不能超过窗口上限。
  assert.ok(passed <= LIMITS.login.maxAttempts, '并发下也不得超过窗口上限');
  assert.equal(passed, LIMITS.login.maxAttempts, '正好放行上限次数');
  assert.equal(limited, LIMITS.login.maxAttempts, '其余全部被限流');
  assert.equal(passed + limited + failedClosed, results.length, '不得出现其它错误结果');

  // 计数由带谓词的更新推进，不会因为并发而丢更新或超发。
  const bucket = db.dump('auth_limiter').find((row) => row.key === `login:${name}`);
  assert.equal(bucket.attempt_count, LIMITS.login.maxAttempts);
});

test('限流：注册尝试同样有上限，成功登录不会清空已消费的配额', async () => {
  const { db, handle } = fixture();
  const name = uniqueName();
  assert.equal((await register(handle, name)).status, 201);

  const more = [];
  for (let index = 0; index < LIMITS.register.maxAttempts + 1; index += 1) {
    more.push((await register(handle, name)).status);
  }
  assert.ok(more.includes(429), '重复注册应触发注册限流');
  assert.equal(db.dump('users').filter((row) => row.username === name).length, 1);

  const bucket = () => db.dump('auth_limiter').find((row) => row.key === `login:${name}`);
  // 成功登录本身也要占用窗口配额，且不得把已消费的次数清零。
  assert.equal((await login(handle, name)).status, 200);
  assert.equal(bucket().attempt_count, 1, '成功登录不得重置计数');

  const statuses = [];
  for (let index = 0; index < LIMITS.login.maxAttempts; index += 1) {
    statuses.push((await login(handle, name)).status);
  }
  assert.ok(statuses.includes(429), '连续成功登录同样受窗口上限约束');
  assert.equal(bucket().attempt_count, LIMITS.login.maxAttempts, '计数只增不减');
  assert.equal(statuses.filter((s) => s === 200).length, LIMITS.login.maxAttempts - 1);
});

test('写入结果未知：不重放、不谎报成功', async () => {
  const { control, db, handle } = fixture();
  const name = uniqueName();
  await register(handle, name);

  const sessionsBefore = db.dump('sessions').length;
  const writeCount = () => control.writes.filter((table) => table === 'sessions').length;
  let attempts = writeCount();

  control.dropTable = 'sessions';
  const uncertain = await login(handle, name);
  assert.equal(uncertain.status, 503);
  assert.equal(uncertain.body.error, 'service_unavailable');
  assert.equal(cookiePair(uncertain), null, '结果未知时不得下发会话 Cookie');

  // 会话写入实际上已提交，但客户端拿不到；服务端不得重放该写入。
  assert.equal(db.dump('sessions').length, sessionsBefore + 1, '写入已提交（结果未知≠被拒绝）');
  assert.equal(writeCount() - attempts, 1, '结果未知时写入只能尝试一次');
  attempts = writeCount();

  // 明确的数据库拒绝：同样不得重放。
  control.rejectTable = 'sessions';
  const rejected = await login(handle, name);
  assert.equal(rejected.status, 503);
  assert.equal(cookiePair(rejected), null);
  assert.equal(db.dump('sessions').length, sessionsBefore + 1, '被拒绝的写入不得落库');
  assert.equal(writeCount() - attempts, 1, '被拒绝时写入也只能尝试一次');
});

test('响应头与路由：no-store、未知路径、错误方法', async () => {
  const { handle } = fixture();
  const health = await call(handle, ctx('/api/health'));
  assert.equal(health.status, 200);
  assert.deepEqual(health.body, { ok: true });
  assert.match(health.headers.get('cache-control') ?? '', /no-store/);
  assert.match(health.headers.get('referrer-policy') ?? '', /no-referrer/);

  assert.equal((await call(handle, ctx('/api/health', { logical: true }))).status, 200, '逻辑路径 /functions/v1/app/... 同样要命中');
  assert.equal((await call(handle, ctx('/api/unknown'))).status, 404);
  assert.equal((await call(handle, ctx('/api/notes', { method: 'DELETE' }))).status, 405);
  assert.equal((await call(handle, ctx('/api/me', { method: 'POST', body: {} }))).status, 405);
  assert.equal((await call(handle, ctx('/api/login', { method: 'POST' }))).status, 400);
});

// Local fixtures only. setup.mjs keeps this directory outside both upload roots.
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export class LocalError extends Error { constructor(code, status) { super(code); this.code = code; this.status = status; } }
export function createMemoryRuntime() {
  const tables = { notes: [], attachments: [] }, objects = new Map(), signatures = new Map();
  const state = { user: 'local-a', failList: false, loseCreate: false, conflict: false, loseComplete: false };
  function reset(empty = false) {
    tables.notes.length = 0; tables.attachments.length = 0; objects.clear(); signatures.clear();
    Object.assign(state, { user: 'local-a', failList: false, loseCreate: false, conflict: false, loseComplete: false });
    if (empty) return;
    const titles = ['秋日城市漫步 · 路线与灵感', '下个版本值得尝试的三个想法', '周五分享会：把复杂的事情讲清楚', '常用设计资料与阅读清单', '旅行前的小小准备', '本周复盘：做成了哪些事'];
    titles.forEach((title, i) => tables.notes.push({ id: randomUUID(), owner_id: 'local-a', title, creation_title: title, idempotency_key: randomUUID(), version: i === 1 ? 3 : 1, created_at: new Date(Date.now() - i * 86_400_000).toISOString() }));
    tables.notes.push({ id: randomUUID(), owner_id: 'local-b', title: '账号 B 的私人记录', creation_title: '账号 B 的私人记录', idempotency_key: randomUUID(), version: 1, created_at: new Date().toISOString() });
    const id = randomUUID(), path = `attachments/${id}`;
    objects.set(path, { bytes: new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR5kAAAAASUVORK5CYII=', 'base64')), type: 'image/png' });
    tables.attachments.push({ id, note_id: tables.notes[0].id, owner_id: 'local-a', object_path: path, status: 'ready', created_at: new Date().toISOString() });
  }
  reset();
  const db = { from(table) {
    if (!(table in tables)) throw new LocalError('invalid_table', 400);
    const filters = [], order = []; let mode = 'read', values, conflict, columns, count = 1000;
    const query = {
      select(value) { columns = value; return query; }, eq(key, value) { filters.push([key, value]); return query; },
      order(key, options = {}) { order.push([key, options.ascending !== false]); return query; }, limit(value) { count = value; return query; },
      insert(value) { mode = 'insert'; values = value; return query; },
      insertIfAbsent(value, options) { mode = 'insert'; values = value; conflict = options.onConflict.split(','); return query; },
      update(value) { mode = 'update'; values = value; return query; },
      then(fulfilled, rejected) {
        return Promise.resolve().then(() => {
          let result;
          if (mode === 'insert') {
            if (conflict && tables[table].some(row => conflict.every(key => row[key] === values[key]))) result = [];
            else { const row = { id: randomUUID(), created_at: new Date().toISOString(), ...(table === 'notes' ? { version: 1 } : {}), ...values }; tables[table].push(row); result = [row]; }
          } else {
            result = tables[table].filter(row => filters.every(([key, value]) => row[key] === value));
            if (mode === 'update') result.forEach(row => Object.assign(row, values));
          }
          for (const [key, asc] of [...order].reverse()) result = [...result].sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (asc ? 1 : -1));
          result = result.slice(0, count).map(row => columns ? Object.fromEntries(columns.split(',').map(key => [key, row[key]])) : { ...row });
          return { data: result, error: null };
        }).then(fulfilled, rejected);
      },
    };
    return query;
  } };
  function sign(path, operation) {
    const token = randomUUID(); signatures.set(token, { path, operation, expires: Date.now() + 60_000 });
    return { signedUrl: `/storage/v1/object/${operation === 'upload' ? 'upload/sign' : 'sign'}/11111111-1111-4111-8111-111111111111/${path}?token=${token}` };
  }
  const storage = {
    async createSignedUploadUrl(path) { return sign(path, 'upload'); }, async createSignedUrl(path) { return sign(path, 'download'); },
    async download(path) { const object = objects.get(path); if (!object) throw new LocalError('storage_object_not_found', 404); return new Response(object.bytes, { headers: { 'content-type': object.type, 'content-length': String(object.bytes.length) } }); },
  };
  return { db, storage, state, tables, reset, BackendError: LocalError,
    requireUser(ctx) { if (!ctx.user) throw new LocalError('login_required', 401); return ctx.user; },
    async transfer(request) {
      const url = new URL(request.url), signed = signatures.get(url.searchParams.get('token'));
      if (!signed || signed.expires < Date.now()) throw new LocalError('signature_expired', 403);
      if (signed.operation === 'download' && request.method === 'GET') return storage.download(signed.path);
      if (signed.operation !== 'upload' || request.method !== 'PUT') throw new LocalError('method_not_allowed', 405);
      if (objects.has(signed.path)) throw new LocalError('object_exists', 409);
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.length > 5 * 1024 * 1024) throw new LocalError('payload_too_large', 413);
      objects.set(signed.path, { bytes, type: request.headers.get('content-type') }); return Response.json({ ok: true });
    },
  };
}

const controls = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>本地测试控制台</title><style>body{font:16px/1.7 system-ui;max-width:700px;margin:50px auto;padding:20px;color:#17352d}button{font:inherit;padding:10px;margin:6px;border:1px solid #abc5ba;background:#f1f8f4;border-radius:6px;cursor:pointer}p{color:#5b6e66}form{display:inline}</style><h1>本地测试控制台</h1><p>只影响本次内存数据，不连接云端。操作后回到工作台点击“重新读取”；故障只影响下一次匹配请求。</p><p><a href="/">← 返回工作台</a></p><div id="controls"></div><p id="status" role="status"></p><script>const actions={'user-a':'切换账号 A','user-b':'切换账号 B','guest':'退出本地身份','fail-list':'下一次列表读取失败','lose-create':'下一次创建成功但丢失响应','conflict':'下一次保存发生版本冲突','lose-complete':'下一次附件确认成功但丢失响应','empty':'重置为空列表','reset':'恢复示例数据'};for(const [action,label]of Object.entries(actions)){const b=document.createElement('button');b.textContent=label;b.onclick=async()=>{const r=await fetch('/__local/control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action})});document.querySelector('#status').textContent=r.ok?'已设置：'+label:'设置失败'};document.querySelector('#controls').append(b)}</script></html>`;

export async function startLocalBackend(application, { port = 0 } = {}) {
  const runtime = createMemoryRuntime(), handle = application(runtime);
  const server = createServer(async (incoming, outgoing) => {
    try {
      const url = new URL(incoming.url, `http://${incoming.headers.host}`);
      if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new LocalError('invalid_host', 403);
      if (!['GET', 'HEAD'].includes(incoming.method) && incoming.headers.origin && incoming.headers.origin !== url.origin) throw new LocalError('invalid_origin', 403);
      let size = 0; const chunks = [];
      for await (const chunk of incoming) { size += chunk.length; if (size > 5 * 1024 * 1024) throw new LocalError('payload_too_large', 413); chunks.push(chunk); }
      const request = new Request(url, { method: incoming.method, headers: incoming.headers, ...(['GET', 'HEAD'].includes(incoming.method) ? {} : { body: Buffer.concat(chunks) }) });
      let response;
      if (url.pathname === '/__local/' && incoming.method === 'GET') response = new Response(controls, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      else if (url.pathname === '/__local/control' && incoming.method === 'POST') {
        const { action } = await request.json();
        if (action === 'reset' || action === 'empty') runtime.reset(action === 'empty');
        else if (['user-a', 'user-b', 'guest'].includes(action)) runtime.state.user = action === 'guest' ? null : action === 'user-a' ? 'local-a' : 'local-b';
        else if ({ 'fail-list': 1, 'lose-create': 1, conflict: 1, 'lose-complete': 1 }[action]) runtime.state[({ 'fail-list': 'failList', 'lose-create': 'loseCreate', conflict: 'conflict', 'lose-complete': 'loseComplete' })[action]] = true;
        else throw new LocalError('invalid_control', 400);
        response = Response.json({ ok: true });
      } else if (url.pathname.startsWith('/storage/v1/')) response = await runtime.transfer(request);
      else {
        const isList = url.pathname.endsWith('/api/notes') && request.method === 'GET';
        if (isList && runtime.state.failList) { runtime.state.failList = false; throw new LocalError('database_unavailable', 503); }
        if (request.method === 'PATCH' && runtime.state.conflict) { runtime.state.conflict = false; const id = url.pathname.split('/').at(-1); const row = runtime.tables.notes.find(row => row.id === id && row.owner_id === runtime.state.user); if (row) { row.version++; row.title += '（另一处已更新）'; } }
        response = await handle({ request, user: runtime.state.user ? { id: runtime.state.user } : null });
        const create = url.pathname.endsWith('/api/notes') && request.method === 'POST';
        const complete = url.pathname.endsWith('/complete') && request.method === 'POST';
        if ((create && runtime.state.loseCreate) || (complete && runtime.state.loseComplete)) { if (create) runtime.state.loseCreate = false; if (complete) runtime.state.loseComplete = false; response = Response.json({ error: 'response_lost' }, { status: 503 }); }
      }
      outgoing.writeHead(response.status, { ...Object.fromEntries(response.headers), 'cache-control': 'no-store' }); outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) { outgoing.writeHead(error instanceof LocalError ? error.status : 500, { 'content-type': 'application/json', 'cache-control': 'no-store' }); outgoing.end(JSON.stringify({ error: error instanceof LocalError ? error.code : 'local_failure' })); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { runtime, server, origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { application } = await import(/* @vite-ignore */ new URL('../functions/routes.mjs', import.meta.url).href);
  const backend = await startLocalBackend(application);
  process.env.RECORDS_LOCAL_API = backend.origin;
  const vite = await import('vite');
  let frontend;
  try { frontend = await vite.createServer(); await frontend.listen(); frontend.printUrls(); }
  catch (error) { await backend.close(); throw error; }
  console.log('Local fixture mode. Data resets on restart. Open /__local/ for failure and account controls.');
  const stop = async () => { await frontend.close(); await backend.close(); process.exit(0); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}

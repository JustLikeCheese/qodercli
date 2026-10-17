import { createServer } from 'node:https';
import { readFile, realpath, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, sep, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

// A single HTTPS loopback origin: no insecure-Cookie rewrites and no cloud SDK.
export async function startLocal({ root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), mode = 'password', port = 8443, cert, key }) {
  if (!['password', 'oauth'].includes(mode) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid_local_configuration');
  const origin = `https://localhost:${port}`;
  const { createFakeDb } = await import(pathToFileURL(resolve(root, 'password/test/fake-db.mjs')));
  const db = createFakeDb();
  let handle;
  if (mode === 'password') {
    const { createApplication } = await import(pathToFileURL(resolve(root, 'password/functions/router.mjs')));
    handle = createApplication({ db, origin });
  } else {
    const { createAppAuth } = await import(pathToFileURL(resolve(root, 'oidc/auth.mjs')));
    const { createBusiness } = await import(pathToFileURL(resolve(root, 'business.mjs')));
    const { applicationPath, applicationError, createEnv } = await import(pathToFileURL(resolve(root, 'shared.mjs')));
    // Local smoke uses synthetic credentials and refuses all provider traffic.
    const values = { APP_ORIGIN: origin, APP_AUTH_SECRET: crypto.randomUUID() + crypto.randomUUID(),
      APP_GITHUB_CLIENT_ID: 'local-client', APP_GITHUB_CLIENT_SECRET: 'local-only' };
    const env = createEnv(name => values[name]);
    const auth = createAppAuth({ env, fetch: async () => { throw new Error('local_provider_disabled'); } });
    const business = createBusiness({ db, auth, env });
    handle = async ctx => {
      try { return applicationPath(ctx.request).startsWith('/auth/') ? await auth.handle(ctx.request) : await business(ctx); }
      catch (error) { return applicationError(error, () => Response.json({ error: 'local_error' }, { status: 503 })); }
    };
  }
  const web = await realpath(resolve(root, mode === 'password' ? 'password/web' : 'web'));
  const server = createServer({ cert: await readFile(cert), key: await readFile(key) }, async (req, res) => {
    try {
      const url = new URL(req.url, origin);
      if (url.origin !== origin) throw new Error('invalid_origin');
      if (url.pathname === '/__local_health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ mode, localOnly: true })); return; }
      if (url.pathname.startsWith('/functions/v1/app/')) {
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 8192) { res.writeHead(413); res.end(); return; } chunks.push(chunk); }
        const request = new Request(url, { method: req.method, headers: req.headers,
          ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }) });
        const response = await handle({ request, requestId: crypto.randomUUID() });
        const headers = Object.fromEntries(response.headers); delete headers['set-cookie'];
        res.writeHead(response.status, { ...headers, 'set-cookie': response.headers.getSetCookie() });
        res.end(Buffer.from(await response.arrayBuffer())); return;
      }
      if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
      const file = await realpath(resolve(web, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
      if (!file.startsWith(web + sep) || !(await stat(file)).isFile()) throw new Error('not_found');
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };
      if (!types[extname(file)]) throw new Error('not_found');
      res.writeHead(200, { 'content-type': types[extname(file)], 'cache-control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : await readFile(file));
    } catch { if (!res.headersSent) res.writeHead(404); res.end(); }
  });
  await new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done); });
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { mode: { type: 'string', default: 'password' }, port: { type: 'string', default: '8443' }, cert: { type: 'string' }, key: { type: 'string' } } });
  startLocal({ ...values, port: Number(values.port) }).then(server => {
    console.log(`Local ${values.mode} example: https://localhost:${values.port} (synthetic database; cloud/provider behavior unverified)`);
    const close = () => { server.close(); server.closeAllConnections(); };
    process.once('SIGINT', close); process.once('SIGTERM', close);
  }).catch(() => { console.error('Local startup failed: check certificate/key paths and port availability. No existing process was stopped.'); process.exitCode = 1; });
}

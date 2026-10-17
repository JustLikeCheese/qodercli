// Local runner only. No PAT, remote requests or cloud resources are used here.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { createChatHandler } from '../handler.mjs';
import { createMemoryService } from './memory-service.mjs';

if (Number(process.versions.node.split('.')[0]) < 22) throw Error('Use Node 22 or newer for this example.');
const port = Number(process.env.PORT || 4318);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid PORT.');
const origin = `http://127.0.0.1:${port}`;
const service = createMemoryService();
const handler = createChatHandler({ service });
const files = new Map([
  ['/', [new URL('../web/index.html', import.meta.url), 'text/html; charset=utf-8']],
  ['/app.js', [new URL('../web/app.js', import.meta.url), 'text/javascript; charset=utf-8']],
  ['/style.css', [new URL('../web/style.css', import.meta.url), 'text/css; charset=utf-8']],
  ['/helpers/conversation-stream.mjs', [new URL('../../conversation-stream.mjs', import.meta.url), 'text/javascript']],
  ['/helpers/sse.mjs', [new URL('../../sse.mjs', import.meta.url), 'text/javascript']],
]);
const server = createServer(async (incoming, outgoing) => {
  try {
    if (incoming.headers.host !== `127.0.0.1:${port}`) { outgoing.writeHead(403); outgoing.end(); return; }
    const url = new URL(incoming.url, origin);
    if (incoming.method === 'GET' && files.has(url.pathname)) {
      const [file, type] = files.get(url.pathname);
      outgoing.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }); outgoing.end(await readFile(file)); return;
    }
    if (incoming.method !== 'GET' && incoming.headers.origin !== origin) { outgoing.writeHead(403); outgoing.end(); return; }
    const abort = new AbortController();
    outgoing.on('close', () => abort.abort());
    const request = new Request(url, { method: incoming.method, headers: incoming.headers, signal: abort.signal,
      ...(!['GET', 'HEAD'].includes(incoming.method) ? { body: Readable.toWeb(incoming), duplex: 'half' } : {}) });
    const response = await handler(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body).pipe(outgoing);
    else outgoing.end();
  } catch {
    if (!outgoing.headersSent) outgoing.writeHead(500, { 'content-type': 'application/json' });
    outgoing.end(JSON.stringify({ error: { code: 'service_unavailable' } }));
  }
});
server.listen(port, '127.0.0.1', () => console.log(`SSE chat example: ${origin}\nLocal controlled replies only. History lasts until this process exits.`));
const shutdown = () => { service.close(); server.closeAllConnections(); server.close(() => process.exit(0)); };
process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);

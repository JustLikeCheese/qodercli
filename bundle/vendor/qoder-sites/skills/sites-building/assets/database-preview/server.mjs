// Local sample data only. Keep this directory out of the published Function package.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const handlerPath = process.argv[2];
if (!handlerPath) throw Error('Usage: node server.mjs <path/to/handler.mjs> [port]');
const port = Number(process.argv[3] ?? 8000);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Invalid port');
const { handleNotes } = await import(pathToFileURL(resolve(handlerPath)).href);
const page = await readFile(new URL('./index.html', import.meta.url));
const rows = Array.from({ length: 25 }, (_, i) => ({
  id: `00000000-0000-4000-8000-${String(25 - i).padStart(12, '0')}`,
  title: `Local sample note ${25 - i}`,
  created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, 25 - i)).toISOString(),
}));
const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, 'http://127.0.0.1');
    if (url.pathname === '/' && incoming.method === 'GET') {
      outgoing.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      outgoing.end(page);
      return;
    }
    if (url.pathname !== '/functions/v1/app') { outgoing.writeHead(404); outgoing.end(); return; }
    const mode = url.searchParams.get('fixture') ?? 'normal';
    if (!['normal', 'empty', 'error'].includes(mode)) { outgoing.writeHead(400); outgoing.end(); return; }
    const query = {
      select() { return query; }, order() { return query; },
      async range(start, end) {
        return mode === 'error' ? { data: null, error: { message: 'local simulated failure' } }
          : { data: mode === 'empty' ? [] : rows.slice(start, end + 1), error: null };
      },
    };
    const response = await handleNotes({
      request: new Request(url, { method: incoming.method }),
      supabase: { from: () => query },
    });
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.writeHead(500, { 'content-type': 'application/json' });
    outgoing.end('{"error":"local_preview_failed"}');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Local sample preview: http://127.0.0.1:${server.address().port}/`));

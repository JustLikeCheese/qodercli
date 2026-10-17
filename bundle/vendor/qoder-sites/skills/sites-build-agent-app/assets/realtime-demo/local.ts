// Local-only fixture entry point. Keep outside the published Function directory.
import { createRealtimeDemoHandler } from './handler.mjs';

const handler = createRealtimeDemoHandler({ siteOrigin: 'http://127.0.0.1:8000' });
Deno.serve({ hostname: '127.0.0.1', port: 8000 }, request => {
  if (new URL(request.url).pathname === '/') {
    return new Response(Deno.readTextFileSync(new URL('./index.html', import.meta.url)), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }
  return handler(request);
});

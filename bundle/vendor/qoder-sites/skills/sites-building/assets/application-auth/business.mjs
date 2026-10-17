import { ApplicationAuthError, applicationPath, httpsOrigin, requireSameOrigin, limitedText, noStore } from './shared.mjs';

// The app user comes only from this application's verifier, never ctx.user.
export function createBusiness({ db, auth, env }) {
  const rows = result => {
    if (result.error) throw new ApplicationAuthError('database_unavailable', 503);
    return result.data;
  };
  return async ctx => {
    const request = ctx.request, path = applicationPath(request);
    requireSameOrigin(request, httpsOrigin(env('APP_ORIGIN')));
    if (path === '/api/health' && request.method === 'GET') return noStore(Response.json({ ok: true }));
    if (!['/api/me', '/api/notes'].includes(path)) throw new ApplicationAuthError('not_found', 404);
    const user = await auth.requireUser(request);
    if (path === '/api/me' && request.method === 'GET') return noStore(Response.json({ user }));
    if (path === '/api/notes' && request.method === 'GET') {
      return noStore(Response.json(rows(await db.from('app_notes').select('id,title').eq('owner_id', user.id).order('id').limit(100))));
    }
    if (path === '/api/notes' && request.method === 'POST') {
      if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new ApplicationAuthError('invalid_input', 400);
      let body;
      try { body = JSON.parse(await limitedText(request)); }
      catch (error) { if (error instanceof ApplicationAuthError) throw error; throw new ApplicationAuthError('invalid_input', 400); }
      const id = request.headers.get('idempotency-key');
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id ?? '')
        || typeof body?.title !== 'string' || !body.title.trim() || body.title.length > 300) throw new ApplicationAuthError('invalid_input', 400);
      const inserted = rows(await db.from('app_notes').insertIfAbsent({ id, owner_id: user.id, title: body.title }, { onConflict: 'owner_id,id' }).select('id,title'));
      if (inserted?.length) return noStore(Response.json(inserted[0], { status: 201 }));
      const existing = rows(await db.from('app_notes').select('id,title').eq('owner_id', user.id).eq('id', id).limit(1));
      if (!existing?.length || existing[0].title !== body.title) throw new ApplicationAuthError('idempotency_conflict', 409);
      return noStore(Response.json(existing[0]));
    }
    throw new ApplicationAuthError('method_not_allowed', 405);
  };
}

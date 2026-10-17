const json = (value, status = 200, extra = {}) => Response.json(value, { status,
  headers: { 'cache-control': 'private, no-store', ...extra } });

export function createProfile({ db, requireUser, BackendError }) {
  return async function handleProfile(ctx) {
    const { request } = ctx;
    if (new URL(request.url).searchParams.get('action') !== 'profile') return json({ error: 'not_found' }, 404);
    if (!['GET', 'POST'].includes(request.method)) return json({ error: 'method_not_allowed' }, 405, { allow: 'GET, POST' });
    let writing = false;
    try {
      const user = requireUser(ctx);
      let result;
      if (request.method === 'POST') {
        if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return json({ error: 'invalid_input' }, 415);
        // Bound actual streamed bytes, not only the client-supplied Content-Length.
        const reader = request.body?.getReader();
        if (!reader) return json({ error: 'invalid_input' }, 400);
        let size = 0; const chunks = [];
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 2048) { await reader.cancel(); return json({ error: 'invalid_input' }, 413); }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        let input;
        try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
        catch { return json({ error: 'invalid_input' }, 400); }
        if (!input || typeof input.display_name !== 'string' || !input.display_name.trim()
            || new TextEncoder().encode(input.display_name.trim()).length > 128) return json({ error: 'invalid_input' }, 400);
        writing = true;
        result = await db.from('profiles').insertIfAbsent({ user_id: user.id, display_name: input.display_name.trim() },
          { onConflict: 'user_id' }).select('user_id,display_name');
        // A duplicate create is a confirmed no-op, not a failed write replay.
        // This preference uses last-write-wins; each mutation is owner-scoped.
        if (!result.error && Array.isArray(result.data) && result.data.length === 0) {
          result = await db.from('profiles').update({ display_name: input.display_name.trim() })
            .eq('user_id', user.id).select('user_id,display_name');
        }
      } else {
        result = await db.from('profiles').select('user_id,display_name').eq('user_id', user.id).limit(1);
      }
      const row = Array.isArray(result.data) ? result.data[0] : undefined;
      if (result.error || !Array.isArray(result.data) || result.data.length > 1 || (request.method === 'POST' && !row)
          || (row && (row.user_id !== user.id || typeof row.display_name !== 'string'))) {
        const code = writing ? ([400,401,403,409,422].includes(result.error?.status) ? 'write_rejected' : 'write_result_unknown') : 'profile_unavailable';
        return json({ error: code }, 503);
      }
      return json({ user: { id: user.id, name: user.name, picture: user.picture },
        profile: row ? { display_name: row.display_name } : null });
    } catch (error) {
      return json({ error: error instanceof BackendError && [401,403].includes(error.status) ? error.code : writing ? 'write_result_unknown' : 'profile_unavailable' },
        error instanceof BackendError && [401,403].includes(error.status) ? error.status : 503);
    }
  };
}

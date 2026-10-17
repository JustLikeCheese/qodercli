import { requireUser, UserContextError } from './auth.mjs';
const json = (value, status = 200, extra = {}) => Response.json(value, { status,
  headers: { 'cache-control': 'private, no-store', ...extra } });

export async function handleProfile({ request, supabase }) {
  if (new URL(request.url).searchParams.get('action') !== 'profile') return json({ error: 'not_found' }, 404);
  if (!['GET', 'POST'].includes(request.method)) return json({ error: 'method_not_allowed' }, 405, { allow: 'GET, POST' });
  let writing = false;
  try {
    const user = requireUser(request);
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
      result = await supabase.from('profiles').upsert({ user_id: user.user_id, display_name: input.display_name.trim() },
        { onConflict: 'user_id' }).select('user_id,display_name').single();
    } else {
      result = await supabase.from('profiles').select('user_id,display_name').eq('user_id', user.user_id).maybeSingle();
    }
    if (result.error || (request.method === 'POST' && !result.data)
        || (result.data && (result.data.user_id !== user.user_id || typeof result.data.display_name !== 'string'))) {
      const code = writing ? (/^(22|23|42)[A-Z0-9]{3}$/.test(result.error?.code ?? '') ? 'write_rejected' : 'write_result_unknown') : 'profile_unavailable';
      return json({ error: code }, 503);
    }
    return json({ user: { id: user.user_id, name: user.name, picture: user.picture },
      profile: result.data ? { display_name: result.data.display_name } : null });
  } catch (error) {
    return json({ error: error instanceof UserContextError ? error.code : writing ? 'write_result_unknown' : 'profile_unavailable' },
      error instanceof UserContextError ? error.status : 503);
  }
}

import { requireUser, UserContextError } from './auth.mjs';

// Copy both files into the Function directory for a credential-free identity endpoint.
Deno.serve((request: Request) => {
  const headers = { 'cache-control': 'private, no-store' };
  if (new URL(request.url).searchParams.get('action') !== 'me') {
    return Response.json({ error: 'not_found' }, { status: 404, headers });
  }
  if (request.method !== 'GET') {
    return Response.json({ error: 'method_not_allowed' }, { status: 405, headers: { ...headers, allow: 'GET' } });
  }
  try {
    const user = requireUser(request);
    return Response.json({ user: { id: user.user_id, name: user.name, picture: user.picture } }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof UserContextError ? error.code : 'request_failed' },
      { status: error instanceof UserContextError ? error.status : 500, headers });
  }
});

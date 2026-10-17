import { checkWebSocketRequest, socketChannel } from '../websocket.mjs';
import { relayRealtime } from '../qca-realtime.mjs';

/**
 * @param {{ siteOrigin: string, apiOrigin?: string,
 *   resolveConversation?: (request: Request, applicationId: string) => Promise<string | null>,
 *   upgrade?: (request: Request) => { socket: WebSocket, response: Response },
 *   getToken?: () => string | undefined,
 *   connect?: (url: string, options: { headers: Record<string, string> }) => WebSocket }} options
 */
export function createRealtimeDemoHandler({ siteOrigin, apiOrigin, resolveConversation,
  upgrade = request => Deno.upgradeWebSocket(request), getToken, connect,
}) {
  return async request => {
    const url = new URL(request.url), action = url.searchParams.get('action');
    if (!['ws-echo', 'realtime'].includes(action)) return new Response('Not found', { status: 404 });
    const rejected = checkWebSocketRequest(request, siteOrigin);
    if (rejected) return new Response('WebSocket request rejected', { status: rejected });
    // Echo is a bounded, credential-free diagnostic route. Remove it from the app
    // after validation. Only the realtime route can use the platform PAT.
    if (action === 'ws-echo') {
      const { socket, response } = upgrade(request);
      const channel = socketChannel(socket, { maxMessageBytes: 4096, onMessage: data => channel.send(data) });
      return response;
    }
    if (!resolveConversation || !apiOrigin) return new Response('Realtime not configured', { status: 503 });
    const applicationId = url.searchParams.get('conversation');
    if (!applicationId || !/^[A-Za-z0-9_-]{1,128}$/.test(applicationId)) return new Response('Invalid conversation', { status: 400 });
    try {
      // This required application adapter verifies current site/user identity,
      // ownership and quota, then returns the stored QCA conv_* ID. It never creates.
      const conversationId = await resolveConversation(request, applicationId);
      if (!conversationId) return new Response('Access denied', { status: 403 });
      const { socket, response } = upgrade(request);
      relayRealtime(socket, { origin: apiOrigin, conversationId, getToken, connect });
      return response;
    } catch (error) {
      const status = error?.code === 'login_required' ? 401 : error?.code === 'invalid_user_context' ? 403 : 503;
      return new Response('Realtime unavailable', { status });
    }
  };
}

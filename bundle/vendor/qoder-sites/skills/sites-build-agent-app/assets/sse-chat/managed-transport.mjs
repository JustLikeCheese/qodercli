import { createCloudAgentsClient } from '../cloud-agents.mjs';
import { readSSE } from '../sse.mjs';

// Server-only transport for the service adapter. This deliberately does not
// allocate Sessions or implement ownership, storage, coordination or retries.
export function createManagedTransport(options) {
  const cloud = createCloudAgentsClient(options);
  const session = id => {
    if (!/^sess_[A-Za-z0-9_-]+$/.test(id)) throw Error('ai_request_invalid');
    return `/api/v1/cloud/sessions/${id}/events`;
  };
  return {
    send(sessionId, text) {
      if (typeof text !== 'string' || !text.trim() || text.length > 4000) throw Error('ai_request_invalid');
      return cloud.request(session(sessionId), { method: 'POST', body: {
        events: [{ type: 'user.message', content: [{ type: 'text', text }] }],
      } });
    },
    history(sessionId, page) {
      if (page !== undefined && (typeof page !== 'string' || page.length > 1000)) throw Error('ai_request_invalid');
      return cloud.request(`${session(sessionId)}?order=asc&limit=100${page ? `&page=${encodeURIComponent(page)}` : ''}`);
    },
    async *events(sessionId, { lastEventId, signal } = {}) {
      session(sessionId);
      const upstream = await cloud.openStream(sessionId, { lastEventId, signal });
      try {
        for await (const frame of readSSE(upstream.body, { signal })) yield JSON.parse(frame.data);
      } finally { upstream.close(); }
    },
  };
}

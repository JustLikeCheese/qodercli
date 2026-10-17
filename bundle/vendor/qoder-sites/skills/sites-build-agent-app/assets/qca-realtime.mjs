import { relayWebSockets } from './websocket.mjs';

const version = 'voice.realtime.v1';
const size = text => new TextEncoder().encode(text).byteLength;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const invalid = () => { throw Error('realtime_message_invalid'); };
function audio(value) {
  if (typeof value !== 'string' || !value || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) invalid();
  if (atob(value).length % 2 !== 0) invalid();
  return value;
}
function parse(data) {
  if (typeof data !== 'string' || size(data) > 256 * 1024) invalid();
  const event = JSON.parse(data);
  if (event?.version !== version || typeof event.type !== 'string' || !object(event.payload)) invalid();
  return event;
}
function identifiers(event) {
  const result = {};
  for (const key of ['work_id', 'announcement_id']) {
    if (event[key] !== undefined) {
      if (!id(event[key])) invalid();
      result[key] = event[key];
    }
  }
  return result;
}

// Server-only. `connect` is the runtime adapter that can attach handshake headers.
// Browser WebSocket does not accept headers; a PAT must never enter its URL/protocols.
export function openRealtimeSocket({ origin, conversationId,
  getToken = () => globalThis.Deno?.env.get('QODER_PAT'),
  connect = (url, options) => new WebSocket(url, options),
}) {
  let base, token;
  try { base = new URL(origin); token = getToken(); } catch { throw Error('ai_not_configured'); }
  if (base.protocol !== 'https:' || base.origin !== origin || !/^conv_[A-Za-z0-9_-]{1,128}$/.test(conversationId)
    || typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token)) throw Error('ai_not_configured');
  const url = new URL('/api/v1/forward/realtime', base);
  url.protocol = 'wss:';
  url.searchParams.set('conversation_id', conversationId);
  try { return connect(url.href, { headers: { Authorization: `Bearer ${token}` } }); }
  catch { throw Error('ai_realtime_unavailable'); }
}

// Uses the QCA wire envelope for selected public content only. Call after visitor
// authorization + durable conversation ownership resolution; this creates no resources.
export function relayRealtime(downstream, {
  origin, conversationId, getToken, connect,
  readyTimeoutMs = 10000, connectTimeoutMs = 10000,
  maxMessageBytes = 256 * 1024, maxBufferedBytes = 512 * 1024,
  maxMessages = 3000, maxDurationMs = 55000,
} = {}) {
  // Validate before starting timers or opening the credential-bearing connection.
  // Timers above the runtime's signed 32-bit range can otherwise fire immediately.
  const limits = { maxMessageBytes, maxBufferedBytes, maxMessages, maxDurationMs };
  if ([readyTimeoutMs, connectTimeoutMs, ...Object.values(limits)].some(value => !Number.isSafeInteger(value) || value < 1)
    || [readyTimeoutMs, connectTimeoutMs, maxDurationMs].some(value => value > 2147483647)
    || maxMessageBytes > 256 * 1024) {
    try { downstream.close(4000, 'realtime_configuration_invalid'); } catch { /* Already closing. */ }
    throw Error('realtime_configuration_invalid');
  }
  let ready = false, closing = false;
  let relay;
  const timer = setTimeout(() => relay?.close(), readyTimeoutMs);
  const relayOptions = {
    ...limits, connectTimeoutMs,
    // Only policy values are configurable; projection and cleanup stay owned here.
    onClose: () => clearTimeout(timer),
    clientMessage(data) {
      const { type, payload: p } = parse(data);
      if (!ready || closing) invalid();
      let payload;
      switch (type) {
        case 'text.message':
          if (typeof p.text !== 'string' || !p.text.trim() || size(p.text) > 16 * 1024) invalid();
          payload = { text: p.text }; break;
        case 'audio.append': payload = { audio: audio(p.audio) }; break;
        case 'interrupt': case 'ping': payload = {}; break;
        case 'playback.started': case 'playback.ended': case 'playback.cancelled':
          payload = identifiers(p); break;
        case 'connection.close':
          if (!id(p.request_id)) invalid();
          payload = { request_id: p.request_id }; closing = true; break;
        default: invalid();
      }
      return JSON.stringify({ version, type, payload });
    },
    serverMessage(data) {
      const event = parse(data), { type, payload: p } = event;
      let payload;
      switch (type) {
        case 'voice.ready': {
          for (const [key, rate] of [['input_audio', 16000], ['output_audio', 24000]]) {
            if (p[key]?.format !== 'pcm16' || p[key]?.sample_rate !== rate || p[key]?.channels !== 1) invalid();
          }
          payload = { input_audio: { format: 'pcm16', sample_rate: 16000, channels: 1 },
            output_audio: { format: 'pcm16', sample_rate: 24000, channels: 1 },
            capabilities: { graceful_close: p.capabilities?.graceful_close === true } };
          ready = true; clearTimeout(timer); break;
        }
        case 'voice.state':
          if (!['connecting', 'ready', 'idle', 'interrupted'].includes(p.state)) invalid();
          payload = { state: p.state }; break;
        case 'voice.replaced': ready = false; payload = { reason: 'connection_replaced' }; break;
        case 'transcript.delta': case 'transcript.final':
          if (!['user', 'assistant'].includes(p.role) || typeof p.text !== 'string') invalid();
          payload = { role: p.role, text: p.text };
          for (const key of ['item_id', 'response_id']) if (id(p[key])) payload[key] = p[key];
          break;
        case 'audio.delta': payload = { audio: audio(p.audio) }; break;
        case 'audio.done': case 'pong': payload = {}; break;
        case 'playback.interrupt': payload = { reason: 'interrupted' }; break;
        case 'work.accepted': case 'work.running': case 'work.completed': case 'work.failed':
          payload = { status: type.slice(5) }; break;
        case 'connection.closed':
          if (!id(p.request_id) || !['no_active_response', 'no_content', 'saved', 'saved_interrupted'].includes(p.outcome)) invalid();
          payload = { request_id: p.request_id, outcome: p.outcome }; break;
        case 'error':
          payload = { code: 'ai_realtime_error', retryable: p.retryable === true };
          if (Number.isInteger(p.retry_after_ms) && p.retry_after_ms >= 0 && p.retry_after_ms <= 60000) payload.retry_after_ms = p.retry_after_ms;
          break;
        default: return; // Tool details, progress and future event types require explicit projection.
      }
      return JSON.stringify({ version, type, payload, ...identifiers(event) });
    },
  };
  try {
    relay = relayWebSockets(downstream, () => openRealtimeSocket({ origin, conversationId, getToken, connect }), relayOptions);
  } catch (error) {
    clearTimeout(timer);
    try { downstream.close(4000, 'realtime_configuration_invalid'); } catch { /* Already closing. */ }
    throw error;
  }
  return relay;
}

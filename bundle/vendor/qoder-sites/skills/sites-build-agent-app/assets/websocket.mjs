// Copy into the Function package. Limits below are demo policy, not platform limits.
const bytes = data => typeof data === 'string' ? new TextEncoder().encode(data).byteLength
  : data instanceof ArrayBuffer || ArrayBuffer.isView(data) ? data.byteLength : Infinity;

export function socketChannel(socket, {
  onMessage = () => {}, onClose = () => {},
  maxMessageBytes = 256 * 1024, maxBufferedBytes = 512 * 1024,
  maxMessages = 3000, maxDurationMs = 55000,
} = {}) {
  for (const limit of [maxMessageBytes, maxBufferedBytes, maxMessages, maxDurationMs]) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw Error('socket_configuration_invalid');
  }
  socket.binaryType = 'arraybuffer';
  let stopped = false, received = 0;
  const timer = setTimeout(() => close('socket_lifetime_limit'), maxDurationMs);
  const disconnected = () => close('socket_disconnected');
  function close(reason = 'socket_closed') {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    socket.removeEventListener('message', message);
    socket.removeEventListener('close', disconnected);
    socket.removeEventListener('error', disconnected);
    // Never copy an upstream close reason or exception into the other connection.
    try { if (socket.readyState < 2) socket.close(4000, reason); } catch { /* Already closing. */ }
    onClose();
  }
  function message(event) {
    if (stopped) return;
    if (bytes(event.data) > maxMessageBytes) return close('socket_message_too_large');
    if (++received > maxMessages) return close('socket_message_limit');
    try { onMessage(event.data); } catch { close('socket_message_invalid'); }
  }
  function send(data) {
    if (stopped) return false;
    const length = bytes(data);
    if (length > maxMessageBytes) { close('socket_message_too_large'); return false; }
    if (socket.readyState !== 1) { close('socket_not_ready'); return false; }
    if (socket.bufferedAmount + length > maxBufferedBytes) { close('socket_backpressure'); return false; }
    try { socket.send(data); return true; } catch { close('socket_disconnected'); return false; }
  }
  socket.addEventListener('message', message);
  socket.addEventListener('close', disconnected);
  socket.addEventListener('error', disconnected);
  if (socket.readyState >= 2) close('socket_disconnected');
  return { send, close };
}

// Fixed, trusted server-side destination only. Message mappers are synchronous;
// returning undefined suppresses a frame. Nothing is buffered or replayed on reconnect.
export function relayWebSockets(downstream, connectUpstream, {
  clientMessage = data => data, serverMessage = data => data,
  connectTimeoutMs = 10000, onClose = () => {}, ...limits
} = {}) {
  let upstream, outgoing, incoming, connectTimer, stopped = false;
  function close() {
    if (stopped) return;
    stopped = true;
    clearTimeout(connectTimer);
    downstream.removeEventListener('open', connect);
    upstream?.removeEventListener('open', opened);
    incoming?.close();
    outgoing?.close();
    onClose();
  }
  const opened = () => clearTimeout(connectTimer);
  function connect() {
    if (stopped) return;
    try {
      upstream = connectUpstream();
      outgoing = socketChannel(upstream, { ...limits, onClose: close, onMessage: data => {
        const mapped = serverMessage(data);
        if (mapped !== undefined) incoming.send(mapped);
      } });
      if (stopped) { outgoing.close(); return; }
      if (upstream.readyState === 0) {
        connectTimer = setTimeout(close, connectTimeoutMs);
        upstream.addEventListener('open', opened, { once: true });
      }
    } catch { close(); }
  }
  incoming = socketChannel(downstream, { ...limits, onClose: close, onMessage: data => {
    if (!outgoing) { close(); return; }
    const mapped = clientMessage(data);
    if (mapped !== undefined) outgoing.send(mapped);
  } });
  if (stopped) incoming.close();
  else if (downstream.readyState === 1) connect();
  else downstream.addEventListener('open', connect, { once: true });
  return { close };
}

// Origin is CSRF protection, not user identity. The application authorizes users
// and ownership separately before upgrading a credential-bearing connection.
export function checkWebSocketRequest(request, siteOrigin) {
  let origin;
  try { origin = new URL(siteOrigin); } catch { return 503; }
  if (!['https:', 'http:'].includes(origin.protocol) || origin.origin !== siteOrigin) return 503;
  if (request.method !== 'GET') return 405;
  if (request.headers.get('origin') !== siteOrigin) return 403;
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return 426;
  return null;
}

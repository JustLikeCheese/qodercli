# Streaming chat through a Function

For Managed chat, use native upstream SSE for interactive text generation. For duplex voice/text, use [Forward Realtime](realtime.md). Keep JSON history reads for initial state and recovery; use polling only when the product requests it or streaming is unnecessary. Wrapping a periodic history query in an SSE response does not provide upstream text deltas.

For a complete local UI and Function-shaped route example, use [Runnable SSE chat](chat-example.md). It includes conversation switching, history reopening, stop and recovery through controlled local streams. Its live service adapter remains an explicit application dependency; the example does not supply durable coordination or turn fixtures into a QCA result.

## Transport and ownership

Authorize the application user and conversation before looking up the server-owned Cloud Session ID. Keep PAT authentication in the Function. With header-based visitor authentication, use fetch to consume the application SSE response; native EventSource cannot attach custom headers. Keep visitor tokens out of query strings. Cookie-based EventSource is an alternative when the application already has appropriate cookie authentication.

Use the [client asset](../assets/cloud-agents.mjs) and [SSE parser](../assets/sse.mjs) inside the Function:

```js
const upstream = await cloud.openStream(conversation.cloud_session_id, {
  lastEventId: conversation.last_event_id || undefined,
  signal: lifetime.signal,
});
try {
  for await (const frame of readSSE(upstream.body)) {
    const event = JSON.parse(frame.data);
    // Project selected text/status events; persist complete events idempotently.
    await consumeAuthorizedEvent(event);
  }
} finally {
  upstream.close();
}
```

`consumeAuthorizedEvent` and the conversation store are application adapters, not platform SDK APIs. Use a ReadableStream response with `Content-Type: text/event-stream`, `Cache-Control: no-store, no-transform`, and heartbeats. Cancellation, Function time budget and downstream backpressure must stop upstream reading. The client's 15-second header timeout is separate from the stream lifetime; select a lifetime below the deployed Function limit and reconnect when it expires. A local Node preview must forward response chunks as they arrive instead of awaiting `arrayBuffer()` or `text()` for the whole stream.

## Delta and history semantics

The client requests `event_deltas[]=agent.message`. Official frames are:

- `event_start`: `event.id` and `event.type` identify a new in-flight message.
- `event_delta`: `event_id` plus `delta: {type:'content_delta', index, content:{type:'text', text}}` appends text to the indexed block.
- Buffered `agent.message`: the complete canonical message, with the same event ID. Persist once and replace its temporary draft.
- Session status/error events: determine whether generation is running, retrying, interrupted or failed. Idle ends execution but does not prove a reply was produced; retain an exhausted generation error instead of replacing it with a success state. EOF alone is not completion. Propagate handler exceptions or emit a safe failure state; swallowing an exception and closing an HTTP 200 stream leaves clients waiting indefinitely.

Relay application-owned snapshot/draft/status envelopes. Exclude thinking, tools, account metadata and raw upstream error bodies unless the product explicitly implements their public authorization and presentation. Bound frame size, accumulated draft text, pending messages and connection duration. The parser handles split UTF-8, CR/LF boundaries, multiline data and comments. At EOF, a CR, LF or CRLF blank line completes the final event; frames without a terminating blank line are discarded. Adapt its size budget to the selected public projection.

Connect before sending the first prompt and wait for application readiness. Connect before history reconciliation to cover the history/live gap. Reconcile required history and advance only the last successfully persisted buffered event ID. On reconnect, resume with that ID via `Last-Event-ID`; replayed drafts replace prior text by event ID. Using an in-flight delta ID skips earlier deltas and can lose partial text after reconnect. Deduplicate buffered messages and guard cursor/state updates against older overlapping connections, using a transaction, lease or compare-and-set as appropriate for the store.

Retry read-side temporary failures with bounded backoff; stop automatic retry on authentication/authorization failure. Reconnection never repeats the prompt POST. Switching conversations, completion or client cancellation must prevent the old stream from updating the active conversation.

## Application stream consumption

For the browser's projected application stream, copy [conversation-stream.mjs](../assets/conversation-stream.mjs) and [sse.mjs](../assets/sse.mjs). Create one reader per mounted conversation view. Starting a read cancels the prior reader; late fetch responses and frames cannot update its replacement:

```js
import { createConversationStream } from './conversation-stream.mjs';

const stream = createConversationStream(frame => {
  const update = JSON.parse(frame.data);
  // Application adapter: validate the envelope and synchronously update this view.
  applyConversationUpdate(update);
  return ['completed', 'failed', 'interrupted'].includes(update.state);
});

async function connect(applicationConversationId) {
  try {
    await stream.read(signal => fetch(
      `/functions/v1/app/events?conversation=${encodeURIComponent(applicationConversationId)}`,
      { credentials: 'same-origin', signal },
    ));
  } catch {
    // Preserve input. Reconcile reads with bounded backoff; never resend the prompt.
    showPendingRecovery();
  }
}
// Call stream.cancel() immediately on conversation change or unmount, before loading history.
```

These routes and `applyConversationUpdate`/`showPendingRecovery` are application adapters, not SDK methods. Keep the frame callback synchronous; guard separate asynchronous history reads by the current conversation/version before committing their results. The helper owns only browser reader lifetime, not authorization, persisted history or send idempotency. A failed terminal state remains failed; a resolved reader is not proof of a successful reply. The underlying `consumeSSE` rejects invalid responses and EOF without a terminal state. Use it directly for a single reader with an existing lifetime controller.

For history-based recovery or polling, retain the accepted Event ID for the current send, use the documented Events cursor and traverse `has_more`/`next_page` within a bounded budget. Resolve `sess_` IDs from the server binding and validate `evt_` cursors separately. An older reply or idle event does not complete the current send; text matching does not establish dispatch identity. An incomplete scan remains pending.

## Transport tests

Follow the [validation scope](../../sites-building/SKILL.md#validation-scope). For an SSE main flow, observe incremental output and one final reply in the same AI request. Use the real Function response or a controlled upstream when cloud execution is unavailable.

When changing transport or fixing a streaming bug, select the affected check: byte-split framing, cancellation, reconnect without a second prompt, duplicate replay, early EOF or proxy buffering. Add cross-user rejection when stream authorization changes. Existing transport helpers do not need a new full test suite for each site; quota and write-recovery checks apply only when those paths change.

Contract sources, checked 2026-09-10: [Stream Events](https://docs.qoder.com/zh/cloud-agents/api/sessions/stream-events), [Event stream](https://docs.qoder.com/zh/cloud-agents/events-stream), [Initial connection behavior](https://docs.qoder.com/zh/cloud-agents/sse-initial-connection-behavior-change). Recheck when changing the protocol.

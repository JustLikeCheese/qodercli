import { createChatHandler } from './sse-chat/handler.mjs';

// Deliberately returns chat_not_configured (503). Supply an application service
// implementing the documented authorization, durable conversation and dispatch
// contracts before enabling live chat. Never import the dev memory service here.
Deno.serve(createChatHandler());

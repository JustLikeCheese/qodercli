---
name: sdk
description: >-
  Guide users building apps, scripts, CI pipelines, or automations on top of
  this CLI's companion TypeScript agent SDK. Use when the user mentions the
  companion SDK; asks to integrate, install, or write code against the SDK;
  says `query()`, `createSdkMcpServer`, `tool()`, `accessTokenFromEnv`, or
  `canUseTool`; asks to run agents programmatically from a script, CI/CD
  pipeline, backend service, or other code outside this CLI; wants to configure
  MCP servers for an SDK agent, handle streaming, permissions, hooks, session
  management, or sub-agents; or is wiring agents into an automation or bot. Use
  eagerly rather than answering from memory; the SDK surface evolves and this
  skill is the source of truth for the external package.
---

# Qoder Agent SDK

The Qoder TypeScript SDK (`@qoder-ai/qoder-agent-sdk`) runs Qoder AI agents programmatically. It spawns a `qodercli` subprocess and communicates over a bidirectional JSONL protocol. The single entry point is `query()`, which returns an `AsyncGenerator<SDKMessage, void>` — iterate it to receive assistant messages, tool calls, and the final result.

Use this skill to help someone **bootstrap a working integration quickly** and **avoid the traps that bite new users**.

## Installation

```bash
npm install @qoder-ai/qoder-agent-sdk zod
```

**Requirements:**
- Node.js 18+
- A working `qodercli` executable (in PATH or via `options.pathToQoderCLIExecutable`)
- `QODER_PERSONAL_ACCESS_TOKEN` environment variable set

## Voice and Posture

- **When the user names the SDK explicitly** (`query()`, `@qoder-ai/qoder-agent-sdk`, `createSdkMcpServer`, etc.): assume they know what it is. Skip framing, go straight to producing the integration.
- **When the user describes a problem the SDK fits but doesn't name it**: surface it as a question briefly, then wait: *"The Qoder SDK is what I'd reach for here — want me to design it that way?"*
- Don't restate the user's intent. Open with the design decision or first actionable thing.

## The Two Invocation Patterns

### 1. Single-turn — `query({ prompt: "string" })`

```typescript
import { query, accessTokenFromEnv } from '@qoder-ai/qoder-agent-sdk';

for await (const msg of query({
  prompt: 'Refactor src/utils.ts for readability',
  options: {
    auth: accessTokenFromEnv(),
    permissionMode: 'acceptEdits',
    allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
  },
})) {
  if (msg.type === 'assistant') {
    for (const block of msg.message.content) {
      if (block.type === 'text') process.stdout.write(block.text);
    }
  } else if (msg.type === 'result') {
    console.log(`Done: ${msg.subtype}, cost: $${msg.total_cost_usd}`);
  }
}
```

Use for fire-and-forget scripts, CI steps, GitHub Actions — "send prompt, get result, exit." No follow-ups, no streaming input. If you need multi-turn or `interrupt()`, use pattern 2.

### 2. Multi-turn — `query({ prompt: asyncIterable })`

```typescript
import { query, accessTokenFromEnv } from '@qoder-ai/qoder-agent-sdk';

function createChannel() {
  const queue = [];
  let resolve = null;
  let done = false;
  return {
    push(msg) { resolve ? resolve({ value: msg, done: false }) : queue.push(msg); resolve = null; },
    end() { done = true; if (resolve) resolve({ value: undefined, done: true }); },
    [Symbol.asyncIterator]() {
      return { next() {
        if (queue.length) return Promise.resolve({ value: queue.shift(), done: false });
        if (done) return Promise.resolve({ value: undefined, done: true });
        return new Promise(r => { resolve = r; });
      }};
    },
  };
}

const channel = createChannel();
const q = query({ prompt: channel, options: { auth: accessTokenFromEnv() } });

// Send first message
channel.push({
  type: 'user',
  message: { role: 'user', content: 'Find the bug in src/auth.ts' },
  parent_tool_use_id: null,
});

for await (const msg of q) {
  if (msg.type === 'assistant') { /* render */ }
  if (msg.type === 'result' && msg.subtype === 'success') {
    // Follow-up keeps conversation context
    channel.push({
      type: 'user',
      message: { role: 'user', content: 'Now write a regression test' },
      parent_tool_use_id: null,
    });
  }
}
channel.end();
```

Use when you need streaming input, multi-turn conversation, `q.interrupt()`, `q.setModel()`, or `q.setPermissionMode()`. This is the shape of most non-trivial integrations (chat UIs, bots, interactive CLIs).

## Top Five Traps

### 1. Missing `auth` throws synchronously

`query()` throws `AuthNotConfiguredError` before any messages flow if `options.auth` is not set. Always pass it explicitly:

```typescript
options: { auth: accessTokenFromEnv() }
```

### 2. Not consuming the generator leaks the subprocess

Constructing `query()` spawns `qodercli` immediately. If you don't iterate `for await` or call `q.close()`, the child process stays alive. Always consume in a try/finally:

```typescript
const q = query({ prompt, options });
try {
  for await (const msg of q) { /* ... */ }
} finally {
  q.close();
}
```

### 3. `result.subtype` distinguishes success from failure

```typescript
if (msg.type === 'result') {
  if (msg.subtype === 'success') {
    // Agent completed. Inspect msg.result for final text.
  } else {
    // msg.subtype is 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd'
    // msg.errors contains error descriptions.
    console.error('Agent failed:', msg.subtype, msg.errors);
  }
}
```

Don't catch exceptions for run failures — they come as `result` messages, not thrown errors. Thrown errors mean the process failed to start (auth, binary not found, protocol mismatch).

### 4. `canUseTool` must echo `toolUseID`

When implementing the permission callback, always include the `toolUseID` from options in your response:

```typescript
canUseTool: async (toolName, input, options) => {
  return { behavior: 'allow', toolUseID: options.toolUseID };
  // or: { behavior: 'deny', message: 'Not allowed', toolUseID: options.toolUseID }
}
```

Omitting `toolUseID` breaks permission correlation and the tool call hangs.

### 5. Control methods require multi-turn mode

`q.interrupt()`, `q.setModel()`, `q.setPermissionMode()` throw if `prompt` was a plain string. If you need control but don't need multi-turn, pass `canUseTool` — it auto-converts to streaming mode internally.

## Auth

```bash
export QODER_PERSONAL_ACCESS_TOKEN="qoder_..."
```

| Helper | Use case |
|--------|----------|
| `accessTokenFromEnv()` | CI, scripts — reads `QODER_PERSONAL_ACCESS_TOKEN` |
| `accessTokenFromEnv('MY_VAR')` | Custom env var name |
| `accessToken(token)` | Token from secret manager / vault |
| `qodercliAuth()` | Reuse local `qodercli login` state (interactive only) |

If you're seeing auth failures: check env var is set without surrounding whitespace, and that the token belongs to the correct environment.

## MCP Servers (In-Process Tools)

```typescript
import { query, createSdkMcpServer, tool, accessTokenFromEnv } from '@qoder-ai/qoder-agent-sdk';
import { z } from 'zod';

const server = createSdkMcpServer({
  name: 'my-tools',
  tools: [
    tool('lookup_user', 'Look up a user by email.', {
      email: z.string().describe('User email address'),
    }, async ({ email }) => ({
      content: [{ type: 'text', text: JSON.stringify(await db.findUser(email)) }],
    })),
  ],
});

for await (const msg of query({
  prompt: 'Find the user alice@example.com',
  options: {
    auth: accessTokenFromEnv(),
    mcpServers: { 'my-tools': server },
    allowedTools: ['mcp__my-tools__lookup_user'],
  },
})) { /* ... */ }
```

Key points:
- Tool name in `allowedTools` follows the pattern `mcp__<server-name>__<tool-name>`
- Use `.describe()` on Zod fields — the model reads those descriptions
- Return business errors via `isError: true` in `CallToolResult`, don't throw
- Set `annotations: { readOnlyHint: true }` on read-only tools for auto-approval hints

## Permissions

| Mode | Behavior |
|------|----------|
| `'default'` | Prompt for every tool (requires `canUseTool`) |
| `'acceptEdits'` | Auto-approve file reads/writes, prompt for others |
| `'plan'` | Model plans but doesn't execute until approved |
| `'bypassPermissions'` | Skip all prompts (requires `allowDangerouslySkipPermissions: true`) |

For programmatic approval without UI:

```typescript
options: {
  canUseTool: async (toolName, input, opts) => {
    if (['Read', 'Glob', 'Grep'].includes(toolName)) {
      return { behavior: 'allow', toolUseID: opts.toolUseID };
    }
    return { behavior: 'deny', message: 'Not allowed', toolUseID: opts.toolUseID };
  },
}
```

## Session Management

```typescript
import { listSessions, getSessionMessages, query } from '@qoder-ai/qoder-agent-sdk';

// Continue most recent session
const q = query({ prompt: 'Continue where we left off', options: { continue: true } });

// Resume specific session
const q2 = query({ prompt: 'Fix the remaining test', options: { resume: 'session-id' } });

// Fork a session (branch from existing state)
const q3 = query({ prompt: 'Try a different approach', options: { resume: 'session-id', forkSession: true } });

// Inspect sessions offline
const sessions = await listSessions({ dir: process.cwd() });
const messages = await getSessionMessages({ sessionId: sessions[0].id, dir: process.cwd() });
```

## Production Best Practices

1. **Always consume or close the query** — `for await` in a try/finally with `q.close()`. Non-negotiable.
2. **Distinguish result subtypes for exit codes** — exit 0 for `success`, exit 2 for `error_*` subtypes.
3. **Log `session_id` from the init message immediately** — it's the key for debugging.
4. **Pass `auth` explicitly** — don't rely on ambient env vars in shared infrastructure.
5. **Use `settingSources: []`** to avoid loading ambient user/project config in services.
6. **Set `maxTurns` in CI** to prevent runaway agents (e.g., `maxTurns: 20`).
7. **For streaming UIs, enable `includePartialMessages: true`** — gives token-by-token output.
8. **Pass `pathToQoderCLIExecutable`** when the binary isn't in PATH (Docker, CI, etc.).

## What This Skill Doesn't Cover

- The `qodercli` CLI itself (TUI, interactive mode, built-in tools).
- Python SDK (`qoder-agent-sdk-python`) — different API surface.
- Direct Connect transport — advanced internal integration pattern.
- Plugin/extension authoring — separate docs.

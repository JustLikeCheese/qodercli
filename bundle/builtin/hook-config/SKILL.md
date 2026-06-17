---
name: hook-config
description:
  Guide for creating and configuring hooks. Use when users want to add
  automated behaviors triggered by tool execution, session lifecycle,
  or other events in the Qoder CLI hook system.
allowed-tools: Edit, Write
---

# Creating Hooks for Qoder CLI

This skill guides you through creating hooks — automated behaviors that
trigger on specific events like tool execution, session lifecycle, file
changes, and notifications. Hooks are configured in settings.json files.

## When to Use Hooks

Use hooks when you need:

- **Automated side effects** after tool execution (format, lint, test)
- **Guardrails** before tool execution (block protected files, detect secrets)
- **Notifications** when events occur (desktop alerts, webhooks)
- **Validation gates** that block or allow operations based on conditions
- **Session automation** at start, end, or compaction

**When NOT to use hooks:**

- One-off tasks (just do them directly)
- Complex multi-step workflows (use agents or skills instead)
- Anything that needs user interaction mid-execution

## Configuration Scopes

| Scope       | File                                 | Use Case                         |
| ----------- | ------------------------------------ | -------------------------------- |
| **Project** | `${QODER_CONFIG_DIR}/settings.json`         | Team-shared, version controlled  |
| **Local**   | `${QODER_CONFIG_DIR}/settings.local.json`   | Personal, not committed          |
| **User**    | `~/${QODER_USER_CONFIG_DIR}/settings.json`       | Global across all projects       |

**Choose project** for team guardrails and standards.
**Choose local** for personal preferences and notifications.
**Choose user** for global behaviors across all projects.

## Configuration Format

```jsonc
{
  "hooks": {
    "<EventName>": [
      {
        "matcher": "<regex>",
        "hooks": [
          {
            "type": "command",
            "command": "${QODER_CONFIG_DIR}/hooks/my-hook.sh",
            "name": "my-hook",
            "timeout": 60
          }
        ]
      }
    ]
  }
}
```

Each event maps to an array of **hook definitions**. Each definition has:

| Field        | Required | Description                                         |
| ------------ | -------- | --------------------------------------------------- |
| `matcher`    | No       | Regex filter (matches tool name for tool events)    |
| `hooks`      | Yes      | Array of hook handlers                              |
| `sequential` | No       | Run hooks in order instead of parallel              |
| `async`      | No       | Fire-and-forget, don't block the operation          |

### Hook Handler Fields

| Field           | Required     | Description                                           |
| --------------- | ------------ | ----------------------------------------------------- |
| `type`          | Yes          | `command`, `http`, `prompt`, or `agent`                |
| `command`       | command type | Shell command to execute                               |
| `url`           | http type    | Webhook URL to POST to                                 |
| `prompt`        | prompt/agent | LLM prompt text                                        |
| `if`            | No           | Per-hook condition: `"ToolName(glob)"` or `"ToolName"` |
| `name`          | No           | Display name                                           |
| `description`   | No           | Human-readable description                             |
| `timeout`       | No           | Seconds before timeout                                 |
| `statusMessage` | No           | Text shown in UI during execution                      |
| `async`         | No           | Run in background without blocking                     |
| `asyncRewake`   | No           | Background hook; exit code 2 wakes model               |
| `rewakeMessage` | No           | Override system-reminder prefix when asyncRewake hook blocks (exit 2). Only with `asyncRewake`. |
| `rewakeSummary` | No           | One-line summary (default `Stop hook feedback`) shown to user + model when asyncRewake hook blocks. Whitespace collapsed, capped at 300 chars. Only with `asyncRewake`. |

> **One-shot headless mode:** when no persistent consumer exists (e.g.
> `claude -p "fix bug"` with text output), `asyncRewake` hooks
> transparently degrade to **synchronous** execution. In this mode
> exit code 2 is treated as `decision: 'deny'` and `rewakeMessage` /
> `rewakeSummary` are ignored.
>
> SDK streaming (`--input-format stream-json`) and remote worker modes
> **do** support background asyncRewake — the persistent connection
> provides a consumer for rewake notifications.

Example asyncRewake hook with custom rewake text:

```json
{
  "PreToolUse": [
    {
      "matcher": "Bash",
      "hooks": [
        {
          "type": "command",
          "command": "bash /opt/security/scan.sh",
          "if": "Bash(git commit:*)",
          "asyncRewake": true,
          "rewakeMessage": "[security-scan] background review:",
          "rewakeSummary": "Commit security review found issues",
          "timeout": 300
        }
      ]
    }
  ]
}
```

The hook script must `exit 2` (and write its diagnostic to `stderr` /
`stdout`) to actually wake the model with the configured prefix + summary.

## Hook Events

### Tool Events (matcher = tool name regex)

| Event                | When                            |
| -------------------- | ------------------------------- |
| `PreToolUse`         | Before tool execution           |
| `PostToolUse`        | After successful tool execution |
| `PostToolUseFailure` | After tool execution fails      |
| `PermissionRequest`  | Tool requests user permission   |

### Session & Agent Lifecycle

| Event           | When                                 |
| --------------- | ------------------------------------ |
| `SessionStart`  | Session initializes                  |
| `SessionEnd`    | Session tears down                   |
| `SubagentStart` | Sub-agent session begins             |
| `SubagentStop`  | Sub-agent session ends               |
| `Stop`          | Agent decides to stop                |
| `StopFailure`   | Agent encounters fatal error and must stop (notification-only) |
| `PreCompact`    | Before context compaction            |
| `PostCompact`   | After context compaction             |

### User, Config & Notification Events

| Event                | When                            |
| -------------------- | ------------------------------- |
| `UserPromptSubmit`   | User submits a prompt           |
| `ConfigChange`       | Settings change at runtime      |
| `Notification`       | External notification arrives   |
| `InstructionsLoaded` | System instructions loaded      |

### File & Workspace Events

| Event            | When                       |
| ---------------- | -------------------------- |
| `CwdChanged`     | Working directory changes  |
| `FileChanged`    | Watched file changes       |
| `WorktreeCreate` | Git worktree created       |
| `WorktreeRemove` | Git worktree removed       |

### Task Events

| Event           | When                          |
| --------------- | ----------------------------- |
| `TaskCreated`   | Background task created       |
| `TaskCompleted` | Background task completes     |

## Handler Types

### Command (`type: "command"`)

Executes a shell command. Hook input arrives as JSON on **stdin**.
Output is parsed from **stdout** as JSON.

**Exit code semantics:**

| Exit Code | Meaning                          |
| --------- | -------------------------------- |
| 0         | Success — parse stdout as JSON   |
| 2         | Blocking deny — stderr is reason |
| Other     | Non-blocking error, execution continues |

**Stdin** receives the full hook input as JSON (fields vary by event):

```json
{
  "session_id": "abc-123",
  "cwd": "/path/to/project",
  "hook_event_name": "PreToolUse",
  "tool_name": "Edit",
  "tool_input": { "file_path": "src/app.ts", "old_string": "...", "new_string": "..." }
}
```

**Stdout** JSON output (all fields optional):

```json
{
  "decision": "allow",
  "reason": "Checks passed",
  "hookSpecificOutput": {
    "additionalContext": "Message injected into conversation"
  }
}
```

Best for: scripts, linters, formatters, external CLI tools.

### HTTP (`type: "http"`)

POSTs hook input as JSON to the URL. Response parsed as JSON hook
output. Headers support `${ENV_VAR}` interpolation.

```jsonc
{
  "type": "http",
  "url": "https://api.example.com/hooks",
  "headers": { "Authorization": "Bearer ${API_TOKEN}" }
}
```

Best for: webhooks, external integrations, CI/CD triggers.

### Prompt (`type: "prompt"`)

Single-turn LLM evaluation. The prompt plus hook input go to the model,
which returns a structured JSON decision.

```jsonc
{
  "type": "prompt",
  "prompt": "Review this edit for security issues. Return {\"decision\": \"allow\"} or {\"decision\": \"deny\", \"reason\": \"...\"}"
}
```

Best for: AI-powered review gates, semantic validation.

### Agent (`type: "agent"`)

Spawns a sub-agent with tool access.

```jsonc
{
  "type": "agent",
  "prompt": "Verify the edited file passes type checking. $ARGUMENTS",
  "tools": ["Bash", "Read"],
  "maxTurns": 10,
  "timeout": 120
}
```

Best for: complex verification needing tool use (run tests, read files,
check types).

## The `if` Condition

Narrow when a hook fires within a matched definition:

```jsonc
{ "if": "Edit(*.ts)" }       // Only Edit calls on .ts files
{ "if": "Write(src/**)" }    // Only Write calls under src/
{ "if": "Bash" }             // Any Bash call
{ "if": "Bash(git commit:*)" } // Only `git commit` (with or without args)
```

Format: `"ToolName(glob_pattern)"` or `"ToolName"`.
The glob matches the tool's primary argument (typically a file path).

A trailing `:*` is treated as a **prefix rule**: `"git commit:*"` matches the
exact command `git commit` and any command that starts with `git commit `
(prefix + space + anything). For Bash, compound commands (`VAR=1 git commit`,
`ls && git commit`) are split via tree-sitter and each sub-command is tested
against the rule.

## Hook Creation Workflow

### Step 1: Determine the Behavior

Understand what the user wants:

- What should happen automatically?
- When should it trigger? (before/after tool use, session event, etc.)
- Should it block operations or just observe?
- Who needs it? (team or personal)

**Avoid interrogation loops.** Propose a concrete hook config based on
initial understanding and ask the user to refine.

### Step 2: Choose Event, Matcher, and Handler

Map the behavior:

| Behavior               | Event         | Matcher        | Handler |
| ---------------------- | ------------- | -------------- | ------- |
| Auto-format after edits| `PostToolUse` | `Edit\|Write`  | command |
| Block protected files  | `PreToolUse`  | `Edit\|Write`  | command |
| Secret detection       | `PreToolUse`  | `Edit\|Write`  | command |
| Desktop notifications  | `Notification`| —              | command |
| Run tests after changes| `PostToolUse` | `Edit\|Write`  | command |
| AI code review gate    | `PreToolUse`  | `Edit`         | prompt  |
| Type-check verification| `PostToolUse` | `Edit\|Write`  | agent   |
| Webhook to CI/CD       | `PostToolUse` | `Edit\|Write`  | http    |
| Dependency guard       | `PreToolUse`  | `Edit`         | command |

### Step 3: Choose Scope

- **Project** (`${QODER_CONFIG_DIR}/settings.json`): Team standards, check in
- **Local** (`${QODER_CONFIG_DIR}/settings.local.json`): Personal, not committed
- **User** (`~/${QODER_USER_CONFIG_DIR}/settings.json`): Global, all projects

### Step 4: Create the Configuration

1. Read the target settings.json (if it exists)
2. Merge the new hook into the existing `hooks` object
3. Write back the file

If no hooks exist yet, create the full structure.

### Step 5: Create Script Files (command type)

For command hooks with non-trivial logic, create scripts in
`${QODER_CONFIG_DIR}/hooks/`:

```bash
mkdir -p ${QODER_CONFIG_DIR}/hooks
```

Script requirements:
- Read JSON from stdin
- Write JSON to stdout (or nothing for simple success)
- Exit 0 for success, 2 for blocking deny, other for warning
- Use stderr for error messages and debug output
- Make executable: `chmod +x ${QODER_CONFIG_DIR}/hooks/my-hook.sh`

Test independently:

```bash
echo '{"tool_name":"Edit","tool_input":{"file_path":"test.ts"}}' | \
  ${QODER_CONFIG_DIR}/hooks/my-hook.sh
```

### Step 6: Verify

Tell the user to verify:

1. Restart the session or trigger the relevant event
2. Check the hook fires and produces expected output
3. Test the blocking path (for PreToolUse guards)
4. Confirm `async` hooks don't block the session

## Best Practices

1. **Keep hooks fast** — Target <5s for synchronous hooks
2. **Test scripts independently** — Pipe sample JSON stdin, verify output
3. **Use `async: true`** for non-blocking side effects (notifications, logging)
4. **Scope matchers narrowly** — Don't fire on every tool invocation
5. **Prefer `if` conditions** for file-type filtering
6. **Log to stderr** — stdout is parsed as JSON; debug output goes to stderr
7. **Handle edge cases** — Exit 0 if the condition doesn't apply
8. **Use `statusMessage`** for meaningful UI feedback during execution

## Anti-Patterns to Avoid

- **Overly broad matchers** — `".*"` on PreToolUse fires on every single tool call
- **Long synchronous hooks** — Block the entire interactive session
- **Stdout pollution** — Non-JSON stdout causes parse errors
- **Missing shebang** — Scripts without `#!/bin/bash` may fail silently

## Examples

### Auto-Format TypeScript

Runs Prettier on TypeScript files after every Edit or Write.

**`${QODER_CONFIG_DIR}/settings.json`:**

```jsonc
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Edit|Write",
      "hooks": [{
        "type": "command",
        "command": "${QODER_CONFIG_DIR}/hooks/auto-format.sh",
        "if": "Edit(*.{ts,tsx,js,jsx})",
        "name": "auto-format",
        "statusMessage": "Formatting..."
      }]
    }]
  }
}
```

**`${QODER_CONFIG_DIR}/hooks/auto-format.sh`:**

```bash
#!/bin/bash
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
[ -z "$FILE" ] && exit 0
[ -f "$FILE" ] || exit 0
npx prettier --write "$FILE" >/dev/null 2>&1
exit 0
```

### Protected File Guard

Blocks edits to lock files and CI configuration.

**`${QODER_CONFIG_DIR}/settings.json`:**

```jsonc
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Edit|Write",
      "hooks": [{
        "type": "command",
        "command": "${QODER_CONFIG_DIR}/hooks/protected-files.sh",
        "name": "protected-file-guard",
        "statusMessage": "Checking file permissions..."
      }]
    }]
  }
}
```

**`${QODER_CONFIG_DIR}/hooks/protected-files.sh`:**

```bash
#!/bin/bash
INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
[ -z "$FILE" ] && exit 0

PROTECTED_PATTERNS=(
  "package-lock.json"
  "yarn.lock"
  "pnpm-lock.yaml"
  ".github/workflows/*"
  ".gitlab-ci.yml"
)

for PATTERN in "${PROTECTED_PATTERNS[@]}"; do
  if [[ "$FILE" == $PATTERN ]]; then
    echo "Blocked: $FILE is a protected file" >&2
    exit 2
  fi
done

exit 0
```

### Desktop Notification

Sends a macOS notification when Qoder CLI needs attention.

**`${QODER_CONFIG_DIR}/settings.local.json`:**

```jsonc
{
  "hooks": {
    "Notification": [{
      "hooks": [{
        "type": "command",
        "command": "${QODER_CONFIG_DIR}/hooks/notify.sh",
        "name": "desktop-notify",
        "async": true
      }]
    }]
  }
}
```

**`${QODER_CONFIG_DIR}/hooks/notify.sh`:**

```bash
#!/bin/bash
INPUT=$(cat)
TITLE=$(echo "$INPUT" | jq -r '.title // "Qoder CLI"')
MSG=$(echo "$INPUT" | jq -r '.message // "Notification"')

if command -v osascript &>/dev/null; then
  osascript -e "display notification \"$MSG\" with title \"$TITLE\""
elif command -v notify-send &>/dev/null; then
  notify-send "$TITLE" "$MSG"
fi
exit 0
```

### Type-Check Gate

Uses an agent to verify TypeScript compiles after edits.

**`${QODER_CONFIG_DIR}/settings.json`:**

```jsonc
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Edit|Write",
      "hooks": [{
        "type": "agent",
        "prompt": "Run `npx tsc --noEmit` and check for type errors in the edited file. If there are errors, report them. $ARGUMENTS",
        "tools": ["Bash", "Read"],
        "if": "Edit(*.{ts,tsx})",
        "name": "type-check",
        "statusMessage": "Type checking...",
        "maxTurns": 5,
        "timeout": 60
      }]
    }]
  }
}
```

---
description: "Qoder security scanning. Use when the user invokes /security-scan, explicitly requests a full repository or named-path cloud scan, asks for an L2 lightweight or L3 deep security review, or asks to push, git push, push it, publish commits, open a PR/MR, merge, release, deploy, configure a remote for push, or otherwise hand off committed code where an enabled L3 deep review must be offered first. Respect the Qoder L2 lightweight/L3 deep product switches. Never infer remediation approval from an earlier scan or handoff request."
name: security-scan
---

Route security intent to exactly one of three isolated workflows: project/file cloud scan, L2 lightweight review, or L3 deep review. Keep all qodersec execution private and preserve the decision boundaries below.

## Route explicit intent first

Use the first matching route. Do not show the fixed mode picker when the user has already supplied a mode or scope.

0. If the request combines an explicit L2 lightweight/L3 deep mode with one or more explicit file or directory targets, the intent is ambiguous because manual L2 lightweight/L3 deep reviews ignore path arguments while project/file cloud scans use them as scope. Do not choose a workflow or run any command. Immediately use an `AskUserQuestion` tool call whose first question object includes a non-empty `question` field asking which scan to run. Offer exactly these choices:
   - **Run L2 lightweight/L3 deep review** — ignore the named paths and review the layer's normal change set.
   - **Scan the specified paths** — run the project/file cloud scan for exactly the named paths.

1. An explicit full, all-project, whole-repository, or broad scan uses the project/file cloud scan with `--all`.
2. One or more explicit file or directory targets use the project/file cloud scan for exactly those targets.
3. An explicit lightweight or L2 lightweight request uses the explicit L2 lightweight gate.
4. An explicit deep, commit-range, committed-change, release security check, or L3 deep request uses the explicit L3 deep gate.
5. A bare `/security-scan`, or a security-scan request with no mode or scope, uses the fixed mode picker.
6. A direct request such as `push`, `git push`, `push it`, `publish`, `open a PR/MR`, `merge`, `release`, `deploy`, remote-for-push setup, or another committed-code handoff that is not itself an explicit security request uses the implicit L3 deep handoff gate.

Full-repository and named-path cloud scans are independent of the L2 lightweight/L3 deep switches. Never resolve L2 lightweight/L3 deep settings for an explicit cloud scope scan.

## Fixed picker for bare /security-scan

A bare invocation is explicit security interaction. The next action must be an `AskUserQuestion` tool call. Its first question object must include a non-empty `question` field and exactly three choices in this fixed order:

1. **L3 deep scan**
2. **L2 lightweight scan**
3. **Project/file scan**

Do not call Bash or run any command before showing this picker. Do not resolve L2 lightweight/L3 deep settings before showing the picker and do not inspect Git or review state to reorder choices. Selecting L2 lightweight or L3 deep follows that layer's explicit gate, including its settings check. Selecting project/file scan enters the cloud scan workflow without resolving L2 lightweight/L3 deep settings.

If project/file scan is selected without a scope, immediately ask a second `AskUserQuestion` tool call. Its first question object must include a non-empty `question` field and exactly these choices:

- **Whole repository**
- **Specific files or directories**

Use `--all` only for **Whole repository**. For **Specific files or directories**, obtain the target paths before scanning and never guess or broaden them.

## Resolve L2 lightweight/L3 deep availability

Whenever an L2 lightweight or L3 deep gate needs availability, use the absolute plugin root injected by the runner or launcher through `QODER_PLUGIN_ROOT`:

- Windows: `${QODER_PLUGIN_ROOT}/bin/security-scan-settings.cmd`
- macOS or Linux: `${QODER_PLUGIN_ROOT}/bin/security-scan-settings.sh`

The runner or launcher must inject `QODER_PLUGIN_ROOT` as an absolute path to the plugin root. The skill does not derive it from `SKILL.md` and never looks for `skills/security-scan/bin/security-scan-settings.*`.

Invoke the selected entry point silently and consume only its normalized JSON fields: `status`, `host`, `l2_enabled`, and `l3_enabled`. Only a literal normalized `true` enables a layer. If execution fails, output is invalid, or a field is absent, treat both layers as disabled.

A `status` of `initializing`, or no output at all, means Qoder Security is still downloading its components — not that a layer is switched off. In that state never run a review and never point the user at the settings page. For an explicit request or picker selection, tell the user that Qoder Security is still initializing and ask them to try again in about a minute. For an implicit handoff, stay silent about security and continue the handoff.

The settings entry points are the only exception to the direct-binary rule because they own launcher/bootstrap. Never independently inspect `QODER_CLI`, `QODERCN_CLI`, `QODER_IDE`, `QODER_CN_IDE`, `QODER_AGENT_SDK_ENTRYPOINT`, or `QODER_SECURITY_SCAN_SETTINGS_JSON`; never construct or probe a Qoder settings path; never read or decode `settings.json` or `app-config.json`; and never use `jq`, Python, Node.js, regular expressions, or another fallback parser.

For an explicit request or picker selection whose layer is disabled:

- Do not run L2 lightweight or L3 deep.
- Tell the user that the requested mode is not enabled and point them to the host-specific Qoder Security settings:
  - If `host` is `qoder_ide` or `qoder_cn_ide`, use the IDE guidance:
    - English: "Go to Qoder Settings > Security to configure"
    - Chinese: "请前往 Qoder 设置  > 安全 页开启配置"
  - If `host` is `qoder_cli` or `qodercn_cli`, use the CLI guidance:
    - English: "Run `/security-settings` to configure"
    - Chinese: "请执行 `/security-settings` 开启配置"
  - If `host` is `qoder_sdk`, use the SDK guidance:
    - English: "Enable the requested mode in the Qoder Agent SDK's `securityScan` (TypeScript) or `security_scan` (Python) options"
    - Chinese: "请在 Qoder Agent SDK 的 `securityScan`（TypeScript）或 `security_scan`（Python）选项中开启所请求的模式"
  - If `host` is absent or unrecognized, use the CLI guidance.

For an implicit handoff with L3 deep disabled, do nothing security-related: do not prompt or remind the user, and do not mention the disabled setting. Continue the original handoff.

## Shared execution and result invariants

Choose the binary from main-host OS information. Do not probe files or read manifests to decide the binary name:

- Windows uses `~/.qodersec/bin/qodersec.exe`.
- macOS or Linux uses `~/.qodersec/bin/qodersec`.

Invoke scan and review commands directly. Do not invoke `qodersec-launch.cmd`, `qodersec-launch.sh`, or another launcher for scan or review. The settings resolver scripts above are the sole launcher-backed interface.

Keep all execution quiet. Do not expose qodersec commands, launcher commands, stdout/stderr, JSON, identifiers, statistics, skipped-file metadata, logs, environment details, or internal mechanics. Do not narrate internal routing or planning. Use tool output only to present actual issues/findings or make the specified routing decision. Never interpret, add to, or fabricate a finding.

The single exception to the identifier rule is the asynchronous cloud scan handoff: `report_url`, `project_id`, `scan_id`, and `task_name` from the scan command's JSON output may be shown to the user exactly as described in the project/file cloud scan workflow. Everything else in that output, and all other stdout/stderr, logs, and internal mechanics, stays hidden.

For a missing or non-executable direct qodersec binary, or when a review command fails because Qoder Security is still installing its dependencies, tell the user that Qoder Security is still initializing and ask them to try again in about a minute. Do not present it as a disabled setting, do not claim that no security issues were found, and do not ask them to restart Qoder/qodercli or run `/clear`. Invalid user arguments may still be reported as invocation errors.

The only user-actionable internal notice that may be surfaced is a structured qodersec JSON `notice` with `code` equal to `qoder_credits_exhausted`. If this notice appears, do not say that no security issues were found. Tell the user exactly: "You've run out of Credits, so code security scanning is unavailable. Upgrade your plan or buy an add-on pack to continue." If `notice.pricing_url` is present, include that billing link. Do not expose any other qodersec stdout/stderr, logs, raw SDK errors, identifiers, or scan statistics.

## Project/file cloud scan workflow

Use current Qoder login authentication; no AK/SK is needed.

Project/file cloud scans are asynchronous: the command uploads the code, creates the scan task, prints its JSON handoff, and exits immediately. Do not wait for results, do not poll, do not run the scan again for the same scope, and do not automatically retry a failed scan.

For a full scan:

Windows:
```
~/.qodersec/bin/qodersec.exe scan
```

macOS or Linux:
```
~/.qodersec/bin/qodersec scan
```

For explicit targets, replace `$ARGUMENTS` with exactly the user-provided paths:

Windows:
```
~/.qodersec/bin/qodersec.exe scan $ARGUMENTS
```

macOS or Linux:
```
~/.qodersec/bin/qodersec scan $ARGUMENTS
```

Do not add `--diff`, `--all`, inferred files, or neighboring paths to a targeted scan. If scope is still ambiguous, ask instead of guessing.

### Asynchronous result handoff

On success the command prints a JSON object on stdout. Read `report_url`, `project_id`, `scan_id`, and `task_name` from it and present them to the user in plain product language:

- The report link (`report_url`), so the user can open the result later.
- The project ID (`project_id`) and the scan task ID (`scan_id`), plus the task name (`task_name`) when it helps identify the run.
- A clear statement that the scan keeps running in the cloud and that the user should check the result later through that link.

If `report_url` is absent or empty, present only the project ID and the scan task ID and tell the user to look the result up later in the Qoder Security console.

Cloud scans never return issues inline, so this workflow has no no-issues statement, no issue list, and no remediation gate. Do not claim that the code is clean or that no security issues were found.

## Explicit L2 lightweight review workflow

Resolve settings first. If `l2_enabled=false`, use the explicit disabled behavior and stop. If enabled, the request is approval to run a single-pass review of current working-tree changes.

Windows:
```
~/.qodersec/bin/qodersec.exe review --layer=l2
```

macOS or Linux:
```
~/.qodersec/bin/qodersec review --layer=l2
```

Manual mode and Qoder routing come from qodersec config defaults. Backend routing comes from the host-provided Qoder/QoderCN business environment, never from a `--model` argument.

On success with no findings, simply state that no security issues were found. On findings, follow the shared result handling requirements below.

## Explicit L3 deep review workflow

Resolve settings first. If `l3_enabled=false`, use the explicit disabled behavior and stop. If enabled, an explicit L3 deep request or picker selection is already scan approval: run manual L3 deep directly.

Windows:
```
~/.qodersec/bin/qodersec.exe review --layer=l3
```

macOS or Linux:
```
~/.qodersec/bin/qodersec review --layer=l3
```

L3 deep reviews unreviewed commits since the manual review baseline and may fall back to L2 lightweight when only working-tree changes exist. Manual mode comes from qodersec config defaults; never use a `--model` argument.

On success with no findings, simply state that no security issues were found. On findings, follow the shared result handling requirements below.

## Implicit L3 deep handoff workflow

This workflow has two separate user decisions: a pre-scan **scan gate** and, only if findings are returned, a post-findings **remediation gate**. Never merge them.

1. Resolve settings first. If `l3_enabled=false` or settings resolution fails, remain completely silent about security and continue the handoff.
2. Make sure all changes intended for the handoff are committed before asking. If this flow creates a commit, ask after that commit and before checking remotes, adding a remote, running `git remote`, pushing, opening a PR/MR, merging, releasing, or deploying.
3. Do not combine commit and handoff in one Bash command. A command such as `git add ... && git commit ... && git push` is forbidden for this workflow because it skips the scan gate. Commit first, then stop at the scan gate before any push/PR/MR/merge/release/deploy command.
4. Immediately use `AskUserQuestion`. Its first question object must include a non-empty `question` field that asks whether to run an L3 deep security scan before continuing the handoff. Offer exactly:
   - **Run L3 deep security review** — run the L3 deep committed-change review before handoff.
   - **Skip scan and continue** — skip it and resume the original handoff.
5. If the user skips, do not run L3 deep and do not write persistent skip state. Enter `SCAN_SKIPPED_FOR_CURRENT_HANDOFF` and continue. Do not ask again for the same commit set in that handoff. A newly created commit clears this in-memory state.
6. If the user approves, silently run the explicit L3 deep command. The next user-facing content is either the no-findings statement or all findings followed by the remediation gate.

If a handoff progress update is necessary before the commit, use plain product language such as: "I'll commit the changes, then ask whether to run an L3 deep security scan before pushing to the remote."

## Mandatory issues/findings-first remediation gate

This gate applies to the manual L2 lightweight and L3 deep review modes only; asynchronous cloud scans return no inline findings and never enter it.

For both review modes, findings must be visible before the fix decision. The remediation question is not a substitute for the findings summary.

Before the remediation question, present every reported finding. Manual L2 lightweight/L3 deep findings must include severity, category and CWE (when available), file and line, description, vulnerable code snippet, remediation suggestion, and data flow summary (when available).

After presenting all required details, enter `AWAITING_REMEDIATION_DECISION`. The next model action must be an `AskUserQuestion` tool call whose first question object includes a `question` field with this exact value:

"Security issues were found. Do you want me to fix them before I continue?"

Offer exactly two choices:

- **Fix now**
- **Continue without fixing**

The remediation gate must be a valid tool call, not a partial parameter object. In particular, do not omit the required `question` property under `questions[0]`.

Do not render the choices as plain text in place of the tool call. Do not call Bash, run any git command, resume a push/PR/release/deploy, continue another previous task, or send a completion message until `AskUserQuestion` returns. Only a choice made after the findings were shown satisfies this gate; the original handoff request, picker selection, scan approval, or a prior `continue` never does. If `AskUserQuestion` is unavailable, stop after the findings without inventing a text fallback.

If the user chooses **Continue without fixing**, do not modify the findings and resume the previous task. If the user chooses **Fix now**, make only the approved fixes and run relevant verification.

## Mandatory post-fix reporting and halt

Fixing code is not permission for any follow-up handoff action. After fixes:

1. Report the changed files, which issues/findings were addressed, and verification results.
2. Enter `POST_FIX_HALT` and stop for a new user message.
3. Do not run `git add`, `git commit`, `git push`, `git remote`, PR/MR, merge, release, or deploy commands. Do not stage unrelated files or resume any previous task.
4. Do not treat the earlier handoff request, scan approval, or **Fix now** choice as authorization. Only a new message sent after the fix summary may authorize commit, push, PR/MR, release, deploy, or other continuation.

Never run `git push` after **Fix now** unless the user sends a new push or continue instruction after the fix summary.

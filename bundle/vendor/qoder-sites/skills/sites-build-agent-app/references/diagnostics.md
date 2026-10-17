# Runtime failures

Before classifying QCA errors, [verify the target version](../../sites-hosting/SKILL.md#verify-the-target-version). A gateway rejection before the handler runs is not a QCA authentication result; a missing deployment is not a reason to replace PATs.

Use application responses, safe diagnostics and public API contracts to isolate the failing boundary. Keep initialization, message acceptance, generation, persistence and quota checks distinguishable. A generic 503 or `quota_unavailable` is not evidence that the owner's credits are exhausted.

## Safe diagnostic contract

The JSON client asset emits `sites_cloud_request_failed` with a random `diagnosticId`, resource kind, method, phase, category, duration, safe HTTP status, optional UUID request ID, public error code and write outcome. The handler can return that diagnostic ID with its public error. Diagnostics must remain best effort and must not change the request result or repeat a POST.

Keep diagnostics free of tokens, authorization/cookie headers, query strings, prompts, response bodies, arbitrary exception text, resource/user IDs and signed URLs. Classify transport errors locally. A custom diagnostic callback must preserve these boundaries. When adding streaming diagnostics, use the same safe field allowlist for header failure, read failure, cancellation and lifetime expiry; never serialize raw SSE frames to diagnose transport problems.

| Evidence | Interpretation and next implementation check |
| --- | --- |
| Missing runtime Secret | Configuration was unavailable before HTTP; preserve the existing platform-managed Secret workflow. |
| `ai_configuration_invalid` with `reason: reserved_metadata_prefix` and `resource: agent` or `environment` | The helper rejected reserved `qsites_*` business metadata before any resource lookup or creation (`not_sent`). Pass scope through `applicationScope` and correct business keys to non-reserved names. Keep `reason` and `resource` as server-side diagnostic labels; omit metadata keys/values. Show “AI 服务配置有误，暂时无法使用。” / “The AI service configuration is invalid and is temporarily unavailable.” to application users. Other configuration errors require checking their actual validation branch. |
| Deadline before response headers | No HTTP status was received. This alone does not distinguish DNS, TCP, TLS or a slow upstream. Verify the trusted origin and report the exact failing boundary; extending the timeout does not establish a fix. |
| HTTP 401/403 | An access failure was received; stop automatic authentication retries. |
| HTTP 404 | Identify the exact operation and method before treating the resource as absent or creating a replacement. |
| Body/JSON parse failure | Headers arrived; investigate the expected response contract and body bounds. |
| Accepted message followed by `session.error` | The request succeeded but generation failed. Read the safe error code and retry status; show provider retrying versus exhausted. Preserve the accepted message and history. An eventual idle state without a completed reply is not success. Do not resend automatically or replace PATs based on a generation error. |
| Ambiguous POST result | Preserve durable intent and reconcile; never blindly resend. |

After a reported configuration or whitelist change, repeat one authorized application action and evaluate its new result. Initialization may now succeed while a later database or generation step still fails. Do not carry the old diagnosis forward or claim the entire flow is fixed from one successful step.

## Bounded database quota query

Use the count operation supported by the site's selected database adapter. New persistent applications use [Function backend](../../sites-building/references/function-backend.md); [Exact counts](../../sites-building/references/database.md#exact-counts) documents the GET pattern for existing legacy allocations. Verify the selected adapter's actual query/response contract. For message quotas, keep authorized visitor, role and time-window filters. An unavailable count must block dispatch rather than imply unused quota. A read-then-send check alone is not an atomic cross-conversation limit; strict concurrent enforcement needs a verified transaction or reservation mechanism. Preserve one-message idempotency.

## Tests and publication evidence

Follow the [validation scope](../../sites-building/SKILL.md#validation-scope). When changing quota enforcement, check the affected scope filters and that a failed count blocks sending. Reuse the shared database checks; ordinary AI integration does not require a second quota fixture suite.

Changed Function or static content requires a new draft/action ID; an existing ready draft contains frozen bytes. Preserve the existing project, database declarations, capabilities and schema unless the change requires otherwise. Follow sites-hosting for publication and confirmation behavior. Distinguish prepared, published and real AI execution; publication readiness is not a successful reply. Keep test credentials and deployment-specific identifiers out of reusable skill assets.

# First-use initialization

The resource workflow below is for Managed Agent/Environment/Session. Realtime shares the Sites backend preparation step, then uses [Identity/Template/Conversation initialization](realtime.md#conversation-creation-and-ownership).

There are two independent resource layers: Sites backend setup prepares `QODER_PAT`; Cloud Agents resources define and execute the website's AI workflows. Backend setup happens through owner tools. Cloud resource initialization happens inside the deployed Function on first authorized use.

## Prepare the site

For an existing Site, reuse its IDs. For a new site, first build and review the static frontend, then call `prepare_site` with a new action ID and no Function/Secret/database inputs. Preserve the resulting Project/Site IDs and leave this initialization draft unpublished.

Read `get_site(include: ["backend"])` and reuse an already-ready `qoder` capability. If enablement is needed, complete the [Qoder PAT disclosure and explicit confirmation](../SKILL.md#3-prepare-the-sites-ai-capability) before any `qoder` enablement/PAT-creation call. Then call `ensure_backend` with the actual `siteId`, `capabilities: ['qoder']`, and a stable UUID `requestId`. It includes Functions; add database/storage only if the application's data workflow requires them. Wait for the returned Operation, then read `get_site(include: ["backend"])` and verify `qoder` in its capabilities. `get_site(include: ["secrets"])` intentionally omits the platform Secret; an empty list does not establish that `QODER_PAT` is missing. Never attempt ordinary Secret writes under that name or automatically create a replacement PAT.

If `ensure_backend` returns `sites_backend_capability_not_ready` without an Operation, report a Sites capability setup failure. No Cloud Agents request or PAT authentication result has been established. Keep the exact request ID; stop repeated capability writes until an operator confirms the deployment/configuration changed. `sites_qoder_pat_forbidden` is a signing-policy denial, not an upstream Cloud Agents 401. Continue local development, but do not recommend publishing a dependent AI release while `qoder` is absent.

Prepare the full frontend and Function as a new action with the existing `projectId`. Omit `QODER_PAT` from `secretNames` because it is platform-managed; ordinary app Secrets remain declared normally. Keep initialization and complete-draft action IDs separate. Follow [sites-hosting](../../sites-hosting/SKILL.md) to publish, verify and show the complete draft by default; honor an explicit request to defer publication. The initialization draft remains unpublished. Preserve the hosting workflow's content review and database prerequisites.

## Resource scopes and durable intents

Generate a stable application scope when implementing the website, scoped to its actual deployment environment and site. Maintain it in trusted configuration across Function redeploys; never derive it from a Host header, visitor-supplied ID or random value generated at every cold start.

Maintain private durable records for:

- Agent/Environment bindings: scope, configuration revision, resource IDs, pinned Agent version, and creation intent state.
- Conversations: authenticated application principal, app conversation ID, Cloud Session ID, Agent/environment binding and last event cursor.
- Message intents: app request ID, request fingerprint, accepted Event IDs, and known/unknown delivery outcome.

For a new persistent application, use [Function backend](../../sites-building/references/function-backend.md): its private database credential isolates the site/tenant, and Function predicates enforce user ownership within the site. For an existing legacy allocation, follow [legacy identity and coordination](../../sites-building/references/database.md#identity-and-coordination); an anonymous adapter plus a visitor filter does not establish private storage. Keep chat history, bindings and intents behind authorized business routes and private storage policies.

Implement the application's durable coordinator before connecting the bootstrap helper to an HTTP route. `withLock(key, callback)` must serialize callers across Function instances; the callback receives durable `read`/`write` and `assertHeld` methods. Persist `creating` before a create request. A process-local Map or promise is only a cache. Lease validation and a protected write need atomic fencing: checking a lease and then doing an unconditional upsert allows a stale worker to overwrite its successor. The Function backend SDK and notes example do not supply this coordinator or arbitrary transactions. Verify the required atomic provider operation; if unavailable, report that dependency and continue the independent application slice.

## Lazy bootstrap

On an authenticated, authorized first-use POST:

1. Check application quota and the runtime Secret. Reject invalid prompts or unauthorized requests before any cloud allocation.
2. Choose the application's configured enabled model via the Models API. Build fixed Agent and Environment definitions from trusted configuration. When using `ensureCloudResources`, pass the stable app scope through `applicationScope`; the helper generates resource-role and configuration-fingerprint metadata. Optional business metadata uses non-reserved keys such as `app` or `purpose`; exclude personal prompt content and Secrets.
3. For each definition, enter the shared coordinator, load its durable record, and scan active Cloud resources for the exact metadata match. Reuse the unique match and persist its ID. Agent/Environment display names alone are not unique ownership keys.
4. If no match exists and no prior create is outstanding, persist a `creating` record and send one creation request. Preserve the Agent's stable idempotency key. Persist success immediately. If the response is lost, leave the durable intent unresolved.
5. On a later request after timeout/crash, reconcile by the exact resource metadata before doing anything else. A unique match completes the record. No match leaves initialization pending; several matches require reconciliation, not arbitrary selection or automatic deletion. Do not issue another Environment/Session create merely because the result is unknown.
6. Create a Session for the application's user/conversation with the same intent discipline. Bind the exact Agent and Environment and record the Cloud Session ID before delivering the first prompt. Repeated requests reuse this mapping; never use an account-wide 'latest session'. Apply owner checks to every lookup, send, event read and interrupt.
7. Record the message intent before sending `user.message`. After a definite success, retain returned Event IDs. Duplicate requests return existing status. If delivery is unknown, read Events and reconcile using a documented correlation mechanism where available; absent proof, return pending and do not automatically resend. Do not claim message idempotency from text matching alone.

The [client asset](../assets/cloud-agents.mjs) implements the Agent/Environment portion against this coordinator interface. Session and message state belong to the application's conversation service. Reuse the same private coordination semantics there; the supplied client performs each POST at most once per invocation and never retries writes automatically.

## Integrate the bootstrap helper

Call this inside the application's authorized first-use workflow. `privateCoordinator` is the application's durable implementation of the interface above; the model and definitions come from trusted configuration.

`qsites_*` is reserved in Agent and Environment definition metadata. The helper injects `qsites_scope`, `qsites_kind` and `qsites_config` for resource matching; supply neither these keys nor custom keys such as `qsites_app`. Business metadata can be omitted. Both definitions are validated before any resource lookup or creation. Correct invalid configuration explicitly; silently dropping or renaming fields changes the configuration fingerprint and resource matching.

```js
import { createCloudAgentsClient, ensureCloudResources } from './cloud-agents.mjs';

// Server-only configuration generated from sites.get_context.runtime.cloudAgents.apiOrigin.
// Stop setup if cloudAgents.configured is false; never use the Sites management origin as a fallback.
const cloud = createCloudAgentsClient({ origin: configuredCloudApiOrigin });
const binding = await ensureCloudResources({
  client: cloud,
  coordinator: privateCoordinator,
  applicationScope: stableSiteEnvironmentScope,
  agent: {
    name: 'Website assistant', model: selectedEnabledModelId,
    system: applicationSystemInstructions, tools: reviewedAgentTools,
    metadata: { app: 'website-assistant', purpose: 'chat' }, // Optional business fields.
  },
  environment: { name: 'Website assistant environment', config: { type: 'cloud' } },
});
```

Within a newly recorded Session intent, create the Session with `cloud.request('/api/v1/cloud/sessions', { method: 'POST', body: { ...binding, title: safeConversationTitle, metadata: serverOwnedConversationMetadata } })`. Save its returned ID before sending a message. For a resumed conversation, read the saved Session ID instead. Translate `CloudAgentsError.code` to app text; a status of 202 means the existing initialization intent is pending. Catch coordinator/storage failures at the HTTP boundary and expose a fixed initialization error rather than their raw messages.

## Recovery and changes

Show a safe initializing/pending state while setup is incomplete; keep retrying only reads within a bounded budget. Expose a retry/status action that reconciles the existing intent, not one that changes IDs. An explicit owner repair may authorize a new generation only after inspecting the previous result; never clear an unknown intent because a lock expired.

A confirmed removed/archived resource or changed Agent configuration needs a reviewed new binding generation. Existing conversations retain their resource/version mapping. A revoked PAT or quota failure does not authorize creating another PAT, using a visitor token, changing regions or silently selecting a different resource.

## Verification cases

Follow the [validation scope](../../sites-building/SKILL.md#validation-scope). The normal AI conversation checks initialization or reuse as encountered; do not create extra cloud resources just to exercise every initialization branch.

When changing the initialization coordinator or fixing a recovery bug, use mocked Cloud API responses and a test coordinator for the affected case: concurrent first use, a lost create response, a crash around dispatch, ambiguous lookup or expired ownership. When changing conversation authorization, check wrong-user rejection. Select the cases implicated by the change; this is not a required matrix for every AI website.

Use only the authorized target Site and Cloud account for real execution. Backend setup and a completed Agent response are distinct evidence; reuse the conversation result from [sites-build-agent-app](../SKILL.md#6-validate-and-hand-back-to-publication).

# Runtime acceptance and recovery

Use this reference for requested real-browser/integration tests and authentication
features. Keep one current acceptance table in the application workspace. Update
rows in place after fixes; move obsolete evidence to history instead of appending
contradictory conclusions.

| Layer | Check | Status | Target release / artifact | Time | Evidence / blocker |
| --- | --- | --- | --- | --- | --- |
| Local | Build and protocol tests | pending | | | |
| Control plane | Secret sync, Function, committed active release | pending | | | |
| Browser | Click login, callback, write, reload, logout | pending | | | |
| Isolation | Account A/B and unauthorized access | pending | | | |

Use only passed, failed or pending. Each claimed pass needs evidence from that
layer and exact target; a new release invalidates affected runtime checks.
Providers endpoint 200 proves configuration parsing, not provider acceptance of a
Client Secret. An unexplained request log does not prove a platform probe.
Local protocol tests do not prove deployed cookies, ingress closure or tenant RLS.

1. Confirm the intended active release before testing. Preserve private admission;
   platform login and application login are separate steps.
2. If browser QA is authorized, exercise the actual page button, not a manually
   corrected API request. Follow callback, session restoration, persistence and
   logout. Use synthetic data; let the user supply real account credentials.
3. Test a second account separately. If unavailable, mark that row pending and
   finish independent checks. Carry forward explicitly deferred ingress tests.
4. On failure, classify the layer: local process/port, browser navigation,
   Gateway admission, Function, provider, database or control plane. Correlate a
   fixed time window and request ID through existing Function log tools.
5. Keep queries free of OAuth callback search parameters. Record stable error
   codes and safe authentication stage events, never Cookie/Token/Secret values.
6. Present final delivery after requested checks are complete or their remaining
   prerequisites are explicit. Preview tools do not terminate requested testing.

For missing configuration, keep the full draft and list exact names, callback
URLs and where the user enters values. Check Secret sync and reuse its actionId;
no replacement site or reduced-functionality release is needed. For asynchronous
work, respect retryAfterMs and stop on a terminal failure or actionable blocker.

A missing local descriptor is recovered by retrying prepare_site with the same
original action and exact inputs after readiness; recovery uses the trusted frozen ZIP. Preserve a newer entry;
never hand-write cloud identities or repackage unchanged work to repair a file.

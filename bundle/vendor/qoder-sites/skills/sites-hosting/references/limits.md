# Explain service limits in conversation

When a Sites tool reports a limit, including during site creation or backend enablement, stop the blocked write and state the matching case below in the user's language. Use a concise declarative message with the known usage and the operation that could not complete. Do not ask a follow-up question, invoke a user-input tool, or present a choice/confirmation dialog to handle the limit. This rule takes precedence over general instructions to ask how to proceed when blocked.

Preserve the project, draft and request identity. Continue only independent work already within the user's request; leave dependent work blocked until the limit is resolved. Do not offer or perform site reuse, replacement, deletion, backend release or a local-only substitute as quota workarounds. Resume the blocked operation when the user returns with the blocker resolved; repeated requests cannot resolve an unchanged limit. Return friendly prose, keeping internal error codes out of the user-facing explanation.

## Structured quantity limits

For `error=sites_quota_exceeded` with `resource`, `used` and `limit`, use the following copy during the current limited-time free offering. Select by resource and quota ceiling (`limit`), not current usage (`used`) or an inferred Free subscription:

| Condition | Chinese | English |
| --- | --- | --- |
| `sites_total` | 已达到可发布的网站数量上限，暂时无法发布新网站。 | You’ve reached your website limit. You can’t publish more websites at this time. |
| `backend_sites` with `limit > 0` | 可开通数据库与存储的网站数量已达上限，暂时无法为更多网站开通。 | You’ve reached the limit for websites with database and storage. You can’t enable these services for more websites at this time. |
| `backend_sites` with `limit = 0` | 你当前订阅计划仅支持部署静态网站。此站点需要使用数据库和存储服务，请升级后继续部署。 | Your current plan only supports static website deployments. This site requires database and storage services. Please upgrade your plan to continue. |

For `sites_total` and `backend_sites` with `limit > 0`, include the returned usage as `used/limit` and omit upgrade copy and links even when `pricingUrl` is present. Site usage includes created but unpublished sites and resources still being deleted. The backend limit concerns enabling services for more sites; it does not mean that an existing site's database is full.

Only for `backend_sites` with `limit = 0`, use the static-only plan copy above without appending `0/0`. When the result includes `pricingUrl`, add `[升级](pricingUrl)` in Chinese or `[Upgrade](pricingUrl)` in English, using the exact returned URL. Global returns `https://qoder.com/pricing`; CN returns `https://qoder.cn/pricing`. Select by the returned product URL, not the conversation language. If absent, omit the link. This branch does not identify the subscription as Free; do not add that label, promise a specific post-upgrade quota or suggest a client update. A current usage of zero with a positive limit does not select this branch.

## Deployment storage capacity

For `resource=storage_bytes`, explain that deployment storage is insufficient and include `used`, `reserved`, `requested` and `limit` with explicit byte units or a consistent MiB/GiB conversion. Use the returned server limit, never assume a default. `requested` is the server's reservation for this upload (including expansion and copies), not just the ZIP size. Historical deployment versions also consume capacity. This is separate from site counts, runtime object storage and daily PV limits. Do not suggest changing the domain or upgrading a plan, automatically delete versions, or promise that expired versions have already released quota. Keep the original action and project.

For `sites_rate_limited`, explain the temporary request limit and use the returned retry hint. Do not describe it as exhausted site or storage capacity.

## Other existing limits

- Bare `sites_quota_exceeded`: “本次操作已达到配额或请求限制，暂时无法继续。请检查额度；若是频率限制，请稍后重试。” / “This operation has reached a quota or request limit and can’t continue. Check your quota; if requests were rate-limited, try again later.” The resource is unknown: omit quantities and an upgrade action.
- `sites_storage_file_too_large`: “本次上传的文件超过大小上限，请缩小文件后重试。” / “This file exceeds the upload size limit. Reduce its size and try again.” This is an individual storage file limit, not exhausted total storage or a deployment ZIP limit. Use the returned file policy for a known limit; never invent a size.
- An operation explicitly reports `artifact_size_exceeded`: “本次部署资源超过大小上限，请精简资源后重试。” / “This deployment exceeds the size limit. Reduce your site files and try again.” Include size/limit only when measured or returned for this exact artifact. A generic invalid artifact or request failure does not establish oversize.

Expiration, database/storage capacity exhaustion and daily PV limits require explicit service evidence. Do not infer them from these errors. Preserve the existing unknown-write recovery workflow and never turn an unknown result into a definite rejection or a promise that the live version is unchanged.

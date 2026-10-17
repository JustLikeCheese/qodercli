# Choose an application example

Choose by the user's primary task. Adapt the content, layout and theme to the requested product; a demo's sample content is not the finished website. Existing projects keep their structure and use only the relevant parts.

| Requested experience | Start here | What is included |
| --- | --- | --- |
| A static page or a custom React website | [React starter](../templates/react-starter/README.md) | Shared theme, UI components, build and optional public Function. The starter page is deliberately neutral. |
| Private records with attachments | [Records workbench](records-example.md) | Search within loaded records, create/edit, conflict and uncertain-write recovery, file upload/confirmation/download. A local adapter exercises the same business routes without cloud credentials. |
| An existing login provider or a local password experiment | [Application authentication](application-auth.md) | OAuth/introspection adapters and a password laboratory. The local identity fixtures do not establish live provider login or production isolation. |
| Chat with incremental replies and conversation switching | [SSE chat example](../../sites-build-agent-app/references/chat-example.md) | Browser UI, Function-shaped routes and a controlled local service. Live use requires the documented identity, conversation and durable storage adapters. |
| WebSocket routing or frame diagnostics | [Transport demo](../../sites-build-agent-app/references/websocket.md) | Local text/binary echo and a separately configured Realtime relay. This diagnostic does not record or play audio. |

The records and chat examples are independent choices, not mandatory dependencies of every website. Start them with their documented local commands. Local adapters stay in `dev/` and are excluded from the published Function; their sample data and fault controls remain visibly identified as demonstrations. Inspect the example's live integration requirements before selecting deployment outputs.

For private data, retain the original identity and owner checks while changing the UI. Use the [Function backend](function-backend.md) for new persistent projects and the corresponding example's recovery rules for uncertain writes. A local demonstration proves that the application components work together; real authentication, provider concurrency and cloud execution require their own evidence.

When the finished website is ready for hosted delivery, follow [sites-hosting](../../sites-hosting/SKILL.md). For a publication state that is hard to interpret, consult its [worked examples](../../sites-hosting/references/workflow-examples.md); these examples do not add another publishing step.

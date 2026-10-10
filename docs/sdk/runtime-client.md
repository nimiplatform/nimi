# Runtime Client

A Nimi App uses one host-bound `NimiLocalAppClient`, normally created by the generated Kit integration. Use `client.ai`, `client.aiConfig`, and the separately admitted App capability surfaces. The App does not choose its account, App owner, Runtime address, or protected transport.

`@nimiplatform/sdk/runtime` also exposes typed Runtime facilities for hosts and admitted infrastructure. Importing a type or constructing a direct client does not grant App authority. Ordinary loopback gRPC rejects App-scoped AI execution, AIConfig, and storage; it is not an alternative App integration path.

## Requests and Results

AI requests carry content and supported parameters. The committed AIConfig supplies the Local or Cloud route; Runtime captures the selected Local Loadout or exact Cloud configuration at submission. The SDK does not choose substitute implementations or inject credentials.

Streams expose typed ordered output and terminal outcomes. Asynchronous Jobs use Submit, repeated Get, complete result reads, and explicit Cancel. Retain the original Job identity when observation fails; do not resubmit work to recover a connection. See [Streaming](/runtime/streaming).

LocalAgent operations use session-scoped authorized handles. Conversation, business execution, shared configuration, Memory management, and realtime each retain their own operation coverage. Cognition owns long-term Memory through Runtime mediation; Knowledge V1 has no public client surface.

## Handle Failures

Preserve the typed error, reason, and available action details. Malformed data and missing authority fail closed. A missing method or unsupported combination is not permission to call Runtime internals or a Provider directly.

Start with [First AI Call](/sdk/first-ai-call), [AIConfig](/sdk/ai-config-surface), and [App authorization](/platform/agents/participation-authority).

## Source Basis

- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)

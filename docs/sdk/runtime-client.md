# Runtime Client

A standard Nimi App consumes a single host-bound client instance (`NimiLocalAppClient`), typically instantiated during app bootstrap via Kit. Application code interacts with platform services through `client.ai`, `client.aiConfig`, and authorized feature surfaces; the App does not manage user accounts, App identity headers, Runtime endpoints, or low-level transport security.

The `@nimiplatform/sdk/runtime` module exports strongly-typed Runtime interfaces for Desktop hosts and trusted system infrastructure. Merely importing types or constructing a direct client does not grant application privileges. Standard loopback gRPC connections reject App-scoped AI execution, AIConfig management, and secure storage; direct clients must not be used as an application integration backdoor.

## Requests and Execution Results

AI generation requests carry prompt contents and supported execution parameters. Persistent AIConfig preferences supply the intended Local or Cloud route; Runtime binds directly to the active Local Loadout or configured Cloud target at submission. The SDK does not swap models or inject credentials on the client.

- **Streaming responses**: Emit ordered, strongly-typed event chunks ending with an explicit terminal outcome.
- **Asynchronous Jobs**: Follow standard lifecycle operations: Submit, poll Get, fetch complete results, or invoke Cancel. If client observation is interrupted, resume queries using the original Job ID rather than resubmitting duplicate workloads. See [Streaming](/runtime/streaming).
- **LocalAgent operations**: Agent interactions execute through session-scoped authorized handles. Conversations, task execution, shared configurations, memory controls, and realtime streams are each protected by specific capability scopes. Cognition manages long-term memory via Runtime mediation; Knowledge V1 does not expose a public client surface.

## Error Handling and Fault Tolerance

The SDK preserves strongly-typed error codes, structured reason codes, and diagnostic metadata returned by Runtime. When input payloads are malformed or authorization is missing, requests fail closed. Missing methods or unsupported option combinations must be reported to the user with clear diagnostic feedback; applications must not attempt to call Runtime private packages or contact providers directly.

To get started, review [First AI Call](/sdk/first-ai-call), [AI Config](/sdk/ai-config-surface), and [App Authorization](/platform/agents/participation-authority).

## Source Basis

- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)

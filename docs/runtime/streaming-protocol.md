# Low-Level Streaming Protocol and Wire Conventions

Runtime RPC endpoints define explicit event formats and lifecycle semantics. In typical development workflows, applications interact with streams through the standard SDK without needing to parse low-level binary gRPC frames directly.

## Streaming Endpoints and Lifecycle Behaviors

| Endpoint | Normal Completion | Interruption & Recovery Handling |
| --- | --- | --- |
| `StreamScenario` | Emits terminal frame with `completed` status | Emits explicit `failed` events; socket disconnects trigger connection timeouts |
| `SubscribeScenarioJobEvents` | Delivers status snapshots up to terminal state, then closes | Re-query with `GetScenarioJob`; ending observation does not cancel background compute |
| `ExportAuditEvents` | Final batch marked with `eof: true` | Interrupted streams yield partial output; re-exporting requires a new export request over the desired time window |
| **Long-Lived Subscriptions** | Follows specific owner resource lifecycles | Cleanly terminates upon session invalidation or daemon restart |

## Generation Stream Handling Principles

1. **Strict Ordering**: Incremental text deltas maintain strict sequential ordering across the transport layer, ensuring coherent text reassembly in the UI.
2. **Separation of Metrics and Data**: Content chunks, performance metrics (e.g., token `usage`), and lifecycle signals (start, completion) are demarcated into distinct message envelopes.
3. **Reconnection Strategies**: For interactive streaming, brief disconnects prompt actionable retry banners; for asynchronous jobs, client apps re-bind using the persistent `jobId`.

## Backpressure and Resource Protection

To prevent slow consumers from causing memory exhaustion within Runtime:
- **Bounded Buffers**: Streaming channels enforce bounded sliding windows, applying backpressure upstream to inference workers when buffers saturate.
- **Connection Pruning**: Dangling or unresponsive socket connections are reclaimed automatically after bounded timeouts, freeing system socket handles.

## Source Basis

- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`proto/runtime/v1/ai.proto`](https://github.com/nimiplatform/nimi/blob/main/proto/runtime/v1/ai.proto)
- [`sdks/typescript/runtime/scenario-jobs.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/runtime/scenario-jobs.ts)

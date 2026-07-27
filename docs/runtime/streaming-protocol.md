# Streaming Protocol

> Status: Running today. The streaming contract (`K-STREAM-*`) is
> the shipped close-mode authority for every Runtime
> server-streaming RPC.

Runtime owns several server-streaming RPCs (text generation, voice
synthesis, scenario job events, workflow events, audit export, long-
lived subscriptions). The streaming contract pins **how each
stream closes** so consumers can write recovery logic that does not
guess at protocol shape.

## Four Close Modes

The contract classifies every Runtime server-streaming RPC into one
of four close modes:

| Mode | Close signal | RPCs |
| --- | --- | --- |
| **A — completed / failed stream event** | Final event is `STREAM_EVENT_COMPLETED` or `STREAM_EVENT_FAILED` | `StreamScenario` (`TEXT_GENERATE`), `StreamScenario` (`SPEECH_SYNTHESIZE`) |
| **B — terminal event then gRPC OK close** | Server emits terminal event, then closes stream cleanly | `SubscribeScenarioJobEvents`, `SubscribeWorkflowEvents` |
| **C — `eof=true` chunk then gRPC OK close** | Server emits `eof=true` chunk, then closes | `ExportAuditEvents` |
| **D — long-lived subscription stream** | No terminal frame; either side may close | `SubscribeRuntimeHealthEvents`, `SubscribeAIProviderHealthEvents`, `SubscribeAccountSessionEvents`, `SubscribeMemoryEvents`, `SubscribeAgentEvents`, `SubscribeAppMessages`, `ReadRealtimeEvents`, `WatchLocalTransfers`, `grpc.health.v1.Health/Watch` |

Mode D streams have no terminal signal. When the daemon enters
`STOPPING` (`K-DAEMON-003`), it closes all active subscriptions with
gRPC `CANCELLED`. Clients detect closure via `runtime.disconnected`
(`S-RUNTIME-028`) or gRPC status and decide whether to rebuild.

## Stream Establishment Boundary

For `StreamScenario` (`TEXT_GENERATE` / `SPEECH_SYNTHESIZE`):

| Stage | Where errors flow |
| --- | --- |
| Step 1-9 of `K-KEYSRC-004` evaluation chain | Pre-establishment errors → gRPC error |
| Step 10 (route execution) | Stream is established; subsequent business / upstream errors → terminal `STREAM_EVENT_FAILED` frame with a reason code |

The split is deliberate: pre-establishment errors are connection
failures (caller never streams); post-establishment errors are
in-stream business outcomes (caller already streaming).

## Mode A Event Constraints

Text streams (`TEXT_GENERATE`):

| Event shape | Required |
| --- | --- |
| `STREAM_EVENT_DELTA` with `payload.delta.text` | `payload.delta.text.text` must be non-empty |
| `STREAM_EVENT_USAGE` | Carries incremental or final `UsageStats` when Runtime has usage evidence |
| `STREAM_EVENT_COMPLETED` | Carries `payload.completed.finish_reason` and completion metadata |
| `STREAM_EVENT_FAILED` | Carries `payload.failed.reason_code` and, when available, `action_hint` |

Voice streams (`SPEECH_SYNTHESIZE`):

| Event shape | Required |
| --- | --- |
| `STREAM_EVENT_DELTA` with `payload.delta.artifact` | Artifact chunk and MIME type must match the admitted voice artifact contract |
| `STREAM_EVENT_COMPLETED` | Carries typed completion metadata |
| `STREAM_EVENT_FAILED` | Carries `payload.failed.reason_code` and, when available, `action_hint` |

## Mode B Event Constraints

`SubscribeScenarioJobEvents` and `SubscribeWorkflowEvents`:

| Rule | Value |
| --- | --- |
| Mode A terminal semantics | NOT used |
| Steady-state close | After terminal event, server closes stream gRPC OK |
| `STOPPING` preempt | Daemon may preempt active streams with gRPC `CANCELLED`; terminal event delivery not guaranteed |

The same job / workflow may emit repeated state events of the same
`event_type` while non-terminal. Consumers must overwrite the prior
snapshot with the latest event content; do **not** assume strict
event-type monotonicity.

## Reader Scenario: A Text Streaming Call

App calls `StreamScenario` for text generation.

1. **Pre-establishment validation.** Steps 1-9 of `K-KEYSRC-004`
   chain: parse, JWT, app_id, key-source, connector load, owner
   check, endpoint security, …
2. **Establishment.** All pre-establishment checks pass. Stream
   begins (step 10).
3. **Delta events.** Each `STREAM_EVENT_DELTA` text chunk carries
   non-empty `payload.delta.text.text`.
4. **Terminal event.** Runtime emits `STREAM_EVENT_COMPLETED` with a
   completed payload or `STREAM_EVENT_FAILED` with a failed payload.
5. **Stream closes.** gRPC OK after terminal frame received.

If something fails post-establishment, it surfaces as a terminal
`STREAM_EVENT_FAILED` frame with a reason code, not as a gRPC error.

## Reader Scenario: A Long-Lived Subscription Survives Daemon Restart

App subscribes to `SubscribeAccountSessionEvents`.

1. **Stream open.** Mode D. Events stream as session state changes.
2. **Daemon enters `STOPPING`.** Runtime closes all active
   subscriptions with gRPC `CANCELLED`.
3. **App detects closure.** Either via `runtime.disconnected` or
   gRPC status.
4. **Reconnect logic.** App decides to rebuild the subscription
   when the daemon comes back; it does not assume the daemon
   "should have" sent a terminal event.

The contract's explicit "no terminal signal in mode D" is what makes
the recovery logic correct — apps don't wait forever for an event
that's not coming.

## Reader Scenario: Job Events With Repeating Event Types

App subscribes to `SubscribeScenarioJobEvents`.

1. **Job runs.** Same `event_type` (e.g., `progress`) emits multiple
   times during execution with updated snapshot content.
2. **App overwrites prior snapshot.** Does not deduplicate by event
   type.
3. **Terminal event.** When job completes, terminal event arrives;
   server closes stream gRPC OK.

If the daemon enters `STOPPING` first, the stream may close with
gRPC `CANCELLED` before the terminal event — the app rebuilds the
subscription on next daemon availability and re-derives terminal
state from the job snapshot.

## What Streaming Protocol Does Not Do

- It does not let consumers infer close behavior; every RPC's mode
  is admitted in the table.
- It does not allow Mode A completed / failed event semantics in mode B / C / D.
- It does not let mode D streams expect terminal events.
- It does not allow post-establishment errors to surface as gRPC
  errors instead of terminal frames in mode A.
- It does not allow consumers to assume strict event-type
  monotonicity within a job / workflow stream.

## Boundary Summary

| Concern | Authority |
| --- | --- |
| Close-mode classification | `K-STREAM-001` |
| Establishment boundary | `K-STREAM-002` |
| Text stream events | `K-STREAM-003` |
| Voice stream events | `K-STREAM-004` |
| State event streams | `K-STREAM-005` |
| Chunk framing | `K-STREAM-006` |
| EOF chunk close | `K-STREAM-009` |
| Subscription stream lifecycle | `K-STREAM-010` |
| Daemon shutdown coupling | `K-DAEMON-003` |

## Source Basis

- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/security-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/security-core.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)

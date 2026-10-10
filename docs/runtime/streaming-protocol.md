# Streaming Protocol

Runtime RPCs declare their own event shapes and close behavior. An App normally consumes their protected SDK projection, rather than constructing a direct gRPC connection.

| Surface | Normal completion | Interruption |
| --- | --- | --- |
| `StreamScenario` | Typed completed or failed terminal event | Transport loss can prevent terminal delivery; do not infer success |
| `SubscribeScenarioJobEvents` | Job snapshots through a terminal state, then closure | Re-observe the original Job with Get; detachment does not cancel work |
| `ExportAuditEvents` | Final chunk with `eof=true` | An interrupted export is incomplete |
| Long-lived subscriptions | Follow the owning operation's lifecycle; no universal success frame | Session, authority, transport, or daemon changes can close the subscription |

## Generation Events

Admission failure before stream establishment is an operation error. An established generation stream carries the admitted started, delta, usage, completed, or failed shapes. Consumers preserve ordered content and distinguish a successful terminal from failed or interrupted delivery. Speech bytes and MIME information must satisfy the exact speech output contract.

A terminal frame cannot be guaranteed after connection loss. Do not retry a partial generation as if it resumed the original operation. An explicit new generation is a separate App action.

## Job Snapshots and Complete Results

A Job can emit multiple snapshots of the same status or event type. Do not discard a newer snapshot merely because its type repeats. Events do not expose every typed terminal result.

Use repeated `GetScenarioJob` calls on the same identity. Each call may reconcile the original native provider task within bounded work. Read the complete terminal response, including operation-specific results such as VoiceAsset/VoiceReference or vision locations, and use `GetScenarioArtifacts` for contracts with formal artifact output. An empty valid result is distinct from an absent required result.

An observation error is not a fabricated Job terminal. SDK observation helpers retain the original Job, expose typed issues, and separate observation abort from explicit execution cancellation. See [Streams and Job Observation](/runtime/streaming).

## Reconnect and Resource Limits

Shared realtime infrastructure owns ordering, generation fencing, cancellation, bounded buffering, and safe lifecycle metadata. It does not own generic replay or durable checkpoints. Realm defines its cursor recovery, LocalAgent recovers from its committed Conversation snapshot, and AI Realtime remains session-ephemeral.

Backpressure is bounded: slow consumers may be closed with a typed failure. Daemon shutdown or stale authority closes affected subscriptions and fences late data. A client must re-establish authorized state through the owning surface before accepting a new generation.

## Source Basis

- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`proto/runtime/v1/ai.proto`](https://github.com/nimiplatform/nimi/blob/main/proto/runtime/v1/ai.proto)
- [`sdks/typescript/runtime/scenario-jobs.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/runtime/scenario-jobs.ts)

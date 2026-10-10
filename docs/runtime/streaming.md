# Streams and Job Observation

A stream carries ordered typed events. Connection closure alone is not proof of successful completion. Consume the operation's terminal signal, and preserve transport failure separately from its last trustworthy state.

## Generation Streams

Text and supported speech generation use typed deltas and explicit completed or failed outcomes. Before establishment, admission can reject the call. After establishment, operation failures use the admitted failed event where delivery is possible. A broken transport or Runtime shutdown can prevent a terminal event from arriving; the client must not turn that loss into success.

There is no general promise of replaying a partial generation after reconnect. Shared realtime mechanics provide bounded reconnect hooks; each owner defines its recovery. AI Realtime sessions are ephemeral and close on Runtime or Driver loss. LocalAgent Conversation recovery uses the committed snapshot, not durable event replay.

## Asynchronous Jobs

The common program is Submit, repeated Get on the original Job, formal result reads, and explicit Cancel when requested. `GetScenarioJob` may admit one bounded reconciliation of an original native asynchronous task. Without a later Get, Runtime does not start another permanent provider polling round.

`SubscribeScenarioJobEvents` projects snapshots and can make the UI update sooner. It is a hint alongside Get, not the driver of asynchronous provider progress or a replacement for a complete terminal Get. The App owns observation cadence. An event's terminal status does not replace operation-specific result fields returned by Get or the formal artifact reader.

Keep `observationIssue` separate from Job status. It reports a response-local observation problem and may accompany the last trusted snapshot; it does not prove the original execution failed. Detaching a subscription, leaving a view, or losing transport stops observation, not admitted work. Explicit Cancel is a separate operation and a canceled status alone does not prove external billing or work stopped; preserve the reported stop outcome.

For recovery, keep the original Job identity or a saved client submission identity. Look up and observe that work instead of submitting generation again. Adopt complete results into App storage before Runtime's bounded retention ends.

## Bounded Delivery

Runtime bounds messages, buffering, subscriber lag, retry, and lifetime. A slow consumer receives backpressure or a typed resource/slow-consumer failure; it is not promised unlimited pause and lossless replay. Independent channels and tracks remain isolated.

For wire-level details, see [Streaming Protocol](/runtime/streaming-protocol). The compilable [Scenario Job example](https://github.com/nimiplatform/nimi/blob/main/examples/sdk/05-scenario-job.ts) uses the protected App client.

## Source Basis

- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`sdks/typescript/runtime/scenario-jobs.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/runtime/scenario-jobs.ts)

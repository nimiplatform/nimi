# Streaming Events and Scenario Job Observation

In Nimi, streaming channels deliver low-latency text tokens, audio frames, and presentation state events, while prolonged heavy compute tasks—such as image synthesis, video generation, or music rendering—are managed through structured asynchronous Scenario Jobs.

## Streaming Lifecycle

- **Structured Incremental Output**: Text and voice generation streams deltas in real-time, allowing frontends to render responsive, progressive output.
- **Explicit Termination and Error Signaling**: Streams dispatch clear terminal events upon successful completion or failure, enabling clients to clearly distinguish socket drops from verified operational success.
- **Resilience and State Recovery**: If network interruptions occur, conversational state is restored from the committed conversation snapshot, preserving contextual integrity.

## Asynchronous Scenario Jobs Workflow

For compute-intensive operations, applications follow the standardized Scenario Job pattern:

1. **Submit**: The application posts a task specification. Runtime validates arguments and returns a unique `jobId`; client apps can preserve a `clientSubmissionId` for idempotency.
2. **Observe (Get & Subscribe)**:
   - Poll task health and terminal states via `GetScenarioJob`;
   - Optionally listen to `SubscribeScenarioJobEvents` for real-time progress callbacks and stage updates.
3. **Retrieve Artifacts**: Once the job achieves `completed` status, retrieve finalized files, embeddings, or structured records.
4. **Cancellation**: If a user abandons a task, dispatching a Cancel command requests task stoppage; client applications inspect the returned terminal status and `stopOutcome` to determine whether execution was confirmed stopped or remains unconfirmed.

## Backpressure and Flow Control

To safeguard local machine resources:
- **Adaptive Throttling**: Runtime maintains bounded buffers and subscription timeouts to prevent memory exhaustion on resource-constrained consumers.
- **Capacity Management**: Runtime manages queue bounds and execution concurrency to prevent compute tasks from exhausting system memory and resources.

## Related Documentation

- [Wire-level Streaming Protocol Details](/runtime/streaming-protocol)

## Source Basis

- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`examples/sdk/05-scenario-job.ts`](https://github.com/nimiplatform/nimi/blob/main/examples/sdk/05-scenario-job.ts)

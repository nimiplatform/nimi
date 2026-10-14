# Transport and Error Handling

The SDK Transport and Error handling mechanisms govern how the SDK communicates with Runtime over supported physical transports (such as Desktop IPC or gRPC), and how low-level runtime errors translate into predictable, strongly-typed SDK errors for applications.

## Transport Management

| Concern | Specification & Rule |
| --- | --- |
| Transport bindings | `.nimi/spec/sdks/client-core.authority.yaml` |
| Connection lifecycle | Managed independently per supported transport (heartbeats, state machines) |
| Reconnect strategy | Restricted strictly to transport-level recovery (never rescues business contract errors) |

The transport layer guarantees reliable byte transmission; it maintains socket connectivity and never silently attempts to patch business contract violations.

## Error Projection Architecture

| Concern | Specification & Rule |
| --- | --- |
| Error translation from Runtime to SDK | `.nimi/spec/sdks/client-core.authority.yaml` |
| Structured Reason Code preservation | Strongly-typed; never silently dropped or swallowed |
| Decode failures / Content-Type / Schema violations | Surfaces as typed validation errors; retries are forbidden |
| Authentication expiration / Transport disconnects | Surfaces as typed connection errors; retried per transport policy |

> [!IMPORTANT]
> **Automatic retries and token refreshes are transport and authentication recovery mechanisms only**. They cannot resolve payload decode failures, Content-Type mismatches, schema violations, or business contract breaches. A schema-invalid response will never become valid by being retried.

## Typical Scenario: A Schema-Invalid Response

A Runtime API returns a response that fails SDK schema validation:

1. **Typed error projection**: The SDK wraps the failure into a structured SDK error containing a precise schema failure reason code.
2. **No silent retry**: Transport retries handle physical network drops; semantic contract failures are rejected immediately.
3. **Application handling**: The application catches the typed error and displays user-friendly diagnostic information without fabricating success.

## Typical Scenario: Transport Disconnect

The Runtime daemon enters a stopping state or restarts, causing the SDK transport connection to drop:

1. **Failure detection**: The SDK captures the connection drop via protocol events (`runtime.disconnected` or gRPC status codes).
2. **Reconnect strategy**: The client triggers exponential backoff reconnection according to transport policy.
3. **Notify application**: The SDK surfaces a typed transport error, allowing the application to decide whether to replay the business call upon reconnection.
4. **No fake success**: Transport drops never synthesize mock data or pretend success.

## Architectural Boundaries

- **Retries never cross boundary layers**: Automatic retries may handle transient transport failures only when the operation’s retry policy permits replay; they must never be used to mask schema, decoding, or contract failures.
- **Preserve structured error context**: Structured reason codes and diagnostic metadata must never be discarded or swallowed during error translation.
- **Authentication recovery is scope-limited**: Token refreshes recover authentication sessions; they cannot be abused to circumvent data validation errors.
- **Faithful failure propagation**: Real failures must be surfaced transparently without synthesizing mock data or faking successful outcomes.

## Source Basis

- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)

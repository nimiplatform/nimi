<!-- nimi-docs: {"authority":["rule.nimi.platform.core-protocol.p-arch-001a","rule.nimi.runtime.remote-access.direct-transport","rule.nimi.runtime.remote-access.source-admission"],"sources":["sdks/typescript/runtime/remote.ts","runtime/internal/remoteaccess","proto/runtime/v1/remote_access.proto"]} -->

# Local-First and Remote Runtime Access

Nimi currently uses a PC Runtime to execute local or cloud AI for native Desktop Apps and admitted remote Web and Android clients. A phone or browser consuming that Runtime does not need its own Runtime installation. Here, **local execution means execution on the Runtime host**, which may be a different device from the screen you are using.

## Current Topology

```text
Desktop App ── verified native Host ──┐
                                     ├── PC Runtime ── local models / cloud provider
Web / Android ── direct WebRTC ───────┘       │
                                             └── Conversation, App data, Cognition bridge
Realm: account identity, primary binding, source qualification and connection coordination
```

The remote client signs in through the official Nimi browser flow and discovers the account's primary Runtime. The owner enables remote access and confirms the admitted source in PC Home. The host must remain running, the account and source must remain valid, and the devices must have a reachable direct network path. First confirmation is scoped to Account, primary Runtime and source revision; changing browser or device does not create another lasting approval.

Realm and an App's coordination backend carry identity and connection coordination. Remote AI input, results and files travel directly between client and PC. The current carrier accepts STUN discovery, rejects TURN and relay candidates, and reports an unavailable connection when direct access fails. It does not fall back to a local Runtime or an AI proxy. Use the public SDK carrier; private Runtime ports are not an integration path.

## Model Execution and Data

Prepare the host's model resources and choose `Local` or `Cloud` in the App or shared LocalAgent AIConfig. Runtime captures the effective configuration when accepting work. A failed Local request does not silently switch to Cloud. With Cloud selected, the context needed for the request goes to the configured provider.

Authorized clients attached to the same LocalAgent consume its Runtime-owned Conversation and Cognition-managed memory through the same host. App-private storage retains its owner-defined partition. Accessing that existing state is not cross-Runtime replication. A shared account or App name does not automatically merge other Runtime databases, hardware Loadouts or memory banks.

Closing a client ends its live connection, not the PC Runtime. A disconnected stream ends; reconnection obtains current handles and does not replay business requests. Already accepted durable Jobs follow their existing observation and cancellation contracts.

## Connectivity and Future Federation

Local inference can continue only while the applicable session, authorization, model assets and policies remain valid. New login, primary discovery, connection establishment, authorization renewal, Realm operations and cloud inference depend on their network services. Remote access does not promise whole-product offline operation.

Additional Runtime hosts, automatic cross-host synchronization and compute federation are separate architectural questions. The current multi-device journey is clients consuming one primary Runtime, not a distributed execution scheduler.

## Source Basis

- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/runtime/local-compute.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/local-compute.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/cognition/memory.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/memory.authority.yaml)
- [`.nimi/spec/runtime/remote-access.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/remote-access.authority.yaml)
- [`.nimi/spec/platform/remote-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/remote-clients.authority.yaml)
- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)

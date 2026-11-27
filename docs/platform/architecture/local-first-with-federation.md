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

The remote client signs in through the official Nimi browser flow and discovers the account's primary Runtime. In PC Home, the owner enables remote access and confirms the admitted source. The host must remain running, the account and source must remain valid, and the devices must have a reachable direct network path. First confirmation is scoped to the Account, primary Runtime, and source revision—using another browser or device reuses that confirmation rather than creating a separate lasting approval.

Realm and an App's coordination backend carry identity and connection coordination. Remote AI input, results and files travel directly between client and PC. The current carrier accepts STUN discovery, rejects TURN and relay candidates, and reports an unavailable connection when direct access fails. It does not fall back to a local Runtime or an AI proxy. Use the public SDK carrier; private Runtime ports are not an integration path.

## Model Execution and Data

Prepare the host's model resources and choose `Local` or `Cloud` in the App or shared LocalAgent AIConfig. Runtime captures the effective configuration when accepting work. A failed Local request does not silently switch to Cloud. With Cloud selected, the context needed for the request goes to the configured provider.

Authorized clients attached to the same LocalAgent consume its Runtime-owned Conversation and Cognition-managed memory through the same host. App-private storage retains its owner-defined partition. Accessing that existing state is not cross-Runtime replication. A shared account or App name does not automatically merge other Runtime databases, hardware Loadouts or memory banks.

Closing a client ends its live connection, not the PC Runtime. A disconnected stream ends; reconnection obtains current handles and does not replay business requests. Already accepted durable Jobs follow their existing observation and cancellation contracts.

## Offline Continuity, Re-Authentication, and Future Federation

Runtime separates trusted local sign-in identity from short-lived online Realm credentials so a previously signed-in device remains usable offline:

- **What continues offline on a signed-in device**: When this device has completed trusted unified-account sign-in and Runtime still holds valid, unrevoked local custody, Home can cold-start and stay open during a Realm outage or after the short-lived online Realm access token naturally expires offline. Prepared local models, authorized local App data, and LocalAgent conversations continue under their owner checks. For verified installed Apps, when the official Registry is unreachable, Runtime reuses its last verified official approval for that exact installed target regardless of elapsed time while the installation identity, account validity, and local authorization remain intact (local cache reads, launches, restarts, and failed checks never refresh stored approval timestamps).
- **When online re-authentication is required**: Expired, cleared, or absent online access tokens are never sent to authorize online Realm, Cloud account, or protected Remote Access operations—those fail honestly as network unavailable or online-auth-required. If an online token refresh produces an ambiguous or possibly-rotated outcome (such as a post-dispatch transport drop, Realm 503 verification unavailability, or restart recovery hitting a pre-refresh crash fence), Runtime immediately clears and fences the potentially rotated online tokens while preserving local sign-in identity; restoring online Realm or Remote Access then requires fresh online re-authentication in Home. First-time sign-in on a device without local custody, new verified App installs/updates, primary discovery, and Cloud inference also require live network services.
- **Immediate enforcement of logout, revocation, and kill-switch**: Explicit logout, account switching, confirmed revocation, ban, account deletion, or contract-invalid refresh immediately invalidates both online credentials and local authenticated identity and fences affected sessions and work. For verified installed Apps, an observed active kill-switch or absent Registry row immediately blocks new launch and bind even if the Registry later becomes unreachable.

Additional Runtime hosts, automatic cross-host synchronization and compute federation are separate architectural questions. The current multi-device journey is clients consuming one primary Runtime, not a distributed execution scheduler.

## Source Basis

- [`.nimi/spec/platform/product-lifecycle.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/product-lifecycle.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
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

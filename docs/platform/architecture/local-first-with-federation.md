# Local-First Architecture & Multi-Device Execution

Nimi supports executing AI workloads entirely on-device using configured local models, or leveraging cloud providers that the user explicitly configures. Being "local-first" does not imply anonymous or unrestricted offline operation: Nimi is rooted in user account identity, and authenticated sessions and authorization policies apply uniformly.

## Local Inference Execution

To execute AI tasks locally, prepare the runtime environment and model weights, configure and select the capability's machine Loadout, and specify the `Local` route in the App or shared LocalAgent AIConfig. At job submission time, Runtime locks that exact configuration. If local inference fails, the system will not silently or automatically fall back to cloud providers, ensuring users retain complete control over privacy, data flow, and API costs.

Cognition stores each agent's long-term memory locally via Runtime's typed bridge. Memory enablement is managed per agent; Knowledge V1 currently has no active data ingestion or query interface. Active conversation streams and local audit logs are maintained separately by Runtime.

## Offline Operational Boundaries

Existing local workflows can continue as long as required protected sessions, capability tokens, local model assets, and security policies remain valid. Cold restarts, new account sign-ins, fetching fresh Realm character sources, renewing authorization tokens, or issuing cloud inference calls naturally require network connectivity. Local caches serve as performance optimizations and cannot synthesize or forge successful Realm state mutations.

Authoritative world history, character identity assets, social graphs, and economic states are owned by Realm. Pending local intents do not constitute committed Realm mutations. Operating locally does not imply automatic audit log uploads or unprompted cross-device memory synchronization.

## Multi-Device Topology & Compute Federation

Each device runs an independent Runtime daemon and maintains its own hardware-specific loadouts. Sharing an account or character identity across devices via Realm does not automatically sync local hardware loadouts, in-flight conversation streams, or agent local memory stores.

Peer-to-peer compute federation represents a forward-looking architectural exploration, not a current networking layer or installation prerequisite. Applications must never point at private Runtime debugging ports on remote machines to simulate distribution; always use officially supported protected host interfaces.

## Source Basis

- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/runtime/local-compute.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/local-compute.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/cognition/memory.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/memory.authority.yaml)

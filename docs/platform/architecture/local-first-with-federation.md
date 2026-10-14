# Local-First Architecture & Multi-Device Execution

Nimi can run AI workloads on-device with local models or route requests to cloud providers that the user explicitly configures. "Local-first" does not mean anonymous or whole-product offline operation: Nimi is grounded in account identity, and protected sessions and authorization policies apply in every mode.

## Local Inference Execution

To run AI tasks locally, prepare the runtime environment and model weights, select the capability's local Loadout, and set the `Local` route in the app or shared LocalAgent `AIConfig`. When a job is submitted, Runtime locks that configuration. If local inference fails, Runtime never silently falls back to a cloud provider—keeping privacy, data flow, and API spend predictable. When a `Cloud` route is selected instead, requests may send relevant context to the configured provider.

Cognition stores each agent's long-term memory locally through Runtime's typed bridge. Memory is enabled per agent, while `Knowledge V1` currently has no active ingestion or query interface. Active conversation streams and local audit logs are maintained separately by Runtime.

## Offline Operational Boundaries

Ongoing local workflows can continue offline as long as the required protected session, capability tokens, local model assets, and security policies remain valid. Cold starts, new sign-ins, fetching fresh Realm character sources, renewing authorization tokens, and calling cloud models require network access. Local caches only optimize performance; they cannot forge committed Realm updates.

Character identity assets, social graphs, economic state, and world definitions (including planned World State/History contracts) belong to Realm. Unsynced local intents are not committed Realm changes. Running locally also does not trigger automatic audit log uploads or unprompted cross-device memory sync.

## Multi-Device Topology & Compute Federation

Each device runs its own Runtime daemon and hardware-specific loadouts. Signing into the same Realm account across machines shares character identities, but does not automatically sync local hardware loadouts, live conversation streams, or per-agent local memory.

Peer-to-peer compute federation is a future architectural direction, not a current networking layer or installation requirement. Applications must never connect directly to private Runtime debugging ports on remote machines to simulate distributed execution; always use supported protected host interfaces.

## Source Basis

- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/runtime/local-compute.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/local-compute.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/cognition/memory.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/memory.authority.yaml)

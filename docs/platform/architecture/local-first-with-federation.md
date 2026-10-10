# Local-First and Multiple Devices

Nimi can execute AI on your machine using configured local capabilities, or use cloud capabilities you explicitly configure. Local-first does not mean anonymous or unrestricted offline operation: Nimi requires an account, and protected access and current authorization still apply.

## Local Execution

Prepare the required assets and environment, save and select the capability's machine Loadout, and save Local intent in the App or shared LocalAgent AIConfig. At submission, Runtime captures that exact configuration. It does not automatically switch between Local and Cloud when a request fails.

Cognition stores each Agent's long-term Memory locally through Runtime's typed bridge. Memory enablement is Agent-specific; Knowledge V1 has no active ingestion or query path. Conversation and local audit remain separate Runtime records.

## When the Network Is Unavailable

Existing local work can proceed only while its required protected session, authorization, assets, and owner policies remain valid. A cold start, new login, Realm source acquisition, authorization renewal, or cloud call may require network access. A local cache cannot create account or Realm success.

Realm owns world, identity, social, and economy truth. Pending local intent is not a committed Realm mutation. No automatic audit upload or cross-device Memory synchronization is implied by local operation.

## Multiple Devices and Federation

Each device has its own Runtime and local configuration. An account or Character identity shared through Realm does not automatically share Loadouts, Conversation state, or Agent Memory between devices.

Peer-to-peer compute federation is a future direction, not a current transport or installation step. Do not point an App at another machine's private Runtime endpoint to emulate it. Use only the protected host and operations admitted for the current product.

## Source Basis

- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
- [`.nimi/spec/runtime/local-compute.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/local-compute.authority.yaml)
- [`.nimi/spec/runtime/rpc-foundations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/rpc-foundations.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/cognition/memory.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/memory.authority.yaml)

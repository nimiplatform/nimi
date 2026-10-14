# Realm Authoritative State and Architectural Boundaries

In Nimi's architecture, shared facts that span digital worlds—including global account identities, the social relationship graph, `WorldCore` metadata, character profiles and settings, and world lifecycle rules—are governed by Realm as the **Single Source of Truth**.

Desktop, Web, and third-party applications do not unilaterally define or mutate these global facts. Instead, they consume state projections from Realm through typed interfaces in `@nimiplatform/sdk`, while Runtime mediates credentials and proxy channels for protected App access.

## Division of Responsibilities

| Platform Component | Primary Responsibility |
| --- | --- |
| **Realm** | Holds service authority and persistent truth for global identities, social relationships, `WorldCore`, and character settings |
| **SDK (`@nimiplatform/sdk`)** | Typed client compiled from Realm OpenAPI specifications; provides schemas, retry policies, and fail-closed error handling without holding service authority |
| **Runtime** | Protected consumption intermediary (not a UI surface); manages credentials and proxy channels required for protected App requests |
| **Desktop / Web / Apps** | Consumer surfaces that present and act on state projections from Realm without overriding owner permissions |

## Core Invariants and Current Boundaries

- **Unified Authority**: Global account identities, friendship records, `WorldCore` definitions, and character settings are maintained centrally by Realm. Local clients and individual worlds do not run conflicting private ledgers.
- **Owner and Permission Boundaries**: Shared protocol interfaces and SDK methods never authorize an application or world to bypass the resource owner or mutate global state without permission.
- **Planned Contracts vs. Live Capabilities**:
  - `WorldState` and `WorldHistory` remain planned protocol contracts; they are not an executable full world-state ledger in current Home.
  - In creator economics, revenue split previews only reflect configuration previews—they do not represent live financial settlement, and creator payouts/withdrawals are not yet connected.
- **Fail-Closed Semantics**: If Realm connectivity is interrupted or a schema mismatch occurs, the platform surfaces explicit unavailable states rather than fabricating local success.

Application developers should access Realm exclusively through `@nimiplatform/sdk` (and Runtime-mediated channels where required), avoiding manual HTTP endpoint stitching or local mock state that mimics authoritative truth.

## Related Documentation

- [World State vs. History](/platform/worlds/state-vs-history)

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)

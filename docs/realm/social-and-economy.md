# Universal Social Graph and Economic Systems

Within Realm's platform governance, two foundational invariants are maintained: **how participants establish trusted relationships** (Social Graph), and **how digital value flows securely** (Economic System). Both systems operate on append-only event ledgers, guaranteeing transparent, verifiable records.

## Universal Social Graph

In the Nimi world network, user friendships are universal and indivisible across applications and realms:

| Dimension | Specification | Architectural Value |
| --- | --- | --- |
| **Storage Engine** | Realm Social Graph (`R-SOC-*`) | Globally distributed storage with instant state replication |
| **Topology** | Graph of unique ordered pairs | Exactly one authoritative relationship exists between any two users |
| **Cross-World Continuity** | Yes; accessible across every world | No need to re-add friends when traveling to new worlds |
| **Cross-App Shared State** | Yes; visible across all Nimi Apps | Prevents fragmented, isolated contact directories |

### Social Subsystem Responsibilities
- **Relationship & Gating**: Manages friend requests, approvals, blocks, and follows. Private direct messaging typically checks social graph preconditions.
- **Decoupled from Messaging**: The social subsystem governs "who is connected with whom"; conversational message streams are managed independently by Realm Chat.

## Platform Economic Systems

Platform economics follow a strict **append-only bookkeeping model**:

| Dimension | Specification | Architectural Rationale |
| --- | --- | --- |
| **Storage Engine** | Realm Economic Ledger (`R-ECON-*`) | Immutable distributed financial recordkeeping |
| **Event Typing** | Explicit typed entries (Purchase, Settlement, Withdrawal) | Guarantees transparent provenance for all value flows |
| **Correction Mechanism** | Ledger corrections occur exclusively via explicit Correction entries | Prohibits destructive row mutations, ensuring audit integrity |
| **Decoupling Compute & Assets** | Local inference compute costs remain decoupled from Realm assets | Local hardware resource consumption is isolated from virtual assets |

## Typical Scenarios

### 1. Cross-World Social Continuity
1. **Connect**: Alice and Bob connect in a fantasy realm; Realm registers the friendship record.
2. **Travel**: When Alice travels to a sci-fi space station world, Bob remains visible in her contact rail for immediate messaging.
3. **Layered Local Rules**: Worlds can layer local context rules (e.g., factional boundaries) on top of the underlying universal connection.

### 2. Automated Creator Royalties
1. **Asset Purchase**: A user purchases a world prop, emitting a structured `Purchase` event.
2. **Settlement Allocation**: Realm references the registered revenue split scheme to partition proceeds, committing a `Settlement` event.
3. **Wallet Derivation**: Creator wallet balances update automatically from the authoritative ledger, providing verifiable audit trails.

## Related Documentation

- [Creator Economy and Royalties](/realm/creator-economy)
- [Realm Realtime Chat Architecture](/realm/chat)

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)

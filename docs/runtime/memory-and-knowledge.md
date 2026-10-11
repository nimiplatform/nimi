# Agent Memory Architecture and Knowledge Boundaries

In Nimi's cognitive framework, long-term memory lifecycle and synthesis are governed by Cognition. Local Runtime manages LocalAgent operational identities, conversation turn staging, and acts as the secure mediation broker between agent sessions and memory stores.

## Memory Isolation and Ownership Principles

- **Independent Memory Banks**: Each LocalAgent maintains a dedicated, isolated Memory Bank. Distinct instances spawned from the same base Character maintain separate experiential memories.
- **World Invariance**: The authoritative history and lore of a digital world are anchored in Realm; an agent's personal memory cannot unilaterally mutate shared world lore or global states.
- **Session-Scoped Access**: All read/write operations targeting memory pass through Runtime's authorization gates. Client applications interact via structured SDK APIs, prevented by design from cross-tenant snooping.

## Context Assembly and Recall Mechanics

When a user initiates a conversation turn, the system stages context through clear phases:

1. **Context Capture**: Runtime extracts recent turn history and active conversation anchors.
2. **Semantic Recall**: Runtime requests relevant memories from Cognition matching the user's intent.
3. **Resilient Degradation**: Memory recall functions as an enhancement. If index warm-up is in progress or zero matches are found, the service returns an empty list, allowing generation to proceed without delay.
4. **Memory Consolidation**: As meaningful interactions conclude, Cognition evaluates conversation milestones and commits consolidated memories in the background.

## Memory Lifecycle Controls

- **Per-Agent Memory Toggle**: Each LocalAgent has an independent memory switch. Disabling it halts new ingestion and recall while safely preserving stored historical memories.
- **Memory Deletion**: Users can clear an agent's memory bank at any time; this removes all stored memories from recall while leaving raw conversation history and base character persona intact.
- **Account Deletion Cleanup**: Upon an observed typed Realm `ACCOUNT_DELETED` result, associated local memory stores for that account namespace are cleaned up locally on the current device.

## Source Basis

- [`.nimi/spec/runtime/memory-world.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/memory-world.authority.yaml)
- [`.nimi/spec/cognition/memory.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/memory.authority.yaml)
- [`.nimi/spec/cognition/runtime-bridge.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/runtime-bridge.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)

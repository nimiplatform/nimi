# Cross-Surface Continuity

When switching across windows, apps, or displays, conversations with your agent remain seamless. This continuity stems from authoritative state maintained jointly by Realm and Runtime—not from individual UI surfaces syncing state with one another.

Realm provides the persistent Character identity and Character Source. Runtime instantiates the LocalAgent, orchestrating its active conversation lifecycle, memory mediation, internal state machines, and visual presentation streams. Each surface consumes a bounded, read-only projection via the standard SDK, strictly constrained by active session authorization.

## Entities Exchanged Across Surfaces

The following entities can be shared across surfaces through official contracts:
- Stable Character references and session-scoped LocalAgent handles (`agentHandle`);
- An explicit Runtime Conversation Anchor;
- Committed dialogue turns and structured execution states;
- Authorized presentation artifacts and synthesized speech streams.

A receiving surface receives only references and read-only projections—never authoritative ownership of the underlying data.

## Subsystem-Local States

Window layout geometries, rendering pipeline contexts, media playback controls, application route parameters, user draft inputs, and other ephemeral UI states remain strictly local to the consumer. Local client caches accelerate visual rendering, but cannot replace authoritative state recovery or serve as sources of truth for conversations, memory, or permissions.

If authorization scopes change or a conversation anchor expires, client surfaces must handle the structured response returned by Runtime. Copying cached state from an adjacent window is never an acceptable fallback.

> [!NOTE]
> Long-term memory is managed by Cognition and isolated per agent; Runtime mediates authorized recall and updates. Knowledge V1 currently has no active public client interface.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)

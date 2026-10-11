# Cross-Domain Product Stories

These end-to-end scenarios demonstrate how subsystem ownership boundaries compose across real product workflows.

## Scenario 1: Creating a Character and Executing a LocalAgent

1. **Character Selection**: The user creates or selects a Character within a Realm-owned product surface.
2. **Source Generation**: Realm issues the formal Character Source definition.
3. **Local Instantiation**: Runtime instantiates an account-scoped LocalAgent from that definition on the user's machine.
4. **Authorized Projection**: Nimi Home or an independent App receives only the authorized LocalAgent projection via the SDK.
5. **Private State Isolation**: Runtime encapsulates conversation sessions, memory routing, inference loadouts, readiness states, and provider credentials within its secure boundary.

The product host does not mint character identities, and Realm does not execute the LocalAgent's local inference turns.

## Scenario 2: Continuing Conversations Across Multiple Surfaces

1. **Session Creation**: Runtime opens a Conversation and yields an explicit, unique Conversation Anchor.
2. **Multi-Surface Rendering**: Desktop shell renders committed turns and manages local ephemeral UI states.
3. **Embodiment Attachment**: Avatar binds a visual 2D/3D character model to that same authorized Conversation Anchor.
4. **Single Source of Truth**: Runtime remains the sole continuity authority; neither UI surface copies local chat logs to forge recovery state.

Renderer gaze tracking and physical motions remain managed locally by Avatar; dialogue text, speech synthesis, and presentation timing remain Runtime projections.

## Scenario 3: Launching a Scaffolded Application

1. **Protected Launch**: Nimi Home initializes the application through a local protected launch sequence.
2. **Intent Submission**: The application submits typed intents and the active session-scoped `agentHandle` through the standard SDK.
3. **Session Verification**: Runtime derives the user account, application identity, authorization scopes, and permissions directly from the secure session.
4. **Least-Privilege Return**: The application receives a validated, typed result—never receiving Realm JWTs, provider API keys, internal Runtime tokens, or account-wide agent rosters.

Direct SDK usage and scaffolded standalone apps adhere to the same underlying architectural contract. Subsystem integration rules represent platform invariants rather than user-selectable options.

> [!NOTE]
> Long-term memory is managed by Cognition and isolated per agent; Runtime mediates authorized recall and updates. Knowledge V1 currently has no active public client interface.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)

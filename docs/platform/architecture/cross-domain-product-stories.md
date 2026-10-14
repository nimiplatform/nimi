# Cross-Domain Product Stories

These end-to-end scenarios show how subsystem boundaries work together in real product flows.

## Scenario 1: Creating a Character and Running a LocalAgent

1. **Character Selection**: The user creates or selects a Character in a Realm-backed surface.
2. **Source Generation**: Realm issues the structured Character Source definition.
3. **Local Instantiation**: Runtime instantiates an account-scoped LocalAgent from that definition on the user's machine.
4. **Authorized Projection**: Nimi Home or an app receives only the authorized LocalAgent projection through the SDK.
5. **Private State Isolation**: Runtime keeps conversation sessions, Cognition-backed memory routing, inference loadouts, readiness state, and provider credentials inside its own boundary.

The host surface never mints character identities, and Realm never executes the LocalAgent's local inference turns.

## Scenario 2: Continuing a Conversation Across Surfaces

1. **Session Creation**: Runtime opens a conversation and returns an explicit, unique Conversation Anchor.
2. **Multi-Surface Rendering**: The Desktop host renders committed turns and manages lightweight local UI state.
3. **Embodiment Attachment**: Avatar binds a 2D or 3D character model to the same authorized Conversation Anchor.
4. **Single Continuity Authority**: Runtime remains the sole source of truth for conversation continuity; neither surface copies local chat logs to fabricate recovery state.

Avatar manages gaze tracking and physical motion locally, while Runtime projects dialogue text, speech synthesis, and presentation timing.

## Scenario 3: Launching a Scaffolded Application

1. **Protected Launch**: Nimi Home starts the application through a local protected launch sequence.
2. **Intent Submission**: The application submits typed operations and the session-scoped `agentHandle` through accepted SDK APIs.
3. **Session Verification**: Runtime derives the user account, application identity, and allowed operations directly from the protected host session.
4. **Least-Privilege Return**: The application receives a validated, typed result—never Realm JWTs, provider API keys, internal Runtime tokens, or account-wide agent rosters.

Direct SDK integrations and scaffolded standalone apps follow the same architectural contract. These boundary rules are platform invariants, not user-toggled settings.

> [!NOTE]
> Long-term memory is isolated per agent in Cognition and accessed through Runtime. `Knowledge V1` currently has no active public client interface.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)

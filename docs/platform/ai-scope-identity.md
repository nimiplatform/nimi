# AIConfig Ownership & Scoping

AI execution configurations (`AIConfig`) belong to a single canonical owner within the authenticated user account. System architecture recognizes exactly two kinds of owners: an independent App identified by its canonical application identity, and the shared Runtime LocalAgent subsystem shared across all LocalAgents in that account.

| Consumer Context | AIConfig Owner |
| --- | --- |
| A third-party App | That specific App |
| Nimi Chat in Home | The Desktop host App |
| Agent Chat (including different LocalAgents) | The shared Runtime LocalAgent subsystem |

Individual Agents, Conversations, modules, windows, tabs, or UI routes are not AIConfig owners. Switching between active characters does not switch to a per-agent model routing configuration. Agent-specific personality prompts, visual embodiment settings, and memory flags remain separate attributes decoupled from model routing.

## Configuration via the Protected Client

Applications read and persist their own configuration via `client.aiConfig`. The caller's account and App identity are automatically resolved from the authenticated session; callers never supply an owner selector. Conversely, managing the shared LocalAgent subsystem requires elevated `agent.configure` authorization and similarly accepts no arbitrary agent selector. Nimi Home displays and manages currently mapped App configurations.

Updates follow optimistic concurrency control: read the current configuration along with its opaque `revision` string, then submit the complete capability list carrying that revision. Capabilities omitted from the payload are cleared. If a revision conflict occurs, the application must fetch the latest configuration for user review rather than silently overwriting changes.

## Decoupling Configuration from Hardware Inference Engines

Each capability entry stores standardized feature requirements, portable defaults, and an explicit routing target (`Route`). The `Local` route serves as a routing marker; the `Cloud` route specifies the exact user Connector reference, `CapabilityImplementation`, and target model. Hardware-specific inference backends (`Local Loadout`) and active device engine bindings are managed separately by Runtime's machine store.

Applying an AI preset profile (`AIProfile`) merely populates editable form defaults. It does not automatically persist `AIConfig` or alter machine-level hardware selections. Saving application configuration and confirming machine-level inference engine changes are distinct steps. There is no implicit inheritance or fallback between different owners.

## Lifecycle Boundaries

An App's `AIConfig` lifecycle is bound to the App's lifecycle within the system. The shared LocalAgent configuration persists across the creation, selection, and deletion of individual agents. Ephemeral UI states or registration generations do not create new configuration owners.

For client implementation details, see [AIConfig Surface](/sdk/ai-config-surface); for user-facing management, see [AI Configuration](/desktop/ai-profile-config).

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)

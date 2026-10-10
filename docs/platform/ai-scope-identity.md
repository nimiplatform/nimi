# AIConfig Owner Identity

AIConfig belongs to one canonical owner within the authenticated account. There are two owner kinds: an App identified by its canonical App identity, and one Runtime LocalAgent subsystem shared by all LocalAgents in that account.

| Consumer | Configuration owner |
| --- | --- |
| A third-party App | That App |
| Nimi Chat in Home | The Desktop App |
| Agent Chat, including different LocalAgents | The shared Runtime LocalAgent subsystem |

An individual Agent, Conversation, feature, module, window, tab, or route is not an AIConfig owner. Changing the selected Agent does not switch to a per-Agent AI configuration. Agent-specific personality, presentation, and Memory enablement remain separate settings.

## Configure Through the Protected Client

An App reads and saves its own configuration through `client.aiConfig`. The protected session determines its account and App owner; the caller supplies no owner selector. The separately authorized shared LocalAgent configuration path requires `agent.configure` and has no Agent selector. Home may manage currently projected App owners.

Read the current configuration and its opaque revision, then save the complete capability list with that revision. Omitting a capability clears it. A conflict requires rereading and reviewing the current value; do not silently overwrite a newer choice.

## Configuration and Machine Selection

Each capability stores required standardized features, portable defaults, and an explicit route. Local is a route-only marker. Cloud stores the exact current-account Connector reference, CapabilityImplementation, and Driver-owned provider-model target. Local Loadouts and the machine's current selection belong to Runtime's separate machine store.

Applying an AIProfile produces editable prefill. It neither saves AIConfig nor changes a machine selection. Saving configuration and confirming machine-wide configuration changes are separate actions. There is no inheritance or automatic fallback between owners.

## Lifecycle

App AIConfig follows its App or product lifecycle. The shared LocalAgent configuration survives creation, selection, and deletion of individual Agents. UI state and registration generations do not create configuration owners.

See [AIConfig Surface](/sdk/ai-config-surface) for the App API and [AI Configuration](/desktop/ai-profile-config) for Home settings.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)

# Owner Domains

Nimi separates product truth by owner. A projection, host, package, App, docs
page, or implementation location does not silently acquire another domain's
truth.

| Domain | Owns | Does not own |
| --- | --- | --- |
| Platform | Cross-domain protocol and product owner boundaries | Realm truth, Runtime execution, App product behavior |
| Realm | Character, Character Source, World Source, social, economy, canonical World state and history | LocalAgent execution and local AI routing |
| Runtime | Local and Cloud AI consumption, LocalAgent, Conversation, Memory mediation, voice, readiness, credentials, local audit, App authorization | Realm Character or World truth; product UI |
| Cognition | Agent-private long-term Memory and derived retrieval; Knowledge V1 inactive | Conversation, authorization, AI execution |
| SDK | Typed public consumer projection for Runtime and Realm | Provider execution, Realm truth, host-private transport |
| Kit | Demand-driven shared UI and host composition | A reusable public capability catalog or owner-domain truth |
| Nimi Home / Desktop | Current product home, native host, product UI and interaction | Realm or Runtime authority |
| Avatar | Embodiment shell, renderer execution, playback, and renderer-local state | LocalAgent, Conversation and Memory mediation, AI routing |
| App | Its product behavior and private data | Account, grant, session, LocalAgent, provider, or Realm truth |

## Main owner transitions

| Transition | Meaning |
| --- | --- |
| Realm → Runtime | Realm-issued Character Source enables LocalAgent materialization |
| Realm → Runtime | Admitted World Source contributes execution context without moving World ownership |
| Runtime → SDK | Typed authorized LocalAgent and AI projection |
| SDK → App | Public capability use without private transport or proof custody |
| Runtime → Avatar | Typed presentation and voice input; rendering stays Avatar-local |
| Nimi Home → App | Protected launch and host composition; authorization remains Runtime-owned |

## Independently Scoped Capabilities

Registry-approved packages and local development follow the [App lifecycle](/start/#local-development-and-distribution). [Integrations](/runtime/integrations) have their own connection and permission contract. General Workflow, World Evolution, federation, and marketplace settlement do not become prerequisites for an unrelated admitted App operation.

Cognition owns Agent-private long-term Memory; Runtime mediates authorized delivery, recall, and management. Knowledge V1 has no active read, write, or public client path.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)

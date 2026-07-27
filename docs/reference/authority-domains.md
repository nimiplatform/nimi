# Owner Domains

Nimi separates product truth by owner. A projection, host, package, App, docs
page, or implementation location does not silently acquire another domain's
truth.

| Domain | Owns | Does not own |
| --- | --- | --- |
| Platform | Cross-domain protocol and product owner boundaries | Realm truth, Runtime execution, App product behavior |
| Realm | Character, Character Source, World Source, social, economy, canonical World state and history | LocalAgent execution and local AI routing |
| Runtime | Local and Cloud AI consumption, LocalAgent, Conversation, operational Memory and Knowledge, voice, readiness, credentials, local audit, App authorization | Realm Character or World truth; product UI |
| SDK | Typed public consumer projection for Runtime and Realm | Provider execution, Realm truth, host-private transport |
| Kit | Demand-driven shared UI and host composition | A reusable public capability catalog or owner-domain truth |
| Nimi Home / Desktop | Current product home, native host, product UI and interaction | Realm or Runtime authority |
| Avatar | Embodiment shell, renderer execution, playback, and renderer-local state | LocalAgent, Conversation, Memory, Knowledge, AI routing |
| App | Its product behavior and private data | Account, grant, session, LocalAgent, provider, or Realm truth |
| Simulator | Development qualification of selected App modules | Product hosting, platform readiness, or App truth |

## Main owner transitions

| Transition | Meaning |
| --- | --- |
| Realm → Runtime | Realm-issued Character Source enables LocalAgent materialization |
| Realm → Runtime | Admitted World Source contributes execution context without moving World ownership |
| Runtime → SDK | Typed authorized LocalAgent and AI projection |
| SDK → App | Public capability use without private transport or proof custody |
| Runtime → Avatar | Typed presentation and voice input; rendering stays Avatar-local |
| Nimi Home → App | Protected launch and host composition; authorization remains Runtime-owned |

## Non-blocking future capabilities

General Workflow, MCP, World Evolution, marketplace, Registry, Trust Tier,
public distribution, and settlement remain outside the current core loop.
Their absence is not a failure of Runtime, SDK, Nimi Home, Avatar, or ordinary
App readiness.

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/platform/app-ecosystem.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/app-ecosystem.authority.yaml)
- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`.nimi/spec/runtime/app-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/app-surface.authority.yaml)

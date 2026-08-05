# AIConfig and Machine Profiles

## Status: Desktop-Owned Configuration Surfaces

Desktop exposes two distinct configuration concerns:

- Agent Center presents owner-scoped `AIConfig` capability intent.
- Runtime configuration manages machine profiles, providers, engines, and local
  assets.

They must remain separate. Applying machine configuration does not create an
App- or Agent-visible execution binding.

## Agent Center AIConfig

For an exact App or Agent owner, the AIConfig section presents each admitted
capability and its Local or Cloud intent. Saving replaces that owner's complete
capability list through the authorized session.

| AIConfig owns | AIConfig does not own |
| --- | --- |
| Exact owner identity | Provider or model selection |
| Admitted capability | Machine route or connector |
| Local or Cloud intent | Engine or asset binding |
| Authorized overwrite action | Readiness, health, or fallback policy |

Local and Cloud are capability intents. They do not identify which model,
provider, connector, endpoint, or machine route will execute a request.

## Runtime Machine Profiles

Desktop may provide a separate administration UI for portable `AIProfile`
packages and machine-local resources. That UI can validate, import, install, or
remove Runtime configuration. The resulting state belongs to Runtime and may
influence Runtime's future implementation selection.

A machine profile is not copied into owner `AIConfig`, attached to an
`AIScopeRef`, or sent with an App request. Runtime chooses among its admitted
implementations when the request arrives.

## Reader Scenario: Set Agent Capability Intent

1. **Open Agent Center.** The session loads the exact Agent owner's complete
   `AIConfig`.
2. **Choose intent.** The user sets an admitted capability to Local or Cloud.
3. **Save.** The authorized overwrite action replaces the complete capability
   list for that owner.
4. **Invoke later.** The Agent submits identity, scenario content, and supported
   parameters. It does not submit a profile, model, route, or connector.
5. **Runtime executes.** Runtime interprets the intent against current machine
   configuration and returns a typed result or failure.

## Reader Scenario: Install a Machine Profile

1. **Open Runtime configuration.** The user inspects Runtime-owned profiles and
   assets.
2. **Install or update.** Runtime validates and applies the machine
   configuration.
3. **Keep owner intent unchanged.** No App or Agent configuration is rebound.
4. **Future request.** Runtime can consider the new machine state while retaining
   sole implementation-selection authority.

## Public Boundary

- Agent Center edits owner capability intent, not execution profiles.
- Runtime configuration manages machine resources, not App request controls.
- Desktop does not expose per-owner profile binding, model routing, connector
  selection, readiness, or fallback UI.
- Runtime-issued execution evidence may be displayed for diagnostics, but it
  cannot become the next request's input.

## Source Basis

- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)

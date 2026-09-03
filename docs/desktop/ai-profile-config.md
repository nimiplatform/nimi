# AIConfig and Machine Profiles

## Status: Desktop-Owned Configuration Surfaces

Desktop has two separate kinds of AI settings:

- Agent Center, where you set Local or Cloud intent per capability for
  a specific App or Agent.
- Runtime configuration, where you manage machine profiles, providers,
  engines, and local assets.

Keep the two apart in your mental model. Applying machine
configuration never creates an execution binding that an App or Agent
can see.

## Agent Center AIConfig

Pick an App or Agent owner, and the AIConfig section shows each
available capability with its Local or Cloud intent. Saving replaces
that owner's complete capability list, and it goes through the
authorized session.

| AIConfig owns | AIConfig does not own |
| --- | --- |
| Exact owner identity | Provider or model selection |
| Admitted capability | Machine route or connector |
| Local or Cloud intent | Engine or asset binding |
| Authorized overwrite action | Readiness, health, or fallback policy |

Local and Cloud are intents, not bindings. They never identify which
model, provider, connector, endpoint, or machine route will execute a
request.

## Runtime Machine Profiles

A separate administration UI handles portable `AIProfile` packages and
machine-local resources. You can validate, import, install, or remove
Runtime configuration there. The resulting state belongs to Runtime
and can influence which implementation Runtime picks later.

A machine profile is never copied into an owner's `AIConfig`, attached
to an `AIScopeRef`, or sent along with an App request. When a request
arrives, Runtime chooses among its available implementations.

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

## Key Points

- Agent Center edits your capability intent, not execution profiles.
- Runtime configuration manages machine resources, not App request
  controls.
- Desktop intentionally has no UI for per-owner profile binding, model
  routing, connector selection, readiness, or fallback.
- Runtime's execution evidence can be displayed for diagnostics, but
  it never becomes the next request's input.

## Source Basis

- [`.nimi/spec/desktop/ai-consumption.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/ai-consumption.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)

# AI Profile Execution

## Status: Runtime-Managed Machine Configuration

`AIProfile` is a desktop-portable configuration package. Runtime may project an
admitted profile into machine-local assets and descriptors, but an App does not
bind an execution request to that profile. App requests carry caller identity,
scenario content, and supported operation parameters; Runtime chooses the
implementation.

## Ownership Boundary

| Responsibility | Owner |
| --- | --- |
| Portable `AIProfile` schema and validation | Desktop kernel |
| Profile installation and machine-local projection | Desktop / Runtime administration |
| Local asset and device-resource management | Runtime |
| Owner capability intent (`AIConfig`) | Exact App or Agent owner |
| Implementation selection and scheduling | Runtime |
| Execution diagnostics and audit evidence | Runtime |

A `LocalProfileDescriptor` is machine configuration. It is not an App-facing
model, route, connector, target, fallback policy, or reusable execution
binding. The SDK does not translate an App's capability intent into one of
these request controls.

## App Call Path

1. The exact owner stores Local or Cloud capability intent in `AIConfig`.
2. The App invokes an admitted capability with identity, scenario content, and
   supported parameters.
3. Runtime evaluates its current machine configuration and selects an admitted
   implementation.
4. Runtime returns a typed result or typed failure. Any implementation details
   included in Runtime-issued diagnostics remain output evidence.

Changing an `AIProfile` can change how Runtime services later requests, but it
does not rewrite owner intent and does not grant the caller implementation
selection authority.

## Machine Diagnostics

Runtime administration may report daemon reachability, installed-asset state,
resource pressure, and profile installation failures. Internal resolution and
scheduler probes can support those diagnostics. They do not become per-model or
per-route readiness controls in an App, and an App does not run a preflight to
choose an execution target.

Execution evidence is immutable audit information about what Runtime did. A
caller must not feed a resolved model, route decision, connector, endpoint, or
scheduling judgement back into another request as authority.

## Scope Identity

`AIScopeRef` identifies the owner and surface for scoped configuration or
records. It does not identify an execution implementation. A scope can retain
Runtime-issued evidence without turning that evidence into a profile binding or
request target.

See [AI Scope Identity](/platform/ai-scope-identity) for the identity contract
and [AIConfig Surface](/sdk/ai-config-surface) for owner capability intent.

## Reader Scenario: Install a Local Profile

1. A machine administrator validates and installs an admitted portable profile.
2. Runtime resolves the required local assets and records installation status.
3. An App keeps only its Local capability intent; it does not receive a model or
   route selector.
4. On the next capability request, Runtime decides whether the installed profile
   can supply an admitted implementation and either executes or fails closed.

## Reader Scenario: Review Execution Evidence

1. An App submits a capability request without implementation controls.
2. Runtime chooses and executes an implementation.
3. Runtime emits typed diagnostics or audit evidence for the completed attempt.
4. The owner may display or retain that evidence, but cannot reuse it to pin a
   later request.

## Key Points

- `AIProfile` and `LocalProfileDescriptor` are machine-configuration concepts.
- `AIConfig` is owner-scoped capability intent, not an execution profile.
- App requests contain no provider, model, route, connector, endpoint, target,
  fallback policy, profile descriptor, or readiness probe.
- Runtime alone owns implementation selection, resource scheduling, and
  execution evidence.
- Runtime-wide reachability does not imply readiness for a particular model or
  route.

## Source Basis

- [`.nimi/spec/runtime/ai-provider.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/ai-provider.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)

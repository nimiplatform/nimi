# Nimi App Ecosystem Responsibility Entrypoint

Status: non-authoritative AI handoff.

Product authority lives under `.nimi/spec/**`. Repository and nearest
`AGENTS.md` files define working constraints. This page is a compact
owner map, not a second specification, migration record, or validation
ledger.

## Core Responsibility Chain

`Realm or Runtime owner → SDK typed access → Kit reusable UI → App composition`

| Concern | Owner |
| --- | --- |
| Durable Character identity, world truth, history, account/social truth | Realm |
| LocalAgent materialization and lifecycle | Runtime |
| Conversation, operational Memory, Knowledge, provider routing, jobs | Runtime |
| Typed App-facing access and transport projection | SDK |
| Reusable UI, shell, accessibility, tokens, and headless primitives | Kit |
| Product-specific screens, user-intent wiring, and ephemeral UI state | App |
| Current first-party home and native host composition | Nimi Home / Desktop |
| Embodiment presentation | Avatar |
| Developer qualification and deterministic effects | Simulator |

Character and LocalAgent are related but distinct. Realm owns the
durable Character. Runtime materializes that Character as a LocalAgent
for execution. Projection records, App bindings, Desktop stores, and
Avatar instances do not become identity owners.

## App Authorization

- App access to Runtime is derived from the active session and app
  identity.
- A scaffolded App does not receive Realm JWTs, provider credentials,
  or independent Runtime proof.
- Apps consume admitted SDK or host surfaces; they do not call Realm or
  Runtime private APIs.
- App-local configuration, docs, and tests never become product
  authority.

Direct SDK use and a scaffolded App are integration paths, not
user-facing product profiles.

## Consumer Boundaries

- Runtime owns execution, readiness, LocalAgent, Conversation, Memory,
  Knowledge, provider/model routing, audit outcomes, and fail-closed
  enforcement.
- Realm owns durable world and Character truth. Runtime and Apps use
  admitted Realm consumer surfaces.
- SDK owns typed access and developer ergonomics, never platform truth.
- Kit owns reusable presentation primitives only when real consumers
  need them; it does not prebuild a speculative public feature catalog.
- Apps own product composition and ephemeral state. They do not cache
  themselves into a new owner.
- Nimi Home is the current host, not an irreplaceable cross-platform
  authority.
- Avatar renders owner projections; it does not directly drive or take
  ownership of Character/LocalAgent execution.
- Simulator qualifies developer-facing modules; it is not the current
  core platform or a production authority.

## Deferred And Isolated Capabilities

General Workflow, MCP, World Evolution, Marketplace, public Registry,
Trust Tier, distribution, and commercial settlement are not current
Runtime or Windows-loop prerequisites. Existing public-distribution
design remains isolated unless it directly conflicts with the owner map
above.

## Implementation Rules

- Follow the affected `.nimi/spec/**` owner container before changing
  product semantics.
- Fail closed on contract violations.
- Do not add legacy shims, dual paths, pseudo-success, raw private API
  bypasses, provider/model hardcoding, or forwarding shells.
- Start at the observed consumer and move upstream only when the real
  trace requires it.
- Test product behavior at the nearest owner. Do not substitute
  migration gates, checker-of-checker systems, file inventories, or
  evidence-completeness checks for owner behavior.

## Read First

1. `AGENTS.md`
2. The nearest descendant `AGENTS.md`
3. The exact affected authority container under `.nimi/spec/**`
4. `.nimi/methodology/authority-authoring.yaml` before authority edits

For app boundaries, the usual starting containers are:

- `.nimi/spec/platform/app-ecosystem.authority.yaml`
- `.nimi/spec/runtime/app-surface.authority.yaml`
- `.nimi/spec/runtime/agent-service.authority.yaml`
- `.nimi/spec/runtime/memory-world.authority.yaml`
- `.nimi/spec/sdks/client-core.authority.yaml`
- `.nimi/spec/sdks/feature-clients.authority.yaml`

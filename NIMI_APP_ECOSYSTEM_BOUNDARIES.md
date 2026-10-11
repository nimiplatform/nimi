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
| Persistent Character identity, authoritative world state, history, account/social state | Realm |
| LocalAgent execution runtime, materialization, and process lifecycle | Runtime |
| Conversations, committed events, memory access authorization, provider routing, jobs | Runtime |
| Canonical long-term memory and knowledge, provenance, ranking, and retention | Cognition |
| Typed client interfaces, cross-process transport, and developer APIs | SDK |
| Reusable UI components, design tokens, accessibility, and shell foundations | Kit |
| Application-specific workflows, user-facing views, and local state management | App |
| Primary desktop shell, user workspace, and app supervisor | Nimi Home / Desktop |
| Visual embodiment presentation and animation rendering | Avatar |

Character and LocalAgent are related but distinct concepts. Realm manages the
persistent Character definition, persona attributes, and social identity. Runtime
instantiates that Character as an active LocalAgent execution instance for active sessions.
UI projections, App bindings, and Avatar visual renderers consume this state without creating
parallel identity truth.

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

## Subsystem Responsibilities
- Runtime manages execution, LocalAgent instances, conversational sessions, committed events, memory access authorization, provider/model routing, and fail-closed channel access controls.
- Cognition manages long-term memory and knowledge structures. V1 implements long-term memory and bounded agent source custody. Runtime and Apps do not maintain parallel, conflicting long-term stores.
- Realm manages authoritative world definitions and persistent Character identities. Runtime and Apps consume these via standard Realm SDK interfaces.
- SDK provides typed client abstractions, transport handling, and developer ergonomics, maintaining strict decoupling from internal backend state.
- Kit provides reusable UI components, design tokens, and shared presentation primitives driven by actual app requirements.
- Apps manage application-specific views, local workflows, and ephemeral user interface state.
- Nimi Home serves as the desktop workstation and application supervisor.
- Avatar renders character visual projections (2D/3D embodiments) without altering character execution logic or identity state.

## Deferred And Isolated Capabilities

General Workflow, MCP, World Evolution, Marketplace, Trust Tier, and commercial
settlement are not current Runtime-core prerequisites. App package lifecycle is
source-specific: verified packages use approved Registry descriptors, immutable
local imports do not acquire Registry trust, and Developer Mode remains a
non-package path. The current Windows x86_64 and macOS arm64 package entry points
are governed by P-NAPP-040a; implementation does not establish combined product
acceptance or public release readiness. Ordinary repair and package lifecycle
on other platforms remain unavailable.

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

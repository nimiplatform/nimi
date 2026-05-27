# Platform Kit

> Status: Running today. `@nimiplatform/kit` is the shipped
> single-package authority for cross-app shared platform
> infrastructure (`P-KIT-001..P-KIT-099`).

The **Platform Kit** is the cross-surface layer that holds the design
tokens, primitives, foundation modules, feature modules, logic
modules, and infra modules that governed apps consume. It is the
answer to: "where does the shared visual + interaction language live?"

Kit is one package. Every Nimi app reaches into it through subpath
imports. Apps do not duplicate what Kit covers.

## Package Authority

| Rule | Value |
| --- | --- |
| Authority package | `@nimiplatform/kit` (single) |
| Subpath exports | `/ui`, `/auth`, `/core/*`, `/telemetry/*`, `/features/*` |
| Source location | `kit/` at repo root, peer to `apps/`, `sdk/`, `runtime/` |
| Sub-module workspace manifests | NOT permitted (single workspace package) |
| Apps may duplicate Kit capabilities? | No |

A Kit sub-module that wants to ship must register in
`tables/nimi-kit-registry.yaml` with declared `subpath`, `kind`
(`foundation` / `feature` / `logic` / `infra`), `dependencies`,
`peer_dependencies`, `exports`, `admission_status`, `owner`. New
sub-modules register before any consumer can import.

## Module Kinds

| Kind | Purpose | Example |
| --- | --- | --- |
| `foundation` | Tokens + primitives + themes (Kit's bedrock) | `ui` (`@nimiplatform/kit/ui`) |
| `feature` | Bounded feature surface (components + hooks + adapters within one public surface) | `auth` (`@nimiplatform/kit/auth`) |
| `logic` | Pure-logic utility (no UI / no CSS) | `core` (`@nimiplatform/kit/core/*`) |
| `infra` | Infrastructure: telemetry, error boundaries, host glue | `telemetry`, `shell/tauri` |

## Layer Boundaries

| Layer | Imports allowed | Imports forbidden |
| --- | --- | --- |
| Kit sub-module | Other Kit sub-modules per declared dependencies | App-layer code (`apps/**`); runtime internal (`runtime/internal/**`) |
| App | Kit through admitted subpath imports | Kit-internal paths bypassing the public subpath |

`kit/shell/tauri/**` is admitted as a non-npm Rust crate consumed via
Cargo path dependency. It does not have `package.json` exports and
does not carry an independent workspace package manifest.

## What Kit Owns

| Concern | Sub-module |
| --- | --- |
| Design tokens + primitives + themes (visual foundation) | `ui` |
| Auth components + hooks + storage + adapters | `auth` |
| Shared env / capability detection / OAuth helpers | `core` |
| Renderer-side telemetry + error boundaries | `telemetry` |
| Tauri host glue (runtime bridge, daemon lifecycle, session logging, oauth commands) | `shell/tauri` |

For the design-language depth see [Design Pattern](/platform/kit/design-pattern).
For the material-token catalog see [Nimi UI Material](/platform/kit/nimi-ui-material).

## What Kit Does Not Own

- Per-app layout (each app composes Kit primitives in its own way)
- App-specific UX or product flows
- Runtime semantic authority (those are runtime/cognition contracts)
- Realm domain truth
- Backend execution

Kit provides the building blocks. Apps assemble.

## Reader Scenario: A Consumer Wants Buttons That Look Right

A consumer app wants its UI to match the shared Nimi interaction
language.

1. **Consume Kit primitives.** The app imports
   `@nimiplatform/kit/ui` for shared `<Button>`, `<Surface>`,
   `<Dialog>`, etc.
2. **Use semantic tokens.** Components consume `--nimi-*` CSS custom
   properties; do not redefine them.
3. **Theme follows shared scheme.** The app imports the shared light /
   dark CSS plus exactly one app accent pack from
   `@nimiplatform/kit/ui/themes/*-accent.css`.
4. **Visual consistency.** The consumer UI inherits the admitted
   primitives and tokens automatically.

The consumer did not redefine button variants. It composed admitted
primitives.

## Reader Scenario: An App Adds A Feature That Already Exists In Kit

An app needs OAuth flow handling.

1. **Check Kit first.** `@nimiplatform/kit/auth` provides auth
   components + hooks, parameterized through `AuthPlatformAdapter`.
2. **Inject the adapter.** App provides the platform-specific
   adapter (native shell / browser).
3. **Use Kit's surface.** The app does not implement OAuth from
   scratch.

This rule (P-KIT-001) keeps the surface area honest: Kit's job is to
prevent N apps from each writing their own auth.

## Reader Scenario: Adding A New Kit Sub-Module

A maintainer wants to add a new shared sub-module.

1. **Register first.** A new row lands in
   `tables/nimi-kit-registry.yaml` with the required fields and
   `admission_status`.
2. **Pick a kind.** `foundation` / `feature` / `logic` / `infra`.
3. **Add source under `kit/<subpath>`.** Single workspace package;
   no independent manifest.
4. **Consumers may import.** Only after registration; the boundary
   is enforced.

Sub-modules cannot ship dark, undocumented surface area.

## What Kit Does Not Do

- It does not let apps redefine its primitives or tokens.
- It does not allow N parallel design systems.
- It does not consume app-layer code.
- It does not consume runtime internal code.
- It does not let provider-specific or app-specific UX leak into
  shared primitives.

## Boundary Summary

| Concern | Owner |
| --- | --- |
| Single-package authority + subpath registry | `P-KIT-001..P-KIT-002` |
| Source location + boundary | `P-KIT-003` |
| Foundation / feature / logic / infra module kinds | `P-KIT-010..P-KIT-041` |
| Design pattern (visual + interaction contracts) | `P-DESIGN-*` (separate page) |
| Material taxonomy + tokens | `nimi-ui-material-contract.md` (separate page) |

## Source Basis

- [`.nimi/spec/platform/kernel/kit-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/kit-contract.md)
- [`.nimi/spec/platform/kernel/tables/nimi-kit-registry.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/tables/nimi-kit-registry.yaml)
- [`.nimi/spec/platform/kernel/design-pattern-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/design-pattern-contract.md)
- [`.nimi/spec/platform/kernel/nimi-ui-material-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/nimi-ui-material-contract.md)

# Local Environment Projection

> Status: Standardized core contract; public capabilities are gated by official SDK package exports.

The Local Environment Projection contract governs **how application developers safely consume local environment state and dependency readiness evaluated by Runtime**—and strictly restricts guessing readiness via out-of-band heuristics or bypassing platform boundaries.

## Export Boundary

Supported SDK public capabilities are exposed strictly via explicit package exports in `package.json` and typed root-client surfaces. Product semantics are governed by canonical platform specifications; package manifests project these semantics for consumer use. Applications cannot introduce unauthorized imports by convention.

## Key Forbidden Paths

| Forbidden Path | Rationale & Architectural Rule |
| --- | --- |
| `runtime/internal/**` | Runtime private implementation; applications must consume official SDK clients exclusively |
| `kit/internal/**` | Kit private internals without backwards-compatibility guarantees |
| App-layer code (`apps/**`) of other apps | Applications remain decoupled and must not depend on another app's internal business code |

## Typical Scenario: An Application Queries the Local Environment Setup Plan

An application wishes to present the environment readiness and model setup progress to the user:

1. **Instantiate client**: Use the root SDK client or `@nimiplatform/sdk/runtime`.
2. **Query projected state**: Read the setup plan, selected model assets, activation gates, and dependency jobs via standard environment projection helpers.
3. **Preserve Runtime authority**: SDK helpers faithfully reflect strongly-typed Runtime state; applications must not guess readiness by scanning filesystem directories, inspecting Python virtualenvs, probing `PATH` variables, or polling local engine ports directly.
4. **Retired compatibility paths fail closed**: Legacy experimental subpaths (such as ad-hoc `local-env` paths) fail closed unless formally admitted and exported.

Attempts to invoke `import { internal } from '@nimiplatform/sdk/runtime/internal'` trigger immediate compilation errors.

## Architectural Boundaries

- Applications cannot access `runtime/internal/**`.
- Applications cannot bypass Runtime private boundaries.
- Applications cannot fork local environment management or state machines within client application layers.
- Ad-hoc conventions outside formal specification cannot introduce new integration boundaries.

## Source Basis

- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)

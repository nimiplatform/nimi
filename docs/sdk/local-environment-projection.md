# Local Environment Projection

## Status: Admitted Contract; Release-Gated Surface

The local environment projection contract is admitted at the SDK kernel level.
The full developer-facing projection surface is usable only when present in SDK
package exports.

## What This Page Covers

The Local Environment Projection contract governs **how app developers may
consume Runtime-projected local environment state** — and what they may not
infer or bypass. Public export admission is closed; deviation fails closed.

## Export Boundary

Admitted SDK public exports live in the TypeScript target export map. Each
entry declares:

| Field | Purpose |
| --- | --- |
| Export id | Stable identity |
| Public entry | Explicit admitted import path or root-client surface |
| Owner boundary | Which SDK surface owns the export |
| Rationale | Why this boundary exists |

The catalog is closed. Apps cannot invent new exports by
convention.

## Key Forbidden Paths

| Forbidden | Why |
| --- | --- |
| `runtime/internal/**` | Runtime private surface; apps consume admitted SDK clients only |
| `kit/internal/**` | Kit private surface |
| App-layer code (`apps/**`) from another app | Apps do not depend on other app-layer code |

## Reader Scenario: App Reads A Local Environment Plan

An app author wants to show a Runtime-resolved local setup plan.

1. **App creates a client.** It uses the root SDK client or
   `@nimiplatform/sdk/runtime`.
2. **App calls the projection.** It reads the Runtime-projected plan, selected
   sources, activation gate, or dependency jobs through admitted runtime local
   environment helpers.
3. **SDK preserves Runtime truth.** The helper returns typed Runtime
   projection state; it does not infer readiness from filesystem, Python, PATH,
   endpoint, package-manager, or local engine details.
4. **Removed compatibility paths fail closed.** There is no public `local-env`
   SDK subpath unless it is explicitly admitted in the TypeScript target export
   map.

If the app tried `import { internal } from '@nimiplatform/sdk/runtime/internal'`,
the boundary check rejects.

## What This Does Not Do

- It does not let apps reach `runtime/internal/**`.
- It does not let apps call SDK runtime private internals.
- It does not let apps fork local environment access through
  app-layer code.
- It does not allow new boundaries by convention.

## Source Basis

- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
- [`config/sdks-typescript-target-export-map.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/sdks-typescript-target-export-map.yaml)
- [`.nimi/spec/sdks/client-core.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/client-core.authority.yaml)

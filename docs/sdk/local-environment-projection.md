# Local Environment Projection

## Status: Admitted, in build-out

The local environment projection contract + the import boundary
table (`tables/import-boundaries.yaml`) are admitted at the SDK
kernel level. The full developer-facing projection surface is in
active build-out.

## What This Page Covers

The Local Environment Projection contract governs **what app
developers may import from the local environment** — and what they
may not. The closed import boundary catalog is admitted; deviation
fails closed.

## Import Boundary Catalog

Admitted import boundaries live in
`tables/import-boundaries.yaml`. Each entry declares:

| Field | Purpose |
| --- | --- |
| Boundary id | Stable identity |
| Allowed imports | Explicit list of admitted import paths |
| Forbidden imports | Explicit list of forbidden import paths |
| Rationale | Why this boundary exists |

The catalog is closed. Apps cannot invent new boundaries by
convention.

## Key Forbidden Paths

| Forbidden | Why |
| --- | --- |
| `runtime/internal/**` | Runtime private surface; apps consume admitted SDK clients only |
| `kit/internal/**` | Kit private surface |
| App-layer code (`apps/**`) from another app | Apps do not depend on other app-layer code |

## Reader Scenario: App Imports A Capability

An app author wants to use an admitted local capability.

1. **App imports.** `import { foo } from '@nimiplatform/sdk/local-env'`.
2. **Boundary check.** Per the import boundary catalog, `local-env`
   is an admitted import path.
3. **App uses.** Through admitted typed surface.

If the app tried `import { internal } from '@nimiplatform/sdk/runtime/internal'`,
the boundary check rejects.

## What This Does Not Do

- It does not let apps reach `runtime/internal/**`.
- It does not let apps call SDK runtime private internals.
- It does not let apps fork local environment access through
  app-layer code.
- It does not allow new boundaries by convention.

## Source Basis

- [`.nimi/spec/sdk/kernel/local-environment-projection-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/local-environment-projection-contract.md)
- [`.nimi/spec/sdk/kernel/tables/import-boundaries.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/tables/import-boundaries.yaml)
- [`.nimi/spec/sdk/kernel/boundary-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdk/kernel/boundary-contract.md)

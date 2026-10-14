# Kit Feature: Model Config

The public Nimi configuration presentation toolkit for canonical App AIConfig, shared LocalAgent AIConfig, and first-party machine Loadout surfaces. Every mount declares exactly one owner and consumer context.

## Public Surfaces

- `@nimiplatform/kit/features/model-config`
- `@nimiplatform/kit/features/model-config/headless`
- `@nimiplatform/kit/features/model-config/ui`

### Styling Requirements

Import Kit's Tailwind 4 stylesheet and a foundation theme in the same CSS compilation entry as `@import 'tailwindcss'` (see the package README's Theming section). Importing Kit CSS through a separate JavaScript entry can leave model-picker layout utilities uncompiled even when ordinary App styles work.

## Ownership Boundary

- **Kit owns**: Controlled presentation, draft interaction, and effective-resource projection.
- **Host injects**: Canonical reads, bounded options, and whole-object mutations.
- **Out of scope for Kit**: Kit never persists AIConfig, invents an owner, mutates machine selection from an App or Agent surface, or presents execution readiness.

### AIConfig Hub and Picker Flow

The AIConfig presentation provides the standard AI Model hub, capability detail, Active Model trigger, and Local/Cloud picker flow. A Host may open directly into an initial capability detail view while preserving Back navigation to the full hub.

- **Local selection**: Projects the owner's exact Loadout options.
- **Cloud / Connector selection**: Every covered App uses the same options manager:
  1. The user selects a Connector.
  2. Model Config requests that Connector's provider-model targets.
  3. A single Save atomically commits the exact `connectorRef`, implementation, `providerModelId`, and Connector-scoped `remoteModelCatalogId`.

If a reloaded intent has a missing or inconsistent exact target identity, it remains unconfigured and is never repaired by provider-name inference. The retired `core/model-config` scoped configuration ontology is not restored.

### Current-Machine Local Action

The Kit-owned current-machine Local action is constructed from the surface's explicit `CapabilityContracts`, observed whole-owner configuration, opaque revision, options reader, and whole-owner overwrite manager. It remains unmounted until the single active product cutover and enforces the following invariants:

- Reads the current Local selection for every explicit contract exactly once.
- Withholds all mutations if any projection is unavailable or invalid.
- Preserves all existing intent fields except the selected covered routes, appending any missing selected intents in explicit order.
- Skips canonical no-ops and performs a single compare-and-swap overwrite when changes are valid.
- Never reads a global capability catalog or mutates Loadouts, Connectors, ModelAssets, another App, or another AIConfig owner.

## Verification

```bash
pnpm --filter @nimiplatform/kit build
pnpm --filter @nimiplatform/kit test
pnpm check:nimi-kit
```

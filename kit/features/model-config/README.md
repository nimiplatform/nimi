# Kit Feature: Model Config

## What It Is

The public Nimi configuration presentation toolkit for canonical App AIConfig,
shared LocalAgent AIConfig, and first-party machine Loadout
surfaces. Every mount declares exactly one owner and consumer context.

## Public Surfaces

- `@nimiplatform/kit/features/model-config`
- `@nimiplatform/kit/features/model-config/headless`
- `@nimiplatform/kit/features/model-config/ui`

## Ownership Boundary

Kit owns controlled presentation, draft interaction, and effective-resource
projection. Hosts inject canonical reads, bounded options, and
whole-object mutations. Kit never persists AIConfig, invents an owner, mutates
machine selection from an App/Agent surface, or presents execution readiness.

The AIConfig presentation keeps the established AI Model hub, capability
detail, Active Model trigger, and Local/Cloud picker flow. A host may request
one initial capability detail while preserving Back navigation to the complete
hub. Local projects the
owner's exact Loadout options. Every covered App uses the same options manager:
the user selects a Connector, then Model Config requests that Connector's
provider-model targets. One Save atomically commits the exact `connectorRef`,
implementation, `providerModelId`, and Connector-scoped
`remoteModelCatalogId`. Reloaded intent
with missing or inconsistent exact target identity remains not configured and
is never repaired by provider-name inference.

The retired `core/model-config` scoped configuration ontology is not restored.

## Verification

- `pnpm --filter @nimiplatform/kit build`
- `pnpm --filter @nimiplatform/kit test`
- `pnpm check:nimi-kit`

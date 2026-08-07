# Kit Feature: Model Config

## What It Is

The public Nimi configuration presentation toolkit for canonical App AIConfig,
shared LocalAgent AIConfig, and first-party Machine Local AI Configuration
surfaces. Every mount declares exactly one owner and consumer context.

## Public Surfaces

- `@nimiplatform/kit/features/model-config`
- `@nimiplatform/kit/features/model-config/headless`
- `@nimiplatform/kit/features/model-config/ui`

## Ownership Boundary

Kit owns controlled presentation, draft interaction, local-selection status
projection, and explicit Cloud confirmation. Hosts inject canonical reads and
whole-object mutations. Kit never persists AIConfig, invents an owner, mutates
machine selection from an App/Agent surface, or presents execution readiness.

The AIConfig presentation keeps the established AI Model hub, capability
detail, Active Model trigger, and Local/Cloud picker flow. Local projects the
Machine's current selection and deep-links to the Machine Local AI owner; it
does not list or switch machine models. In first-party Cloud flows, the host
must first supply configured Connectors, the user chooses one, and only then
does Model Config request that Connector provider's implementation/model
targets. An empty or failed Connector projection exposes no Cloud models and
may deep-link to the host's Connector configuration. Connector choice scopes
discovery only; model confirmation and optional ConnectorGrant binding remain
separate explicit actions.

The retired `core/model-config` scoped configuration ontology is not restored.

## Verification

- `pnpm --filter @nimiplatform/kit build`
- `pnpm --filter @nimiplatform/kit test`
- `pnpm check:nimi-kit`

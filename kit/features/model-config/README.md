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

The retired `core/model-config` scoped configuration ontology is not restored.

## Verification

- `pnpm --filter @nimiplatform/kit build`
- `pnpm --filter @nimiplatform/kit test`
- `pnpm check:nimi-kit`

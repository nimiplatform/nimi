# Kit Feature: Model Picker

## What It Is

Public, non-committing candidate discovery and choice UI. The current owner
supplies typed candidates; Model Picker provides search, filtering, grouping,
details, draft selection, and explicit confirmation.

The route presentation preserves the compact Local/Cloud tabs and model list
interaction. Owner-provided item actions may deep-link to the canonical owner;
they do not turn Model Picker into a mutation surface.

Owners may declare route tabs before candidates exist and inject route-local
controls such as a Connector selector. A candidate outside the active route is
never confirmable, and changing an upstream control may explicitly clear the
dialog draft before the owner reloads candidates.

## Public Surfaces

- `@nimiplatform/kit/features/model-picker`
- `@nimiplatform/kit/features/model-picker/headless`
- `@nimiplatform/kit/features/model-picker/ui`

## Ownership Boundary

Model Picker never reads Runtime or Realm directly and never commits AIConfig,
Machine Local AI Configuration selection, exact bindings, credentials, or
routes. A confirmed result is still only a typed choice returned to the owner.

The retired `features/model-picker/runtime` route-provider surface is not
restored.

## Verification

- `pnpm --filter @nimiplatform/kit build`
- `pnpm --filter @nimiplatform/kit test`
- `pnpm check:nimi-kit`

# Kit Feature: Model Picker

## What It Is
Reusable browse-and-select surface for runtime model catalogs with shared filtering, grouping, and details.

## Public Surfaces
- `@nimiplatform/nimi-kit/features/model-picker`
- `@nimiplatform/nimi-kit/features/model-picker/headless`
- `@nimiplatform/nimi-kit/features/model-picker/ui`
- `@nimiplatform/nimi-kit/features/model-picker/runtime`
- Current surfaces:
  - `headless`: active
  - `ui`: active
  - `runtime`: active for runtime control-plane catalog access
  - `realm`: none

## When To Use It
- Reuse model selection UI and headless filtering logic.
- Bind runtime catalog APIs without rebuilding browse/select UX.
- Reuse `useModelPicker(...)` when the app owns its own model source but should not reimplement filtering, grouping, and selected-detail state.
- Reuse `useRuntimeModelPicker(...)` and `RuntimeModelPickerPanel` when the app should consume runtime control-plane catalog data directly.

## What Stays Outside
- App-specific model admin overlays and provider editing flows.
- YAML editors, provider CRUD, and other admin-only catalog tooling.
- Realm business services.

## Current Consumers
- `desktop`
  Uses `model-picker/runtime` and `model-picker/ui` for runtime catalog browse/select/detail panels in runtime config.
- `relay`
  Uses `model-picker/headless` and `model-picker/ui` for route-level model selection over relay-discovered local/cloud model lists.

## Verification
- `pnpm --filter @nimiplatform/nimi-kit test`
- `pnpm check:nimi-kit`

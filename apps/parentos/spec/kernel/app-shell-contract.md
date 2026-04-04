# App Shell Contract

> Owner Domain: `PO-SHELL-*`

## Scope

This contract governs the ParentOS Phase 1 desktop shell, bootstrap path, route registration, and nurture-mode settings flow.

Covered Phase 1 features from `feature-matrix.yaml`:

- `PO-FEAT-009` nurture mode settings

Governing fact sources:

- `tables/routes.yaml`
- `tables/nurture-modes.yaml`
- `tables/local-storage.yaml#families`
- `tables/local-storage.yaml#children`
- `tables/local-storage.yaml#app_settings`

## PO-SHELL-001 Bootstrap Order

The app shell bootstrap must execute in this order:

1. initialize SDK access required by the desktop app
2. initialize SQLite-backed local storage
3. load family and child records from local storage
4. derive the active child from persisted local state or the first available child
5. render route content only after spec-backed knowledge-base assets are available

Bootstrap is local-first. ParentOS must not require cloud profile hydration before local family and child data become usable.

## PO-SHELL-002 Route Registration

Route registration must be a strict projection of `tables/routes.yaml` for Phase 1 routes.

- `gated: true` routes must stay out of the router until the declared phase is active.
- `/reports` is `phase: 2` and must not be registered in Phase 1.
- `/settings/children` and `/settings/nurture-mode` must be registered because they are present in `routes.yaml`.
- Navigation must only expose registered non-gated routes.

## PO-SHELL-003 Typed Shell State

The shell-level state required for Phase 1 is:

| Field | Type | Invariant |
|---|---|---|
| `familyId` | `string \| null` | `null` only when no local family exists yet |
| `children` | `ChildRecord[]` | rows are projected from `local-storage.yaml#children` without dropping required fields |
| `activeChildId` | `string \| null` | must reference an item in `children` when not `null` |
| `nurtureMode` | `relaxed \| balanced \| advanced` | value must come from `nurture-modes.yaml` |
| `nurtureModeOverrides` | `Record<string, NurtureMode> \| null` | domains must align with spec-governed knowledge domains |

JSON-backed child fields such as `nurtureModeOverrides`, `allergies`, `medicalNotes`, and `recorderProfiles` must be parsed and serialized through typed bridge mappers. The shell must not silently coerce malformed JSON into fake defaults.

## PO-SHELL-004 Nurture Mode Persistence

Phase 1 nurture mode settings are child-scoped and must round-trip through the `children` table.

- `nurtureMode` is required and defaults to `balanced` only when a record is first created with the field absent.
- `nurtureModeOverrides` is optional JSON text and may only override domains supported by the current app.
- The shell may change reminder visibility and AI detail for `P1-P3` items through nurture mode.
- The shell must never let nurture mode weaken `P0` delivery or safety thresholds.

## PO-SHELL-005 Family and Child Selection

The shell must support a single local family with multiple children in Phase 1.

- child create, edit, and delete flows must operate on the local SQLite store
- switching the active child must refresh profile, timeline, journal, and advisor views from that child's local records
- deleting a child must rely on storage-layer cascade behavior for dependent rows

## PO-SHELL-006 Fail-Close Behavior

The shell must fail closed when spec-governed prerequisites are invalid.

- missing compiled knowledge-base artifacts is a startup failure
- route drift against `routes.yaml` is a verification failure, not a runtime fallback case
- malformed typed bridge payloads must raise an error instead of returning placeholder success objects
- missing nurture-mode parameters must not be patched with ad hoc values outside the spec-defined `balanced` default

## Phase 1 Exclusions

The following are outside this contract for Phase 1:

- `/reports` route registration or navigation exposure
- family collaboration and multi-account sharing (`PO-FEAT-030`)
- cloud sync or remote backup
- any use of `ability-model.yaml` as a frozen runtime contract

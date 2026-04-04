# ParentOS Phase 1 Blocker Closeout

## Scope

This note records the remaining ParentOS Phase 1 blocker closeout work after the main implementation pass.

Closed blockers:

- added the missing kernel contract documents under `apps/parentos/spec/kernel`
- replaced the empty WHO LMS loader path with committed assets generated from official WHO 2006/2007 expanded percentile tables

## WHO LMS Provenance

The committed growth-chart reference assets are generated from official WHO expanded percentile-table `.xlsx` files only.

Covered Phase 1 datasets:

- length-height-for-age, girls and boys, WHO Child Growth Standards 2006
- weight-for-age, girls and boys, WHO Child Growth Standards 2006
- head circumference-for-age, girls and boys, WHO Child Growth Standards 2006
- BMI-for-age, girls and boys, WHO Child Growth Standards 2006
- height-for-age, girls and boys, WHO Growth Reference 2007
- BMI-for-age, girls and boys, WHO Growth Reference 2007
- weight-for-age, girls and boys, WHO Growth Reference 2007 for 5-10 years only

Asset scope rules:

- `height` coverage closes to 228 months using 2006 plus 2007 tables
- `bmi` coverage starts at 24 months and closes to 228 months
- `head-circumference` is trimmed to the spec-approved 36 month Phase 1 range
- `weight` remains officially covered only through 120 months because the WHO 2007 reference does not publish weight-for-age beyond 10 years

## AI Boundary Reminder

Landing official WHO chart data does not change `knowledge-source-readiness.yaml`.

- `growth` remains `needs-review`
- Phase 1 may use the WHO data for deterministic chart rendering and fixed-threshold safety wording
- Phase 1 may not promote `growth` into free-form AI knowledge generation

## Phase 1 Exclusions Kept Intact

The following boundaries remain unchanged:

- `/reports` is still Phase 2 only and remains unregistered
- `ability-model.yaml` is still not treated as a frozen runtime asset
- `PO-FEAT-013` remains intentionally out of scope in its broad AI form
- no fabricated WHO data, guessed percentile lines, or placeholder chart success paths were added

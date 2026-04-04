# ParentOS Implementation Baseline Note

> This file is kept only as a historical implementation-plan pointer. Normative product rules remain in `spec/**`; execution evidence belongs in `dev/report/**`.

## Status

The original Phase 1 implementation plan is no longer the active worklist.

- Phase 1 closeout has already landed.
- Phase 2 core frozen features `PO-FEAT-020` through `PO-FEAT-024` are now implemented in repo.
- Current implementation truth should be read from:
  - `spec/**` for contracts and boundaries
  - `dev/report/phase-1-final-wrap-up.md`
  - `dev/report/phase-2-journal-tagging-closeout.md`
  - `dev/report/phase-2-reports-closeout.md`
  - `dev/report/phase-2-trend-analysis-closeout.md`

## Important Corrections To Older Plan Assumptions

These older assumptions are no longer true:

- `/reports` is no longer excluded from router/nav. It is enabled as a Phase 2 structured local reports surface.
- `PO-FEAT-020` is implemented as local voice observation plus typed STT transcription.
- `PO-FEAT-021` is implemented as local closed-set AI tag suggestion with parent confirmation.
- `PO-FEAT-022` is implemented as local-first OCR candidate extraction for checkup sheets.
- `PO-FEAT-023` is implemented as structured local report generation persisted in `growth_reports`.
- `PO-FEAT-024` is implemented as deterministic local trend analysis inside the structured reports surface.

## Boundaries Still In Force

The following remain intentionally unchanged:

- `ability-model.yaml` stays out of runtime generation and prompt assembly.
- `needs-review` domains remain excluded from free-form AI generation.
- `growth`, `milestone`, `vaccine`, and `observation` remain structured/reporting-only where contracts say so.
- `PO-FEAT-013` remains intentionally out of scope unless separately frozen to a much narrower structured-only contract.

## Verification

Use these app-level closeout entrypoints:

```bash
pnpm --filter @nimiplatform/parentos check:phase1-closeout
pnpm --filter @nimiplatform/parentos check:phase2-closeout
```

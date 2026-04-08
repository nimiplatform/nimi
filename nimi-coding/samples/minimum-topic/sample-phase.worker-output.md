# Sample Phase Worker Output

## Findings

- The minimum topic was missing prompt, worker-output, and acceptance samples.
- All existing artifacts (topic-index, explore, baseline, evidence, finding-ledger) are valid.

## Implementation summary

- Added `sample-phase.prompt.md` with all required prompt blocks.
- Added `sample-phase.worker-output.md` (this file) with all required worker-output blocks.
- Added `sample-phase.acceptance.md` with all required acceptance blocks.

## Files changed

| File | Action |
|------|--------|
| `sample-phase.prompt.md` | Created |
| `sample-phase.worker-output.md` | Created |
| `sample-phase.acceptance.md` | Created |

## Checks run

| Check | Result |
|-------|--------|
| `pnpm nimi-coding:validate-module` | OK |

## Remaining gaps / risks

- Phase execution artifacts are not routed through `topic.index.yaml` — this is by design, not a gap.

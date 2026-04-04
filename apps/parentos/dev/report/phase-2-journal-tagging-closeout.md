# ParentOS Phase 2 Closeout: PO-FEAT-021

## Scope

This closeout covers `PO-FEAT-021` only.

- local-first AI tag suggestion for journal drafts
- closed-set output only: `dimensionId + quickTags`
- no open-ended explanation, diagnosis, recommendation, or trend narrative

## Authority

- `spec/kernel/journal-contract.md`
- `spec/kernel/tables/feature-matrix.yaml`
- `spec/kernel/tables/knowledge-source-readiness.yaml`

`observation` remains `needs-review` for free-form prompt generation. This feature is allowed only because the runtime surface is constrained to a spec-backed closed vocabulary and the parent confirms the final save.

## Implementation Notes

- runtime surface: `runtime.ai.text.generate`
- route: `local`
- output contract: JSON only
- accepted dimensions: current journal candidate dimensions only
- accepted tags: selected dimension `quickTags` only
- persistence:
  - confirmed tags are folded into `journal_entries.selectedTags`
  - confirmed AI tags are also persisted in `journal_tags` with `domain = observation` and `source = ai`
  - journal entry and AI tag rows share one typed save path

## Explicit Exclusions

- no free-form observation analysis
- no open-vocabulary tagging
- no automatic background tagging of saved rows
- no theory interpretation, pattern summary, or diagnostic wording
- no expansion into `PO-FEAT-024`

# Finding Lifecycle Contract

Findings are first-class lifecycle artifacts.

They must not be managed only through prose, memory, or ad hoc summaries.

## First-Class Artifact

- `finding-ledger.yaml`

## Required Properties

Each finding must have:

- stable identifier
- lifecycle status
- reason
- owner
- timestamps

## Closeout Rules

1. Findings do not close by deletion.
2. `fixed` requires evidence.
3. `invalid` requires evidence or an equivalent explicit decision basis.
4. `superseded` requires a successor finding reference.
5. Closeout should be visible from both the ledger side and the evidence side.

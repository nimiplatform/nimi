# Artifact Model Contract

The formal `nimi-coding` artifact model has two artifact families.

## Topic Lifecycle Artifacts

These track topic state and are routed through `topic.index.yaml`:

- `topic.index.yaml` — topic entrypoint and routing index
- `*.explore.md` — open exploration and option framing
- `*.baseline.md` — current execution truth
- `*.evidence.md` — auditable result and closeout evidence
- `finding-ledger.yaml` — stable finding lifecycle register

## Phase Execution Artifacts

These are produced during staged delivery phases. They live in topic directories but are NOT routed through `topic.index.yaml` — they are tied to specific phases, not the topic's current state:

- `*.prompt.md` — dispatch prompt defining one bounded phase for a worker
- `*.worker-output.md` — structured worker completion output
- `*.acceptance.md` — manager acceptance disposition and next step

## Artifact Relations

### Topic lifecycle chain

```
topic.index.yaml
  -> active_baseline     -> *.baseline.md
  -> active_explores[]   -> *.explore.md
  -> latest_evidence     -> *.evidence.md
  -> final_evidence      -> *.evidence.md (status=final)
  -> finding_ledger_ref  -> finding-ledger.yaml
```

### Phase execution chain

```
dispatch (protocol) -> *.prompt.md -> worker executes -> *.worker-output.md -> manager reviews -> *.acceptance.md
```

Each phase execution produces at most one prompt, one worker-output, and one acceptance. The acceptance disposition (complete / partial / deferred) determines the next phase or topic state transition.

### Cross-family relations

- `finding-ledger.yaml` findings may reference `evidence_ref`, `baseline_ref`, and `protocol_ref`
- `*.evidence.md` may reference findings by ID in its Resolved/Invalidated/Deferred/Superseded Findings sections
- `*.acceptance.md` disposition feeds back into topic lifecycle: `complete` may advance the baseline, `deferred` may update finding status

## Non-Rules

1. These artifacts are execution-system artifacts, not product spec authority.
2. They must not redefine product truth already owned by `spec/**`.
3. They must be structure-first and machine-readable enough for tooling.
4. Phase execution artifacts are not indexed in `topic.index.yaml` — they are phase-scoped, not topic-state-scoped.

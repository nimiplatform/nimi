# Artifact Model Contract

The formal `nimi-coding` artifact model has two artifact families.

## Topic Lifecycle Artifacts

These track topic state and are routed through `topic.index.yaml`:

- `topic.index.yaml` — topic entrypoint and routing index
- `*.explore.md` — open exploration and option framing
- `*.baseline.md` — current execution truth
- `*.execution-packet.yaml` — frozen post-convergence execution authority for bounded autonomous continuation
- `*.orchestration-state.yaml` — mutable packet-bound run position for future resumable autonomous mode
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
  -> execution_packet_ref -> *.execution-packet.yaml
  -> orchestration_state_ref -> *.orchestration-state.yaml
  -> active_explores[]   -> *.explore.md
  -> latest_evidence     -> *.evidence.md
  -> final_evidence      -> *.evidence.md (status=final)
  -> finding_ledger_ref  -> finding-ledger.yaml
```

### Phase execution chain

```
*.execution-packet.yaml -> dispatch (protocol) -> *.prompt.md -> worker executes -> *.worker-output.md -> manager reviews -> *.acceptance.md
```

Each phase execution produces at most one prompt, one worker-output, and one acceptance. The acceptance disposition (complete / partial / deferred) determines the next phase or topic state transition.

The execution packet does not replace prompt, acceptance, or evidence artifacts:

- it freezes the allowed phase route and escalation boundary for automation
- it does not carry worker output, semantic acceptance, or runtime state
- it remains a topic lifecycle artifact, not a third artifact family

The orchestration state does not replace packet, acceptance, evidence, or finding artifacts:

- it persists mutable run position for one packet-bound execution attempt
- it may reference packet, acceptance, or evidence artifacts
- it must not become runner implementation, semantic judgment, or finding lifecycle truth

### Cross-family relations

- `finding-ledger.yaml` findings may reference `evidence_ref`, `baseline_ref`, and `protocol_ref`
- `*.evidence.md` may reference findings by ID in its Resolved/Invalidated/Deferred/Superseded Findings sections
- `*.acceptance.md` disposition feeds back into topic lifecycle: `complete` may advance the baseline, `deferred` may update finding status
- `*.execution-packet.yaml` must reference one frozen baseline and may be routed from `topic.index.yaml` by `execution_packet_ref`
- `*.orchestration-state.yaml` must reference one execution packet and may be routed from `topic.index.yaml` by `orchestration_state_ref`
- `*.orchestration-state.yaml` may reference notification correlation ids, but must not carry transport secrets or runtime lease state
- `*.prompt.md` may be derived from a packet-declared phase, but packet presence does not delegate semantic acceptance to automation

## Non-Rules

1. These artifacts are execution-system artifacts, not product spec authority.
2. They must not redefine product truth already owned by `spec/**`.
3. They must be structure-first and machine-readable enough for tooling.
4. Phase execution artifacts are not indexed in `topic.index.yaml` — they are phase-scoped, not topic-state-scoped.
5. Execution packets are not runtime implementations, notification transports, or general workflow engines.
6. Orchestration states are not generic workflow stores, runner processes, or semantic closeout artifacts.

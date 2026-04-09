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

One frozen phase may contain multiple bounded execution attempts.

Each execution attempt produces exactly one prompt, one worker-output, and one acceptance.

Acceptance semantics are:

- `complete` closes the current phase attempt and may advance to the next frozen phase or terminal manager-owned run completion
- `partial` closes the current attempt but keeps the same frozen phase open for another attempt
- `deferred` closes the current attempt and pauses or reroutes due to blocker, escalation, or unresolved ambiguity

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
- `*.acceptance.md` disposition feeds back into topic lifecycle: `complete` may advance the phase route, `partial` keeps the same frozen phase active, and `deferred` may update finding status or pause the run
- `*.execution-packet.yaml` must reference one frozen baseline and may be routed from `topic.index.yaml` by `execution_packet_ref`
- `*.orchestration-state.yaml` must reference one execution packet and may be routed from `topic.index.yaml` by `orchestration_state_ref`
- `*.orchestration-state.yaml` may reference notification correlation ids, but must not carry transport secrets or runtime lease state
- transport-agnostic notification payload logs live at `.nimi-coding/notifications/<run_id>.jsonl`; they may reference topic/run artifacts for local emission and readback, but they are not routed from `topic.index.yaml` and are not canonical state owners
- `notification-handoff.v1` is protocol-only readback semantics derived from notification-log append order; it is not a stored artifact and must not become transport-owned topic state
- `provider-worker-execution.v1` is protocol-only worker invocation authority for admitted providers; it is not a stored artifact and must not persist provider session or transport state into topic artifacts
- `worker-runner-signal.v1` is protocol-only machine-readable runner handoff derived from worker-authored output; it is not a separate topic artifact and must not be inferred from provider stdout alone
- transport-local ack checkpoints live at `.nimi-coding/transport-state/<consumer_id>/<run_id>.checkpoint.yaml`; they are operational persistence for one consumer stream and must not become canonical topic or orchestration state
- external adapter side effects such as file-sink, webhook, or Telegram deliveries are transport-owned operational outputs; they consume handoff entries and checkpoints but are not topic artifacts or canonical notification truth
- `*.prompt.md` may be derived from a packet-declared phase, but packet presence does not delegate semantic acceptance to automation

## Non-Rules

1. These artifacts are execution-system artifacts, not product spec authority.
2. They must not redefine product truth already owned by `spec/**`.
3. They must be structure-first and machine-readable enough for tooling.
4. Phase execution artifacts are not indexed in `topic.index.yaml` — they are phase-scoped, not topic-state-scoped.
5. Execution packets are not runtime implementations, notification transports, or general workflow engines.
6. Orchestration states are not generic workflow stores, runner processes, or semantic closeout artifacts.
7. Provider execution and worker runner signals are protocol-only operational surfaces; they do not create a third execution artifact family.

# Execution Protocol

## Status: Admitted Contract; Public API Owned By Platform/Runtime

The five-stage execution protocol is admitted at the kernel level
(`P-ALMI-011`). The state machine, idempotency rule, compensation
rule, fail-close rule, and execution-level matrix are pinned. Audit
ledger persistence is available only through the owning Platform/Runtime
surface that exposes it.

## The Five Stages

The Nimi AI execution protocol has a fixed canonical order:

```
discover  →  dry-run  →  verify  →  commit  →  audit
```

| Stage | Purpose |
| --- | --- |
| `discover` | Find the typed action verb available under the requesting Principal's scope |
| `dry-run` | Execute the action under a simulated commit; no side effects |
| `verify` | Validate that the dry-run output matches the caller's intent + policy |
| `commit` | Execute the real action; mutate state |
| `audit` | Record the outcome (success or failure) in the execution ledger |

The order is canonical. Documents and walkthroughs must present the
stages in this order; reversing or skipping a stage is a contract
violation, not a stylistic choice.

## Required Idempotency

Write actions **must** support `idempotencyKey`. Retries must carry
the same `idempotencyKey`. The runtime is required to recognize and
de-duplicate.

This is a hard rule because retry without idempotency turns transient
network failure into duplicate side effects. The protocol's
correctness depends on the key being honored.

## Compensation (SAGA)

Multi-action orchestration must support compensation. If `commit`
fails after earlier `commit`s succeeded, the protocol triggers
compensation for actions that declared a `compensation` handler in
their action contract.

| Property | Value |
| --- | --- |
| Compensation declared in | Action contract (`compensation` field) |
| Triggered by | Failed `commit` after partial multi-action success |
| Compensation kind | Reverse / refund / undo per action declaration |
| Failure of compensation | Recorded into audit; does not silently no-op |

If an action does not declare compensation, multi-action orchestration
that includes it cannot rely on rollback — that's a contract-level
property the orchestrator must respect.

## Verify Must Precede Commit

`verify` always runs before `commit`. The protocol does not admit
"commit and validate after." If `verify` fails, the protocol
terminates without commit.

## Commit Must Persist Audit Ledger

`commit` must persist into the execution ledger. If persistence is
uncertain (e.g., ledger backend is unreachable), the protocol fails
**closed** — it does not proceed with an unpersisted commit.

## Failure Transitions

| Where it fails | What happens |
| --- | --- |
| `dry-run` | No side effects; protocol enters `audit` with failure reason |
| `verify` | Protocol terminates without commit; `audit` records failure |
| `commit` | Triggers compensation if action declared one; `audit` records the failure (and any compensation outcomes) |
| `audit` persistence uncertain | Fail-close; previous `commit` is treated as suspect and reported |

A failure at any stage routes directly into `audit`. There is no
silent skip.

## Execution Level Matrix

Actions are registered with one of three execution levels. Each level
binds different protocol guarantees:

| Level | dry-run requirement | Audit requirement | High-risk admitted? |
| --- | --- | --- | --- |
| `full` | Required | Standard | Yes |
| `guarded` | Preflight may substitute | Strong audit required | Yes |
| `opaque` | `supportsDryRun=false` (fixed) | Persistent audit required | **No** — high risk forbidden in opaque mode |

`opaque` mode exists for actions that cannot expose their pre-commit
state (e.g., a provider that does not admit dry-run). The trade-off
is that opaque actions cannot be high risk.

## Action Contract Minimum

Action Registry entries declare at minimum:

| Field | Purpose |
| --- | --- |
| `actionId` | Stable identity |
| `inputSchema` | Typed input |
| `outputSchema` | Typed output |
| `riskLevel` | `low` / `medium` / `high` |
| `executionMode` | `full` / `guarded` / `opaque` |
| `idempotent` | Whether the action is idempotent without key |
| `supportsDryRun` | Whether dry-run is admitted (forced `false` for `opaque`) |
| `auditEventMap` | Mapping of action events to audit event types |
| `compensation` | Optional; required for SAGA participation |

`opaque` + `high risk` is **not** admittable. Apps cannot register
that combination.

## Reader Scenario: A Standard Write Action

An app initiates a typed write action through its admitted Principal.

1. **Discover.** The Principal's scope grants the action verb;
   discovery returns the typed action contract.
2. **Dry-run.** Action runs under simulated commit; output schema
   validates; no state mutated.
3. **Verify.** Verify checks dry-run output against caller intent +
   policy; passes.
4. **Commit.** Real commit executes; state mutates; audit ledger
   persists.
5. **Audit.** Outcome recorded; lineage links discover → dry-run →
   verify → commit → audit.

A retry with the same `idempotencyKey` returns the original commit
result, not a duplicate side effect.

## Reader Scenario: Multi-Action Orchestration With Compensation

An orchestrated workflow calls three commits: A, B, C. C fails.

1. **A discovers + dry-runs + verifies + commits + audits.** A's
   compensation handler is declared.
2. **B discovers + dry-runs + verifies + commits + audits.** B's
   compensation handler is declared.
3. **C discovers + dry-runs + verifies + commits.** Commit fails.
4. **Compensation triggers.** Runtime invokes B's compensation; then
   A's compensation.
5. **Audit chain.** Audit records the original commit attempts plus
   each compensation outcome; lineage is complete.

If A or B had not declared compensation, the orchestrator could not
have rolled them back; that's a property of the action contract, not
the protocol.

## Reader Scenario: A Verify-Failure

A typed write proposal arrives. Discovery + dry-run pass.

1. **Verify runs.** Verify cross-checks: does the dry-run output
   actually match what the caller intended, given current policy
   snapshot?
2. **Verify fails.** Output indicates a write the policy now
   forbids (e.g., a sensitivity threshold changed since dry-run).
3. **Protocol terminates.** No commit. No retry-rescue. The
   contract-level rule is "verify must precede commit and verify
   failure terminates the flow."
4. **Audit.** Failure reason recorded; the caller sees the typed
   refusal.

Retries that change the input + key may succeed under a fresh flow.
Retries with the same key get the original audit result.

## Reader Scenario: A Compensation Path Itself Fails

The orchestrator triggers compensation for B. B's compensation
handler raises an error.

1. **Compensation attempted.** Runtime calls B's compensation.
2. **Compensation fails.** Runtime does not silently no-op; it
   records the failure into audit.
3. **Operator visibility.** The audit ledger now shows: original
   commits, the failed C commit, compensation attempt for B with
   failure, compensation attempt for A.
4. **No silent rescue.** The system does not pretend the
   compensation succeeded. The audit shows the truth.

## What Retry / Transport Does Not Do

Retries and auth refresh are **transport / auth mechanisms only**.
They do not rescue:

- decode failure
- content-type failure
- schema failure
- contract-level failure (e.g., verify failure, commit failure
  without admitted retry semantics)

A failed verify does not become a passed verify by retrying. A
schema-invalid response does not become valid by retrying. The
protocol holds those failures fail-closed.

## Performance / Availability Red Lines

| Constraint | Rule |
| --- | --- |
| Control plane / data plane separation | Required |
| Policy + authorization decisions | Locally cached when possible |
| Audit writes | Default async |
| Action control plane overhead | p95 ≤ 20ms |
| Read-only low-risk actions on policy anomaly | Controlled fail-open admitted |
| High-risk write actions on policy anomaly | Default fail-close |

These rules govern operational properties of the execution protocol
in production. They are not optional defaults.

## Boundary Summary

| Concern | Owner |
| --- | --- |
| Five-stage state machine | Platform (`P-ALMI-011`) |
| Action contract minimum | Platform (`P-ALMI-010`) |
| AI action boundary (which actions exist) | Platform (`P-ALMI-002`) |
| Principal model (who is calling) | Platform (`P-ALMI-003`) |
| ExternalAgent admission rules | Platform (`P-ALMI-004`) |
| Runtime-side delegation gateway / firewall | Runtime (`K-DELEG-*`) |

## Source Basis

- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)
- [`.nimi/spec/runtime/delegation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/delegation.authority.yaml)

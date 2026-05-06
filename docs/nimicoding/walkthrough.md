# Walkthrough

This is a synthetic Nimi Coding topic from start to finish — a
contrived but realistic example. It's not a real topic in this
repository, just one we made up to walk through the full flow.

## Setup

A team is migrating their authentication service from JWT-only
to JWT-plus-session-bearer. The change touches authority
contracts, runtime execution, and client SDK projection. It is
exactly the kind of cross-domain work the methodology is for.

We will follow the topic from `proposal` through `closed`.

## Phase 1: Topic Creation (`proposal`)

The team's lead engineer authors a topic.

`topic.yaml` (initial):

```yaml
topic_id: 2026-06-15-auth-jwt-plus-session-migration
state: proposal
created_at: 2026-06-15
last_transition_at: 2026-06-15
last_transition_reason: topic_created
title: Auth JWT-Plus-Session Migration
mode: landed
posture: no_legacy_hard_cut
design_policy: complete_contract_first
parallel_truth: forbidden
layering: ontology
risk: high
applicability: high_risk_refactor
entry_justification: |
  Migrate auth from JWT-only to JWT+session bearer. Touches
  authority contract (P-AUTH-*), runtime execution
  (K-AUTH-*), SDK projection (S-ERROR-*). Backward-compat
  path is hard-cut; legacy alias is forbidden.
execution_mode: manager_worker_auditor
selected_next_target: null
current_true_close_status: not_started
forbidden_shortcuts:
  - mvp_subset_contract
  - legacy_alias
  - compat_shim
  - dual_read
  - dual_write
  - placeholder_success
  - happy_path_only_closure
  - time_phased_layering
  - app_local_shadow_truth
  - silent_owner_cut_reopen
waves: []
```

Topic exists. No wave yet.

## Phase 2: Design (Still `proposal`)

The team writes `design.md` outlining the migration's intended
shape. The design names:

- The new `SessionBearer` contract.
- The relationship between `JWT` (existing) and `SessionBearer`
  (new) — explicit dual-truth admission with a planned cutover
  date, not silent `legacy_alias`.
- The four-closure conditions the migration must satisfy.

## Phase 3: Wave-1 Admitted (`proposal → ongoing`)

The team admits the first wave.

```yaml
- wave_id: wave-1-auth-spec-update
  slug: auth-spec-update
  state: admitted
  primary_closure_goal: |
    Update `.nimi/spec/runtime/kernel/auth-service.md` and
    `.nimi/spec/sdk/kernel/error-projection.md` to admit the
    SessionBearer contract alongside JWT. Explicit
    dual-admission with cutover date.
  deps: []
  owner_domain: .nimi/spec/runtime/kernel/auth-service.md and .nimi/spec/sdk/kernel/error-projection.md
  parallelizable_after: stable_authority_contract
  selected: true
```

Topic state moves: `proposal → ongoing`. `selected_next_target`
points at wave-1.

## Phase 4: Pre-Implementation Authority Convergence

Wave-1 is a `spec` packet (touches `.nimi/spec/`). Authority
convergence gate fires.

The manager runs an independent audit (different AI session):

| Result kind | audit |
| Verdict | PASS |
| Findings | None blocking |

Manager records the audit result. Now wave-1 can dispatch.

## Phase 5: Wave-1 Packet Frozen And Worker Dispatched

Packet is frozen with allowed reads, allowed writes, acceptance
invariants, negative tests, stop lines, reopen conditions.

Worker (the AI host) executes within packet boundary:

- Reads `.nimi/spec/runtime/kernel/auth-service.md`.
- Edits the file to admit `SessionBearer` contract.
- Reads `.nimi/spec/sdk/kernel/error-projection.md`.
- Edits to add SessionBearer error reason codes.
- Stops at packet boundary; does not touch other surfaces.

## Phase 6: Post-Implementation Judgement

Independent loop reviews the implementation.

| Result kind | judgement |
| Verdict | PASS |
| Findings | None blocking |

Wave-1 can proceed to closeout.

## Phase 7: Wave-1 Closeout (Four Closures)

| Dimension | Verdict | Evidence |
| --- | --- | --- |
| Authority closure | closed | Canonical owner unique; no parallel truth introduced |
| Semantic closure | closed | SessionBearer required fields, failure modes pinned |
| Consumer closure | closed | App developers can read SessionBearer contract; runtime + SDK aligned |
| Drift resistance closure | closed | Forbidden shortcuts (`legacy_alias`, `compat_shim`, `dual_read`, `dual_write`) declared; reopen conditions explicit |

Wave-1 closes. Topic stays `ongoing` since more waves remain.

## Phase 8: Wave-2 Admitted (Runtime Implementation)

Wave-2 implements the runtime auth-service changes per the new
spec.

```yaml
- wave_id: wave-2-runtime-auth-implementation
  slug: runtime-auth-implementation
  state: admitted
  primary_closure_goal: |
    Implement SessionBearer issuance and validation in
    runtime auth-service. JWT path stays operational under
    explicit dual-truth admission per wave-1.
  deps:
    - wave-1-auth-spec-update
  owner_domain: runtime/internal/auth/**
```

Wave-2 is `implementation` packet (no `.nimi/spec/`); authority
convergence gate does not fire. Wave-2 can dispatch directly.

## Phase 9: Wave-2 Encounters Overflow

Mid-implementation, the worker reaches the packet boundary
without completing. The work has not crossed into a new owner
domain; direction is still correct; no shadow truth introduced.

| Result | OVERFLOW |
| Reason | Packet boundary too thin |

Manager evaluates: continuation admissible? Yes (direction
correct, scope contained, no shadow truth, no fallback needed).

Manager admits a continuation packet that extends the boundary.
Worker resumes.

## Phase 10: Wave-2 Closeout

After continuation completes, wave-2 closes through four
closures (PASS).

## Phase 11: Wave-3 (SDK Projection)

Wave-3 updates the SDK to project the new SessionBearer error
reason codes.

After dispatch, audit, and closeout — closes PASS.

## Phase 12: Topic Reaches Pending

All admitted waves are closed. The migration is mechanically
complete. But: the team wants the change deployed and observed
in production for one cycle before declaring true close.

Topic state moves: `ongoing → pending` with explicit
`pending-note`:

```yaml
reason: awaiting-deployment-observation
close_trigger: One full release cycle observed without
  SessionBearer regression
reopen_criteria: SessionBearer regression observed; admit
  remediation wave under this topic
```

## Phase 13: Pending Resolves; True Close

After one release cycle, no regression. Team triggers true close.

| Step | Action |
| --- | --- |
| 1. Topic-true-close-audit | Independent audit confirms all four closures held under production observation |
| 2. result-topic-true-close | Recorded |
| 3. topic.yaml updates | `state: pending → closed`; `current_true_close_status: not_started → true_closed`; `last_transition_reason: topic_true_close_passed` |
| 4. Folder move | `.nimi/topics/pending/2026-06-15-auth-jwt-plus-session-migration/` → `.nimi/topics/closed/2026-06-15-auth-jwt-plus-session-migration/` |

## What The Walkthrough Demonstrates

| Property | How it appears in the walkthrough |
| --- | --- |
| Authority is named | Topic carries `forbidden_shortcuts`, owner_domain, parallel_truth posture |
| Execution is packetized | Each wave has its own packet with allowed_reads / writes |
| Closure is multidimensional | Wave-1 closeout has four explicit dimensions |
| Roles are separated | Manager admits, worker executes, independent auditor reviews |
| Authority convergence | Spec wave required pre-audit + post-judgement |
| Forbidden shortcuts | Declared at packet level; checked at audit |
| Overflow vs PASS | Wave-2 hit overflow; admitted continuation under explicit conditions |
| True close ≠ folder closed | Topic stayed pending after waves closed; true close required separate audit |
| Pending state | Used for "waiting on production observation" with typed reopen criteria |

Each property corresponds to admitted machinery the package
ships.

## What The Walkthrough Does Not Show

| Concern | Why omitted |
| --- | --- |
| The actual auth code | Outside docs scope |
| Specific provider / model used | Host-agnostic; doesn't matter for the methodology |
| Continuous integration plumbing | DevOps layer, not Nimi Coding layer |
| Per-line diffs | Wave-level discipline, not line-level |

## Source Basis

- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-convergence-policy.yaml)
- [`.nimi/contracts/topic.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/topic.schema.yaml)
- [`.nimi/contracts/wave.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/wave.schema.yaml)
- [`.nimi/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/packet.schema.yaml)
- [`.nimi/contracts/closeout.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/closeout.schema.yaml)

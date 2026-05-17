# Authority Convergence

Authority convergence is the gate that says: when a packet
touches authority / spec / redesign surfaces, **an independent
audit must record PASS before implementation dispatch**. This is
the methodology's structural guarantee against AI-authored spec
drift.

## What The Gate Triggers On

| Trigger | Match condition |
| --- | --- |
| `packet_kind` | `authority`, `spec`, `redesign`, or `preflight` |
| `ref_prefix` | `.nimi/spec/` |
| `topic.work_type` | `redesign` |

If any of these match, the gate fires. An independent auditor
PASS must precede worker dispatch.

## Required Result

| Field | Value |
| --- | --- |
| `result_kind` | `audit` |
| `verdict` | `PASS` (the only admitted pass verdict) |

`NEEDS_REVISION` and `FAIL` are blocked verdicts. Worker dispatch
does not happen until the verdict moves to `PASS`.

## Post-Update Review

After implementation lands, a follow-up judgement PASS is
required before mechanical phase transition.

| Field | Value |
| --- | --- |
| `result_kind` | `judgement` |
| `verdict` | `PASS` |

The post-implementation review is a separate gate from the
pre-implementation audit. Both must pass.

## Why The Two-Gate Pattern

Pre-implementation audit catches:

- Drift in the proposed change (does the spec edit make sense?)
- Hidden authority shifts (is canonical truth being moved?)
- Forbidden patterns in the planned approach.

Post-implementation judgement catches:

- Drift between plan and execution (did the worker do what was
  planned?)
- Implementation-side patterns the pre-audit could not see (a
  shortcut introduced during execution).
- Final closure verification across the four dimensions.

A single gate catches half. Two gates catch both halves.

## Hard Constraints

| Constraint | What it forbids |
| --- | --- |
| Auditor output is candidate evidence only | Auditor cannot self-admit |
| Manager records audit result before implementation dispatch | Manager cannot skip the record step |
| Unresolved blocking findings fail closed | Cannot wave away a blocker |
| Deferred items must be explicitly non-blocking | Cannot push blockers into "later" silently |
| Concrete subagent mechanics belong to adapter profiles, not methodology semantics | Methodology stays host-agnostic |

The last constraint is the host-agnostic principle: how the
audit gets routed to a different AI session is an adapter
concern, not a methodology concern.

## Reader Scenario: A Spec Edit Without Pre-Audit

A worker tries to dispatch a packet that edits `.nimi/spec/`
without a pre-implementation audit on record.

1. **Manager evaluates dispatch.** Authority convergence gate
   fires.
2. **Audit lookup.** Gate checks for recorded
   `result_kind: audit` with `verdict: PASS`.
3. **Not found.** No audit on record for this packet.
4. **Refuse dispatch.** Worker is not dispatched.
5. **Path forward.** Run pre-implementation audit; record PASS;
   resubmit dispatch.

There is no skip. The gate is structural.

## Reader Scenario: A Pre-Audit Returns NEEDS_REVISION

A pre-implementation audit runs and returns `NEEDS_REVISION` with
specific findings.

1. **Audit recorded.** `result_kind: audit, verdict: NEEDS_REVISION`.
2. **Findings noted.** Specific drift / forbidden-pattern issues.
3. **Worker dispatch refused.** `NEEDS_REVISION` is a blocked
   verdict.
4. **Manager addresses findings.** Either revise the packet (new
   `forbidden_shortcuts`, narrower scope, etc.) or resolve the
   underlying issue (admit a missing prerequisite).
5. **Re-audit.** New pre-audit run; if PASS this time, dispatch.

The findings drive the next packet revision. There is no "audit
said no but we'll proceed" path.

## Reader Scenario: Post-Implementation Judgement Catches Drift

Implementation lands. Pre-audit PASS was recorded. Worker said
"done."

1. **Post-implementation judgement.** Independent loop reviews
   the actual work.
2. **Drift detected.** Worker introduced a `dual_read` pattern
   that pre-audit could not have foreseen.
3. **Verdict.** `judgement: NEEDS_REVISION`.
4. **Wave returns to revision.** Cannot advance to mechanical
   phase transition until judgement is PASS.
5. **Worker addresses.** Removes the `dual_read`, re-submits.
6. **Re-judgement PASS.** Now the wave can advance.

Implementation-side drift gets caught because the post-audit is
its own gate.

## Reader Scenario: A Spec Update Review Gate

A packet that successfully implements a spec change has both
pre-audit PASS and post-judgement PASS recorded. Mechanical
phase transition would normally proceed.

But there's a special rule: **post-spec-update review is the
exception to mechanical phase transition continuation**. After a
spec / authority / redesign implementation PASS, run-next-step
must use `require_human_confirmation` with reason code
`spec_update_review_required` until a fresh judgement PASS is
recorded.

This exists because spec changes are consequential enough that
even mechanically-clean implementations get a human-confirmation
gate before the next phase moves.

## Boundary Summary

| Concern | Owner |
| --- | --- |
| Pre-implementation audit | Independent auditor |
| Audit result recording | Manager |
| Worker dispatch decision | Manager (after audit PASS) |
| Post-implementation judgement | Independent auditor |
| Mechanical phase transition | Manager (after judgement PASS, with spec-update review gate) |

## Source Basis

- [`nimi-coding/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/methodology/authority-convergence-policy.yaml)
- [`nimi-coding/contracts/authority-convergence-audit.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/authority-convergence-audit.schema.yaml)
- [`nimi-coding/contracts/topic-step-decision.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/topic-step-decision.schema.yaml)
- [`nimi-coding/contracts/decision-review.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/decision-review.schema.yaml)

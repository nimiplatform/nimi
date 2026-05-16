# Role Separation

Three roles. Strict separation. The auditor is **not the worker
with a different hat** — that is the most distinctive operational
rule in the methodology.

## The Three Roles

| Role | Owns | Must not |
| --- | --- | --- |
| Manager | Wave graph, packet admission, manager judgement, closeout sync | Silently implement production scope while changing semantics |
| Worker | One admitted packet, bounded write-set execution | Widen owner domain, weaken fail-closed rules |
| Auditor | Structural review, drift detection, closure verification, pre-implementation authority convergence evidence | Silently turn missing scope into future follow-up; mutate authority or implementation while auditing; decide semantic acceptance or packet admission |

The forbidden actions are listed deliberately. They name the
ways each role is most likely to overreach.

## Manager

The manager is the role that:

- Decides which wave is admitted.
- Freezes the packet for that wave.
- Records the audit result.
- Decides whether the wave reaches closeout, returns to revision,
  or admits a continuation.
- Records topic-level closeout decisions.

The manager **does not write the production code** in the
strictest case (`manager_worker_auditor` execution mode). In
`inline_manager_worker` mode (low-risk work only), the manager
and worker may be the same loop.

The manager's defining constraint: do not silently implement
production scope while changing semantics. If semantics change,
that is its own admission step, not a side effect of execution.

## Worker

The worker is the role that:

- Executes one admitted packet.
- Reads only what `allowed_reads` admits.
- Writes only what `allowed_writes` admits.
- Stops at the packet's stop lines.

The worker's defining constraint: do not widen owner domain. If
the work needs to touch a surface outside the packet's owner
domain, the worker stops and returns to the manager for a
re-scoped packet.

The worker also cannot weaken fail-closed rules. A worker that
"helpfully" adds a fallback to rescue a contract failure has
introduced `placeholder_success`.

## Auditor

The auditor is the most under-appreciated piece. **In a typical
AI workflow, the same loop that produced the code reviews it,
and the failure mode is well-known: the loop's blind spots
survive review.**

The auditor in `manager_worker_auditor` mode is structurally
separate. In current host implementations, this means a different
AI session or a different vendor.

The auditor:

- Performs structural review.
- Detects drift.
- Verifies closure across all four dimensions.
- Provides pre-implementation authority convergence evidence
  when packets touch spec / authority / redesign surfaces.

The auditor does **not** silently turn missing scope into future
follow-up. If the audit finds a gap, the gap is named explicitly;
"someone will fix this later" is not an audit verdict.

The auditor does **not** mutate authority or implementation while
auditing. Audit is read-only.

The auditor does **not** decide semantic acceptance or packet
admission. Those decisions belong to the manager. The auditor's
output is "candidate evidence only"; the manager records the
audit result before implementation dispatch.

## Why The Separation

If manager / worker / auditor collapse into one loop:

| Pathology | What happens |
| --- | --- |
| Self-review | The loop's blind spots survive |
| Scope creep | Worker silently widens because there is no separate gate |
| Soft pass | Auditor's standard relaxes to match worker's reality |
| Drift normalization | Repeated patterns get normalized as "fine" |

If they're separate:

| Behavior | What it gives |
| --- | --- |
| Independent audit | Different blind spots; one loop catches what the other missed |
| Hard scope boundary | Worker bounded by frozen packet; manager re-scopes only with new packet |
| Standard preservation | Auditor's standard cannot drift toward worker's reality |
| Drift detection | Patterns that recur get named (catalog grows) |

## Authority Convergence Gate

A specific case: when a packet is `authority`, `spec`, `redesign`,
or `preflight` kind and references `.nimi/spec/`, the manager
must record an auditor PASS verdict **before** dispatching the
worker.

| Step | Owner |
| --- | --- |
| Pre-implementation audit | Auditor (independent) |
| Verdict recorded | Manager (record-only) |
| Worker dispatch | Manager (admits packet only after audit PASS) |

After implementation lands, a follow-up judgement PASS is
required before mechanical phase transition.

Unresolved blocking findings fail closed.

## Reader Scenario: Why Same-Loop Audit Fails

You're using AI to make a substantial change. You ask the same
AI to review its own work.

The AI reviews; everything looks fine. You ship. A week later,
you discover the change introduced a `legacy_alias` pattern that
neither the AI's authorship nor the AI's review caught.

This is the structural failure mode. The same loop's blind spots
do not change between authorship and review. The AI is not less
careful as the reviewer; it has the same model of what is OK.

The methodology's response: the auditor is **a different loop**.
Different session, different vendor, different host. The
auditor's blind spots are different.

## Reader Scenario: A Solo Founder Using The Auditor Pattern

You're a solo founder using AI heavily. You don't have a team
that can provide structural review. You have only yourself and
your AI host.

The methodology's response:

| Loop | Role |
| --- | --- |
| Your primary AI session | Manager + worker |
| A separate AI session (different vendor or different session) | Auditor |
| You | Final acceptance gate |

You're using the same `manager_worker_auditor` model that a team
would use, but you're routing the auditor through a different
AI session. The structural separation is preserved without
requiring more humans.

This is the methodology's pitch for solo founders: simulate the
review redundancy a team would provide, by routing the audit
through a different AI loop.

## Reader Scenario: A Manager Refusing An Admission

A worker submits a packet for admission. The manager reviews:

- Authority owner: clear.
- Allowed reads: bounded.
- Allowed writes: bounded.
- Acceptance invariants: explicit.
- Negative tests: explicit.
- Stop lines: explicit.
- Forbidden shortcuts: declared.

But: this packet is a spec-touching kind, and no auditor PASS
has been recorded. The manager refuses admission.

| Step | What happens |
| --- | --- |
| Worker requests admission | Submitted |
| Manager checks gate | Authority convergence gate not satisfied |
| Refusal | Admission denied |
| Path forward | Run pre-implementation audit; record PASS; resubmit |

The refusal is **not optional**. The methodology's hard rule:
unresolved blocking findings fail closed.

## Source Basis

- [`nimi-coding/methodology/role-separation-policy.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/methodology/role-separation-policy.yaml)
- [`nimi-coding/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/methodology/authority-convergence-policy.yaml)
- [`nimi-coding/contracts/topic-step-decision.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/topic-step-decision.schema.yaml)
- [`nimi-coding/contracts/authority-convergence-audit.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/authority-convergence-audit.schema.yaml)

# Tutorial: First Wave End-To-End

This tutorial walks you through a single wave from admission to
closeout. By the end you will have:

- A small sample topic in `.nimi/topics/ongoing/`
- One wave admitted, frozen, dispatched, audited, closed
- Closeout artifacts demonstrating the four-closure framework

## Prerequisites

| Requirement | Why |
| --- | --- |
| Completed [First Topic Bootstrap](/nimicoding/tutorials/first-topic) | You need `.nimi/**` in place |
| Canonical spec tree under `.nimi/spec/**` | Required for `high_risk_execution` skill |
| Admitted external AI host | The worker role |
| A second admitted external AI host (or session) | The auditor role |

The auditor host must be different from the worker host. Same
session as worker is **not** admitted for `manager_worker_auditor`
mode.

## Sample Task

We will use a contrived but realistic task: **add a single new
field to a public docs reference page**. The field is admitted in
spec; the docs page is the consumer. The work is small enough to
walk end-to-end but real enough to exercise all the gates.

This is a synthetic example for the tutorial; do not actually run
the steps unless you want to commit the artifacts to your
project.

## Step 1: Author The Topic

Create `.nimi/topics/proposal/2026-XX-XX-add-reference-field/topic.yaml`
with required fields. State: `proposal`.

The topic's `entry_justification` names the spec field being
added and the docs page being updated.

## Step 2: Author A Wave

Add wave entry to `topic.yaml`:

```yaml
waves:
  - wave_id: wave-1-add-reference-field
    slug: add-reference-field
    state: candidate
    primary_closure_goal: |
      Add new field FOO to docs/reference/some-page.md
      under admitted spec contract; preserve source basis.
    deps: []
    owner_domain: docs/reference/some-page.md
    parallelizable_after: stable_readability_contract
    selected: true
```

Move topic to `.nimi/topics/ongoing/...` and update
`topic.yaml.state: ongoing` and
`last_transition_reason: wave_admitted`.

## Step 3: Freeze The Packet

Author `packet-wave-1-add-reference-field.md`. Keep the packet id
wave-qualified, for example `packet_id: wave-1-add-reference-field`,
so later lifecycle commands do not create ambiguous `packet-*.md`
artifacts.

The packet requires:

- `packet_id`, `topic_id`, `wave_id`, `packet_kind`
- `authority_owner`
- `canonical_seams`
- `forbidden_shortcuts`
- `acceptance_invariants`
- `negative_tests`
- `reopen_conditions`
- `allowed_reads` and `allowed_writes` when the packet will bind a worker

`topic packet freeze` validates the draft and writes the frozen packet
artifact. Dispatch happens after freeze; once
`topic worker dispatch` moves it to `status: dispatched`, the worker is
bound by it.

## Step 4: Run Preflight

Author `preflight-result-wave-1-add-reference-field.md` with
verdict and required fields. If preflight is PASS, dispatch.

This wave is `implementation` kind (not `spec`/`authority`/
`redesign`/`preflight`), so authority convergence gate does not
fire. No pre-implementation audit required.

## Step 5: Hand Off To The Worker Host

Run:

```
nimicoding handoff --skill high_risk_execution --json
```

The CLI emits an authoritative JSON payload. Hand it to your
worker host (the AI session you are using to do the work).

## Step 6: Worker Does The Work

The worker host:

- Reads only `allowed_reads`.
- Writes only `allowed_writes`.
- Stops at the packet boundary.
- Returns a typed result.

Specifically: the worker edits `docs/reference/some-page.md` to
add the new field FOO under admitted contract, with Source Basis
section updated.

## Step 7: Ingest Worker Result

Run:

```
nimicoding ingest-high-risk-execution --from worker-result.json
```

The CLI mechanically validates the result. If valid, the ingest
artifact is recorded.

## Step 8: Hand Audit To The Second Host

Run:

```
nimicoding handoff --skill high_risk_execution --json (or specific audit handoff)
```

Hand to your **auditor host** (different from worker). The auditor
reviews the work against the four closures.

For our sample task, the audit checks:

- Authority closure: spec field FOO admitted? Source basis cited?
- Semantic closure: required attributes documented?
- Consumer closure: rendered docs page useful for readers?
- Drift resistance: forbidden shortcuts not introduced?

## Step 9: Record Audit Result

Author `audit-wave-1-add-reference-field.md` recording verdict
and findings.

For the tutorial's sample task, assume verdict = PASS.

## Step 10: Manager Records Closeout

Author `closeout-wave-1-add-reference-field.md` with the four
closure dimensions:

```yaml
authority_closure: closed
semantic_closure: closed
consumer_closure: closed_pending_user_acceptance (or closed)
drift_resistance_closure: closed
disposition: complete
```

For the tutorial's sample task, you might record consumer_closure
as `closed_pending_user_acceptance` if the rendered output still
needs human review.

## Step 11: Close The Wave

Update `topic.yaml`: wave-1 state moves to `closed`.

If the topic still has more work, admit wave-2. Otherwise, move
the topic to closeout (covered separately if you want full
topic closure).

## Step 12: Verify

Run `nimicoding doctor`. It should report a healthy state with
the new wave artifacts in place.

## What You Have Now

After this tutorial, you have:

- A topic with one closed wave.
- All seven artifact types: `topic.yaml`, packet, preflight
  result, worker result, audit, manager judgement (if applicable),
  closeout.
- Demonstrable evidence of the four-closure framework in action.

## What You Have Practiced

| Skill | What you did |
| --- | --- |
| Topic admission | Authored topic.yaml |
| Wave admission | Added wave entry |
| Packet freeze | Frozen execution contract |
| Preflight | Stop-line check |
| Handoff | CLI handoff to host |
| Ingest | CLI ingest of result |
| Audit | Different-host audit |
| Closeout | Four-dimension closure |

## What This Tutorial Did Not Cover

| Concern | Where to find |
| --- | --- |
| Authority convergence gate | [Authority Convergence](/nimicoding/authority-convergence) (when wave touches spec) |
| Overflow continuation | [False Closure Typology](/nimicoding/false-closure-typology) |
| Topic-level closeout | (covered in topic-workflow + topic-lifecycle) |
| True close vs folder closed | [Topic Lifecycle](/nimicoding/topic-lifecycle) |

## Next Step

You now know the full cycle. For specific situations the cycle
needs adjustment, see the [How-to recipes](/nimicoding/how-to/).

## Source Basis

- [`nimi-coding/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/README.md)
- [`nimi-coding/cli/`](https://github.com/nimiplatform/nimi/blob/main/nimi-coding/cli/) (high-risk execution commands)
- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-convergence-policy.yaml)

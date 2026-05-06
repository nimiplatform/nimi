# Topic Workflow

A topic is a governed work track for high-risk or authority-bearing
work. It isn't required for every small edit. It is used when the
work can change product truth, cross multiple owner surfaces, or
produce a result that needs explicit audit before it is accepted.

This page describes how a topic actually flows.

## Typical Flow

A topic moves through a small number of well-named states:

1. **Define** the topic and explain why ordinary local execution is
   not enough. The topic gets a topic id and an entry justification.
2. **Split** the work into waves with clear owner domains. Each wave
   has its own primary closure goal.
3. **Freeze** a packet for the selected wave. The packet declares
   allowed reads, allowed writes, acceptance invariants, negative
   tests, stop lines, and reopen conditions.
4. **Run preflight** before implementation. Preflight is a stop-line
   check, not a rehearsal. It records spec status, authority owner,
   work type, and parallel-truth posture.
5. **Execute** only the admitted scope. The worker is bounded by the
   packet.
6. **Record result evidence** including positive evidence and
   negative checks.
7. **Audit** the wave's output against the acceptance invariants and
   negative tests.
8. **Close the wave** only when the four closure dimensions are
   satisfied.
9. **Close the topic** only when all waves close and the consumer-side
   acceptance is real, not assumed.

Each step has a corresponding artifact under
`.nimi/topics/<state>/<topic-id>/`. The artifacts are the audit trail.

## Why Waves Matter

Large work becomes unsafe when unrelated responsibilities are closed
together. A wave keeps one owner cut in focus. For example, a spec
audit, a docs rewrite, and a landing-page projection are different
waves because they have different authority and consumer risks.

Trying to close all three at once invites the kind of accidental
spec drift the methodology is designed to prevent.

## Reader Scenario: How A Wave Stops Itself

Suppose a wave's worker discovers, mid-implementation, that the work
needs new product truth not present in `.nimi/spec/**`. The packet's
stop lines say to stop in that case. The worker:

1. Stops execution.
2. Records the stop reason as an artifact.
3. Returns the wave to a state that requires admitted spec evidence
   before it can resume.

The wave does not silently invent the missing truth. It also does not
silently fail; it leaves a typed record so the right authority owner
can decide what to admit.

## What False Closure Looks Like

False closure is when the output looks complete from one angle but
fails another closure dimension. A build can pass while the page is
unreadable. A page can be readable while its claims lack source
authority. A route can exist while it has no meaningful reader value.

Nimi Coding treats those as reopen conditions, not as acceptable rough
edges. The current pending docs remediation topic is exactly that
kind of reopen: wave-0 closed by machine audit, but human consumer
acceptance was not yet recorded.

## Reader Scenario: How A Topic Reopens After Acceptance Failure

Suppose a wave closes by machine evidence, but the user reviews the
result and rejects it. The expected flow:

1. The topic stays in pending. It doesn't true-close.
2. The pending note records the reason for not closing.
3. A new wave is admitted under the same topic with bounded scope.
4. The new wave goes through its own preflight, packet, execution,
   audit, and closeout.
5. The topic only true-closes when human acceptance is recorded.

That sequence is why the methodology distinguishes wave closeout from
topic closeout, and why pending is a real state instead of a
transitional one.

## Source Basis

- [`.nimi/methodology/topic-lifecycle-report.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/topic-lifecycle-report.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-convergence-policy.yaml)
- [`.nimi/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/packet.schema.yaml)
- [`.nimi/contracts/result.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/result.schema.yaml)
- [`.nimi/contracts/topic-step-decision.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/topic-step-decision.schema.yaml)

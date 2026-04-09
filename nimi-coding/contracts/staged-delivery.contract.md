# Staged Delivery Contract

Staged delivery is enabled by audit routing, not by task labels.

## Required Roles

- `manager`
  - converge authority
  - freeze phase boundaries
  - accept, reject, defer, or reopen
- `worker`
  - execute one bounded phase
  - run required checks
  - return structured output
- `autonomous-runner`
  - optional bounded mechanical operator
  - consume only a frozen execution packet plus existing topic artifacts
  - validate, route, and pause on declared escalation conditions
  - must not perform semantic acceptance, final confirmation, or finding inference
  - may invoke only admitted module-owned provider execution surfaces and consume only module-owned worker runner signals

## Required Outcomes

Each execution attempt inside a frozen phase must close as exactly one of:

- `complete`
- `partial`
- `deferred`

Outcome semantics are:

- `complete`: current frozen phase is closed and may advance
- `partial`: current attempt is closed but the same frozen phase remains active for another worker attempt
- `deferred`: current attempt is closed and requires pause, blocker handling, or explicit reopen/defer handling

## Required Inputs

Each dispatched phase must define:

- goal
- authority reads
- confirmed state
- hard constraints
- explicit non-goals
- required checks
- output format

## Autonomous Mode

Autonomous mode is a staged-delivery specialization, not a new authority model.

- It may start only when a frozen execution packet exists.
- It consumes the packet as post-freeze execution authority.
- Resumable autonomous mode may additionally persist orchestration state as packet-bound run position.
- Stateless batch skeleton remains valid and does not require orchestration state.
- It does not replace manager semantic authority.
- It may write packet-declared mechanical acceptance records for `complete` or `deferred`, but it must not perform semantic acceptance, infer `partial`, close topics, or infer finding status changes.
- It must pause on packet-declared escalation conditions rather than continue through ambiguity.
- Provider execution inside autonomous mode remains operational worker invocation only; it must not rewrite orchestration semantics or turn automation into a general orchestration marketplace.

## Manager Review Boundary

Manager review is the phase-close gate, not a per-run execution gate.

- A frozen phase may contain multiple worker attempts before manager closes that phase as `complete`.
- Manager review may issue findings and return `partial`, keeping the same frozen phase active.
- Worker reruns after `partial` remain inside the same frozen phase and must not require a fresh freeze cycle unless authority changes.
- Terminal phase closure is still manager-owned; user confirmation belongs to overall acceptance or topic closeout, not per-phase progression.

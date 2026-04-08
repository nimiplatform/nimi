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

## Required Outcomes

Each phase must close as exactly one of:

- `complete`
- `partial`
- `deferred`

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
- It does not auto-accept phases, close topics, or infer finding status changes.
- It must pause on packet-declared escalation conditions rather than continue through ambiguity.

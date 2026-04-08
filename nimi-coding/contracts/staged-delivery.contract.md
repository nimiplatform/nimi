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

# Write Fail-Closed Acceptance Invariants

Use acceptance invariants to make a missing requirement produce a real
failure instead of a plausible completion claim.

## Recipe

1. Name the canonical authority and affected consumer.
2. Write each invariant as an observable predicate.
3. Include at least one negative or unavailable-state check.
4. Name the real command or runtime interaction that proves it.
5. State what must happen when evidence cannot be obtained.

## Weak And Strong Forms

| Weak | Fail-closed |
| --- | --- |
| “Auth works” | “The real Desktop shell signs in through the shared SDK; missing Runtime returns the declared disabled/error state without local fallback” |
| “UI looks good” | “Desktop and narrow captures show no clipping; DOM inspection confirms labels, focusability, disabled state, and no console errors” |
| “Tests pass” | “The named affected-scope commands exit zero and the real consumer path succeeds; either failure blocks completion” |

## Required Evidence Shape

Evidence records the command or interaction, actual result, timestamp
when required, and remaining gaps. Never write the expected result into
the evidence slot before the check runs.

## Source Basis

- [`.nimi/methodology/core.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/core.yaml)
- [`.nimi/contracts/placement-contract.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/placement-contract.schema.yaml)
- [`.nimi/contracts/negative-fixtures.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/negative-fixtures.yaml)

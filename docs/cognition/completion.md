# Completion

Cognition Completion contract governs the gates around how
cognition outputs become useful artifacts. It declares
completion gates — the typed checks an output must pass before
it is admitted as a real artifact.

## What Completion Gates Are

Completion gates are admitted in
`tables/completion-gates.yaml`. Each gate declares:

| Field | Purpose |
| --- | --- |
| Gate id | Stable identity |
| Trigger | When the gate fires |
| Validator | What it validates |
| Outcome | Pass / fail / quarantine |
| Reason codes | Typed reasons for outcome |

A completion that fails a gate does not produce an artifact
silently. Either the output is admitted under typed gate or
quarantined / refused.

## Why Gates At Completion

Without gates, model output flows directly into typed artifacts.
With gates, output passes through admitted validation:

- Schema validity
- Provenance check
- Sensitivity classification
- Cross-reference validation
- Cleanup eligibility check

Gates are what keep "the model said something" from becoming
"this is a typed canonical artifact" without explicit admission.

## Reader Scenario: A Memory Save Passes Completion Gates

An agent saves a typed memory record.

1. **Save submitted.** Memory service receives.
2. **Completion gates evaluate.** Schema validates; cross-refs
   check (no cross-scope leakage); admission.
3. **All gates pass.** Memory record admitted with typed shape.
4. **Service-derived metadata computed.** Support, lineage.
5. **Audit lineage.** Save event recorded.

The agent's save is admitted under explicit gate. There is no
"silent admission."

## Reader Scenario: A Knowledge Save With A Missing Target Reference

An agent saves a knowledge page that references another page
that does not exist (cross-ref miss).

1. **Save submitted.** Knowledge service receives.
2. **Completion gate fires.** Cross-reference validation.
3. **Missing target.** Reference target does not exist in scope.
4. **Reject.** Fail-closed; typed error returned.
5. **Agent sees reason.** "Missing reference target X."

The reference is **not silently dropped**. The platform refuses
to admit a knowledge page that points to nothing.

## Reader Scenario: A Skill Bundle Step Validation

A skill bundle has ordered steps. One step has empty content.

1. **Skill bundle save.** Skill service receives.
2. **Completion gate.** Validates step ordering; checks
   non-empty validation per step.
3. **Empty step found.** Validation fails.
4. **Reject.** Bundle is not admitted; typed error explains
   which step is invalid.

The bundle does not get admitted in a half-state.

## Standalone Completion Standard

Cognition holds a strict standard: cognition is admitted only
when it is **production-grade, not as a reduced skeleton**.

| Forbidden | Reason |
| --- | --- |
| Pseudo-implementation | Cannot pretend to implement |
| Fake success | Cannot return success when no real work happened |
| Placeholder cleanup | Cannot mark records cleaned without actually cleaning |

This is what differentiates Cognition from "an in-progress
service that mostly works." Either Cognition is admitted as
production-grade for the artifact family, or that family stays
outside the public artifact surface.

## What Completion Does Not Do

| Concern | Why not |
| --- | --- |
| Mutate truth (kernels) | Kernels are core; advisory cannot demote |
| Bypass validation | Fail-closed by design |
| Silent partial save | No half-admitted artifacts |

## Boundary Summary

| Concern | Owner |
| --- | --- |
| Gate definitions | `tables/completion-gates.yaml` |
| Validation | Service-side |
| Outcome | Admitted / quarantined / rejected (typed) |
| Production-grade standard | Cognition admission policy |

## Source Basis

- [`.nimi/spec/cognition/standalone-services.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/standalone-services.authority.yaml)

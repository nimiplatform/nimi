# Authority Convergence

Authority convergence is the fail-closed rule for spec, authority, and
redesign work. Before implementation changes canonical truth, the
current Codex task must establish the owner, inspect conflicts, and
obtain the required independent judgement.

## Preflight

| Field | Required answer |
| --- | --- |
| `Spec Status` | Is active authority present, sufficient, and internally consistent? |
| `Authority Owner` | Which canonical surface decides the change? |
| `Work Type` | Is this alignment or an admitted redesign? |
| `Parallel Truth` | Would the proposed implementation create another owner? |

Any unresolved blocking answer stops implementation.

## Convergence Sequence

1. Codex reads current authority and affected consumers.
2. An independent review identifies contradictions, missing owners, and
   downstream impact.
3. The authority owner resolves admitted decisions in `.nimi/spec/**`.
4. Codex implements against the converged truth.
5. Validators and real-consumer checks prove alignment.
6. Acceptance reviews the evidence and disposition.

This is a semantic sequence, not an execution scheduler. Codex decides
how to plan and coordinate each step.

## Stop Conditions

- no canonical owner exists;
- two active sources claim the same truth;
- redesign has no prior authority decision;
- a downstream app is being used to redefine an upstream contract;
- required independent review or evidence is missing.

The correct response is explicit blocking or partial disposition, not a
plausible fallback.

## Source Basis

- [`.nimi/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/authority-convergence-policy.yaml)
- [`.nimi/contracts/authority-convergence-audit.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/authority-convergence-audit.schema.yaml)
- [`.nimi/spec/platform/kernel/package-authority-admission-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/kernel/package-authority-admission-contract.md)

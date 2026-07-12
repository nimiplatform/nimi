# Reconcile Divergent Audits

Two independent reviews disagree about the same authority surface or
result. Do not average the verdicts or select the convenient one.

## Recipe

1. Confirm both reviews used the same canonical authority revision and
   inspected the same implementation.
2. Normalize each finding into claim, evidence, affected owner, and
   severity.
3. Reproduce disputed evidence with real commands or runtime checks.
4. Ask the canonical authority owner to resolve semantic disagreement.
5. Record which finding holds and why.
6. Rerun independent review against the resolved state.

## Decision Rules

| Situation | Result |
| --- | --- |
| One review used stale authority | Discard that verdict and rerun |
| Findings cover different risks | Keep both; satisfy both required checks |
| Evidence is not reproducible | Treat the claim as unresolved, not passed |
| Product judgement differs | Escalate to the named human authority owner |
| A blocker is confirmed | Keep the Codex task open until fixed and rechecked |

The reconciliation record is local evidence. It cannot rewrite
`.nimi/spec/**` by implication.

## Source Basis

- [`.nimi/contracts/authority-convergence-audit.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/authority-convergence-audit.schema.yaml)
- [`.nimi/contracts/acceptance.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/acceptance.schema.yaml)
- [`.nimi/methodology/role-separation-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/role-separation-policy.yaml)

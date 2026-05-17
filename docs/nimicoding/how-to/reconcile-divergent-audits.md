# How To Reconcile Divergent Audits

Two audits ran on the same wave (or the same packet decision)
and returned different verdicts. How do you reconcile?

## Recipe

1. **Verify both audits are real.** Check that each audit was
   produced by an admitted independent loop, recorded under
   typed contract.
2. **Read the findings, not just the verdicts.** A `PASS` audit
   may have caveats; a `NEEDS_REVISION` audit may name specific
   blockers.
3. **Stricter verdict wins by default.** If one audit says
   `NEEDS_REVISION` and another says `PASS`, the `NEEDS_REVISION`
   verdict's findings are the active gate. The `PASS` audit
   cannot soften the blocker.
4. **The findings drive the resolution.** Address the named
   blockers; do not just re-audit hoping for `PASS`.
5. **Record an explicit reconciliation artifact.** Author
   `audit-reconciliation-<topic-or-wave-id>.md` capturing both
   audits, the findings list, and the chosen resolution.
6. **If reconciliation is not a code fix** (e.g., the `PASS`
   audit was correct and the `NEEDS_REVISION` audit was based on
   a misread), record the rationale and the audit's correction
   pathway.
7. **Re-audit if needed.** After resolution, re-run independent
   audit; record the new verdict.

## Why Stricter Wins By Default

The four-closure framework requires all four dimensions to be
explicit. A `NEEDS_REVISION` finding identifies a specific gap.
A `PASS` audit that does not address that gap is silent on it,
not contradicting it.

The methodology's structural rule:
**unresolved blocking findings fail closed**. A `PASS` cannot
override a blocking finding by simple disagreement; the finding
must be addressed (resolved, declared non-blocking, or
demonstrated invalid by typed evidence).

## Reader Scenario: A Real Reconciliation

Wave-1 of the previous public docs remediation topic was audited
by two independent sessions:

- Audit A: PASS
- Audit B: NEEDS_REVISION (with specific design-only-language
  finding)

The reconciliation:

| Step | Action |
| --- | --- |
| Both audits real | Confirmed |
| Findings examined | Audit B's blocker was about boundary wording in topic-level files |
| Stricter wins | Audit B's NEEDS_REVISION held |
| Resolution | Update boundary wording; preflight rescoped to admit later waves |
| Reconciliation artifact | `external-audit-round-N-reconciliation.md` |
| Re-audit | Implicit in subsequent wave admission audits |

Audit A's PASS was accepted for design-package completeness; it
did not override Audit B's boundary-wording blocker. The
resolution addressed Audit B's specific finding.

## Reader Scenario: Two PASS Verdicts With Different Caveats

Audit A: PASS, with non-blocking note "consider adding example"
Audit B: PASS, with non-blocking note "consider tightening
forbidden-shortcuts list"

These are not divergent in verdict; they are convergent with
non-overlapping non-blocking notes.

Recipe:

1. Both PASS verdicts are admitted.
2. Non-blocking notes are recorded as future-improvement
   candidates.
3. No reconciliation artifact required (verdicts converge).
4. Future wave may pick up the non-blocking notes as scope.

## Reader Scenario: A Disputed Verdict

Audit A: PASS
Audit B: FAIL with finding "the work introduced
`silent_owner_cut_reopen`"

The reconciliation:

| Step | Action |
| --- | --- |
| Verify Audit B's finding | Inspect the work; check whether the owner cut was reopened |
| If finding holds | Audit B's FAIL is the active gate; the wave's owner-cut reopen must be resolved or explicitly admitted |
| If finding does not hold | Audit B's evidence is corrected; reconciliation artifact records why; Audit A's PASS holds |

Either way, the resolution is **typed and recorded**, not "we
took the verdict we liked."

## What To Watch For

| Symptom | Meaning |
| --- | --- |
| Two audits same loop | Reject both; auditor must be independent |
| Looser audit picked because faster | Soft pass; reject |
| Reconciliation skipped | Methodology rule violation; demand reconciliation artifact |
| Re-audit until PASS | Soft pass; the findings still need addressing |

## Source Basis

- [`nimi-coding/contracts/result.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/result.schema.yaml)
- [`nimi-coding/contracts/decision-review.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/decision-review.schema.yaml)
- [`nimi-coding/methodology/authority-convergence-policy.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/methodology/authority-convergence-policy.yaml)
- [`nimi-coding/methodology/role-separation-policy.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/methodology/role-separation-policy.yaml)

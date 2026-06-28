# Reference Graph

## Status: Admitted Contract; Release-Gated Surface

The admitted reference matrix and refgraph explainability boundary
(`C-COG-047..C-COG-049`) are admitted. Cross-family ref tooling and
cleanup proposal UI are Cognition-owned surfaces and are not app-owned APIs.

## What The Reference Graph Is

Cognition's **reference graph** (refgraph) is the authority for
how local static cognition artifacts relate to each other. It
answers: "if I delete this knowledge entry, what depends on it?
What's broken if I do?" The refgraph is the explainability surface
for cleanup and digest decisions.

## Admitted Reference Matrix

The authority surface:

| Concern | Authority |
| --- | --- |
| Admitted reference matrix | `tables/admitted-reference-matrix.yaml` |
| Reference matrix rules | `C-COG-047` |
| Explainability boundary | `C-COG-048` |
| Missing-target + cleanup blocking | `C-COG-049` |

Every registered cognition family must appear exactly once in the
matrix. Per family the matrix declares:

| Declaration | Meaning |
| --- | --- |
| Allowed outgoing refs | Which families this one may reference |
| Allowed incoming refs | Which families may reference into this one |
| Forbidden cross-family refs | Explicit "this combination is not admitted" entries |
| Cross-scope prohibition | Whether refs may cross cognition scopes |
| Missing-target effects | Per family: what happens when a referenced target is missing |

Cross-family reference admission lives in this matrix — not in
storage convenience or permissive tests.

## Kernel vs Advisory Reference Rules

Kernel rules may own outgoing refs to standalone advisory artifacts
**only** where the matrix explicitly admits `memory_substrate`,
`knowledge_projections`, and `skill_artifacts` as kernel targets.

Kernels remain **forbidden as incoming reference targets**. Advisory
artifacts cannot claim kernel ownership by storing reverse refs into
kernel families.

This rule prevents authority inversion: an advisory artifact storing
a back-ref into a kernel does not promote itself to kernel ownership.

## Explainability Boundary (C-COG-048)

The refgraph is the explicit explainability authority for local
static cognition artifact relations:

| Property | Value |
| --- | --- |
| Cleanup proposals | Must remain traceable to broken refs / incoming support / outgoing dependency health / remove blockers |
| Explainability | Must remain explicit and queryable; not hidden inside digest heuristics |
| Truth scope | Local static relation only — does NOT absorb runtime review, replication, alias, or provider-ranking semantics |
| `knowledge_relation` rows | First-class cognition-local relation truth; participate in backlink, traversal, delete blocker, and digest cleanup reasoning |
| Remove blockers | Distinguish strong vs weak inbound support; do not flatten both into one generic blocker string |
| Removed sources | Do not contribute live support |
| Removed targets | Remain visible as broken dependency evidence |

## Missing-Target Semantics (C-COG-049)

Missing-target behavior is **family-specific** and fail-closed:

| Family-declared behavior | Effect |
| --- | --- |
| `reject` on missing target | Save-time mutation must fail before commit |
| Other family-declared behaviors | As declared in the matrix |

Archive or remove blocking caused by missing or incoming relations
must remain explicit in cleanup reasoning. Cleanup blocking must
not be silently bypassed by forcing a generic remove path through
storage ownership alone.

Digest `remove` requires prior archival plus a later pass
confirmation. Same-pass archive-and-remove is not admitted.

## Reader Scenario: A User Wants To Delete A Knowledge Entry

A user wants to remove a knowledge entry. The refgraph governs
whether removal is safe.

1. **Cleanup proposal.** System enumerates incoming refs to this
   entry across admitted families.
2. **Explainability surface.** Each incoming ref is shown with its
   support strength (strong / weak) and family origin.
3. **Remove blockers.** If strong incoming refs exist, removal is
   blocked with explicit reason; the user sees what depends on the
   entry.
4. **User chooses.** Either remove the dependents first, or accept
   the broken dependency evidence.
5. **Digest pass.** Remove requires prior archival + a later pass
   confirmation; cannot happen in one shot.

## Reader Scenario: A Cross-Family Reference Attempt

A subsystem tries to create a reference from family A to family B
that the matrix does not admit.

1. **Reference attempted.** Subsystem submits the cross-family ref.
2. **Matrix check.** `forbidden_cross_family_refs` includes `(A, B)`.
3. **Fail close.** Reference is not stored.
4. **Reviewer sees typed reason.** "Cross-family ref (A, B) not
   admitted by matrix."

The matrix is the single authority. Storage that "happens to allow
it" does not.

## Reader Scenario: Authority Inversion Attempt

An advisory artifact tries to store a reverse ref into a kernel
family.

1. **Reference attempted.** Advisory `→` Kernel reverse ref.
2. **Matrix rejects.** Kernels remain forbidden as incoming
   reference targets.
3. **Authority preserved.** The advisory artifact does not become
   the kernel's owner just by storing a back-ref.

## Reader Scenario: A Knowledge Entry Becomes Stale

A maintainer marks an entry as removed. Memory had referenced it.

1. **Entry removed.** Knowledge entry status: removed.
2. **Memory's outbound ref now broken.** Refgraph reflects: target
   removed.
3. **Broken dependency evidence.** Memory's history shows the ref
   was to a now-removed target; the memory is not silently rewritten.
4. **Cleanup proposal.** Surfaces the broken dependency for
   explicit handling.

The boundary keeps "knowledge changed" from silently mutating
"what memory once said."

## What The Reference Graph Does Not Do

- It does not absorb runtime review, replication, alias, or
  provider-ranking semantics.
- It does not let advisory artifacts claim kernel ownership through
  back-refs.
- It does not flatten strong vs weak support into a single blocker
  string.
- It does not let removed sources contribute live support.
- It does not allow same-pass archive-and-remove.
- It does not let storage convenience override matrix-declared
  forbidden cross-family refs.

## Boundary Summary

| Concern | Authority |
| --- | --- |
| Reference matrix | `C-COG-047` + `tables/admitted-reference-matrix.yaml` |
| Explainability + scope | `C-COG-048` |
| Missing-target + cleanup blocking | `C-COG-049` |

## Source Basis

- [`.nimi/spec/cognition/kernel/reference-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/reference-contract.md)
- [`.nimi/spec/cognition/kernel/family-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/family-contract.md)
- [`.nimi/spec/cognition/kernel/cognition-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/cognition-contract.md)

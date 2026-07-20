# Four Closures

Nimi Coding evaluates high-risk results across four independent
dimensions. Codex owns the task completion state; these dimensions
define the evidence required to justify completion.

## Authority Closure

The canonical owner is explicit, current, and aligned with the change.
No downstream surface invents or shadows product truth.

Evidence can include spec references, owner decisions, placement checks,
and absence of prohibited bypasses.

## Semantic Closure

The implementation expresses the behavior and failure semantics declared
by authority. A type-correct approximation is not enough.

Evidence can include focused tests, contract validation, negative cases,
and code inspection at the owning layer.

## Consumer Closure

Real consumers use the canonical seam and deliver the intended outcome.
For app work, this includes the real shell, runtime/auth/SDK connectivity,
accessibility, narrow layout, long text, and failure states.

## Drift-Resistance Closure

Tests and gates make the old failure or owner bypass detectable. The
result does not rely on a reviewer remembering an unwritten rule.

## Decision Rule

| Result | Disposition |
| --- | --- |
| All required dimensions evidenced | `complete` |
| Useful result with explicitly open requirements | `partial` |
| Required truth or evidence unavailable | `deferred` or blocked host task |

One green signal never substitutes for another dimension. In
particular, a green build cannot prove consumer behavior or authority.

## Source Basis

- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
- [`.nimi/methodology/core.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/core.yaml)

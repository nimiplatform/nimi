# Four Closures

The four closures are **a way of thinking**, not just a closeout
schema. You use them to figure out *why* an AI output feels wrong
when nothing has actually failed.

A wave is closed only when **all four** are explicit. Three out of
four isn't closed.

## The Four Dimensions

| Dimension | Question it answers |
| --- | --- |
| Authority | Where does truth for this surface live, and is it internally consistent? |
| Semantic | Are the contract's required fields, failure modes, and complex cases all explicit? |
| Consumer | Do the systems / readers that consume this seam use it correctly? |
| Drift Resistance | Can the next implementer easily walk this design back? |

## Authority Closure

> Where does truth for this surface live, and is it internally
> consistent?

Authority closure asks: after this change, is there exactly one
canonical owner? Has any parallel truth surface (shadow caches,
app-local convenience state, dual-read paths) been eliminated or
explicitly admitted?

| Closes when | Fails when |
| --- | --- |
| Canonical owner is unique | Two surfaces both claim authority |
| No parallel truth remains | An informal cache has become canonical |
| Admitted alterations are explicit | Silent owner-cut reopens occurred |

**Common authority failure**: The AI added a helper that
effectively re-implements behavior owned by another package,
creating shadow truth.

## Semantic Closure

> Are the contract's required fields, failure modes, and complex
> cases all explicit?

Semantic closure asks: would two different implementers of this
contract produce equivalent behavior? Are MIME types, error
reasons, retry policies, and edge case behaviors specified, or
were they "left to the implementation"?

| Closes when | Fails when |
| --- | --- |
| Required fields specified | Required field omitted |
| Failure modes pinned | Happy-path-only |
| Complex cases not deferred as assumptions | "Edge case" parked silently |

**Common semantic failure**: Happy-path-only — the AI
implemented what success looks like and left failure handling
implicit.

## Consumer Closure

> Do the systems / readers that consume this seam use it
> correctly, and can shortcuts not silently become mainline?

Consumer closure asks: does the actual consumer (the app, the
docs reader, the operator) experience this work as solving their
problem? Or did the contract land cleanly while the consumer
remained broken?

| Closes when | Fails when |
| --- | --- |
| Normal consumers use the correct seam | Consumers still use the old seam |
| Shortcuts cannot silently become mainline | A "temporary" shortcut becomes the de-facto path |

**Common consumer failure**: Build-pass / consumer-fail. The
public docs topic that produced the closed-then-reopened cycle is
a textbook example: every machine-side gate passed; the actual
reader rejected the docs as "audit artifact prose."

## Drift Resistance Closure

> Can the next implementer easily walk this design back?

Drift-resistance closure asks: are forbidden shortcuts named, are
reopen conditions explicit, are the boundaries that prevent
regression structurally enforced or only socially enforced?

| Closes when | Fails when |
| --- | --- |
| Forbidden shortcuts are explicit | Shortcuts unnamed and re-discoverable |
| Future implementers cannot easily thin the design | Re-thinning available without explicit admission |

**Common drift failure**: A closeout that passes today but leaves
no machinery to prevent the same shortcut from recurring next
quarter when context is gone.

## Why All Four Matter Independently

**Three-of-four passing is the most common false closure in AI
work.** Each combination of "three pass, one fails" produces a
recognizable pathology:

| Authority | Semantic | Consumer | Drift | Result |
| --- | --- | --- | --- | --- |
| ✓ | ✓ | ✓ | ✗ | Works today, rots in six months |
| ✓ | ✓ | ✗ | ✓ | Technically correct, unusable |
| ✓ | ✗ | ✓ | ✓ | Good UX, unspecified contract |
| ✗ | ✓ | ✓ | ✓ | Parallel authority hidden |

The methodology requires **all four to be explicit**. A closeout
that omits a dimension is a schema violation, not a soft signal.

## Reader Scenario: Reasoning About A Wave Through The Four Closures

You're a manager judging a wave's closeout. The worker says the
wave is done. You walk the four closures:

1. **Authority.** Is canonical truth still in
   `.nimi/spec/**`? Are no shadow paths created? Is
   ownership unambiguous?
2. **Semantic.** Does the kernel rule still pin required fields,
   failure modes, schemas? Are complex cases explicit?
3. **Consumer.** Does the actual app / docs reader / operator
   experience the work as solving their problem? Run the rendered
   site, read the prose, exercise the API.
4. **Drift Resistance.** Is the forbidden shortcut catalog up to
   date? Are reopen conditions named? Could a future hurried
   change re-introduce the wrong pattern?

Three pass; consumer fails. The wave is **not closed**. Send back
for revision or admit a follow-on wave that addresses consumer
gap.

## Reader Scenario: A Real Three-Of-Four Pattern

The previous public docs remediation closed by machine audit:
authority closed (no spec drift), semantic closed (claims matched
spec), drift-resistance closed (forbidden-claim posture
preserved). Consumer **failed** — user rejected the rendered docs
as "audit artifact."

The methodology's response: hold the topic in `pending` (do not
mark `closed`); admit a follow-on wave addressing the consumer
gap. **Do not retroactively edit the closed wave's record.**

This is what the four-closure framework is for. Without it, "build
passes" would have been treated as completion.

## Source Basis

- [`nimi-coding/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/methodology/four-closure-policy.yaml)
- [`nimi-coding/contracts/closeout.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/closeout.schema.yaml)

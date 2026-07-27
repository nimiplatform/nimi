# Prompt Lanes

## Status: Admitted Contract; Release-Gated Surface

The prompt-lane registry (`tables/prompt-serving-lanes.yaml`) and
the `C-COG-050..C-COG-052` prompt-serving contracts are admitted.
The lane-routing implementation across families is a Cognition-owned surface,
not an app-owned routing table.

## What Prompt Lanes Are

A **prompt lane** is an admitted route through which a particular
class of cognition truth reaches the prompt. Lanes are not just
formatter output layout; they govern what kind of truth may flow
where, in what serving order, and what is forbidden.

The fixed authority surface:

| Concern | Authority |
| --- | --- |
| Lane registry | `tables/prompt-serving-lanes.yaml` |
| Lane semantics + serving rules | `C-COG-050` |
| Lane separation + derived metadata | `C-COG-051` |
| Failure model | `C-COG-052` |

## Required Per-Lane Declarations

Every admitted prompt lane must declare:

| Declaration | Purpose |
| --- | --- |
| Serving order | Where this lane sits in prompt assembly |
| Admitted families | Which cognition families may flow through this lane |
| Admitted inputs | What input shapes the lane accepts |
| Derived-view source | Where service-owned derived views come from |
| Forbidden inputs | What may NOT flow through this lane |

A lane that does not declare these is not admitted. Apps cannot
configure new lanes by convention.

## Lane Separation Rule (C-COG-051)

The most important rule on this page:

> Kernel truth remains in a dedicated **core** lane and must never be
> merged implicitly into advisory context.

A lane carries one kind of truth. Other kinds do not get to ride in.

| Lane class | Carries | Forbidden |
| --- | --- | --- |
| Core lane | Kernel truth (admitted authoritative artifacts) | Advisory context |
| Advisory lane | Validated artifacts or service-owned derived views | Working state, routine evidence (unless admitted later), caller-persisted metadata |

Working state and routine evidence are excluded from prompt serving
unless a later cognition rule explicitly admits them. Cleanup,
support, or serving signals may appear in prompt output **only**
when they come from explicit derivation logic — not from
caller-persisted metadata.

## Failure Model (C-COG-052)

Prompt serving must **fail close** on lane or derivation violations:

| Violation | Required behavior |
| --- | --- |
| Missing required kernel artifacts | Explicit failure (no best-effort rendering) |
| Illegal lane mixing | Explicit failure |
| Malformed derived views | Explicit failure |
| Forbidden prompt inputs | Explicit failure |

Formatter convenience must not override family-truth ordering. The
prompt output must not silently imply kernel truth from advisory-only
inputs.

## Why Lane Separation Matters

If kernel truth and advisory context were merged silently, two
failure modes follow:

1. **Authority drift.** The model can't tell which content carries
   admitted authority and which is suggestive — it treats them
   uniformly.
2. **Privacy / safety leak.** Working state or caller-persisted
   metadata that was never admitted into prompts can now influence
   model output.

The lane system is a contract-level guard against both.

## Reader Scenario: A Turn Pulls From Memory + Knowledge + Skill

A turn assembles a prompt that needs:

- Memory (per-participant continuity)
- Knowledge (retrieved facts)
- A validated skill bundle's ordered steps

1. **Lane resolution.** Each piece routes through its admitted lane:
   memory through admitted memory-serving lane, knowledge through
   admitted knowledge-serving lane, skill through admitted
   skill-serving lane.
2. **Family truth ordering preserved.** Core kernel artifacts come
   first; advisory views compose afterward in their declared serving
   order.
3. **No implicit merging.** The model sees clearly-segregated content
   per lane.
4. **Prompt assembled.** Output respects every lane's declared
   inputs and derivation source.

## Reader Scenario: A Forbidden Input Tries To Sneak In

A formatter convenience would let a caller pass arbitrary metadata
into the advisory lane.

1. **Lane validates.** Caller-persisted metadata is on the lane's
   forbidden inputs list (per `C-COG-051`).
2. **Fail close.** Prompt serving raises explicit failure with
   typed reason.
3. **No best-effort rendering.** The prompt is not generated with
   the bad metadata silently ignored — generation fails.
4. **Reviewer sees the truth.** "Lane X rejected forbidden input Y."

The fail-close posture is what keeps the lane contract enforceable.

## Reader Scenario: Working State Tries To Reach The Prompt

Working state (transient cognition processing data) is excluded
from prompt serving by default.

1. **Working state attempted.** A subsystem tries to include working
   state in a prompt.
2. **Reject.** No admitted lane carries working state for this
   family.
3. **No silent demotion.** The system does not quietly let the
   working state through as advisory.
4. **Explicit admission required.** A later cognition rule must
   explicitly admit working state into a lane before it can flow.

## What Prompt Lanes Do Not Do

- They do not let core lanes silently merge into advisory.
- They do not let formatter output choices override family-truth
  ordering.
- They do not allow caller-persisted metadata as advisory derived
  views (only service-owned derivation).
- They do not let working state into prompts without explicit
  admission.
- They do not best-effort-render around lane violations.

## Boundary Summary

| Concern | Authority |
| --- | --- |
| Lane registry | `tables/prompt-serving-lanes.yaml` |
| Lane registry rules | `C-COG-050` |
| Separation + derived metadata | `C-COG-051` |
| Failure model | `C-COG-052` |
| Service that owns prompt assembly | Cognition `PromptService` |

## Source Basis

- [`.nimi/spec/cognition/standalone-services.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/standalone-services.authority.yaml)

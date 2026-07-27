# Prompt Serving

Cognition Prompt Service is the authority for **how** a prompt
is composed for a model. It draws from kernels (core truth) and
advisory artifacts (memory, knowledge, skill) and produces typed
prompt context, with strict separation between the lanes.

## Three Format Methods

| Method | Serves |
| --- | --- |
| `FormatCore` | Kernel truth only — agent kernel + world kernel |
| `FormatAdvisory` | Validated advisory artifacts — memory, knowledge, skill |
| `FormatAll` | Composed core + advisory under admitted ordering |

The three lanes are intentionally separated. `FormatCore` cannot
include advisory content; `FormatAdvisory` cannot include kernel
content; `FormatAll` is the admitted composition.

## Why Lane Separation

Without lane separation, prompt assembly would silently mix
identity context with recalled context. The model would not be
able to tell "this is who I am" from "this is what I remember"
from "this is what I'm currently working on."

With lane separation:

- `FormatCore` is **identity context** — slow-changing kernel
  truth.
- `FormatAdvisory` is **recalled context** — the agent's
  memory / knowledge / skill bundle relevant to this turn.
- Working state and routine evidence are **excluded** from prompt
  serving by design.

The model gets a prompt with explicitly-typed sections; nothing
sneaks in.

## What Working State Does NOT Reach Prompt

Working state is **transient cognition scaffolding** — the agent's
intermediate notes, the routine's bookkeeping, etc. It isn't
durable truth and is **never served as prompt context**.

If working state could leak into prompts, prompts would acquire
arbitrary scaffolding. The hard boundary keeps prompts clean.

## Prompt Lanes

Lanes are admitted under
`tables/prompt-serving-lanes.yaml`. Each lane declares:

| Field | Purpose |
| --- | --- |
| Serving order | Where the lane appears in `FormatAll` |
| Admitted families | Which artifact families this lane reads |
| Admitted inputs | What inputs the lane accepts |
| Derived view source | Which service-derived view backs this lane |
| Forbidden inputs | What is explicitly excluded |

A reader who wants to know "what shape does this lane produce"
goes to the table, not to docs prose.

## Reader Scenario: An Agent's Turn Composes A Full Prompt

An agent is about to produce a turn.

1. **`FormatAll` invoked.** Cognition's prompt service composes
   the full prompt.
2. **Core lane.** Agent kernel + world kernel — slow-changing
   identity.
3. **Advisory lanes.** Memory recall, knowledge query, skill
   bundle — all validated advisory.
4. **Admitted serving order.** Lanes appear in admitted order.
5. **Working state excluded.** Transient scaffolding does not
   leak.
6. **Result handed to Brain.** Model sees typed prompt with
   typed sections.

The model cannot tell "this is identity" from "this is recall"
unless the prompt distinguishes — which the lane separation
ensures.

## Reader Scenario: An App Tries To Inject Through Prompt

An app that has access to the agent's surface attempts to inject
extra context by smuggling it through prompt assembly.

1. **App constructs intended content.** Wants it in the prompt.
2. **Submit to admitted lane.** The lane validates the input
   against its admitted shape.
3. **Forbidden input rejected.** Working state, routine
   evidence, or other forbidden inputs fail validation.
4. **Allowed input admitted under lane.** Stays under that
   lane's typed shape.

An app cannot smuggle working state through prompt assembly.
The lane validation is the gate.

## Reader Scenario: An Auditor Asks "What Did The Model See"

An auditor wants to reconstruct exactly what prompt context the
agent had during a specific turn.

1. **Locate turn.** By trace id.
2. **Read prompt composition.** Cognition records what lanes
   produced what content for this turn.
3. **Reconstruct.** Auditor sees core lane content, advisory
   lane content, ordering.
4. **No hidden content.** Nothing is in the model's input that
   is not in the recorded composition.

Lane separation makes this reconstruction structural.

## Boundary Summary

| Concern | Owner |
| --- | --- |
| Prompt composition | Cognition Prompt Service |
| Lane semantics | `tables/prompt-serving-lanes.yaml` |
| Kernel truth source | Cognition kernels |
| Advisory inputs | Memory / knowledge / skill services (admitted) |
| Working state | Excluded by design |

## Source Basis

- [`.nimi/spec/cognition/standalone-services.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/standalone-services.authority.yaml)

# Cognition Prompt Serving Contract

> Owner Domain: `C-COG-*`

## C-COG-050 Prompt Serving Lane Registry

The authoritative prompt-lane registry is `tables/prompt-serving-lanes.yaml`.

Fixed rules:

- every admitted prompt lane must declare serving order, admitted families,
  admitted inputs, derived-view source, and forbidden inputs
- prompt lanes govern cognition serving semantics, not just formatter output
  layout
- prompt-lane admission must remain explicit even when formatting happens inside
  one `PromptService`

## C-COG-051 Prompt Separation And Derived Metadata Rule

Standalone cognition prompt serving must preserve family truth ordering.

Fixed rules:

- kernel truth remains in a dedicated core lane and must never be merged
  implicitly into advisory context
- advisory lanes may consume only validated artifacts or service-owned derived
  views
- working state and routine evidence are excluded from prompt serving unless a
  later cognition rule explicitly admits them
- cleanup, support, or serving signals may appear in prompt output only when
  they come from explicit derivation logic rather than caller-persisted metadata

## C-COG-052 Prompt Failure Model

Prompt serving must fail close on lane or derivation violations.

Fixed rules:

- missing required kernel artifacts, illegal lane mixing, malformed derived
  views, or forbidden prompt inputs must surface explicit failure rather than
  best-effort rendering
- formatter convenience must not override family-truth ordering
- prompt output must not silently imply kernel truth from advisory-only inputs

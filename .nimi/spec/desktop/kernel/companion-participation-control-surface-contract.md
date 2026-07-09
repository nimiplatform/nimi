# Companion Participation Control Surface Contract

> Owner Domain: `D-LLM-*`

This contract defines Desktop-owned companion participation controls and
projection surfaces for Avatar companion/persona and Desktop companion panels.

## D-LLM-094 Desktop Consumer Boundary

Desktop may display companion participation projection and expose bounded
controls through SDK/Runtime typed methods. Desktop does not own participation
execution, prompt assembly, provider/model routing, memory/cognition writes,
Runtime queue truth, or domain commit.

## D-LLM-095 Control Semantics

Desktop controls may submit or display only through `runtime.companionParticipation`
typed SDK methods:

- explicit user trigger requests
- cancellation/interrupt requests
- replay open requests

Controls must carry typed refs only: `agent_id`, `surface_kind`, `profile_ref`,
`conversation_anchor_ref`, `room_orchestration_ref`, `domain_context_ref`, or
`debug_probe_ref` as applicable.

Avatar debug/probe participation remains Runtime/Avatar-owned. Desktop may
display typed projection state when surfaced by SDK/Runtime, but it must not own
or run a Desktop debug/probe workbench.

## D-LLM-096 Persona Boundary

Desktop may route Avatar companion/persona controls only as typed companion
participation controls. Persona/package variants remain Avatar configuration
and must not create a separate product, app, Runtime facade, prompt path, or
execution owner.

## D-LLM-097 Refusal And Recovery UX

Desktop must render Runtime refusal, blocked, failed, canceled, and missing
evidence states as explicit product states. It must not create a local reply,
retry through a private provider route, or hide the refusal behind a fake
success state.

## D-LLM-098 No Private Scheduler

Desktop companion participation surfaces must not create app-local schedulers,
room queues, fairness budgets, timeout budgets, or queue-status truth for
Runtime participation.

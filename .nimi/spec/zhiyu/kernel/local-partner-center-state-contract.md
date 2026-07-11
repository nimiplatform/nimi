# Zhiyu Local Partner Center State Contract

## Z-STATE-001 Product States

Zhiyu uses the state machine in `tables/product-state-machine.yaml` as the
product state authority. The v1 state set is:

- local_service_unavailable
- no_partner
- partner_candidates_unselected
- model_config_not_ready
- partner_ready
- partner_responding
- recoverable_failure

Bounded LocalAgent source/context `ready`, `blocked`, `truncated`, and `failed`
values are upstream projection inputs mapped into this existing product state
set; they do not add a second Zhiyu state machine or new product states.

## Z-STATE-002 First Screen

The first screen must be the local partner center state, not a diagnostics
dashboard, readiness checklist, capability studio, evidence wall, or disabled
card wall.

## Z-STATE-003 State Truth

Zhiyu may present state derived from admitted upstream projections and local UI
state. It must not synthesize partner readiness, model readiness, memory state,
Runtime session state, or Avatar carrier readiness.

LocalAgent source/context state is derived only from the closed Runtime/SDK
`LocalAgentSourceContextStatus` and `AgentTurnContextSummary` projections.
Ready, blocked, truncated, and failed remain distinct typed states. Unknown,
partial, malformed, unsupported, or absent-required projection state never
maps to `partner_ready`; it maps to a typed unavailable/recoverable failure.
Zhiyu must not maintain a second readiness reducer over raw source, profile,
prompt, lane, memory, proof, or diagnostics data.

## Z-STATE-004 Check Local Service

`检查本地服务` must run a real health reconnect action: probe Runtime/auth/SDK
bridge, refresh product state, and show owner-aware failure with diagnostics on
failure. It must not be a no-op button.

## Z-STATE-005 Runtime Emotion Projection

Zhiyu companion emotion state must derive only from admitted Runtime Agent
emotion ontology ids. Zhiyu must preserve the ontology id and intensity as
truth-axis evidence, derive `AvatarEmotionCue` through the Kit avatar emotion
mapping surface, and expose both axes through product evidence. Unknown emotion
ids, unknown intensity values, and neutral emotion with intensity must fail
closed into typed `emotionViolation` evidence without displaying the rejected
raw value. Non-emotion Runtime Agent activity events must not overwrite the
current companion emotion projection.

# Runtime Agent App Consume Contract

> Owner Domain: `K-AGCORE-*`

Runtime Agent app-facing reactive chat consume and scoped binding attachment authority.

This file is a semantic split from `runtime-agent-service-contract.md`; Rule IDs and rule text remain authoritative under Runtime kernel.

## K-AGCORE-032 App-Facing Reactive Chat Consume Seam

`RuntimeAgentService` owns one admitted app-facing reactive chat consume seam
for first-party host surfaces.

Fixed rules:

- the canonical transport target for that seam is the reserved runtime app
  target `runtime.agent`
- the admitted ingress families on that target are:
  `runtime.agent.turn.request`,
  and `runtime.agent.turn.interrupt`
- the admitted projection families on that target are:
  `runtime.agent.turn.accepted`,
  `runtime.agent.turn.started`,
  `runtime.agent.turn.reasoning_delta`,
  `runtime.agent.turn.text_delta`,
  `runtime.agent.turn.structured`,
  `runtime.agent.turn.message_committed`,
  `runtime.agent.turn.action_planned`,
  `runtime.agent.turn.action_started`,
  `runtime.agent.turn.artifact_ready`,
  `runtime.agent.turn.action_completed`,
  `runtime.agent.turn.action_failed`,
  `runtime.agent.turn.post_turn`,
  `runtime.agent.turn.completed`,
  `runtime.agent.turn.failed`,
  `runtime.agent.turn.interrupted`,
  and `runtime.agent.turn.interrupt_ack`
- full public chat session snapshot is a query and must use
  `RuntimeAgentService.GetPublicChatSessionSnapshot`; it must not be modeled as
  an app-message request/reply pair
- `runtime.agent.*` remains the steady-state lifecycle/state/memory/admin/read
  RPC projection and must not be restated as a second reactive-chat app-message
  family
- the reserved app target is only the carrier for this seam; semantic
  ownership of `runtime.agent.turn.*` / `runtime.agent.session.*` remains on
  `RuntimeAgentService`
- host surfaces must consume runtime-owned `session` / `turn` / `stream` truth
  through this seam rather than reconstructing shadow chat orchestration,
  provider-native sidecar parsing, or provider-native transcript truth locally
- host surfaces must bind or recover the appropriate `conversation_anchor_id`
  explicitly; runtime must not infer that all host surfaces attached to one
  `agent_id` belong to the same reactive conversation
- host surfaces must open or recover anchors through the runtime-owned
  `OpenConversationAnchor` / `GetConversationAnchorSnapshot` surface before
  sending `runtime.agent.turn.request`; app-local guessed anchor ids are not
  admitted continuity truth
- typed chat-sidecar / structured projection on this seam remains runtime-owned
  semantic output; hosts may render or act on it, but must not reinterpret raw
  provider output as canonical chat truth
- current transport authorization and subscription posture for turn ingress and
  turn projection remains governed by the admitted `RuntimeAppService` /
  app-messaging path; query surfaces are owned by `RuntimeAgentService` unary
  RPCs

## K-AGCORE-052 Scoped Binding Attachment For App-Facing Consume

Explicit binding-only first-party consume modes must attach a Runtime-issued
scoped binding to every app-facing reactive consume operation. Default Nimi
Avatar launch is not binding-only; it consumes runtime-agent through admitted
local first-party Runtime / SDK account and agent authorization paths.

Fixed rules:

- `runtime.agent.turn.request` and `runtime.agent.turn.interrupt` carried over
  `RuntimeAppService` must include `ScopedRuntimeBindingAttachment` with at
  least `binding_id`.
- `RuntimeAppService.SubscribeAppMessages` used to consume
  `runtime.agent.turn.*` or `runtime.agent.presentation.*` projections must
  include the same attachment.
- `RuntimeAgentService.GetPublicChatSessionSnapshot` used by binding-only
  consumers must include the same attachment on `AgentRequestContext`.
- `RuntimeAgentService.SubscribeAgentEvents` used by binding-only consumers to
  merge `runtime.agent.state.*`, hook, or presentation-adjacent projections
  must include the attachment on `AgentRequestContext`.
- Runtime must validate the attachment against the binding relation:
  `runtime_app_id`, app/window relation where available, `avatar_instance_id`
  where available, `agent_id`, `conversation_anchor_id` for anchor-scoped
  surfaces, optional `world_id`, required scope, state, expiry, and current
  authenticated account state.
- Missing, revoked, expired, stale, suspended, superseded, replayed,
  relation-mismatched, scope-mismatched, or account-non-authenticated bindings
  fail closed with typed unavailable / permission status.
- `subject_user_id` remains available for unrelated Web/cloud or
  external-principal paths, but it is never scoped binding proof.
- Default local first-party Avatar must not be forced through this binding
  attachment path solely because Desktop launched it.

# Agent Hook Intent Contract

> Owner Domain: `K-AGCORE-*`

## K-AGCORE-040 HookIntent Narrow-Admission Authority Home

`RuntimeAgentService` owns narrow-admission `HookIntent` truth for deferred
continuation on the live agent path.

It owns:

- validation of model-proposed hook intent
- admission / rejection decision
- pending lifecycle truth
- execution outcome and replay-visible observability

It does not own:

- a general timer, deadline, or appointment object model
- host automation or proactive contact semantics beyond the admitted effect set

## K-AGCORE-041 HookIntent Shape And Admission States

The admitted semantic object is `HookIntent`.

Its minimum typed shape is:

- `intent_id`
- `agent_id`
- optional `conversation_anchor_id`
- optional `originating_turn_id`
- optional `originating_stream_id`
- `trigger_family`
- `trigger_detail`
- `effect`
- `admission_state`

Fixed rules:

- admitted `trigger_family` is limited to `time` and `event`
- admitted `trigger_detail` is limited to:
  - `time(delay_ms)`
  - `event(user-idle, idle_ms)`
  - `event(chat-ended)`
- admitted `effect` is limited to `follow-up-turn`
- admission states must remain reconstructable through committed runtime truth
  and include `proposed`, `pending`, `rejected`, `running`, `completed`,
  `failed`, `canceled`, and `rescheduled`

## K-AGCORE-042 Hook Event Projection Seam

The public runtime event seam for narrow-admit hook intent is:

- `runtime.agent.hook.intent_proposed`
- `runtime.agent.hook.pending`
- `runtime.agent.hook.rejected`
- `runtime.agent.hook.running`
- `runtime.agent.hook.completed`
- `runtime.agent.hook.failed`
- `runtime.agent.hook.canceled`
- `runtime.agent.hook.rescheduled`

Fixed rules:

- `intent_proposed` is the projection of a validated APML hook proposal before
  runtime admission finalizes
- `pending` is the only admitted "accepted into scheduler truth" state
- reject reasons, conflict replacement, and budget/autonomy denial must remain
  observable through `runtime.agent.hook.rejected`
- hook event projection requires `agent_id`; origin linkage back to
  `conversation_anchor_id`, `originating_turn_id`, and
  `originating_stream_id` must be preserved when present

## K-AGCORE-043 Narrow-Admission Constraints

`HookIntent` v1 remains intentionally narrow.

Fixed rules:

- runtime must validate trigger/effect compatibility before a proposal becomes
  pending truth
- budget, autonomy, cadence-spacing, and conflict/replace policy remain
  runtime-owned admission gates
- new pending intent on the same continuity branch may replace an older pending
  follow-up only through explicit runtime-visible conflict handling
- failure to admit a hook intent must not be silently ignored or converted into
  process-local hidden timer behavior
- widening beyond the admitted trigger/effect matrix requires a later dedicated
  runtime rule, not implicit expansion

## Fact Sources

- `.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`
- `.nimi/topics/proposal/2026-04-20-desktop-agent-live2d-companion-substrate/apml-design.md`
- `.nimi/topics/proposal/2026-04-20-desktop-agent-live2d-companion-substrate/event-hook-contract.md`

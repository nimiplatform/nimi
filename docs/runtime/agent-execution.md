# Agent Execution

> Status: Mixed. `RuntimeAgentService` is the runtime authority for
> supported agent chat and lifecycle. Life Track and hooks are partial:
> the first release promise covers narrow follow-up-turn only, not
> general reminders or app scheduler ownership.

`RuntimeAgentService` is the runtime-owned authority for agent
execution. It owns multi-agent lifecycle, conversation continuity,
supported Chat Track execution, narrow follow-up-turn hook admission,
memory admission policy, and presentation projection. Broader Life Track
autonomy, general reminders, appointments, and app-authored scheduling
are outside the first release promise.

This page is the runtime-side overview. For depth see:

- [Participation Authority](/platform/agents/participation-authority.md) — non-canonical participation profiles
- [Cross-Surface Continuity](/platform/agents/cross-surface-continuity.md) — `ConversationAnchor` + late-join + recovery
- [Agent Presentation Stream](/runtime/presentation-stream.md) — `runtime.agent.*` event projection + APML wire
- [Voice Asset Lifecycle](/runtime/voice-asset-lifecycle.md) — `VoiceAsset` runtime-owned voice resource

## What RuntimeAgentService Owns

| Responsibility | Surface |
| --- | --- |
| Multi-agent lifecycle | Concurrent `agent_id` lifecycles |
| Conversation continuity | `ConversationAnchor` per agent + per conversation |
| Chat / Life track execution | Reactive chat + partial narrow follow-up-turn path |
| Hook scheduling | Typed `HookIntent` admission and dispatch for narrow follow-up-turn only |
| Memory write admission | Bounded by admitted memory contracts |
| Presentation projection | Persistent profile + transient stream |
| APML output parsing | Typed event projection from APML wire format |

There is **no platform default current agent**. The runtime hosts
multiple `agent_id` lifecycles concurrently; an app or surface
selects which agent it is interacting with.

## ConversationAnchor

The conversation anchor is the runtime-owned continuity identity
that lets multiple surfaces share **one** conversation without
collapsing into a global session.

| Property | Value |
| --- | --- |
| Scope | Per-agent + per-conversation |
| Owner | Runtime |
| Persistence | Survives surface switch (Desktop chat → Avatar → Web) |
| Multiplicity | One agent can have multiple anchors (multiple parallel conversations) |

For the product framing, see
[Platform → Agents → Conversation Anchor](/platform/agents/conversation-anchor).

## AgentPresentationProfile

The persistent presentation profile is runtime-owned, slow-changing
truth about how an agent is presented:

| Field | Purpose |
| --- | --- |
| Avatar backend | Live2D / VRM / generated-motion |
| Asset reference | Carrier-specific asset binding |
| Expression preset | Default expression behavior |
| Voice binding | Voice profile reference |

The profile survives runtime restart and cross-surface reuse.
Avatar consumes it; Avatar doesn't redefine it.

## Agent Presentation Stream

Distinct from the persistent profile, the **presentation stream**
is the transient projection seam: turn projection, current emotion
projection, stream commit semantics. This is what Avatar
consumes turn-by-turn for embodied surfaces.

| Owner | Runtime |
| --- | --- |
| Turn projection | `runtime.agent.turn.*` |
| Activity events | `runtime.agent.activity.*` |
| Posture events | `runtime.agent.pose.*` |
| Lipsync frames | `runtime.agent.lipsync.*` |

## APML Output Wire Format

The model-facing contract for agent output is **APML** (Agent
Personality Markup Language).

| Root tag | Purpose |
| --- | --- |
| `<life-turn>` | Proactive life-track output |
| `<chat-track-sidecar>` | Reactive chat-track sidecar |
| `<canonical-review>` | Canonical review output for memory admission |

JSON executor compatibility is **not admitted**. APML is parsed
and projected into typed runtime events before any product code
sees it. Apps consume the typed events, not raw APML.

This is a deliberate design: the model emits structured agent
output; runtime validates the structure; product code receives
typed events that cannot encode shapes the runtime did not admit.

## Hook Intent Admission

Agents request narrow follow-up-turn action through typed `HookIntent`
records, not free-form scheduling strings. Runtime validates and admits
only the release-promised follow-up-turn path.

| Lifecycle state | Meaning |
| --- | --- |
| `pending` | Admitted; awaiting fire time |
| `running` | Currently executing |
| `completed` | Successful terminal |
| `failed` | Failed terminal |
| `canceled` | Canceled before completion |
| `rescheduled` | Moved to new schedule; transitions back to `pending` |
| `rejected` | Refused at admission |

For the product framing, see
[Platform → Agents → Hook Intent](/platform/agents/hook-intent).

## Multi-Agent By Default

Runtime hosts multiple `agent_id` lifecycles concurrently. An app
that wants to interact with a specific agent provides the
`agent_id`; runtime does not assume which agent.

| Concurrency | Detail |
| --- | --- |
| Per-agent state | Each agent has its own anchor set, partial follow-up-turn hook state, presentation profile |
| Per-conversation state | Each conversation has its own anchor |
| Cross-agent isolation | Memory bank scopes (`AGENT_CORE` / `AGENT_DYADIC`) keep agents from reading each other's private state |
| Concurrent execution | Multiple agents can run supported Chat paths; broader Life concurrency is outside the first release promise |

## Reader Scenario: Two Agents In One Surface

A user has two agents on a single Desktop window — perhaps a
project assistant and a personal assistant. Both can act
concurrently.

1. **Each has its own lifecycle.** Runtime tracks both
   `agent_id`s independently.
2. **Each has its own anchors.** The user has separate
   conversations with each.
3. **Each has its own life track.** Both can have life enabled
   independently; their token budgets do not pool.
4. **Their memory is scoped.** `AGENT_CORE` for each is private;
   they do not see each other's private memory.
5. **Audit lineage** preserves which agent took which action.

Two agents under one user; no shared state by default.

## Reader Scenario: A Conversation Anchor Survives Crash

User is in a conversation in Avatar. Avatar crashes.

1. **The anchor lives in Runtime.** Not in Avatar; not in Desktop.
2. **User reopens Avatar.** Avatar reconnects to runtime.
3. **Anchor resolution.** Avatar resolves the same
   `(agent_id, conversation_id)`; the anchor is still there.
4. **Conversation resumes.** Realm chat thread retains messages;
   memory writes that were in flight follow
   replication state.

The anchor's runtime ownership is what makes surface failure
survivable.

## Source Basis

- [`.nimi/spec/runtime/agent-service.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-service.authority.yaml)
- [`.nimi/spec/runtime/agent-participation.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/agent-participation.authority.yaml)
- [`config/spec-frozen/runtime/tables/runtime-agent-service-typed-family.yaml`](https://github.com/nimiplatform/nimi/blob/main/config/spec-frozen/runtime/tables/runtime-agent-service-typed-family.yaml)

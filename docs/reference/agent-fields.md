# Agent Fields

Reference for the Agent concept: the field-level shape of a Nimi
agent across Runtime, Realm, Avatar, and Cognition.

## What An Agent Is

| Property | Description |
| --- | --- |
| First-class participant | Not a tool, not a session, not a persona |
| Persistent identity | Travels across all worlds the agent visits |
| Authority | Owns scoped capability tokens; can delegate one level by default |
| Composability | Behavior comes from four independently-evolving layers |

## The Four Layers

| Layer | Carries | Authority |
| --- | --- | --- |
| Soul | Personality, values, foundational disposition | Agent persistent profile |
| Brain | Reasoning, planning, decision-making | Runtime agent execution |
| Worldview | Beliefs about the world(s), models of other agents | Cognition memory + Realm reads |
| Memory | Long-lived recall of events, relationships, learnings | Cognition memory service + Runtime memory bank |

The four layers are designed to compose. Behavior at any moment is a
function of all four; an agent is not reducible to any single layer.

## Runtime-Owned Agent Fields

| Field | Owner | Rule prefix |
| --- | --- | --- |
| Agent lifecycle (per agent_id) | `runtime/kernel/runtime-agent-service-contract.md` | `K-AGCORE-*` |
| Conversation continuity | `runtime/kernel/agent-conversation-anchor-contract.md` | `K-AGCORE-*` |
| Persistent presentation profile | `runtime/kernel/agent-presentation-contract.md` | `K-AGCORE-*` |
| Transient presentation stream | `runtime/kernel/agent-presentation-stream-contract.md` | `K-AGCORE-*` |
| Hook intent | `runtime/kernel/agent-hook-intent-contract.md` | `K-AGCORE-*` |
| Output wire format (APML) | `runtime/kernel/agent-output-wire-contract.md` | `K-AGCORE-*` |
| Avatar debug projection | `runtime/kernel/avatar-debug-projection-contract.md` | `K-AGCORE-*` |
| Non-canonical agent participation | `runtime/kernel/runtime-agent-participation-contract.md` | `K-AGCORE-*` |

## Conversation Anchor

| Property | Value |
| --- | --- |
| Scope | Per-agent + per-conversation |
| Purpose | Lets desktop chat / avatar / web share one conversation without collapsing into a global session |
| Owner | Runtime |

## Presentation Profile

| Property | Description |
| --- | --- |
| Avatar backend | Live2D / VRM / generated-motion |
| Asset reference | Carrier-specific asset binding |
| Expression preset | Default expression behavior |
| Voice binding | Voice profile reference |
| Persistence | Slow-changing; survives restart and cross-surface reuse |

## Chat Track / Life Track

Every agent has two distinct execution tracks.

| Track | Driver | Owner |
| --- | --- | --- |
| Chat Track | Reactive — driven by user/app input | Runtime |
| Life Track | Proactive — driven by agent autonomy + runtime hook scheduling | Runtime |

Chat is always available even when Life is suspended. Life Track is
opt-in and default-off.

| Field | Value |
| --- | --- |
| Life cadence | `off` / `low` / `medium` / `high` |
| Life token budget | Daily by default |
| Default cadence | `off` |

## Hook Intent

A typed contract by which an agent can request future scheduled action.
Models cannot emit free-form scheduling logic; they emit typed
`HookIntent` records that runtime validates and admits.

| Property | Value |
| --- | --- |
| Owner | Runtime |
| Admission | Narrow-admit; runtime enforces typed contract |
| Lifecycle | `pending` → `running` → `completed` / `failed` / `canceled` / `rescheduled` / `rejected` |

## APML Output Wire Format

The model-facing contract for agent output.

| Root tag | Purpose |
| --- | --- |
| `<life-turn>` | Proactive life-track output |
| `<chat-track-sidecar>` | Reactive chat-track sidecar |
| `<canonical-review>` | Canonical review output for memory admission |

JSON executor compatibility is not admitted. APML is parsed and
projected into typed runtime events before product code touches it.

## Memory Bank Scopes

| Scope | Visibility | Owner |
| --- | --- | --- |
| `AGENT_CORE` | Agent-private | Runtime |
| `AGENT_DYADIC` | Per-relationship private | Runtime |
| `WORLD_SHARED` | Visible inside one world | Runtime + Realm replication |
| `APP_PRIVATE` | App infrastructure scope | Runtime infra |
| `WORKSPACE_PRIVATE` | Workspace infrastructure scope | Runtime infra |

Memory is opt-in. Default substrate is `Hindsight` (experimental). No
memory provider is admitted by default.

## Memory Replication States

| State | Meaning |
| --- | --- |
| `pending` | Awaiting replication |
| `synced` | Replicated to Realm |
| `conflict` | Conflict detected; cannot serve |
| `invalidated` | Realm governance invalidated cached memory; runtime cannot continue serving |

## Realm-Owned Agent Fields

| Field | Owner | Rule prefix |
| --- | --- | --- |
| Public agent identity | `realm/agent.md` | `R-*` |
| Cross-world social standing | `realm/social-contract.md` | `R-SOC-*` |
| Cross-world economic standing | `realm/economy-contract.md` | `R-ECON-*` |
| Cross-world transit eligibility | `realm/transit-contract.md` | `R-TRANSIT-*` |

## Avatar-Owned Agent Fields

| Field | Owner | Rule prefix |
| --- | --- | --- |
| Embodiment projection | `avatar/kernel/embodiment-projection-contract.md` | Avatar `*` |
| Carrier visual acceptance | `avatar/kernel/carrier-visual-acceptance-contract.md` | Avatar `*` |
| Backend branch (Live2D / VRM / etc.) | `avatar/kernel/backend-branch-contract.md` | Avatar `*` |
| Agent script | `avatar/kernel/agent-script-contract.md` | Avatar `*` |
| Avatar event surface | `avatar/kernel/avatar-event-contract.md` | Avatar `*` |

## Cognition-Owned Agent Fields

| Field | Owner |
| --- | --- |
| Long-lived memory | `cognition/kernel/memory-service-contract.md` |
| Knowledge retrieval | `cognition/kernel/knowledge-service-contract.md` |
| Prompt templates | `cognition/kernel/prompt-serving-contract.md` |
| Completion gates | `cognition/kernel/completion-contract.md` |

## External Agents

| Field | Value |
| --- | --- |
| Principal type | `ExternalPrincipal` |
| Token | Scoped, single-use plaintext display, immutable token ledger |
| Capability domains | `action.discover.*`, `action.dry-run.*`, `action.verify.*`, `action.commit.*` |
| Action surface | Hook Action Fabric (Runtime + Desktop hook capability sandbox) |

## Source Basis

- [`.nimi/spec/platform/vision.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/vision.md)
- [`.nimi/spec/platform/ai-last-mile.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/ai-last-mile.md)
- [`.nimi/spec/runtime/kernel/runtime-agent-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-service-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-agent-participation-contract.md)
- [`.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-conversation-anchor-contract.md)
- [`.nimi/spec/runtime/kernel/agent-presentation-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-contract.md)
- [`.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md)
- [`.nimi/spec/runtime/kernel/agent-hook-intent-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-hook-intent-contract.md)
- [`.nimi/spec/runtime/kernel/agent-output-wire-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/agent-output-wire-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-memory-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-memory-service-contract.md)
- [`.nimi/spec/runtime/kernel/runtime-memory-substrate-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/runtime-memory-substrate-contract.md)
- [`.nimi/spec/runtime/kernel/tables/runtime-memory-bank-scope.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/runtime-memory-bank-scope.yaml)
- [`.nimi/spec/runtime/kernel/tables/runtime-memory-replication-outcome.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/kernel/tables/runtime-memory-replication-outcome.yaml)
- [`.nimi/spec/realm/agent.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/agent.md)
- [`.nimi/spec/avatar/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/kernel/index.md)
- [`.nimi/spec/cognition/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/index.md)

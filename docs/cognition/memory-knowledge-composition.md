# Memory + Knowledge Composition

> Status: Running today. Cognition's `MemoryService` and
> `KnowledgeService` are shipped under `C-COG-*`; the runtime bridge
> contract is the admitted consume path.

Cognition holds **two distinct services** that together carry an
agent's continuous understanding of users + facts. They look similar
from a distance and behave very differently underneath.

| Service | Carries | Continuity | Updated by |
| --- | --- | --- | --- |
| Memory | "What I remember about a participant" — relationship continuity | Per-agent + per-participant scope | Agent's behavior + admitted memory write paths |
| Knowledge | "Facts I can retrieve" — structured information | Per-knowledge-base scope | Curation flows + ingestion paths |

Confusing them produces bad agent behavior: relationship facts that
should live in memory get spread across knowledge bases (fragile,
unscoped); facts that should live in knowledge get embedded into
memory (high churn, low retrieval quality).

## Memory: Continuity About Participants

| Property | Value |
| --- | --- |
| Authority | `cognition/kernel/memory-service-contract.md` |
| Scope | Per-agent + per-participant (admitted bank scopes: `AGENT_CORE`, `AGENT_DYADIC`, etc.) |
| Mutation | Through admitted memory write paths |
| Retrieval | Through cognition's prompt-lane and bridge surfaces |
| Privacy | Dyadic memory does not cross participants |

Memory carries the agent's relationship history with a person:
preferences, prior conversations, agreed conventions, ongoing
threads. The bank scopes are the privacy + isolation primitive.

## Knowledge: Retrievable Facts

| Property | Value |
| --- | --- |
| Authority | `cognition/kernel/knowledge-service-contract.md` |
| Scope | Per-knowledge-base |
| Mutation | Through curation / ingestion (not from a single conversation) |
| Retrieval | Through structured retrieval surfaces |
| Privacy | Per-base authorization |

Knowledge carries facts the agent can look up: documentation, FAQ,
domain-specific references. Knowledge is **not** the place to record
what a specific participant said.

## Why The Separation Matters

If memory absorbed knowledge:
- Every participant would carry duplicated copies of the same facts
- Curation flows would have to update N copies
- Cross-participant fact updates would silently drift

If knowledge absorbed memory:
- Privacy boundaries would collapse (one participant's memory in a
  shared knowledge base = leak)
- Memory's per-relationship fidelity would be flattened into "what
  the knowledge base happens to say"

Cognition keeps both. Apps consume both through admitted surfaces;
they do not invent a third thing that fuses them.

## How Runtime Consumes Cognition

Runtime is the execution authority. Cognition is the cognition
authority. The runtime bridge contract
(`cognition/kernel/runtime-bridge-contract.md`) defines what runtime
may consume:

| Bridge surface | Owner | Used for |
| --- | --- | --- |
| Memory consume | Cognition | Runtime asks for relevant memory at turn assembly |
| Knowledge consume | Cognition | Runtime asks for relevant knowledge at turn assembly |
| Prompt serving | Cognition | Cognition assembles prompts under admitted lanes |
| Reference graph | Cognition | Cognition explains why an artifact relates |

The bridge is **consume**, not absorption. Runtime cannot redefine
what a memory bank is or how knowledge gets curated. Cognition does
not depend on runtime to be itself.

## Reader Scenario: An Agent Recalls A User

A user comes back to talk to their agent the next day.

1. **Turn arrives.** Runtime receives a turn for `(agent_id,
   conversation_anchor_id)`.
2. **Runtime calls cognition bridge for memory.** Asks for relevant
   memory under the agent + participant bank scopes
   (`AGENT_DYADIC` + `AGENT_CORE` per admitted policy).
3. **Cognition returns memory.** Bounded by the bank scope and
   prompt-lane separation rules.
4. **Runtime calls cognition bridge for knowledge.** If the turn
   needs facts (e.g., agent has a knowledge base bound to its
   profile), ask the knowledge service.
5. **Knowledge returns matched facts.** Through the admitted
   retrieval surface.
6. **Runtime assembles the turn.** Memory + knowledge participate
   in prompt serving under admitted prompt-lane separation.
7. **Agent responds.** Turn lifecycle proceeds per
   `runtime-agent-service-contract.md`.

Both services participated. Neither absorbed the other. Runtime
consumed both through the bridge; runtime did not redefine either.

## Reader Scenario: A Memory Write After A Turn

After the turn completes, the agent's behavior may admit a memory
write.

1. **Memory write candidate emerges.** Per the agent's admitted
   memory-write rules.
2. **Cognition admits.** The write enters memory under the admitted
   bank scope (`AGENT_DYADIC` for this participant).
3. **Other participants unaffected.** Cross-participant scope is
   honored; the write is not visible to other participants' dyadic
   memory.

## Reader Scenario: A Knowledge Curation Update

A maintainer updates a fact in a knowledge base used by many
agents.

1. **Curation flow updates.** Knowledge base entry is updated.
2. **Future retrievals see new fact.** The next time agents query
   this knowledge base, they retrieve the updated fact.
3. **Memory unchanged.** Past per-participant memory snapshots are
   not silently rewritten. If a memory referenced the old fact, the
   reference graph (see [Reference Graph](/cognition/reference-graph))
   shows the relationship; cleanup decisions are explicit.

The boundary keeps "knowledge changed" from silently mutating "what
this user once said."

## What This Composition Does Not Do

- It does not let runtime absorb cognition.
- It does not let memory absorb knowledge or vice-versa.
- It does not let app code skip the bridge for direct consume.
- It does not allow cross-participant memory leak through shared
  knowledge bases.

## Boundary Summary

| Concern | Owner |
| --- | --- |
| Standalone cognition authority | `cognition/kernel/cognition-contract.md` (`C-COG-*`) |
| Memory service truth | `memory-service-contract.md` |
| Knowledge service truth | `knowledge-service-contract.md` |
| Runtime consume bridge | `runtime-bridge-contract.md` |
| Prompt serving (with lane separation) | `prompt-serving-contract.md` (see [Prompt Lanes](/cognition/prompt-lanes)) |

## Source Basis

- [`.nimi/spec/cognition/kernel/cognition-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/cognition-contract.md)
- [`.nimi/spec/cognition/kernel/memory-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/memory-service-contract.md)
- [`.nimi/spec/cognition/kernel/knowledge-service-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/knowledge-service-contract.md)
- [`.nimi/spec/cognition/kernel/runtime-bridge-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/runtime-bridge-contract.md)
- [`.nimi/spec/cognition/kernel/prompt-serving-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/prompt-serving-contract.md)

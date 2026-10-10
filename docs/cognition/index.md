# Cognition

Cognition is where long-term Memory lives in Nimi. When an Agent
remembers your name, your preferences, or something you told it last
month, that memory came from Cognition.

Cognition is its own owner inside the platform. Runtime runs the
conversation; Cognition keeps what is worth remembering. The two are
connected by a narrow, typed Bridge, and neither side absorbs the
other.

## What This Means For You

- Your Agent remembers you across sessions. Close the app, come back
  next week, and the same Agent still knows what you told it, as long
  as it was worth keeping. Memory belongs to the Agent itself, not to
  one conversation or one world, so it stays with that Agent.
- Memory is private to each Agent. Two Agents on the same account
  keep separate memories, and neither can read the other's. There is
  no shared account profile behind them.
- You can correct a stored memory through the authorized Memory management
  surface. Select the entry, submit the corrected content, and wait for the
  committed owner result before treating the new fact as current.
- You can select stored memories and explicitly confirm Forget. After
  Cognition commits the operation, its durable barrier prevents restarts,
  retries, index rebuilds, and replays from reviving those memories. An ordinary
  chat request to forget is not confirmation that this operation ran.
- Secrets don't become memories. Passwords, tokens, credentials, and
  content marked "do not remember" are rejected before they can be
  retained.
- Memory knows how it knows. Each memory carries honest provenance:
  whether you said it explicitly, whether it was inferred, or whether
  it was consolidated from earlier memories.

Memory is also allowed to be absent. If recall is still building,
unavailable, or simply finds nothing, the conversation continues
normally with zero memories. A read hiccup never fabricates results
and never blocks a turn. Writes are stricter: a correction or forget
is only reported done after Cognition has durably committed it.

## What Cognition Owns

- Each Agent's long-term Memory: one opaque, Agent-private logical
  bank bound to one Agent. Not an account profile, not a workspace
  bank, and not something an App can query directly.
- Memory truth and lifecycle: admission, provenance, correction and
  supersession, forget barriers, and deletion.
- The V1 pipelines: one Remember pipeline, a full-text Recall
  pipeline, an embedding Recall pipeline, a deterministic exact
  Forget pipeline, and a small static router that picks one pipeline
  per operation.
- Derived retrieval indexes (full-text and vector). They are
  rebuildable projections of canonical Memory and never decide what
  is true.
- A bounded Agent Source lane: typed source units from one Runtime
  snapshot, indexed for semantic search under the same per-Agent and
  per-snapshot isolation. It is derived state, not world truth.

Long-term Knowledge also belongs to Cognition's domain, but V1 has no
active Knowledge path: nothing reads or writes Knowledge yet, and
Memory never promotes itself into Knowledge.

## What Stays With Runtime And Realm

Runtime keeps running the show: LocalAgent identity, authorization,
the Conversation and its committed events, context planning, AI
execution, and the final commit of each turn. Authorization is
evaluated by Runtime before any Memory operation crosses the Bridge,
and Runtime is the only caller Cognition accepts.

Realm keeps world truth. A memory about something that happened in a
world does not rewrite that world's state or history.

Apps and SDKs never touch Cognition. They see Memory only as bounded
results returned through Runtime.

## Reader Scenario: Remembering You Across Sessions

Suppose on Monday you tell your Agent you're allergic to peanuts.
That evening you close the app. On Friday you ask it to suggest a
snack.

1. On Monday, Runtime committed your message as an event and
   delivered it to Cognition through the Bridge.
2. Cognition's Remember pipeline judged it worth keeping and proposed
   the memory; Cognition Core committed it atomically, with provenance
   marking it as something you explicitly said.
3. On Friday, while planning the turn, Runtime asks Cognition for
   relevant memories. Recall returns the allergy as a hit.
4. Runtime decides how to use that hit in context. The snack
   suggestions steer clear of peanuts.

If the recall index had still been building on Friday, step 3 would
have returned "unavailable" instead of a hit, and the turn would have
continued anyway, just without that memory.

## Reader Scenario: Correcting And Forgetting

Suppose a stored memory says you work at Acme, but you now work at Beta.

1. Open the authorized Memory management surface for the intended Agent and
   inspect its stored entries.
2. Select the incorrect entry and submit its `memoryId` with the corrected
   content. Runtime validates the current Manager handle and `agent.configure`
   access before forwarding the operation to Cognition.
3. Only after the owner commits the correction does the corrected fact become
   current and the superseded entry leave default recall. Pending, rejected,
   or failed operations are not completed corrections.

To forget memories about the old job, select the exact entries and confirm the
Forget operation. The SDK request carries their `memoryIds` and `confirmed:
true`; the owner result establishes whether the barrier was committed. No
restart, retry, index rebuild, or replay may restore those forgotten entries.
A later eligible event can form a new memory; it does not revive an old one.

Saying "I left Acme" or "Forget everything about my old job" in ordinary chat
does not perform this management operation. Automatic Remember has its own
bounded admission rules and may make no change; a conversational reply is not
a durable correction or deletion acknowledgement.

Because banks are Agent-private, none of this touches any other Agent
you talk to. Another Agent's memory of you is its own.

## Source Basis

- [`.nimi/spec/cognition/memory.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/memory.authority.yaml)
- [`.nimi/spec/cognition/runtime-bridge.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/runtime-bridge.authority.yaml)
- [`nimi-cognition/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-cognition/README.md)
- [`sdks/typescript/core/app/local-app-runtime-platform-configure.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform-configure.ts)

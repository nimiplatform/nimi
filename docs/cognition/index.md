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
- You can correct an Agent. When you say "I don't live in Berlin
  anymore," the corrected fact becomes current right away, and the old
  one leaves default recall, kept only as bounded history.
- You can make an Agent forget. An explicit forget is a durable
  barrier: restarts, retries, index rebuilds, and replays cannot bring
  the forgotten memory back.
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

Suppose your Agent believes you work at Acme. You tell it: "I left
Acme, I work at Beta now."

1. Your correction arrives as a new committed event.
2. Cognition makes the corrected fact current and removes "works at
   Acme" from default recall, keeping it only as provenance-bounded
   superseded history.

Later you go further: "Forget everything about my old job." An
explicit forget commits a barrier against those memories. From then
on, no restart, retry, index rebuild, or replay can revive them. If
you mention your old job again someday, that becomes a new memory
formed from a new event, not the forgotten one coming back.

Because banks are Agent-private, none of this touches any other Agent
you talk to. Another Agent's memory of you is its own.

## Source Basis

- [`.nimi/spec/cognition/memory.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/memory.authority.yaml)
- [`.nimi/spec/cognition/runtime-bridge.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/runtime-bridge.authority.yaml)
- [`nimi-cognition/README.md`](https://github.com/nimiplatform/nimi/blob/main/nimi-cognition/README.md)

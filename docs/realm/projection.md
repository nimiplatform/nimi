# Projection

Projection is the **formal consumption layer** for canonical
truth. It isn't a lorebook rebuild, not a worldview preview, not
a prompt assembly helper. Its semantic owner is Realm Projection
kernel; runtime is the consumer.

## What Projection Is

| Property | Value |
| --- | --- |
| Purpose | Read-aggregate over canonical truth |
| Owner | Realm Projection kernel |
| Consumer | Runtime, apps |
| Authority | Cannot mutate truth; is read-only |
| Shape | Typed admitted aggregates |

Projection answers "give me a structured read view of this
truth." It does **not** answer "what should the model see in its
prompt" — that is prompt assembly, owned by Cognition.

## What Projection Is Not

| Confused with | Why distinct |
| --- | --- |
| Lorebook rebuild | Lorebook is content; projection is read view |
| Worldview preview | Worldview is the agent's belief; projection is canonical view |
| Prompt assembly helper | Cognition Prompt Service handles prompts; projection feeds it but is not it |
| App-side cache | Caching is implementation; projection is contract |

The distinction matters because mixing them creates parallel truth.
A "projection that builds prompts" would be Cognition's job;
keeping projection as a read-aggregate keeps responsibilities
clean.

## Reader Scenario: An App Reads A Projection

An app needs a structured view of a world's current state for
display.

1. **Query projection.** The app calls an admitted projection
   surface (e.g., `detail-with-agents`).
2. **Projection materializes.** Realm computes the aggregate
   from canonical truth + state + relevant additional reads.
3. **Typed result.** The app receives a typed view.
4. **App renders.** The app uses the projection to display.

The projection is not "snapshot of state at time T then cached."
It is a typed read-aggregate computed on demand.

## Reader Scenario: A Projection Cannot Mutate Truth

An app tries to use a projection result and "save back" to truth.

1. **Read projection.** Returns typed view.
2. **Modify the view.** App mutates its local copy (this is fine;
   it's the app's local work).
3. **Attempt to save back.** App tries to commit the modified
   projection as truth.
4. **Realm rejects.** Projections are read-only; truth mutations
   require typed commit envelopes through admitted commit flow.
5. **Typed error.** "Projection writes not admitted; use commit
   envelope."

The split is structural. There is no "projection write" path.
Writes go through admitted commit flow with envelope.

## Reader Scenario: Cognition Consumes Projection For Prompt Serving

An agent's prompt assembly needs canonical world context.

1. **Prompt service consults projection.** Cognition's
   `FormatCore` lane reads canonical truth via projection.
2. **Projection returns canonical aggregate.** Read-only typed
   shape.
3. **Prompt service formats.** Cognition's prompt service is the
   place that translates this into prompt context.
4. **Model sees typed prompt.** Includes canonical world context
   from projection.

Projection feeds prompt assembly; projection is not prompt
assembly. The boundary is what keeps Realm Projection a
reusable read-aggregate layer.

## Why The Boundary Matters

Without the boundary:

- Apps would build their own caches that diverge from canonical
  truth.
- Prompt assembly logic would land inside projection, mixing
  canonical reads with model-context heuristics.
- Mutations could sneak in through "projection write" patterns.
- The reader would not know whether a fact came from canonical
  truth or from projection's interpretation.

With the boundary:

- Projection is canonical read-aggregate.
- Apps consume; they do not invent.
- Cognition handles prompt-context assembly downstream.
- Truth mutation is a separate explicit path.

## Source Basis

- [`.nimi/spec/realm/projection.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/projection.md)
- [`.nimi/spec/realm/truth.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/truth.md)
- [`.nimi/spec/realm/world-state.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world-state.md)
- [`.nimi/spec/realm/world-history.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world-history.md)
- [`.nimi/spec/realm/kernel/index.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/index.md)
- [`.nimi/spec/cognition/kernel/prompt-serving-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/cognition/kernel/prompt-serving-contract.md)

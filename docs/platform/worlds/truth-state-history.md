# World Truth, State, And History

A Nimi world has three related but distinct concepts. They look
similar from far away and behave very differently up close. Knowing
which one you need is the difference between a world that works and
a world that loses information silently.

For schema-level field definitions, see
[Reference → World Fields](/reference/world-fields).

## The Three Concepts

| Concept | Answers | Owner contract |
| --- | --- | --- |
| **Truth** | What is canonically true in this world, regardless of when it was written | Realm `R-TRUTH-*` |
| **World State** | What does this world look like right now | Realm `R-WSTATE-*` |
| **World History** | How did this world reach its current state | Realm `R-WHIST-*` |

These are not interchangeable. They have different read patterns,
different mutation rules, and different audit characteristics.

## Truth

Truth is the canonical definition of the world. It is what the
creator publishes; it is what every read of the world ultimately
anchors against.

Truth carries:

- **WorldRule** entries — rules of the world authored by the creator.
- **AgentRule** entries — agent truth bound to a world scope.
- **WorldRelease** snapshots — the official anchor of any world
  publish, with package version, provenance, checksum/diff metadata,
  and rollback lineage.

Truth is **creator-governed**. Apps and agents read truth; only the
creator (and the creator's authorized release tools) can mutate it.
A runtime story execution can never silently mutate truth. An app's
narrative archive must be app-owned, not Realm-canonical.

Truth is **versioned, atomic, auditable**. Rollback is a release
operation, not an ad hoc rewrite.

## World State

World state is the durable shared present. It is what the world
looks like at this moment — who is present, what positions things
hold, what economic balances exist, what scene is current.

State mutations require an explicit **commit envelope**. The envelope
includes:

| Field | Purpose |
| --- | --- |
| `worldId` | Which world is being mutated |
| `appId` | Which app is committing |
| `sessionId` | Session lineage |
| `effectClass` | `NONE` / `STATE_ONLY` / `STATE_AND_HISTORY` |
| `scope` | `WORLD` / `ENTITY` / `RELATION` |
| `schemaId` and `schemaVersion` | What shape this commit takes |
| `actorRefs` | Who acted |
| `reason` | Why |
| `evidenceRefs` | Supporting evidence |

Creator tooling and authorized world-connected apps use the same
commit envelope model. There is no privileged shortcut.

## World History

World history is the append-only canonical record of what happened.

| Property | Value |
| --- | --- |
| Append-only | yes |
| Provenance | mandatory |
| Replay vs canon | `REPLAY` runs cannot append; only `CANON_MUTATION` runs may append |
| Corrections | superseding events or invalidation records, never silent deletion |

The mandatory provenance and the append-only posture together mean
that history is a real audit surface. Every change has evidence;
nothing is lost when a correction is made — the original is
superseded, not erased.

## When To Read Which

| Situation | Read |
| --- | --- |
| You want to know the rules of this world | Truth |
| You want to render the world as it is right now | World State |
| You want to show how the world reached this state | World History |
| You want to audit who did what | World History (with truth context as needed) |
| You want to publish a new version of the world | Truth, via `WorldRelease` |

A surface that conflates them silently loses information. A view
that is "just the current state" is missing how it got here. A view
that is "just history" cannot answer "what is true here." A view
that is "just truth" cannot show "what changed since publish."

## Reader Scenario: A Relationship Evolves Over Time

Alice and Bob meet in a world two months ago. They become friends a
month ago. The friendship deepens over the next month. The question
the docs reader is going to ask: where is each of these facts
stored?

| Question | Answer | Where |
| --- | --- | --- |
| Are Alice and Bob friends? | Yes, currently | World State (the current relationship) |
| When did they meet? | Two months ago | World History (the original meeting event) |
| Is "friend" a meaningful concept in this world? | Yes; the world admits social relationships | Truth (the world's social model) |
| When did the friendship deepen? | Specific event a month later | World History (each transition is an append-only event) |

The friendship is in state; the journey is in history; the
possibility of friendship is in truth. All three are needed to
answer normal questions about Alice and Bob.

## Reader Scenario: A Mutation That Touches Multiple Surfaces

A participant performs an action that has economic, social, and
presence consequences — say, gifting an item to another participant
in a public scene.

- **Truth** is unchanged. The world's rules about what gifts are,
  what items can be transferred, and what social relationships
  permit gifting are all already in truth.
- **World State** updates: the recipient now owns the item; the
  giver no longer does; the social-relation strength may shift.
- **World History** appends three records (or one composed
  record): the gift event, the social-relation update, the
  presence record of the witnesses.

The action is one product moment; the underlying contract spreads
the consequences across the right surfaces. Apps that read the
right surface get the right answer; nothing is lost.

## Reader Scenario: A Correction That Was Once Wrong

The world creator realizes a published rule was wrong and pushes a
correction.

- **Truth** does not silently change. The creator publishes a new
  `WorldRelease` with the corrected rule. The new release has its
  own provenance, version, and rollback lineage.
- **World History** records the release as a `CANON_MUTATION` run
  (it is mutating truth). The old rule is not deleted from the
  history; it is superseded.
- **World State** updates if the correction implies a state change.

A reader looking at history can reconstruct what was true before
and what is true after. Nothing is lost.

## Source Basis

- [`.nimi/spec/realm/truth.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/truth.md)
- [`.nimi/spec/realm/world-state.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world-state.md)
- [`.nimi/spec/realm/world-history.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world-history.md)
- [`.nimi/spec/realm/kernel/truth-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/truth-contract.md)
- [`.nimi/spec/realm/kernel/world-state-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/world-state-contract.md)
- [`.nimi/spec/realm/kernel/world-history-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/world-history-contract.md)
- [`.nimi/spec/realm/kernel/tables/commit-authorization-matrix.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/tables/commit-authorization-matrix.yaml)
- [`.nimi/spec/realm/world.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/world.md)

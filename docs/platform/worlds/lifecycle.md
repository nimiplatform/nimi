# World Lifecycle

A world in Nimi is built to last. This page follows one through its
whole life: from an idea in a creator's head, to a published place
participants can visit, to a world with an extension-app bound to
it, to one that can be suspended or revoked. Realm keeps the state
machinery behind every step.

For schema-level state field definitions, see
[Reference → State Machines](/reference/state-machines) and
[Reference → World Fields](/reference/world-fields).

## Authoring And Publish

A world is authored by a creator. Creator tooling maintains the
world's canonical `WorldCore` plus admitted `WorldCharacterCore`
records, timeline, scene, history, and product metadata.

The publish moment is a core commit: an atomic `WorldCoreIngressPackage`
or `CorePatch` that freezes the admitted core object state into a single
canonical anchor. A commit carries:

- Core schema version
- Provenance (who released, what tooling)
- Checksum / diff metadata
- Replacement or patch lineage

Atomicity matters. World core, character core, scene, timeline, and history
state land in one transactional commit. Half-published worlds are not admitted.

The commit is published through the **`WorldCoreIngressPackage`** or
**`CorePatch`**. It distinguishes:

| Component | Purpose |
| --- | --- |
| Core world object | Identity, ownership, time model, timeline, history, and product metadata |
| Core character objects | World-owned characters bound to the world |
| Runtime source snapshot inputs | By-value materialization data for LocalAgent creation |
| Governance/release metadata | Version, provenance, audit |

Lorebook text and prompt payloads are never the package's canonical center.
They may be source-core fields or downstream prompt-context inputs, but they do
not replace the core objects.

## Rollback Is A Release Operation

If a release contains a problem, rollback is itself a release —
not an ad hoc edit of the existing release.

- A rollback `WorldRelease` references the prior good release.
- Rollback lineage is part of the release record.
- World history records the rollback as a `CANON_MUTATION` run.
- The bad release is not deleted from history; it is superseded.

This means rollback preserves audit traceability: anyone reading
history later can see exactly what was rolled back, when, and why.

## App-World Binding

A world is most useful when an app is bound to it — the app is what
participants actually use to interact with the world. Binding is
explicit and bounded.

| Mode | Reads world data | Writes world data | Concurrent count per world |
| --- | --- | --- | --- |
| `render-app` | yes | no | many |
| `extension-app` | yes | yes | at most one active per world |

A world has at most one active **extension-app** binding at any
time. Multiple **render-apps** can read the same world concurrently;
they do not gate each other.

### Binding lifecycle

```
(new) ──admit──▶ active ──suspend──▶ suspended ──resume──▶ active
                  │                                          │
                  └────────────────revoke──────────────────────────▶ revoked
```

| State | Meaning |
| --- | --- |
| `(new)` | World exists; no app is bound |
| `active` | An admitted extension-app is bound and writing |
| `suspended` | Binding is paused; rebinding requires explicit re-admission |
| `revoked` | Binding is removed; world is available for new admission |

Suspension is reversible; revocation is not. Re-binding requires
revoking first — the platform does not silently transfer write
authority from one extension-app to another.

## Transit And World Availability

A published world becomes a destination participants can transit to.
Transit goes through OASIS — see [OASIS](/platform/worlds/oasis).
A world that is not currently bound to an extension-app is still
readable by render-apps; it is the truth and the state that exist
even when no app is actively writing.

If a world is taken offline by its creator, participants who were
in that world return to OASIS by default. Their identity and
standing are unaffected.

## Reader Scenario: Publishing A World End-To-End

A creator finishes designing a world and wants to publish.

1. **Author truth.** Truth artifacts: world rules, agent rules,
   scenes, projections.
2. **Stage drafts.** Minimal publish candidates: `importSource`,
   `truthDraft`, `stateDraft`, `historyDraft`. These are the
   creator's local working set, not Realm canonical until publish.
3. **Bundle into a CanonicalTruthPackage.** The package
   distinguishes truth units, derivation inputs, projection
   inputs, and governance metadata.
4. **Publish atomically as a `WorldRelease`.** The release commit
   freezes truth, projections, and package version. It carries
   provenance, checksum/diff, and rollback lineage.
5. **World becomes a destination.** Participants can transit to
   the world via OASIS. Render-apps can read it; an admitted
   extension-app can bind for write authority.
6. **Audit lineage.** World history records the release as a
   `CANON_MUTATION` run. Any future rollback is recorded as
   another `CANON_MUTATION` run referencing this release.

The atomic transactional shape is the key property. The platform
does not admit half-published worlds.

## Reader Scenario: Replacing The Active Extension-App

A creator wants to switch from extension-app A to extension-app B.

1. The creator revokes A's binding. A's binding moves from
   `active` to `revoked`. A no longer has write authority.
2. The creator admits B. B's binding moves from `(new)` to
   `active`. B now has write authority.
3. There is no overlap window where both A and B can write.
   Re-binding is not silent transfer.

Why this strictness? Because a world has only one canonical truth
of "what is true now." If two extension-apps could both write, two
different truths would race to overwrite each other. The platform
makes the transition explicit.

## Source Basis

- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)
- [`.nimi/spec/platform/core-protocol.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/platform/core-protocol.authority.yaml)

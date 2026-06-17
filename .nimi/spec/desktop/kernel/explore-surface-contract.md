# Explore Surface Contract

> Owner Domain: `D-EXPL-*`

## Scope

This contract defines Desktop `Explore` as the Realm discovery surface for
WorldCore and source-core identities. The surface discovers:

- admitted `WorldCore` records;
- `RealmPersona` source records bound to a World;
- public Realm activity from human, persona, and world-character sources.

Desktop Explore does not create WorldCore, WorldCharacterCore, RealmPersona, or
RuntimeSourceSnapshot truth. It does not own Realm feed truth, source admission,
LocalAgent lifecycle, LocalAgent Chat identity, shell layout, or AI execution.

## D-EXPL-001 — Explore Is The Unified Realm Discovery Surface

`MUST`: `Explore` is the single ordinary Desktop surface for discovering Realm
Worlds, RealmPersonas, and public activity. The previous standalone World
surface is folded into Explore.

`MUST`: primary navigation placement is owned by `D-SHELL-001`; this rule fixes
only the product responsibility of Explore as Realm discovery.

`MUST NOT`: ordinary primary navigation must not keep a standalone World entry
outside Explore. Explore must not become App discovery; App discovery belongs to
the Apps surface.

## D-EXPL-002 — Explore Sections

`MUST`: Explore has exactly three product sections, with catalog authority in
`tables/explore-sections.yaml`:

| Section | Product responsibility |
|---|---|
| `Worlds` | Browse admitted WorldCore records and enter World detail. |
| `Personas` | Discover RealmPersona source records across Worlds. |
| `Activity` | Show admitted public Realm activity from humans, personas, and world characters. |

`MUST NOT`: implementations must not add, remove, or rename these sections
without updating the table and this rule. The three-section meaning must not be
collapsed into an undifferentiated mixed stream.

## D-EXPL-003 — World Card Fields

`MUST`: World cards may present only these product facts from WorldCore or
typed World projection:

- `name`;
- `visual`;
- `lineage` / world type;
- `tagline` / summary;
- `era` / current time label where meaningful;
- `sourceSignal` such as persona or world-character count;
- `activitySignal`;
- `status`.

`MUST`: conditional fields shrink when upstream truth is absent. Explore must
not synthesize empty counts, placeholder era values, or local world facts.

`MUST NOT`: World cards must not read old truth/projection payloads or derive
card facts from local prompt/lore fields. WorldCore and typed World projection
are the only admitted sources for this surface.

## D-EXPL-004 — World Detail Sections

`MUST`: World detail presents these product sections when the corresponding
typed data exists:

- WorldCore overview;
- semantic/world summary;
- scenes, locations, and entry points;
- featured WorldCharacterCore or RealmPersona sources;
- public activity;
- source admission status where relevant;
- governance or status information when useful to ordinary users.

`MUST`: section ordering and responsive layout are owned by `D-SHELL-011` to
`D-SHELL-014`; this rule fixes only the product facts that may appear.

`MUST NOT`: World detail must not expose a Desktop-local source creation entry.
World and persona authoring belong to admitted creator/studio surfaces, not to
ordinary Explore.

## D-EXPL-005 — RealmPersona Card Fields

`MUST`: Persona cards may present only these product facts:

- `displayName` / `avatar`;
- `worldOrigin`;
- `sourceKind` and role/category where supplied by core data;
- `concept` / short description;
- `activitySignal` when supplied by Realm feed projection;
- `sourceState`;
- `primaryAction`, derived from `sourceState` by `D-EXPL-006`.

`MUST`: `sourceState` must come from typed core/source admission data. Until a
trusted source admission projection exists, Desktop must use the closed
`source_core_handoff_required` state.

`MUST NOT`: Persona cards must not carry relationship state, quota state, direct
source chat, or local conversation readiness as if those were RealmPersona
truth.

## D-EXPL-006 — Source State To Primary Action

`MUST`: Persona primary action is derived from the source-state table
`tables/realm-persona-source-admission-actions.yaml`.

| Source state | Primary action | Result |
|---|---|---|
| `source_core_handoff_required` | `Source setup pending` | Disabled action; Desktop explains that RuntimeSourceSnapshot materialization is required before LocalAgent Chat can exist. |

`MUST`: the disabled state is a real fail-closed product state, not a loading
placeholder. It remains until an admitted Realm/Runtime path provides typed
RuntimeSourceSnapshot materialization for the source.

`MUST NOT`: Explore must not open LocalAgent Chat directly from a bare
RealmPersona source. LocalAgent Chat requires an account-owned LocalAgent
created from a RuntimeSourceSnapshot, with identity owned by Realm chat and
Runtime contracts.

## D-EXPL-007 — Source Admission Handoff

`MUST`: When a user chooses a persona source, Desktop Explore may only emit a
source-admission handoff intent. The handoff references the RealmPersona source
and its World binding; it is not a relationship mutation and not LocalAgent
creation.

`MUST`: RuntimeSourceSnapshot materialization and repair are owned by
`K-AGCORE-139`. Source removal and LocalAgent deletion are owned by
`K-AGCORE-141`. Explore may show their state but must not implement them as
renderer-local truth.

`MUST NOT`: Explore must not fabricate a LocalAgent, write back to RealmPersona,
or infer source readiness from cached card data.

## D-EXPL-008 — No Desktop Source Creation Entry

`MUST`: Desktop Explore is not a source authoring workbench. RealmPersona and
WorldCharacterCore creation, import, generation, review, publish, and audit
belong to admitted studio/forge paths.

`MUST`: if a creator/studio link is admitted later, it must leave Explore as a
typed external action and return only after core truth has been written by the
owning surface.

`MUST NOT`: Explore must not parse imported persona files, run source
generation, or submit core truth writes.

## D-EXPL-009 — No Local Persona Field Schema

`MUST`: Explore does not define a local minimum field schema for persona
creation. Field authority lives in Realm core/creator contracts and their
studio surfaces.

`MUST NOT`: Explore must not keep a parallel draft schema that can be mistaken
for Realm core truth.

## D-EXPL-010 — No Draft Truth Write

`MUST`: Any source data shown by Explore before Realm acceptance is display-only
or handoff-only. It is not Realm truth and cannot be submitted by Explore.

`MUST NOT`: Explore must not project import/generation candidates as accepted
Realm source records, and must not present generic success for a source write it
does not own.

## D-EXPL-011 — Invalid Data Fails Closed

`MUST`: missing or invalid typed fields must fail closed with a typed state or
shrink the affected optional surface. User-visible cards must not be completed
with guessed names, counts, worlds, avatars, or activity.

`MUST NOT`: Explore must not silently coerce unsupported source fields into
card truth or source admission truth.

## D-EXPL-012 — Source Governance Boundaries

`MUST`: Explore consumes World policy, source visibility, account capability,
moderation, quota, and audit outcomes only through admitted typed projections.

`MUST NOT`: Explore must not bypass world policy, source visibility,
moderation, quota, audit, or core ownership rules by issuing renderer-local
mutations.

## D-EXPL-013 — World Creation Is Not Ordinary Explore Behavior

`MUST`: World creation remains a controlled creator/studio path. Ordinary
Explore users may discover Worlds and sources; they do not create Worlds from
Explore.

`MUST NOT`: any Explore section may expose free World creation or local source
creation as an ordinary Desktop action.

## Fact Sources

- `.nimi/spec/desktop/kernel/tables/explore-sections.yaml` — Explore section catalog.
- `.nimi/spec/desktop/kernel/tables/realm-persona-source-admission-actions.yaml` — source-state to primary-action table.
- `.nimi/spec/desktop/kernel/ui-shell-contract.md` — navigation and World Detail layout.
- `.nimi/spec/desktop/kernel/nimi-home-shell-contract.md` — Apps surface boundary.
- `.nimi/spec/realm/kernel/core-contract.md` — WorldCore, WorldCharacterCore, RealmPersona, RuntimeSourceSnapshot authority.
- `.nimi/spec/realm/kernel/feed-contract.md` — public activity feed scopes and author identity.
- `.nimi/spec/realm/kernel/chat-contract.md` — LocalAgent Chat identity.
- `.nimi/spec/runtime/kernel/runtime-agent-service-contract.md` — RuntimeSourceSnapshot to LocalAgent materialization and deletion.

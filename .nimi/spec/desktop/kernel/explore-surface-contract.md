# Explore Surface Contract

> Owner Domain: `D-EXPL-*`

## Scope

This contract defines Desktop `Explore` as the Realm discovery surface for
WorldCore and source-core identities. The surface discovers:

- admitted `WorldCore` records;
- `WorldCharacterCore` source records through their World/detail/source-detail
  route;
- `RealmPersona` source records bound to a World;
- public Realm activity from human, persona, and world-character sources.

Desktop Explore does not create WorldCore, WorldCharacterCore, RealmPersona, or
SourceMaterializationPacket truth. It does not own Realm feed truth, source
provenance authority, LocalAgent lifecycle, LocalAgent Chat identity, shell
layout, or AI execution.

## D-EXPL-001 — Explore Is The Unified Realm Discovery Surface

`MUST`: `Explore` is the single ordinary Desktop surface for discovering Realm
Worlds, RealmPersonas, World-bound WorldCharacterCore sources, and public
activity. The previous standalone World surface is folded into Explore.

`MUST`: primary navigation placement is owned by `D-SHELL-001`; this rule fixes
only the product responsibility of Explore as Realm discovery.

`MUST NOT`: ordinary primary navigation must not keep a standalone World entry
outside Explore. Explore must not become App discovery; App discovery belongs to
the Apps surface. WorldCharacterCore discovery must use World/detail/source
detail and must not add a fourth Explore section.

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
- featured WorldCharacterCore or RealmPersona sources, with a typed
  source-detail route for either kind;
- public activity;
- local materialization availability where relevant;
- governance or status information when useful to ordinary users.

`MUST`: section ordering and responsive layout are owned by `D-SHELL-011` to
`D-SHELL-014`; this rule fixes only the product facts that may appear.

`MUST NOT`: World detail must not expose a Desktop-local source creation entry.
World and persona authoring belong to admitted creator/studio surfaces, not to
ordinary Explore.

## D-EXPL-005 — Character And Persona Source Card Fields

`MUST`: RealmPersona and WorldCharacterCore source cards may present only these
product facts:

- `displayName` / `avatar`;
- `worldOrigin`;
- `sourceKind` and role/category where supplied by core data;
- `concept` / short description;
- `activitySignal` when supplied by Realm feed projection;
- `sourceState`;
- `primaryAction`, derived from `sourceState` by `D-EXPL-006`.

`MUST`: RealmPersona discovery enters through the existing `Personas` section.
WorldCharacterCore discovery enters through World/detail/source-detail. Both
source kinds converge on `D-EXPL-006`; no new Explore section is admitted.

`MUST`: `sourceState` must come from typed core source data plus the bounded
Runtime/SDK `LocalAgentSourceContextStatus` and opaque local-agent
inventory/provenance projection. Unknown/partial status remains a closed local
materialization unavailable state.

`MUST NOT`: Persona cards must not carry relationship state, quota state, direct
source chat, or local conversation readiness as if those were RealmPersona
truth.

## D-EXPL-006 — Source State To Primary Action

`MUST`: WorldCharacterCore and RealmPersona primary action is derived from the
source-generic state table `tables/realm-source-materialization-actions.yaml`.

| Source state | Primary action | Result |
|---|---|---|
| `source_materialization_available` | `Become my partner` / `成为我的伙伴` | Emit a typed materialization intent for the selected WorldCharacterCore or RealmPersona source. Realm obtains the packet and Runtime owns challenge, validation, snapshot, LocalAgent identity, and materialization. |
| `local_agent_available` | `Open partner` | Open an existing Runtime-owned LocalAgent discovered from Runtime inventory/provenance. |
| `local_agent_ambiguous` | `Open from partners` | Fail closed because Runtime inventory/provenance returned more than one matching partner. |
| `runtime_agent_inventory_pending` | `Checking partner` | Disable the action while Desktop is checking Runtime inventory/provenance. |
| `runtime_agent_inventory_unavailable` | `Runtime unavailable` | Disable the action because Runtime/SDK/auth inventory is unavailable. |

`MUST`: unavailable source or stale hash states are real fail-closed product
states, not loading placeholders. A new materialization attempt must request a
fresh packet and must not synthesize LocalAgent identity from source metadata.
`MUST`: user-facing materialization language is a character/persona
relationship action such as `Become my partner`. Desktop must not present
`Create LocalAgent` or `Create local agent` as the user action.
`MUST`: an existing local-agent state requires Runtime inventory/provenance
read through the SDK/host projection. Desktop may pass the Runtime-owned opaque
`localAgentRef` to Agent Chat, but it must not store token/session custody in
renderer state and must not construct `localAgentRef` from Realm source fields.

`MUST NOT`: Explore must not open LocalAgent Chat directly from a bare
Realm source. LocalAgent Chat requires a Runtime-owned LocalAgent with
opaque identity; source provenance alone is not executable LocalAgent identity.

Desktop consumes only bounded `LocalAgentSourceContextStatus`; it does not
receive source snapshot content, packet/proof, raw diagnostics, prompt, or
context. It never supplies a caller-selected audience, prompt/context, or
LocalAgent identity to materialization.

- AUTHORITY-RELATION subject=desktop action=consume-status object=localagent-source value=bounded-only polarity=require
- AUTHORITY-RELATION subject=desktop-materialization-actions action=set-authority object=source-materialization value=source-generic polarity=require

## D-EXPL-007 — Source Materialization Handoff

`MUST`: When a user chooses a WorldCharacterCore or RealmPersona source,
Desktop Explore may only emit a local materialization handoff intent. The
handoff identifies the typed source ref and World binding. Realm owns packet
issuance and Runtime owns challenge, upload validation, immutable snapshot,
provenance, and LocalAgent creation; the handoff is not a relationship
mutation, durable Realm connection, packet DTO, or LocalAgent creation.

`MUST`: SourceMaterializationPacket materialization is consumed by Runtime under
`K-AGCORE-139`. LocalAgent deletion/reset is Runtime-local under
`K-AGCORE-141`. Source removal does not delete LocalAgent state. Explore may
show their state but must not implement them as renderer-local truth.

`MUST NOT`: Explore must not fabricate a LocalAgent, write back to the source,
fix or replace the Runtime-issued audience, attach prompt/context, or infer
source readiness from cached card data.

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
card truth or local materialization truth.

Unknown or partial `LocalAgentSourceContextStatus` schema, enum, state, source
kind, reason, or coverage branch is an unavailable/failed state and never a
materialization-ready or local-agent-ready state.

## D-EXPL-012 — Source Governance Boundaries

`MUST`: Explore consumes World policy, source visibility, account capability,
moderation, quota, and audit outcomes only through admitted typed projections.

`MUST NOT`: Explore must not bypass world policy, source visibility,
moderation, quota, audit, or core ownership rules by issuing renderer-local
mutations.

Desktop receives no raw source/world snapshot, packet/proof, prompt/lane,
memory, or context authority through governance projections. Bounded status is
presentation input only.

## D-EXPL-013 — World Creation Is Not Ordinary Explore Behavior

`MUST`: World creation remains a controlled creator/studio path. Ordinary
Explore users may discover Worlds and sources; they do not create Worlds from
Explore.

`MUST NOT`: any Explore section may expose free World creation or local source
creation as an ordinary Desktop action.

## D-EXPL-014 - Explore Open Targets

Desktop Explore owns the admitted section and `productIntent` pairings for
Desktop Open Intent. Platform `P-DOPEN-*` may reference
`tables/explore-open-targets.yaml`, but it must not duplicate Explore section
or product-intent truth.

Admitted v1 pairings are:

- `worlds` with optional `discover-worlds`
- `personas` with optional `discover-personas` or `select-partner`
- `activity` with optional `view-activity`

Invalid section/productIntent pairings fail closed as
`desktop-open-target-unsupported`. Explore Open Intent must not create
WorldCore, RealmPersona, SourceMaterializationPacket, or LocalAgent truth.
WorldCharacterCore source materialization remains reachable through a selected
World/detail/source-detail path; it does not add a section/productIntent pair.

## Fact Sources

- `.nimi/spec/desktop/kernel/tables/explore-sections.yaml` — Explore section catalog.
- `.nimi/spec/desktop/kernel/tables/explore-open-targets.yaml` — Explore Desktop Open target and productIntent catalog.
- `.nimi/spec/desktop/kernel/tables/realm-source-materialization-actions.yaml` — source-generic WorldCharacterCore/RealmPersona state-to-action table.
- `.nimi/spec/desktop/kernel/ui-shell-contract.md` — navigation and World Detail layout.
- `.nimi/spec/desktop/kernel/nimi-home-shell-contract.md` — Apps surface boundary.
- `.nimi/spec/realm/kernel/core-contract.md` — WorldCore, WorldCharacterCore, RealmPersona, SourceMaterializationPacket authority.
- `.nimi/spec/realm/kernel/feed-contract.md` — public activity feed scopes and author identity.
- `.nimi/spec/realm/kernel/chat-contract.md` — LocalAgent Chat identity.
- `.nimi/spec/runtime/kernel/runtime-local-agent-materialization-contract.md` — SourceMaterializationPacket to LocalAgent materialization and Runtime-local deletion.

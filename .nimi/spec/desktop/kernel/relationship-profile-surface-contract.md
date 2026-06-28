# Relationship And Profile Surface Contract

> Owner Domain: `D-REL-*`

## Scope

Desktop relationship/profile UX is contextual. It is consumed by Home, Chat,
Explore, Profile, notification, and local materialization flows; it is not a
standalone primary navigation product surface.

This contract owns Desktop placement and reuse rules for relationship/profile
components. It does not own shell navigation, Realm discovery, Friendship
truth, source provenance authority, SourceMaterializationPacket materialization,
or LocalAgent Chat identity.

## D-REL-001 — Contextual Relationship/Profile Surface

`MUST`: Human and source profile detail remains available through shared
profile detail modal and shared profile detail content components. Home,
Explore, Chat, Profile, and notification consumers may open that modal directly
without depending on a standalone relationship-management page.

`MUST`: Social mutations such as remove friend, block, unblock, accept/reject
friend request, and local materialization handoff must use admitted Realm
social/core and Runtime paths. Desktop must not create renderer-local social
truth, pseudo-success, REST bypass, or bare source direct chat.

`MUST`: Local materialization pending, unavailable, or unsupported states must
fail closed or route to an admitted in-context management action. They must not
require a standalone primary relationship-management page.

`MUST NOT`: Desktop shell must not expose relationship management as an
ordinary primary nav tab, lazy route, E2E page journey, governed page shell, or
sidebar surface.

`MUST NOT`: Removing a standalone page must not delete or hide reusable
human/source profile modal behavior from contextual consumers.

## Fact Sources

- `.nimi/spec/desktop/kernel/tables/app-tabs.yaml` — active Desktop app tabs.
- `.nimi/spec/desktop/kernel/tables/renderer-design-overlays.yaml` — shared
  profile detail modal overlay governance.
- `.nimi/spec/desktop/kernel/tables/relationship-categories.yaml` — contextual
  relationship/source categories.
- `.nimi/spec/desktop/kernel/explore-surface-contract.md` — RealmPersona
  discovery and source-state primary actions.
- `.nimi/spec/realm/kernel/social-contract.md` and `.nimi/spec/realm/kernel/core-contract.md` — Friendship and typed source provenance truth.
- `.nimi/spec/runtime/kernel/runtime-agent-service-contract.md` — SourceMaterializationPacket materialization and Runtime-local LocalAgent lifecycle.

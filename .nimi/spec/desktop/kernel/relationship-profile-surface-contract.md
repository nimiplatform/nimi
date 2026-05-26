# Relationship And Profile Surface Contract

> Owner Domain: `D-REL-*`

## Scope

Desktop relationship/profile UX is contextual. It is consumed by Home, Chat,
Explore, Profile, notification, and AgentFriend flows; it is not a standalone
primary navigation product surface.

This contract owns Desktop placement and reuse rules for relationship/profile
components. It does not own shell navigation, Realm discovery, canonical
Friendship / AgentFriend truth, LocalAgent projection truth, or LocalAgent Chat
identity.

## D-REL-001 — Contextual Relationship/Profile Surface

`MUST`: User / Agent profile detail remains available through shared profile
detail modal and shared profile detail content components. Home, Explore, Chat,
Profile, and notification consumers may open that modal directly without
depending on a standalone relationship-management page.

`MUST`: Social mutations such as remove friend, block, unblock, accept/reject
friend request, and open LocalAgent Chat must use admitted Realm social and
Runtime paths. Desktop must not create renderer-local social truth,
pseudo-success, REST bypass, or bare RealmAgent direct chat.

`MUST`: Agent-friend quota exhaustion must fail closed or route to an admitted
in-context management action. It must not require a standalone primary
relationship-management page.

`MUST NOT`: Desktop shell must not expose relationship management as an ordinary
primary nav tab, lazy route, E2E page journey, governed page shell, or sidebar
surface.

`MUST NOT`: Removing a standalone page must not delete or hide reusable
user/agent profile modal behavior from contextual consumers.

## Fact Sources

- `.nimi/spec/desktop/kernel/tables/app-tabs.yaml` — active Desktop app tabs
- `.nimi/spec/desktop/kernel/tables/renderer-design-overlays.yaml` — shared
  profile detail modal overlay governance
- `.nimi/spec/desktop/kernel/explore-surface-contract.md` — RealmAgent
  discovery and friend-state primary actions
- `.nimi/spec/realm/kernel/social-contract.md` — Friendship / AgentFriend
  canonical truth
- `.nimi/spec/runtime/kernel/runtime-agent-service-contract.md` — LocalAgent
  projection lifecycle for AgentFriend relations

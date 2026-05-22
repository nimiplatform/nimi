# Contacts Surface Contract

> Owner Domain: `D-CONTACTS-*`

## Scope

Desktop `Contacts` primary-navigation relationship-management page is retired.
This contract no longer admits a standalone Contacts tab, route, sidebar, or page
shell. Historical relationship semantics now survive only as shared social
actions and reusable profile/detail components consumed by Home, Explore, Chat,
and Profile.

This contract owns the retirement boundary for the former Contacts surface. It
does not own shell navigation, Realm discovery, canonical Friendship /
AgentFriend truth, LocalAgent projection truth, or LocalAgent Chat identity.

## D-CONTACTS-000 — Contacts Primary Page Retired

`MUST NOT`：Desktop shell 不得 expose `contacts` as an ordinary primary nav tab,
lazy route, E2E page journey, or governed page/sidebar surface.

`MUST`：User / Agent profile detail remains available through the shared modal
component (`contact-detail-profile-modal.tsx`) and shared profile detail content
components. Home, Explore, Chat, Profile, and future consumers may open that
modal directly without depending on a Contacts page.

`MUST`：Social mutations formerly surfaced on the Contacts page, such as remove
friend / block / unblock / open LocalAgent Chat, must continue to use admitted
Realm social and Runtime paths. Removing the page does not admit renderer-local
social truth, pseudo-success, REST bypass, or bare RealmAgent direct chat.

`MUST`：When Agent-friend quota is reached, discovery surfaces must fail closed
or route to an admitted in-context management action. They must not route to a
retired Contacts page.

`MUST NOT`：Deleting the Contacts page must not delete or hide reusable
user/agent profile modal behavior from other surfaces.

## Fact Sources

- `.nimi/spec/desktop/kernel/tables/app-tabs.yaml` — active Desktop app tabs
- `.nimi/spec/desktop/kernel/tables/renderer-design-overlays.yaml` — shared profile detail modal overlay governance
- `.nimi/spec/desktop/kernel/explore-surface-contract.md` — RealmAgent discovery and friend-state primary actions

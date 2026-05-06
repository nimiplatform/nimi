# Contacts And Social

Desktop's contacts and social surface lets users manage their
friend list, send and receive friend requests, search users, and
block or unblock contacts. Social state lives canonically in
Realm; Desktop projects it.

## What The Surface Does

| Feature | Behavior |
| --- | --- |
| Friend list | Canonical platform truth, projected from Realm |
| Friend request | Send, receive, accept, decline |
| User search | Find users by handle / display name |
| Block / unblock | Per-user; admitted through Realm |
| Contacts page | Sidebar with collapsible search; auto-collapses on blur or Escape |

The contacts page is not the source of truth. Realm's social
contract (`R-SOC-*`) is. Desktop reads and projects.

## Friendship As Canonical Truth

Friendship in Nimi is **canonical platform truth** — once admitted,
it is not world-local, not session-local, not app-local. It is
visible in any world Alice and Bob both visit, and any app they
both use.

| Property | Value |
| --- | --- |
| Storage | Realm `R-SOC-*` |
| Shape | Ordered-pair uniqueness graph |
| Cross-world visibility | yes — same friendship in every world |
| Cross-app visibility | yes — same friendship in every Nimi app |
| Mutation | Through admitted Realm contracts |

A user who befriends another in World A finds the friendship
visible in World B and in any Nimi app — without re-acceptance.

## Reader Scenario: Sending A Friend Request

You search for a user and send a friend request.

1. **Search.** The contacts search bar accepts a handle.
2. **Realm query.** Desktop queries Realm under admitted user
   search surface; results are typed.
3. **Send request.** You select a user; Desktop submits a typed
   friend request to Realm.
4. **Realm admits.** The request is recorded; the recipient sees
   it.
5. **Recipient accepts.** Realm marks the friendship `active`
   (ordered pair recorded under `R-SOC-*`).
6. **Visible everywhere.** From this moment, the friendship is
   canonical platform truth — visible in any world either of you
   visits.

The friendship is not a Desktop-local cache that needs syncing.
It is canonical Realm truth that Desktop projects.

## Reader Scenario: Blocking A User

You decide to block someone you no longer want to interact with.

1. **Block.** Through the contacts page, you submit a block
   request to Realm.
2. **Realm admits.** Block is recorded; the social graph updates.
3. **Cross-world effect.** The block applies in every world.
   Chat preconditions (which depend on social state) refuse to
   admit further direct conversation.
4. **Audit lineage.** The block event is recorded.

A user blocked in any context is blocked in all contexts. The
social graph is one truth, not per-app.

## Sidebar Behavior

The contacts sidebar has a collapsible search input that
auto-collapses on blur or Escape — small UX detail, but the kind
of behavior that makes the surface feel polished.

## Source Basis

- [`.nimi/spec/desktop/contacts.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/contacts.md)
- [`.nimi/spec/realm/social.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/social.md)
- [`.nimi/spec/realm/kernel/social-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/kernel/social-contract.md)

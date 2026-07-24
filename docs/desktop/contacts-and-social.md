# Relationships And Social

Desktop no longer has a standalone Contacts page. Relationship and
social behavior appears only where the user is already acting: profile
details, chat relationship rail, Explore discovery, Home profile cards,
and notifications.

Realm owns the social graph. Desktop reads the projected relationship
state, renders contextual actions, and sends typed mutations back
through the admitted Realm/SDK path.

## What Desktop Projects

| Surface | Behavior |
| --- | --- |
| Profile detail | Show relationship status, request friendship, remove friend, block user |
| Chat relationship rail | Show available people and agents inside Chat context |
| Explore / Home discovery | Offer contextual add-friend actions from discovered profiles |
| Notifications | Accept, reject, or review incoming friend requests |
| AgentFriend gating | Enforce agent friend quota and local-agent launch preconditions |

There is no primary navigation tab, lazy route, page shell, or
standalone sidebar for Contacts. Those shapes were retired so the
product concept stays centered on relationships, profiles, and the
current task surface.

## Friendship As Canonical Truth

Friendship in Nimi is canonical platform truth. Once admitted, it is
not world-local, session-local, or app-local. It is visible in every
world Alice and Bob both visit and every Nimi app they both use.

| Property | Value |
| --- | --- |
| Storage | Realm `R-SOC-*` |
| Shape | Ordered-pair uniqueness graph |
| Cross-world visibility | yes |
| Cross-app visibility | yes |
| Mutation | Through admitted Realm contracts |

Desktop never treats relationship state as a private local cache. It
projects Realm truth and fails closed when the projection or mutation
precondition is missing.

## Reader Scenario: Sending A Friend Request

You discover a profile from Explore or Home and send a friend request.

1. **Open profile context.** The profile detail surface shows the
   current relationship projection.
2. **Submit request.** Desktop sends a typed friend request through the
   admitted Realm/SDK path.
3. **Realm admits.** The request is recorded; the recipient sees it in
   their notification context.
4. **Recipient accepts.** Realm marks the friendship `active`.
5. **Visible everywhere.** The relationship is now platform truth and
   appears in other admitted contexts.

No Contacts page is involved.

## Reader Scenario: Blocking A User

You block a user from a profile context.

1. **Block.** The contextual profile surface submits the block request.
2. **Realm admits.** The social graph records the block.
3. **Cross-context effect.** Chat and other relationship-dependent
   preconditions refuse further direct interaction.
4. **Audit lineage.** The mutation is recorded with its admitted
   source.

The block is one social truth, not a Desktop-only setting.

## Source Basis

- [`.nimi/spec/canonical/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/canonical/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/realm/README.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/README.md)
- [`.nimi/spec/realm/external-realm.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/realm/external-realm.md)
- [`.nimi/spec/sdks/kernel/realm-api-consumer-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-api-consumer-contract.md)
- [`.nimi/spec/sdks/kernel/realm-core-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-core-contract.md)
- [`.nimi/spec/sdks/kernel/realm-contract.md`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/kernel/realm-contract.md)

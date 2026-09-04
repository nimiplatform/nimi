# Relationships And Social

There is no standalone Contacts page in Desktop. Relationship actions
show up where you're already acting: profile details, the chat
relationship rail, Explore discovery, Home profile cards, and
notifications.

Your social graph lives in Realm. Desktop reads the current
relationship state, offers the actions that fit the context, and sends
changes back through the standard Realm/SDK path.

## What Desktop Projects

| Surface | Behavior |
| --- | --- |
| Profile detail | Show relationship status, request friendship, remove friend, block user |
| Chat relationship rail | Show available people and agents inside Chat context |
| Explore / Home discovery | Offer contextual add-friend actions from discovered profiles |
| Notifications | Accept, reject, or review incoming friend requests |
| AgentFriend gating | Enforce agent friend quota and local-agent launch preconditions |

You won't find a Contacts tab in the main navigation, a separate page
shell, or a sidebar entry. That shape was retired on purpose, so
relationships stay attached to profiles and to whatever you're doing
right now.

## Friendship As Canonical Truth

Friendship in Nimi is platform-wide. Once it's established, it isn't
tied to one world, one session, or one app. It's visible in every
world you both visit and every Nimi app you both use.

| Property | Value |
| --- | --- |
| Storage | Realm `R-SOC-*` |
| Shape | Ordered-pair uniqueness graph |
| Cross-world visibility | yes |
| Cross-app visibility | yes |
| Mutation | Through admitted Realm contracts |

Desktop never treats relationship state as a private local cache. It
shows the state stored in Realm — and when that state can't be read or
a change isn't allowed, the action doesn't go through.

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

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)

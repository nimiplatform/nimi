# Home And Notification

Desktop's Home surface is the social feed and shortcuts entry; the
Notification surface is the unread-count and recent notifications
view. Together they form Desktop's "what's new" surface.

## Home

| Feature | Behavior |
| --- | --- |
| Social feed | Posts and updates from your social graph |
| Shortcuts | Frequent destinations (worlds, agents, conversations) |
| Recommended content | Surface curated content |
| Cross-domain post cards | Surface post cards from other domains (chat, profile, etc.) |

Home is a destination, not an authority. It reads from Realm
social, Realm posts, Realm world / agent surfaces, and projects.

## Cross-Domain Entry Points

Home post cards may surface entry points to other domains —
"Open chat with X" or "View Z's profile". A key
design choice: **Home does not directly own those mutations**.

Cross-domain actions are injected via explicit owner callbacks.
Home presents the entry point; the owner domain (chat, economy,
profile) handles the actual flow.

This is what keeps Home from becoming an accidental shadow
authority for every surface in Desktop.

## Notification

| Feature | Behavior |
| --- | --- |
| Notification list | Recent notifications |
| Unread count badge | Visible in nav |
| Mark as read | Per-notification or all |
| Polling | Polling-based for unread count |

The unread count is polling-based — small operational detail, but
it matters for what apps can rely on. Realtime push for
unread is not admitted; the polling model is.

## Reader Scenario: Acting On A Home Card

You see a home card inviting you to open a direct conversation.

1. **Card surfaces.** Home reads the relevant social event and
   renders a card.
2. **You click "open chat."** Home does not create or mutate a
   thread; it calls the Chat owner through an admitted callback.
3. **Chat handles.** The direct human conversation opens under
   the canonical Realm Chat contract.
4. **Audit lineage.** The user click is recorded; the navigation
   is audited.

Home is the discovery surface. Chat is the action surface. The two
cooperate but neither owns the other's truth.

## Reader Scenario: Checking Notifications

You open Notifications.

1. **List loads.** Recent notifications display.
2. **Unread count.** Badge shows N unread.
3. **Mark as read.** You read items; mark as read; the badge
   decrements.
4. **Polling.** The unread count polls under admitted polling
   policy.

Notifications are bounded; new notification kinds require admitted
notification contracts.

## Source Basis

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)

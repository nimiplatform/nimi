# Home And Notification

Home is your social feed plus shortcuts to the places you use most.
Notifications collect your unread count and recent events. Together
they answer "what's new?"

## Home

| Feature | Behavior |
| --- | --- |
| Social feed | Posts and updates from your social graph |
| Shortcuts | Frequent destinations (worlds, agents, conversations) |
| Recommended content | Surface curated content |
| Cross-domain post cards | Surface post cards from other domains (chat, profile, etc.) |

Home is a reading surface, not a data source. It pulls together social
posts and world / agent updates from your Nimi account and lays them
out for you.

## Cross-Domain Entry Points

A Home card can point into another feature — "Open chat with X" or
"View Z's profile". One design choice worth knowing: **Home doesn't
perform those actions itself**.

When you tap, Home hands off to the feature that owns the action —
chat, economy, or profile — and that feature runs the flow.

That's why a shortcut on Home always behaves exactly like doing the
same thing inside the owning feature.

## Notification

| Feature | Behavior |
| --- | --- |
| Notification list | Recent notifications |
| Unread count badge | Visible in nav |
| Mark as read | Per-notification or all |
| Polling | Polling-based for unread count |

The unread count refreshes by polling. A small operational detail, but
it sets expectations: unread counts update on a polling cadence, not
via realtime push.

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

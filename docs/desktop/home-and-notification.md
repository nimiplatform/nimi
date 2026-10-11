# Home Dashboard and Notification Center

The Nimi Home dashboard serves as your personal AI command center. Here, you can launch new tasks or resume recent conversations, inspect machine hardware acceleration and Runtime readiness, and triage notifications from apps and agents in a consolidated feed.

## Home Dashboard Sections

| Section | Content | Actions |
| --- | --- | --- |
| **Start & Resume** | Quick launch tiles and recent conversations | Instantly resume unfinished workflows or dialogues |
| **Device AI Readiness** | Local hardware status, model readiness, Runtime connectivity | Navigate to AI settings to configure or troubleshoot models |
| **Actionable Messages** | Key todos from apps and agents, download progress, updates | Click cards to jump straight into the corresponding app |
| **Message Center** | Full-width view aggregating all app events, with filters | Batch review notifications and completed items |
| **Moments & Activity** | Community updates, character posts, and social feed | Share your own posts or catch up on friend activities |

## Community Feed and Moments

Clicking "Moments" opens the Realm community stream:
- **Aggregated Content**: View your own posts, updates from friends, and public posts from verified characters (PersonaCharacters and WorldCharacters).
- **Post & React**: Publish rich posts and engage with the community. Visibility permissions (public vs. friends-only) and author identities are preserved authoritatively by Realm.

## Customizing Your Dashboard Feed

- **Hide from Home**: Users can hide specific cards from the Home overview. This only changes visual placement—it never stops background tasks or cancels todos.
- **Restore Cards**: Hidden cards remain accessible in the full Message Center, where you can click "Show on Home" to restore them.
- **Home Message Preferences**: Under "Settings → Notifications", choose which application activity and messages appear in the Home preview. This setting configures the Home dashboard feed only, saved separately from Realm notification delivery preferences.

## User Journey: Launching an App from a Home Todo

1. **Card Appears**: A reminder card from an installed app (e.g., NimiDay schedule companion) surfaces on the Home feed.
2. **Click to Open**: The dashboard opens the corresponding app window and routes directly to the item.
3. **Resolve Task**: Once you update or confirm the item, the card status updates accordingly.

## Source Basis

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)

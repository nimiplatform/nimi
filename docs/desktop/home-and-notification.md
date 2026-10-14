# Home Dashboard and Notification Center

The Nimi Home dashboard is your daily command center for AI tasks, apps, and updates. From here, you can start new workflows, pick up recent conversations, check local hardware acceleration and Runtime health, and triage updates from apps and agents in one consolidated feed.

## Home Dashboard Sections

| Section | Content | Actions |
| --- | --- | --- |
| **Start & Resume** | Quick-launch tiles and recent conversations | Resume unfinished workflows or dialogue sessions |
| **Device AI Readiness** | Local hardware status, model readiness, and Runtime connectivity | Jump to AI settings to configure or troubleshoot models |
| **Actionable Messages** | Key todos from apps and agents, download progress, and pending updates | Click a card to open the corresponding app context |
| **Message Center** | Full-width view of loaded updates with source and status filters | Review notifications and completed items in batches |
| **Moments & Activity** | Community updates, character posts, and social feed | Share posts and interact with updates from friends |

## Community Feed and Moments

Select **Moments** to open the Realm community stream:
- **Aggregated Feed**: Brings together your own posts, updates from friends, and public posts from verified characters (`PersonaCharacters` and `WorldCharacters`).
- **Post & React**: Publish posts and interact with the community. Realm manages post visibility (public or friends-only) and verifies author identity.

## Customizing Your Dashboard Feed

- **Hide from Home**: You can hide App and Agent activity cards from the Home overview. Hiding a card only changes what appears on the dashboard—it never stops background tasks or cancels the underlying todo.
- **Restore Cards**: Hidden cards stay available in the full **Message Center**, where you can select **Show on Home** at any time to put them back on the dashboard.
- **Home Message Preferences**: Under **Settings → Notifications**, choose which apps can surface activity and message cards on the Home preview. This setting only controls the Home dashboard feed and is stored separately from your Realm notification delivery preferences.

## Example Workflow: Acting on a Home Todo

1. **Card Appears**: An installed app (such as the NimiDay schedule companion) posts a reminder card to your Home feed.
2. **Click to Open**: Clicking the card opens the app window and jumps straight to the relevant item.
3. **Resolve Task**: Once you confirm or update the item in the app, the card status on Home updates automatically.

## Source Basis

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)

# Contacts and Social Graph in Desktop

In Nimi Desktop, social connections are not relegated to a standalone address book page. Instead, social relationships are woven contextually into everyday activities: profile views, chat contact rails, discovery streams in Explore, and the notification center.

Relationship data is authoritatively managed by Realm. Desktop reflects relationship states within relevant views and captures user actions (such as sending requests or blocking users), syncing them securely through the SDK.

## Contextual Social Touchpoints

| Interaction Surface | Capabilities & Actions |
| --- | --- |
| **Profile Detail** | View relationship status (friends/unconnected/blocked), send friend requests, remove, or block |
| **Chat Contact Rail** | View available friends and public agents directly within the chat context |
| **Explore & Discovery Feeds** | Follow or send friend requests while browsing worlds, characters, or community posts |
| **Notification Center** | Triage incoming friend requests: accept, decline, or review profile details |
| **Agent Friendship Quotas** | Evaluate agent friend limits and prerequisites before launching LocalAgents |

This context-first design removes unnecessary screen-switching and keeps social interactions seamless.

## Unified Platform Social State

In the Nimi ecosystem, friendship is a network-wide invariant. Once established, it spans across every world you visit and every Nimi application you launch together:

- **Authoritative Storage**: Managed consistently in Realm across all endpoints.
- **Cross-World and Cross-App Visibility**: No need to re-add friends when moving between worlds or apps.
- **Security & Integrity**: Friend requests, approvals, and blocks are mediated by structured contracts that guard against impersonation and unauthorized mutations.

## Common Workflows

### 1. Sending and Accepting Friend Requests
1. **Open Profile**: Click a user's avatar from Explore or a shared conversation to view their profile card.
2. **Send Request**: Click "Add Friend"; Desktop dispatches a structured request via the SDK to Realm.
3. **Receive Notification**: The recipient receives a real-time notification card.
4. **Approve Request**: Upon acceptance, the friendship activates instantly across all shared environments.

### 2. Privacy and Blocking
If you wish to prevent interactions with a specific user, choose "Block" on their profile. Realm updates the social graph, immediately halting direct messages, invitations, and private feed visibility across all worlds and applications.

## Source Basis

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)

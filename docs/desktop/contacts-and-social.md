# Contacts and Social Relationships in Desktop

Instead of isolating contacts in a standalone address book, Nimi Desktop integrates relationship status and actions into the views where you already interact: profile cards, the chat contact rail, Explore feeds, and the notification center.

Realm is the authoritative source for relationship data. Desktop reads current relationship states from Realm and submits user actions—such as sending friend requests, removing friends, or blocking users—through admitted SDK operations.

## Where Social Actions Appear

| Surface | Available Actions |
| --- | --- |
| **Profile Detail** | View relationship status (friend, unconnected, or blocked), send a friend request, remove a friend, or block |
| **Chat Contact Rail** | Browse and open conversations with friends and public Agents |
| **Explore & Discovery Feeds** | Follow creators or send friend requests while browsing worlds, characters, or posts |
| **Notification Center** | Review incoming friend requests and accept, decline, or open the sender's profile |
| **Agent Friendship Quotas** | Check Agent friend limits and prerequisites before launching LocalAgents |

## How Relationship State Is Managed

- **Centralized in Realm**: Friendships, pending requests, and blocks are stored in Realm rather than maintained as isolated local state in a single Desktop view.
- **Shared Across Realm-Backed Surfaces**: Once a relationship changes in Realm, views that read Realm social state reflect the updated status without requiring you to re-add contacts in each surface.
- **Structured Mutations**: Requests, approvals, removals, and blocks go through structured SDK contracts rather than ad-hoc client mutations.

## Common Workflows

### 1. Send and Respond to a Friend Request
1. **Open Profile**: Click a user's avatar in Explore or a conversation to open their profile card.
2. **Send Request**: Click **Add Friend**. Desktop submits the friend request to Realm through the SDK.
3. **Triage in Notifications**: The recipient sees the incoming request in the Notification Center.
4. **Accept or Decline**: Accepting the request updates the relationship in Realm and makes the friend status available to Realm-backed views.

### 2. Block a User
Select **Block** on a user's profile card to record the block in Realm. Once applied, Realm restricts direct messages, requests, and relationship-gated visibility from that user.

## Source Basis

- [`.nimi/spec/desktop/product-surfaces.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/desktop/product-surfaces.authority.yaml)
- [`.nimi/spec/sdks/realm-consumer.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/realm-consumer.authority.yaml)

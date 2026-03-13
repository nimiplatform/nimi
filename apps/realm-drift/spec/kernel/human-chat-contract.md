# Human Chat Contract — RD-HCHAT-*

> Cross-app human-to-human chat via Realm chat API and Socket.IO realtime transport.

## RD-HCHAT-001: Platform Integration

Realm Drift participates in the nimi multi-app chat ecosystem as a peer alongside Desktop and Relay apps.

| Property | Value |
|----------|-------|
| App ID | `nimi.realm-drift` |
| Transport | Socket.IO (same Realm realtime endpoint as Desktop/Relay) |
| REST API | `/api/human/chats/*` via Realm SDK |
| Auth | JWT access token (same token as Realm/Runtime) |

Messages sent from Realm Drift are visible in Desktop and Relay, and vice versa. This is a core platform capability, not app-specific.

### Connection

```typescript
// Socket.IO connection to Realm realtime endpoint
const socket = io(realmRealtimeUrl, {
  path: '/socket.io/',
  auth: { token: accessToken },
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 30000,
});
```

The realtime URL is derived from `NIMI_REALM_URL` (default: same host, path `/socket.io/`).

## RD-HCHAT-002: Chat Panel Integration

The world viewer right panel extends to support both Agent chat and Human chat via a tab selector:

```
┌─────────────────────────────┐
│  [Agents]  [People]         │  ← Tab selector
├─────────────────────────────┤
│                             │
│  (tab-dependent content)    │
│                             │
└─────────────────────────────┘
```

### Agents Tab (default)

Agent list + AI chat per RD-CHAT-001 through RD-CHAT-006. No changes to existing agent chat behavior.

### People Tab

Friend list + human chat. Content:

```
┌─────────────────────────────┐
│  [Agents]  [People]         │
├─────────────────────────────┤
│  Online Friends             │
│  ┌─────────────────────┐    │
│  │ ● Alice  (Desktop)  │    │
│  │ ● Bob    (Relay)    │    │
│  │ ○ Carol  (offline)  │    │
│  └─────────────────────┘    │
├─────────────────────────────┤
│  Chat with Alice            │
│  ┌─────────────────────┐    │
│  │ Alice: Hey!         │    │
│  │ You: Hi there!      │    │
│  │ Alice: Check out... │    │
│  └─────────────────────┘    │
│  [Text input]     [Send]    │
└─────────────────────────────┘
```

## RD-HCHAT-003: Friend List

Fetch friend list via Realm SDK:

```typescript
realm.services.MeService.listMyFriendsWithDetails(cursor?, limit?)
  → paginated FriendDetailDto[]
```

Each friend displays:

| Field | Source |
|-------|--------|
| Name | `friend.name` |
| Handle | `friend.handle` |
| Avatar | `friend.avatarUrl` |
| Online status | Socket.IO `presence` events |
| App context | Derived from presence metadata (Desktop / Relay / Realm Drift) |

Friends are sorted: online first (sorted by name), then offline (sorted by name).

Clicking a friend opens or creates a chat with that user.

## RD-HCHAT-004: Chat Operations

### Start / Open Chat

```typescript
// Start new chat (or get existing)
realm.services.HumanChatService.startChat({ otherUserId, type: 'TEXT', text: initialMessage })
  → ChatViewDto { id, otherUser, lastMessage, unreadCount }

// List existing chats
realm.services.HumanChatService.listChats(limit?, cursor?)
  → ChatViewDto[]

// Get messages
realm.services.HumanChatService.listMessages(chatId, limit?, around?, after?, before?)
  → MessageViewDto[]
```

### Send Message

```typescript
realm.services.HumanChatService.sendMessage(chatId, {
  type: 'TEXT',
  text: messageText,
  clientMessageId: ulid(),  // For optimistic update deduplication
})
```

### Message Types Supported in Demo

| Type | Support |
|------|---------|
| `TEXT` | Yes — primary |
| `IMAGE` | No — demo scope |
| `VIDEO` | No — demo scope |
| `POST_REF` | No — demo scope |
| `RECALL` | Yes — message deletion |
| Others | No — demo scope |

### Edit / Recall

- **Edit**: `realm.services.HumanChatService.editMessage(chatId, messageId, { text })` — optional for demo
- **Recall**: `realm.services.HumanChatService.recallMessage(chatId, messageId)` — SHOULD support

### Read Receipts

Mark chat as read when user opens conversation:

```typescript
realm.services.HumanChatService.markChatRead(chatId)
```

## RD-HCHAT-005: Realtime Sync

### Socket.IO Events (Receive)

| Event | Payload | Action |
|-------|---------|--------|
| `chat:session.ready` | `{ chatId, sessionId, resumeToken, lastAckSeq }` | Store session info |
| `chat:event` | `{ sessionId, seq, eventId, chatId, kind, payload }` | Apply event to local state |
| `chat:session.sync_required` | `{ chatId, requestedAfterSeq }` | REST sync fallback |
| `presence` | User presence update | Update friend online status |

### Socket.IO Events (Send)

| Event | Payload | When |
|-------|---------|------|
| `chat:session.open` | `{ chatId, resumeToken?, lastAckSeq }` | On opening a chat |
| `chat:event.ack` | `{ chatId, sessionId, ackSeq }` | After processing received event |

### Event Kinds

| Kind | Meaning |
|------|---------|
| `message.created` | New message received |
| `message.edited` | Message was edited |
| `message.recalled` | Message was recalled/deleted |
| `chat.read` | Other user read the chat |

### Deduplication

Events MUST be deduplicated by `eventId` using an in-memory set (LRU, max 1000 entries). Duplicate events are silently dropped.

### Reconnection

On Socket.IO reconnect:
1. Send `chat:session.open` with stored `resumeToken` and `lastAckSeq`
2. If server responds with `chat:session.sync_required`, fall back to REST sync:
   ```typescript
   realm.services.HumanChatService.syncChatEvents(chatId, 200, lastAckSeq)
   ```

## RD-HCHAT-006: Chat State Management

Human chat state extends the Zustand store per RD-SHELL-008:

```typescript
// Additional store fields
interface DriftAppStore {
  // ... existing fields ...

  // Human chat
  humanChats: ChatViewDto[];
  activeHumanChat: {
    chatId: string;
    friendName: string;
    messages: MessageViewDto[];
    loading: boolean;
  } | null;
  friendList: FriendDetailDto[];
  onlineUsers: Set<string>;  // User IDs from presence events

  // Actions
  setHumanChats(chats: ChatViewDto[]): void;
  setActiveHumanChat(chat: ActiveHumanChat | null): void;
  setFriendList(friends: FriendDetailDto[]): void;
  addOnlineUser(userId: string): void;
  removeOnlineUser(userId: string): void;
  appendHumanMessage(message: MessageViewDto): void;
  updateHumanMessage(messageId: string, update: Partial<MessageViewDto>): void;
  removeHumanMessage(messageId: string): void;
}
```

### Tab State

The active tab (Agents / People) is stored locally and persists within the session:

```typescript
activeRightPanelTab: 'agents' | 'people';
setActiveRightPanelTab(tab: 'agents' | 'people'): void;
```

## RD-HCHAT-007: Cross-App Visibility

Realm Drift's participation in the chat ecosystem is transparent:

| Scenario | Behavior |
|----------|----------|
| Realm Drift user sends message | Visible in Desktop and Relay immediately via Socket.IO |
| Desktop user sends message | Visible in Realm Drift immediately via Socket.IO |
| Realm Drift user goes online | Presence broadcast to all connected apps |
| Realm Drift user opens a world | No special broadcast — presence only, not activity |

### Demo Showcase Value

The cross-app chat demonstrates nimi's platform architecture:
- **One identity, many surfaces**: Same user, same conversations, regardless of which app they're using
- **Real-time sync**: Messages appear instantly across Desktop, Relay, and Realm Drift
- **Platform composability**: A new app (Realm Drift) joins the ecosystem with minimal integration effort

This is a key differentiator for the nimi platform demo — Realm Drift is not an isolated experience but a connected surface within the nimi ecosystem.

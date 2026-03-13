# Agent Chat Contract — RD-CHAT-*

> Agent discovery, chat panel layout, system prompt construction, streaming, state management, and session semantics.

## RD-CHAT-001: Agent Discovery

The world viewer right pane (top section) displays agents inhabiting the selected world.

### Data Source

Agents are included in the `WorldDetailWithAgentsDto` response from RD-EXPLORE-002:

```typescript
world.agents: WorldAgentSummaryDto[]
```

Each agent summary contains: `id`, `name`, `handle`, `bio`, `avatarUrl`, `ownerType`.

### Agent List Display

| Field | Display |
|-------|---------|
| Avatar | Circular image, 40px, placeholder if `avatarUrl` is null |
| Name | Primary text |
| Bio | Secondary text, truncated to 2 lines |

Agent list is scrollable when more than 4 agents. Clicking an agent selects it for chat and opens the chat section below.

### Empty State

When a world has no agents (`agents.length === 0`), display: "This world has no agents to chat with."

## RD-CHAT-002: Chat Panel Layout

The chat panel occupies the bottom section of the right pane, below the agent list.

```
┌─────────────────────────────┐
│  Selected Agent Header      │
│  [Avatar] Agent Name        │
│  Bio (1 line)               │
├─────────────────────────────┤
│                             │
│  Message List (scrollable)  │
│                             │
│  ┌──────────────────────┐   │
│  │ [User] Hello!        │   │  ← user message (right-aligned)
│  └──────────────────────┘   │
│  ┌──────────────────────┐   │
│  │ [Agent] Welcome to...│   │  ← agent message (left-aligned)
│  └──────────────────────┘   │
│                             │
├─────────────────────────────┤
│  [Text input]     [Send]    │
└─────────────────────────────┘
```

### Behavior

- Message list auto-scrolls to bottom on new messages
- Send button is disabled while streaming
- Enter key sends message (Shift+Enter for newline)
- Streaming text renders progressively in the agent's message bubble (per RD-CHAT-004)
- Switching agents clears the chat history (per RD-CHAT-006)

## RD-CHAT-003: System Prompt Construction

When initiating a chat stream, the system prompt MUST establish agent identity and world context:

```
You are {agent.name}, a character in the world "{world.name}".

{agent.bio}

World description: {world.description}

Genre: {world.genre}
Era: {world.era}

Stay in character. Respond as this character would within the context of this world.
```

### Prompt Assembly Rules

1. Agent identity (`name`, `bio`) MUST always be included
2. World context (`name`, `description`) MUST always be included
3. `genre` and `era` SHOULD be included when present
4. Lorebook entries SHOULD NOT be injected into the system prompt — this is a lightweight demo chat, not a full narrative experience
5. The system prompt MUST NOT exceed 2000 characters
6. Omit any field that is null or empty — do not include placeholder text

## RD-CHAT-004: Streaming via Runtime SDK

Chat uses `runtime.ai.text.stream()` from `@nimiplatform/sdk/runtime` for streaming responses.

### Stream Invocation

```typescript
const { stream } = await runtime.ai.text.stream({
  model: 'auto',
  input: conversationHistory,
  system: systemPrompt,
  route: 'cloud',
  signal: abortController.signal,
  metadata: {
    surfaceId: 'realm-drift',
    extra: { worldId, agentId },
  },
});
```

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `model` | `'auto'` | Let runtime route to available provider |
| `route` | `'cloud'` | Demo uses cloud inference, not local |
| `signal` | `AbortController.signal` | Enables cancellation on agent switch or navigation |
| `surfaceId` | `'realm-drift'` | Identifies traffic source |

### Delta Rendering

```
for await (const part of stream) {
  if part.type === 'delta' → append part.text to partialText in store
  if part.type === 'error' → set error state, stop streaming
}
on stream end → finalize message, set streaming = false
```

The store's `partialText` field is updated on each delta. The chat panel renders `partialText` in the agent's message bubble during streaming.

### Error Handling

| Error | Behavior |
|-------|----------|
| Runtime not ready | Show "AI runtime unavailable" in chat panel |
| Network failure | Show error message in chat, allow retry |
| Stream abort (user-initiated) | Discard partial text, no error shown |
| Provider error | Show error message from stream error payload |

### Conversation History

The `input` array contains the full conversation history for context:

```typescript
const input = messages.map(m => ({
  role: m.role as 'user' | 'assistant',
  content: m.content,
}));
input.push({ role: 'user', content: userMessage });
```

History is maintained in `activeChat.messages` per RD-SHELL-008. No truncation strategy for the demo — conversation length is naturally limited by session ephemerality (per RD-CHAT-006).

## RD-CHAT-005: Chat State Management

Chat state lives in the Zustand store per RD-SHELL-008.

### ChatMessage Type

```typescript
type ChatMessage = {
  id: string;          // ULID
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;   // Date.now()
};
```

### State Update Flow

```
User sends message:
  1. appendChatMessage({ id, role: 'user', content, timestamp })
  2. Set streaming = true, partialText = ''
  3. Invoke runtime.ai.text.stream() per RD-CHAT-004

On each delta:
  4. setStreamingText(accumulated text)

On stream end:
  5. appendChatMessage({ id, role: 'assistant', content: finalText, timestamp })
  6. setStreamingDone() → streaming = false, partialText = ''
```

### Concurrent Chat Guard

Only one active stream per session. The send button MUST be disabled while `streaming === true`. If the user switches agents during an active stream, the current stream MUST be aborted via `AbortController.abort()` before starting a new session.

## RD-CHAT-006: Session Semantics

Agent chat sessions in Realm Drift are **ephemeral**:

| Property | Value |
|----------|-------|
| Persistence | None — messages lost on navigation or app close |
| NarrativeSpine integration | None — demo does not write to narrative system |
| Memory integration | None — demo does not write to agent memory |
| Cross-agent context | None — switching agents clears all messages |
| History limit | None — naturally bounded by session lifetime |

### Agent Switch Behavior

When the user clicks a different agent in the agent list:

1. Abort any active stream (`abortController.abort()`)
2. Clear `activeChat` (set to null)
3. Initialize new `activeChat` with selected agent
4. Chat panel shows empty state for new agent

### World Navigation

When the user navigates back to the browser (`/`) or to a different world:

1. Abort any active stream
2. Clear `activeChat`
3. Chat history is discarded

Marble job state (`marbleJobs`) is preserved — returning to the same world resumes the 3D viewer without regeneration.

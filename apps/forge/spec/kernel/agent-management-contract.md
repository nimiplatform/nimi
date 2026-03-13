# Agent Management Contract — FG-AGENT-*

> Agent CRUD, ownership-aware management, DNA editing, personality preview, and API key management.

## FG-AGENT-001: Agent CRUD

Forge provides full agent lifecycle management for both `WORLD_OWNED` and `MASTER_OWNED` agents, aligned with `R-BOUND-002`.

### Operations

| Operation | API | Method |
|-----------|-----|--------|
| List agents | `/api/creator/agents` | GET |
| Create agent | `/api/creator/agents` | POST |
| Get agent detail | `/api/creator/agents/:agentId` | GET |
| Update agent | `/api/creator/agents/:agentId` | PATCH |
| Delete agent | `/api/creator/agents/:agentId` | DELETE |
| Batch create | `/api/creator/agents/batch-create` | POST |

### Ownership Model

Agent list/detail payloads must expose:

```typescript
interface CreatorAgentRecord {
  agentId: string;
  ownerType: 'MASTER_OWNED' | 'WORLD_OWNED';
  worldId: string | null;
  masterAgentId: string | null;      // Upstream master template, if created from master
  source: 'world-local' | 'master-created';
  status: 'draft' | 'active' | 'archived';
}
```

- `WORLD_OWNED` agents are managed inside a world context and appear in world-scoped filters
- `MASTER_OWNED` agents are creator-level assets that can later be attached to one or more worlds
- Agents created from master templates preserve `masterAgentId` for audit, analytics, and attribution

### Agent List View (`/agents`)

- Paginated grid/list toggle
- Search by agent name/handle
- Filter by world association
- Filter by owner type: world-local, master-created
- Sort by: created date, name, world, owner type
- Quick actions: edit, duplicate, delete (via batch-create with cloned data)
- Group toggle: "All agents", "World agents", "Master agents"

### Agent Detail View (`/agents/:agentId`)

- Tabbed interface:
  - **Profile** — Name, handle, avatar, bio, world association
  - **DNA** — Personality trait editor (see FG-AGENT-002)
  - **Preview** — Live personality test (see FG-AGENT-003)
  - **Keys** — API key management (see FG-AGENT-004)

## FG-AGENT-002: Agent DNA Editor

The DNA editor allows creators to configure agent personality traits. References `@world-engine/services/agent-dna-traits.ts` for trait definitions and validation.

### Trait Categories

Traits are organized by the DNA schema defined in the world engine:

| Category | Description |
|----------|------------|
| Core personality | Archetype, temperament, disposition |
| Communication style | Formality, verbosity, humor level |
| Knowledge domains | Expertise areas, confidence levels |
| Behavioral rules | Boundaries, trigger responses, forbidden topics |
| Voice | Speaking patterns, catchphrases, dialect |

### Editor Interface

- Slider-based controls for numeric traits (0–100 scale)
- Tag-based selection for categorical traits
- Freeform text for voice samples and behavioral rules
- Real-time validation against DNA schema
- "Randomize" button for inspiration
- "Reset to defaults" per category

### Data Flow

```
DNA Editor UI
  → validate against agent-dna-traits schema
  → preview (FG-AGENT-003)
  → save via PATCH /api/creator/agents/:agentId
```

## FG-AGENT-003: Agent Personality Preview

Creators can test-drive an agent's personality before publishing via live AI conversation.

### Implementation

Uses runtime AI `text.stream` for real-time conversational testing:

```typescript
// Pseudo-code for personality preview
const previewSession = {
  systemPrompt: buildAgentSystemPrompt(agentDNA),
  messages: conversationHistory,
  stream: runtime.ai.text.stream({
    model: resolvedRoute,  // Local or cloud model
    system: systemPrompt,
    messages: messages,
  }),
};
```

### UI

- Chat-style interface in the agent detail "Preview" tab
- System prompt preview (collapsible, read-only)
- Conversation history with user/agent message bubbles
- "Reset conversation" button
- "Try as different user persona" dropdown (casual, formal, adversarial)
- Streaming response display with typing indicator

### Constraints

- Preview sessions are ephemeral (not persisted)
- Uses the same model route resolution as World-Studio (local LLM preferred)
- If local LLM unavailable, falls back to cloud text.stream with warning

## FG-AGENT-004: API Key Management

Creators can manage API keys for programmatic agent access.

### Operations

| Operation | API | Method |
|-----------|-----|--------|
| List keys | `/api/creator/keys` | GET |
| Create key | `/api/creator/keys` | POST |
| Delete key | `/api/creator/keys/:id` | DELETE |

### UI

- Table view: key name, created date, last used, truncated key value
- Create dialog: key name input, optional expiry, scope selection
- Delete confirmation with key name display
- Copy-to-clipboard for newly created keys (shown once only)

## FG-AGENT-005: Acceptance Criteria

1. Agent list displays both `WORLD_OWNED` and `MASTER_OWNED` agents with search/filter/sort
2. Agent creation form validates required fields (name, handle, ownerType)
3. Batch create from World-Studio publish flow creates `WORLD_OWNED` agents correctly
4. DNA editor shows all trait categories with appropriate input controls
5. DNA validation errors display inline with field highlighting
6. Personality preview streams AI responses with correct agent persona
7. API key CRUD works: create shows key once, list shows truncated, delete confirms
8. Agent detail tabs switch cleanly with state preservation
9. Detail, update, and delete flows use explicit `/api/creator/agents/:agentId` endpoints

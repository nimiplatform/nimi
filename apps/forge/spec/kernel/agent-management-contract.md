# Agent Management Contract — FG-AGENT-*

> Agent CRUD, ownership-aware management, asset/demo ops, DNA editing,
> personality preview, and API key management.

## FG-AGENT-001: Agent CRUD

Forge provides full agent lifecycle management for both `WORLD_OWNED` and `MASTER_OWNED` agents, aligned with `R-TRUTH-003`.

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

### Agent List View (`/agents/library`)

- Paginated grid/list toggle
- Search by agent name/handle
- Filter by world association
- Filter by owner type: world-local, master-created
- Sort by: created date, name, world, owner type
- Quick actions: edit, duplicate, delete (via batch-create with cloned data)
- Group toggle: "All agents", "World agents", "Master agents"

`/agents/library` is the primary library surface:
- `MASTER_OWNED` agents remain standalone creator assets and open in the master detail page
- `WORLD_OWNED` agents route back into the owning world workspace before editing

### Agent Detail View (`/agents/:agentId`)

- Tabbed interface:
  - **Profile** — Name, handle, avatar, bio, world association
  - **DNA** — Personality trait editor (see FG-AGENT-002)
  - **Preview** — Live personality test (see FG-AGENT-003)
  - **Keys** — API key management (see FG-AGENT-004)

This route is now the **master agent detail** surface. World-owned agent draft editing moves to the workspace-scoped route `/workbench/:workspaceId/agents/:agentId`.

### Workspace Agent Detail (`/workbench/:workspaceId/agents/:agentId`)

- Displays a `WORLD_OWNED` draft agent inside the current world workspace
- Edits local draft truth first, not canonical backend truth directly
- Uses local runtime preview based on draft concept + agent rules
- Participates in the workspace publish plan instead of publishing independently

Agent detail routes may inspect current active multimodal deliverables, but
generation, review, confirmation, and binding authority for admitted asset
families belongs to the agent asset-ops hub and family-focus surfaces.

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

## FG-AGENT-005A: Agent Asset Operations

Forge owns the agent asset-ops hub and family-focus surfaces as the canonical
asset/demo ops surfaces for agents.

Wave 0 admits the following families for agent ops:

- `agent-avatar`
- `agent-cover`
- `agent-greeting-primary`
- `agent-voice-demo`

These surfaces own:

- candidate generation or upload entry
- review queue visibility
- approve / reject decisions
- family confirmation
- binding through an already admitted canonical write surface for the
  applicable agent owner type

Boundary rules:

- `MASTER_OWNED` and `WORLD_OWNED` agents share one asset-family grammar even
  when truth-edit routing differs
- agent detail may summarize active deliverables, but it does not replace the
  asset-ops route as the owner of review semantics
- if a family/owner combination lacks an admitted bind path, Forge must stop at
  `confirmed`; it must not invent a new backend write domain

## FG-AGENT-005B: Greeting Candidate And Confirmation Flow

`agent-greeting-primary` is the canonical primary-opening family for agent
consume and ops surfaces.

Greeting lifecycle rules:

- greeting candidates are `text` candidates under `FG-CONTENT-001`
- generation may come from operator-authored text, AI-assisted rewrite, or
  draft-derived suggestions, but all of them enter one shared review queue
- `approved` means the line is acceptable content
- `confirmed` means the operator selected the active primary greeting
- `bound` is claimed only when the confirmed greeting is written through an
  already admitted canonical agent truth surface for the applicable owner type

Completeness rule:

- `agent-greeting-primary` counts as complete at `confirmed`
- if a bind seam is admitted for the current owner type, `bound` becomes the
  stronger proof of canonical active greeting truth

## FG-AGENT-005C: Voice Demo Operations And Speech Posture

`agent-voice-demo` is the admitted playable speech-demo family for agents.

Forge distinguishes two speech lanes:

1. Plain speech demo synthesis
   - canonical capability: `audio.synthesize`
   - purpose: synthesize playable demo audio from a confirmed greeting or other
     admitted prompt text
2. Optional custom voice design
   - canonical capability: `voice_workflow.tts_t2v`
   - purpose: derive or preview a custom voice identity before a later speech
     demo synthesis step

Posture rules:

- `audio.synthesize` is the only admitted canonical plain-speech route token
  for Forge speech demo generation
- `voice_workflow.tts_t2v` is optional and constrained; it may create
  `workflow-output` candidates or reusable voice handles, but it does not
  replace plain speech demo synthesis
- `tts.synthesize` must not be stored or reasoned over as a canonical Forge
  capability token
- runtime workflow handles and provider/model behavior remain runtime-owned
  truth; Forge only consumes those outputs as candidates inside the family
  review flow
- voice-demo `bind` is valid only when the confirmed playable demo can be
  written through an admitted existing owner surface; otherwise the flow must
  fail closed at `confirmed`

## FG-AGENT-005: Acceptance Criteria

1. `/agents/library` displays both `WORLD_OWNED` and `MASTER_OWNED` agents with search/filter/sort
2. Agent creation form validates required fields (name, handle, ownerType)
3. Batch create from World-Studio publish flow creates `WORLD_OWNED` agents correctly
4. DNA editor shows all trait categories with appropriate input controls
5. DNA validation errors display inline with field highlighting
6. Personality preview streams AI responses with correct agent persona
7. API key CRUD works: create shows key once, list shows truncated, delete confirms
8. Agent detail tabs switch cleanly with state preservation
9. Detail, update, and delete flows use explicit `/api/creator/agents/:agentId` endpoints
10. The agent asset-ops hub and family-focus surfaces are the canonical
    asset/demo ops surfaces for admitted agent families.
11. Avatar, cover, greeting-primary, and voice-demo candidates share one
    approve / reject / confirm / bind grammar.
12. Greeting completeness distinguishes `confirmed` from `bound` and does not
    require Forge to invent a new backend write domain.
13. Voice demo generation uses `audio.synthesize` as the canonical plain speech
    lane and treats `voice_workflow.tts_t2v` as a separate optional custom
    voice-design lane.
14. `MASTER_OWNED` and `WORLD_OWNED` agents share the same asset-ops grammar
    even when their truth-edit or bind seams differ.

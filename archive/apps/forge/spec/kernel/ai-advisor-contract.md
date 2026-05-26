# AI Advisor Contract — FG-ADV-*

> Three AI advisor roles for world consistency, agent coaching, and revenue optimization.

## FG-ADV-001: Overview

AI Advisors are pre-configured AI chat sessions that analyze creator content and provide actionable recommendations. They use the local runtime `text.stream` capability — no new backend required.

### Advisor Roles

| Role | Input | Output |
|------|-------|--------|
| World Advisor | World events + lorebooks + worldview | Timeline consistency, plot holes, character contradictions |
| Agent Coach | Agent DNA traits + conversation logs | Personality optimization, trait balance suggestions |
| Revenue Optimizer | Revenue data + content performance | Pricing strategy, publish timing, content focus |

## FG-ADV-002: World Advisor

### Purpose

Analyze a world's narrative structure for internal consistency and quality.

### System Prompt Template

```
You are a World Consistency Advisor for interactive fiction worlds.

Given the following world data:
- World events (timeline): {eventGraph}
- Lorebook entries: {lorebooks}
- Worldview settings: {worldview}

Analyze for:
1. Timeline inconsistencies (events that contradict temporal ordering)
2. Plot holes (referenced events/characters without definition)
3. Character contradictions (traits/behaviors that conflict across events)
4. Lore gaps (locations/concepts mentioned but not in lorebooks)
5. Narrative dead ends (event chains that lead nowhere)

Provide specific, actionable recommendations with references to event/lorebook IDs.
```

### Input Data

Loaded from current world via SDK:
- `GET /api/worlds/:worldId/history` → world history graph
- `GET /api/worlds/:worldId/lorebooks` → lorebook entries
- `GET /api/worlds/:worldId/state` → worldview/state projection

### Analysis Modes

1. **Chat mode** — Interactive Q&A about the world's consistency
2. **One-click report** — Generate comprehensive analysis report

### Report Structure

```
World Consistency Report
========================
World: {worldTitle}
Analyzed: {timestamp}

## Timeline Analysis
- [ISSUE] Event "X" references time before event "Y" but is ordered after
- [OK] Temporal chain A → B → C is consistent

## Character Analysis
- [ISSUE] Character "Z" described as shy in event 3 but confrontational in event 7
- [SUGGESTION] Add transitional event showing character development

## Lore Coverage
- [GAP] Location "North Keep" mentioned in 3 events but has no lorebook entry
- [OK] All major concepts have lorebook definitions

## Narrative Completeness
- [DEAD_END] Event chain ending at "Battle of Dawn" has no resolution
- [SUGGESTION] Add aftermath event or mark as intentional cliffhanger
```

## FG-ADV-003: Agent Coach

### Purpose

Optimize agent personality configuration for engaging interactions.

### System Prompt Template

```
You are an Agent Personality Coach for interactive AI agents.

Given the following agent data:
- Agent DNA traits: {dnaTraits}
- Sample conversations: {conversationSamples}

Analyze for:
1. Trait balance (over-tuned vs under-tuned dimensions)
2. Personality coherence (traits that work against each other)
3. Engagement potential (traits that drive vs. hinder conversation)
4. Character depth (missing dimensions that could add richness)
5. Edge case behavior (how the agent handles adversarial/unusual input)

Provide specific trait adjustment recommendations with expected behavioral impact.
```

### Input Data

- Agent DNA from current agent being edited
- Conversation samples from personality preview sessions (FG-AGENT-003)

### Analysis Modes

1. **Chat mode** — Ask questions about trait tuning, get suggestions
2. **One-click analysis** — Generate trait optimization report

### Report Structure

```
Agent Personality Analysis
==========================
Agent: {agentName}
Analyzed: {timestamp}

## Trait Balance
- [OVER_TUNED] Formality at 95% may make interactions feel stiff
  → Suggestion: Reduce to 70-80% for more natural conversation
- [UNDER_TUNED] Humor at 10% — agent may feel bland
  → Suggestion: Increase to 30-40% for occasional light moments

## Coherence Check
- [CONFLICT] High empathy (90%) + low patience (20%) creates inconsistent behavior
  → Suggestion: Raise patience to 50%+ to match empathetic personality

## Engagement Score
- Overall: 72/100
- Strengths: Strong knowledge domains, clear communication style
- Weaknesses: Low initiative, rarely asks follow-up questions

## Recommendations
1. Add 2-3 catchphrases to voice profile for memorability
2. Define 1-2 "passion topics" the agent enthusiastically discusses
3. Set explicit boundary for sensitive topics rather than generic deflection
```

## FG-ADV-004: Revenue Optimizer

### Purpose

Provide data-driven recommendations for content monetization strategy.

### System Prompt Template

```
You are a Revenue Optimization Advisor for content creators.

Given the following creator data:
- Revenue history: {revenueData}
- Content inventory: {contentSummary}
- Agent performance: {agentMetrics}

Analyze for:
1. Revenue trends (growth/decline patterns)
2. Top-performing content/agents by earnings
3. Pricing optimization opportunities
4. Publish timing patterns (when content performs best)
5. Undermonetized assets (popular content without revenue capture)

Provide specific, actionable recommendations with projected impact.
```

### Input Data

Loaded from Economy API:
- `GET /api/economy/spark/history` → revenue timeline
- `GET /api/economy/gem/history` → subscription revenue
- `GET /api/economy/revenue-share/preview` → revenue projections
- Agent list + per-agent revenue origin (FG-REV-003)

### Analysis Modes

1. **Chat mode** — Ask about specific revenue questions
2. **One-click report** — Generate revenue optimization report

### Report Structure

```
Revenue Optimization Report
============================
Creator: {creatorName}
Period: {dateRange}

## Revenue Summary
- Total earnings: {totalSpark} Spark + {totalGem} Gem
- Growth rate: {growthPercent}% vs previous period
- Top earner: Agent "{agentName}" ({agentEarnings} Spark)

## Pricing Recommendations
- [UNDERPRICED] World "Fantasy Kingdom" generates high engagement but low revenue
  → Suggestion: Consider premium content tier or gift prompts
- [OPPORTUNITY] Template "Sci-Fi Starter" has 50 forks but is free
  → Suggestion: Set price to 50-100 Spark based on similar templates

## Timing Insights
- Peak gift activity: weekday evenings (18:00-22:00)
- Best publish day: Thursday (highest 48-hour engagement)
- [SUGGESTION] Schedule major content releases for Thursday evening

## Growth Opportunities
1. Create 2-3 more agents in your top-performing world
2. Publish world as template to capture fork revenue
3. Add premium lorebook content for dedicated fans
```

## FG-ADV-005: Implementation Architecture

### Shared Advisor Session Manager

```typescript
interface AdvisorSession {
  id: string;                    // Session ULID
  advisorType: 'world' | 'agent' | 'revenue';
  contextData: Record<string, unknown>;  // Pre-loaded input data
  messages: ChatMessage[];       // Conversation history
  systemPrompt: string;         // Composed from template + context
  createdAt: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}
```

### Session Lifecycle

1. **Create session** — Select advisor type → load context data → compose system prompt
2. **Chat** — User sends messages → stream AI response via `runtime.ai.text.stream`
3. **Generate report** — One-click sends pre-defined analysis prompt → stream formatted report
4. **Close** — Session discarded (not persisted to backend)

### Local Storage

Sessions are persisted to localStorage during the current app session for continuity:
- Key: `nimi:forge:advisor:{userId}:{advisorType}`
- Cleared on explicit "New session" or app restart

## FG-ADV-006: UI (`/advisors`)

### Advisor Selection

- Three advisor cards: World Advisor, Agent Coach, Revenue Optimizer
- Each card shows: icon, description, "Start Session" / "Resume" button
- Context selector: which world/agent to analyze (for World Advisor / Agent Coach)

### Chat Interface

- Full-height chat panel with message history
- Streaming response with typing indicator
- "Generate Report" button in toolbar → sends analysis prompt, renders formatted output
- "Copy Report" button for generated reports
- "New Session" button to reset context

### Layout

```
┌──────────────────────────────────────────────────┐
│  Advisor: World Advisor  |  World: Fantasy Kingdom │
├────────────────────┬─────────────────────────────┤
│                    │  Context Preview             │
│  Chat Messages     │  (collapsible)               │
│                    │  - 47 events                  │
│  [AI response]     │  - 12 lorebooks               │
│  [User message]    │  - 3 worldview modules        │
│  [AI response]     │                               │
│                    │                               │
│                    │                               │
├────────────────────┴─────────────────────────────┤
│  [Input] .......................... [Send] [Report]│
└──────────────────────────────────────────────────┘
```

## FG-ADV-007: Acceptance Criteria

1. All three advisor types can be started with appropriate context data
2. World Advisor correctly loads events, lorebooks, worldview from selected world
3. Agent Coach loads DNA traits from selected agent
4. Revenue Optimizer loads earnings data from Economy API
5. Chat mode streams responses via runtime.ai.text.stream
6. One-click report generates structured analysis output
7. Reports can be copied to clipboard
8. Sessions persist in localStorage across page navigations (not across app restarts)
9. Context preview shows loaded data summary

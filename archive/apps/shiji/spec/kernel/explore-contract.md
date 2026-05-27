# ShiJi Explore Contract

> Rule namespace: SJ-EXPL-*
> Scope: Historical period browsing, agent selection, session initiation

## SJ-EXPL-001 — World Listing

Explore home presents all available historical periods as a timeline:

1. Read `world-catalog.yaml` as the authoritative ShiJi whitelist and timeline order
2. Fetch public worlds via `GET /api/world` (per `api-surface.yaml`) and join only catalog-listed `worldId`s
3. Render order follows catalog `sortOrder`; `startYear` / `endYear` are used for timeline positioning and labels
4. Display each world as a timeline node with: display name, era label, content badge, truth badge, and banner thumbnail
5. If the Realm API fetch fails, display a retriable error on the Explore surface; do not fall back to cached or partial world lists that might present stale eligibility

## SJ-EXPL-002 — Timeline Visualization

The "time river" (时间长河) is the primary navigation metaphor:

1. Horizontal scrollable timeline from ancient (left) to modern (right)
2. Each era node shows: World banner thumbnail, period name, date range
3. Explored worlds show full color; unexplored worlds show muted/desaturated
4. Current selection highlights with accent border
5. Timeline supports keyboard navigation (left/right arrows)

## SJ-EXPL-003 — World Filtering and Search

As the world catalog grows, filtering aids discovery:

1. Text search covers catalog display name, era label, and world tagline
2. Filter by exploration status: all / explored / unexplored
3. Filter results update the timeline view, hiding non-matching nodes
4. Search never broadens the whitelist; non-catalog worlds remain invisible even if the API returns them

## SJ-EXPL-004 — World Detail View

World detail page presents the selected historical period:

1. Fetch via `GET /api/world/by-id/{worldId}/detail-with-agents` (per `api-surface.yaml`)
2. Hero section: banner image, world name, era, tagline, description, content badge, truth badge
3. Recommended agents section: PRIMARY importance agents as character cards
4. More agents section (collapsible): SECONDARY importance agents
5. World overview section: era context, key themes, historical significance, and classification disclosure

## SJ-EXPL-005 — Agent Card Display

Agent cards are the primary entry point to dialogue:

1. Each card shows: avatar (AGENT_AVATAR binding), name, role/title, one-line bio
2. PRIMARY agents display prominently (larger cards, featured position)
3. SECONDARY agents display in a compact grid
4. Card click navigates to agent detail page
5. Agent availability indicator (some agents may be locked for future release)

## SJ-EXPL-006 — Agent Detail and Session Start

Agent detail page provides character context before dialogue begins:

1. Fetch via `GET /api/agent/accounts/{agentId}` (per `api-surface.yaml`)
2. Display: portrait, name, era, role, personality summary
3. Character introduction text (from Agent DNA identity.summary)
4. Historical significance context must retain the parent world's content badge and truth badge
5. "Start Dialogue" button creates a new session or resumes an existing one
6. If a prior session exists for this world+agent pair, show "Resume" with chapter progress

## SJ-EXPL-007 — Catalog Gating

ShiJi world eligibility is catalog-governed:

1. Only worlds listed in `world-catalog.yaml` may appear on Explore surfaces
2. World tags, search matches, and raw browse DTOs are not authoritative eligibility sources
3. Catalog rows with `status != ACTIVE` are not shown in the stable student-facing UI

## SJ-EXPL-008 — Unified Timeline Classification

History, literature, and mythology share one time river:

1. All eligible worlds mount onto a single unified timeline
2. Every node and detail surface must display both `contentType` and `truthMode`
3. Literary and mythic worlds may enrich historical understanding, but they must not be visually or semantically presented as canonical history

## SJ-EXPL-009 — Typed Filters

Explore provides structured filtering over the catalog:

1. Filter by `contentType` using the values defined in `content-classification.yaml`
2. Filter by `truthMode` using the values defined in `content-classification.yaml`; student-facing labels come from table display labels rather than raw enum keys
3. Typed filters are derived from `world-catalog.yaml` and `content-classification.yaml`

## SJ-EXPL-010 — Classification Pair Validation

Catalog entries with invalid classification must not reach stable UI:

1. On catalog load, validate each entry's `contentType` + `truthMode` against `content-classification.yaml` `allowed_pairs`
2. Entries whose pair is not in `allowed_pairs` are excluded from all Explore surfaces, with the same effect as `status != ACTIVE`
3. Validation failures are logged for operational visibility but do not surface error UI to the student

## SJ-EXPL-011 — Timeline Narrative Transitions

The timeline is not a static menu; transitions between eras carry narrative context:

1. When the student scrolls or navigates between adjacent eras on the timeline, a brief transition text may appear — e.g., "秦帝国崩塌了，天下大乱，两个人站了出来争夺天下——"
2. Transition texts are pre-authored content tied to the gap between consecutive `world-catalog.yaml` entries, stored as part of catalog or world metadata
3. Transitions are optional per era pair; if no transition text exists, the timeline scrolls without narrative overlay
4. Transition text is dismissible and non-blocking — the student can skip or scroll past it
5. Transitions play only on first encounter per learner; revisited era boundaries show no overlay

## SJ-EXPL-012 — Multi-Perspective Replayability

The same historical period yields different stories through different characters:

1. World detail pages (per SJ-EXPL-004) must communicate that each agent offers a distinct perspective — e.g., "跟李世民聊大唐，看到的是帝王视角；跟杜甫聊大唐，看到的是百姓苦难"
2. Agent cards (per SJ-EXPL-005) include a one-line perspective hint describing what this character's viewpoint uniquely reveals
3. After completing a session with one agent, the world detail page highlights unseen agents with a "换个视角再看这段历史" prompt
4. Progress overview (per SJ-PROG-003) tracks per-world agent coverage — e.g., "大唐盛世：已对话 1/3 位人物"
5. Knowledge graph (per SJ-KNOW-005) may show which concepts were learned through which agent, reinforcing that different agents teach different things

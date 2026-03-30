# ShiJi Explore Contract

> Rule namespace: SJ-EXPL-*
> Scope: Historical period browsing, agent selection, session initiation

## SJ-EXPL-001 — World Listing

Explore home presents all available historical periods as a timeline:

1. Read `world-catalog.yaml` as the authoritative ShiJi whitelist and timeline order
2. Fetch public worlds via `GET /api/world` (per `api-surface.yaml`) and join only catalog-listed `worldId`s
3. Render order follows catalog `sortOrder`; `startYear` / `endYear` are used for timeline positioning and labels
4. Display each world as a timeline node with: display name, era label, content badge, truth badge, and banner thumbnail

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
3. Filter by `gradeBand` using the values defined in `world-catalog.yaml`
4. Typed filters are derived from `world-catalog.yaml` and `content-classification.yaml`

# Forge — Execution Plan

> Phased implementation plan with milestones and dependencies.
> Authoritative feature phasing in `kernel/tables/feature-matrix.yaml`.

## Completion Boundary

The current hard-cut completion target is the creator-facing world/agent platform:
- world-centric workbench
- stable creator catalog and detail surfaces for worlds and agents
- canonical world and agent multimodal deliverable ops surfaces
- embedded world create/maintain
- master/world agent management
- workspace-scoped Character Card and novel import
- unified review state and ordered publish safety

Generic `Content` and `Publish` utilities remain supporting workflows. Revenue, Advisors, Copyright,
Templates, and Analytics are outside the current completion bar.

## Phase Overview

| Phase | Scope | Features | New Backend | Depends On |
|-------|-------|----------|-------------|------------|
| 1 | App Shell + Auth + Workbench Shell | 7 | None | — |
| 2 | World Management Migration + Workspace Outer State | 6 | None | Phase 1 |
| 3 | Agent Management + Workbench Agent Drafts | 6 | Conditional: agent detail/update/delete extension if absent | Phase 1 |
| 4 | Creator Catalog + Multimodal Ops + Secondary Content | 10 | None | Phase 1 |
| 5 | Non-Core Revenue | 3 | None | Phase 1 |
| 6 | Advisors + Deferred Extensions | 6 | None in current scope | Phase 2, 3, 5 |

Phases 1 through 4 define current Forge closure as a world/agent platform.
Within Phase 4, world and agent catalog and deliverable ops surfaces are on the primary authority line, while generic content creation and publishing remain supporting workflows.
Phases 5 through 6 remain secondary or deferred and do not block the hard-cut decision.

---

## Phase 1: App Shell + Auth + Workbench Shell

**Goal**: Standalone Tauri app that boots, authenticates, and renders creator layout with route skeleton.

### Tasks

#### 1.1 Project Scaffold
- Create `nimi/apps/forge/` with `package.json`, `tsconfig.json`, `vite.config.ts`, `tailwind.config.ts`
- Add to pnpm workspace (pattern `apps/*` already covers it)
- Vite config: root `src/shell/renderer`, port 1421, aliases (`@renderer`, `@runtime`, `@nimiplatform/sdk`, `@nimiplatform/nimi-kit/core`, `@world-engine`)

#### 1.2 Tauri Shell
- Create `src-tauri/` with `tauri.conf.json` (identifier `app.nimi.forge`, window 1440x900)
- Rust `main.rs` — trimmed from desktop (no mod system, no external agent gateway)
- `Cargo.toml` with Tauri 2.10 dependencies

#### 1.3 Bootstrap
- `src/shell/renderer/infra/bootstrap/forge-bootstrap.ts`
- 7-step sequence per FG-SHELL-003
- Adapted from desktop `runtime-bootstrap.ts`: remove mod registration, external agent bridge, data-sync full pipeline
- Retain: runtime defaults, platform client, auth, query client, SDK runtime readiness, exit handler

#### 1.4 Auth Flow
- Reuse desktop JWT auth pattern
- Creator access gate: `GET /api/world-control/access/me` → gate app render
- Auth state in Zustand store

#### 1.5 Layout + Navigation
- `src/shell/renderer/app-shell/` — StudioLayout, Sidebar, ContentArea
- Sidebar with grouped navigation per FG-SHELL-005
- React Router v7 with lazy-loaded route stubs (placeholder pages)

#### 1.6 Provider Stack
- QueryClientProvider, StoreProvider, AuthProvider, CreatorAccessGate, RouterProvider
- App store shape per FG-SHELL-009

#### 1.7 World Workbench Shell
- Add `/workbench`, `/workbench/new`, `/workbench/:workspaceId`
- Create local `ForgeWorkspaceStore`
- Make workbench the primary creator home instead of module-first navigation

### Milestone: App boots in Tauri, authenticates, and opens a world-centric workbench shell

---

## Phase 2: World Management Migration

**Goal**: Full CREATE and MAINTAIN pipelines working in Forge.

### Tasks

#### 2.1 Data Client Adapter
- `src/shell/renderer/data/world-data-client.ts`
- Rewrite ~25 data query functions: `hookClient.data.query()` → SDK realm client calls
- Same function signatures as World-Studio's data layer
- Per FG-WORLD-002

#### 2.2 State Store Adaptation
- `src/shell/renderer/state/creator-world-store.ts`
- Based on `workspace-store.ts` from World-Studio
- Remove mod-scoped storage keys, use `nimi:forge:workspace:{userId}`
- Per FG-WORLD-005

#### 2.3 CREATE Pipeline Pages
- Import CREATE UI panels from `@world-engine/ui/create/*`
- Wrap in Forge layout
- Wire to data client adapter + state store
- 7-step flow: source → ingest → extract → checkpoints → synthesize → draft → publish
- Task lifecycle (pause/resume/cancel) via adapted hooks
- Per FG-WORLD-003

#### 2.4 MAINTAIN Pipeline Pages
- Import MAINTAIN UI panels from `@world-engine/ui/maintain/*`
- 6 panels: base, worldview, events, lorebooks, event graph, mutations
- Conflict detection + reload-remote
- Per FG-WORLD-004

#### 2.5 World List Page
- List view combining drafts (`GET /api/world-drafts`) + published (`GET /api/worlds/mine`)
- Status indicators: draft, published, has unsaved changes
- Quick actions: continue editing, open maintain, delete draft

### Milestone: Creator can complete full CREATE → REVIEW → PUBLISH → MAINTAIN cycle from one workbench

---

## Phase 3: Agent Management

**Goal**: Agent CRUD, DNA editing, personality preview, and API key management.

**Prerequisite**: Phase 1 (app shell)

### Tasks

#### 3.1 Agent List Page
- Grid/list view of creator agents
- Search, filter by world/owner type, sort by date/name
- Per FG-AGENT-001

#### 3.2 Agent Detail Page
- Tabbed interface: Profile, DNA, Preview, Keys
- Profile tab: name, handle, avatar, bio, world selector, owner type
- Fetch/update/delete via `/api/creator/agents/:agentId`
- Per FG-AGENT-001

#### 3.3 DNA Editor
- Import `@world-engine/services/agent-dna-traits.ts` for trait schema
- Slider controls for numeric traits
- Tag selection for categorical traits
- Freeform text for voice/rules
- Real-time validation
- Per FG-AGENT-002

#### 3.4 Personality Preview
- Chat-style AI conversation interface
- Uses runtime `text.stream` with agent's DNA as system prompt
- Ephemeral sessions, not persisted
- Per FG-AGENT-003

#### 3.5 API Key Management
- Table view of keys
- Create/delete operations
- Copy-to-clipboard for new keys
- Per FG-AGENT-004

### Milestone: Creator can manage master agents, edit world-owned drafts inside workbench, and publish from workspace truth

---

## Phase 4: Creator Catalog + Multimodal Ops + Secondary Content Creation

**Goal**: Land stable creator catalog and multimodal ops surfaces while keeping generic content creation and publishing as supporting workflows.

**Prerequisite**: Phase 1 (app shell)

### Tasks

#### 4.1 World Detail
- Land `/worlds/:worldId` as a stable creator inspection surface
- Show current deliverable completeness and active multimodal selections without treating workbench as the only inspection path
- Keep workbench as the authoring route rather than the default detail redirect

#### 4.2 World Agents Roster
- Land `/worlds/:worldId/agents` as the world-context agent consume surface
- Make world-owned agent status explicit in the owning-world context
- Keep roster authority separate from workbench-local draft editing

#### 4.3 World Asset Ops
- Land `/worlds/:worldId/assets` and `/worlds/:worldId/assets/:family`
- Make world deliverable family entrypoints canonical for creator review, confirmation, and binding
- Keep shared studios and content library subordinate to these world ops surfaces

#### 4.4 Agent Asset Ops
- Land `/agents/:agentId/assets` and `/agents/:agentId/assets/:family`
- Give agent deliverables one admitted ops grammar across master and world-context use
- Keep greeting and voice-demo work on explicit ops surfaces rather than hidden helper flows

#### 4.5 Image Studio
- Prompt builder with templates and style presets
- Generation via `runtime.media.image.generate`
- Staging gallery for generated images
- Save to library via `POST /api/resources/images/direct-upload`
- Per FG-CONTENT-001

#### 4.6 Video Studio
- Upload zone with drag-and-drop
- Upload via `POST /api/resources/videos/direct-upload`
- Finalize resource via `POST /api/resources/{resourceId}/finalize`
- Preview player resolves via `GET /api/resources/{resourceId}`
- Per FG-CONTENT-002

#### 4.7 Music Studio
- Prompt + lyrics builder
- Generation via `runtime.media.music.generate`
- Audition queue with waveform preview
- Save via `POST /api/resources/audio/direct-upload`
- Per FG-CONTENT-006

#### 4.8 Content Library
- Unified asset browser (images + videos + audio)
- Search, filter, sort
- Bulk operations (delete, tag)
- Asset-entity association view
- Per FG-CONTENT-003

#### 4.9 Audio Resource Save
- Persist generated audio through existing resource upload and finalize surfaces
- Keep audio resource handling aligned with the unified resource session contract
- Do not introduce a Forge-specific media backend domain

#### 4.10 Publishing Frontend
- Publish workspace: local drafts, identity selection, publish history
- Use existing post capabilities for creator-authored publishing
- Treat internal destinations as app-level semantics, not backend-managed channels
- Leave scheduled publishing out of the current backend contract
- Per FG-CONTENT-007

### Milestone: Creator can inspect worlds and agents outside workbench, operate canonical multimodal deliverable surfaces, and keep shared content tools in a supporting role

---

## Phase 5: Non-Core Revenue

**Goal**: Revenue remains available as a non-core module outside the current hard-cut completion bar.

**Prerequisite**: Phase 1 (app shell)

### Tasks

#### 5.1 Revenue Dashboard
- KPI cards (balances, 30d earnings, pending withdrawal)
- SVG time series chart (Spark + Gem history)
- Earnings breakdown table with filters
- Per FG-REV-002

#### 5.2 Revenue Split + Connect
- Revenue share config display
- Per-agent earnings breakdown
- Stripe Connect onboarding flow
- Per FG-REV-003, FG-REV-004

#### 5.3 Withdrawal Management
- Withdrawal calculator + eligibility check
- Create withdrawal flow
- Withdrawal history with status tracking
- Per FG-REV-005

#### 5.4 Copyright (Deferred Extension)
- Keep `/copyright` as a placeholder route only
- Do not create a copyright backend module in the current execution plan
- Revisit scope only if a separate realm/backend extension is approved later

### Milestone: Revenue remains non-blocking to world/agent platform closure

---

## Phase 6: Extensions (Advisors + Deferred Modules)

**Goal**: AI advisors, plus explicit placeholders for deferred extensions.

**Prerequisites**: Phase 2 (world management), Phase 3 (agent management), Phase 5 (revenue)

### Tasks

#### 6.1 Template Marketplace (Deferred Extension)
- Keep `/templates`, `/templates/mine`, and `/templates/:templateId` as placeholders only
- Do not create template backend models or controllers in the current execution plan
- Redesign later against World-Studio and world draft semantics before implementation

#### 6.2 AI Advisors
- Advisor selection hub (3 roles)
- World Advisor: loads events + lorebooks + worldview → chat/report
- Agent Coach: loads DNA traits + conversation logs → chat/report
- Revenue Optimizer: loads earnings data → chat/report
- Shared session manager with localStorage persistence
- Per FG-ADV-002 through FG-ADV-005

#### 6.3 Analytics (Deferred Extension)
- Keep `/analytics` as a placeholder route only
- Do not create analytics backend endpoints in the current execution plan
- Revisit only as an explicit future module decision

#### 6.4 Settings Page
- App preferences (theme, sidebar default state, notification settings)
- localStorage-based (no backend)

### Milestone: Complete Forge creator workflow with world, agents, content, revenue, and advisor support; extension modules remain deferred

---

## Dependency Graph

```
Phase 1 (App Shell)
  ├── Phase 2 (World Management)
  ├── Phase 3 (Agent Management)
  │     └── Phase 6.2 (AI Advisors — Agent Coach)
  ├── Phase 4 (Content Creation + Publishing)
  └── Phase 5 (Revenue)
        └── Phase 6.2 (AI Advisors — Revenue Optimizer)
```

## New Backend Work Summary

| Module | Phase | Endpoints | Prisma Models | Controller Path |
|--------|-------|-----------|---------------|-----------------|
| Creator Agent Detail Extension | 3 | 3 | 0 | `modules/creator/creator.controller.ts` |
| Media Audio Upload Extension | 4 | 1 | 0 | `modules/media/media.controller.ts` |
| **Total** | | **4** | **0** | |

## Verification Checklist

- [ ] All routes in `routes.yaml` have corresponding page components
- [ ] All API endpoints in `api-surface.yaml` are referenced by at least one feature
- [ ] All features in `feature-matrix.yaml` have a contract rule reference
- [ ] Only current-scope backend additions are represented as `status: new`
- [ ] Each phase's prerequisites are satisfied before execution begins
- [ ] `openapi:dump` runs clean after the audio upload extension
- [ ] No admin endpoints leak into `api-nimi.yaml`

# Realm Drift — Execution Plan

> **Non-normative.** This document is an implementation guide, not a kernel contract.
> It does not define rules or constraints — those live in `kernel/*.md`.
> Authoritative feature phasing in `kernel/tables/feature-matrix.yaml`.
> Follows the same pattern as `apps/forge/spec/execution-plan.md`.

## Phase Overview

| Phase | Scope | Features | New Backend | External API | Depends On |
|-------|-------|----------|-------------|-------------|------------|
| 1 | App Shell + Auth | 5 | None | None | — |
| 2 | World Browser | 2 | None | None | Phase 1 |
| 3 | Marble 3D Integration | 5 | None | World Labs Marble API | Phase 1, 2 |
| 4 | Chat (Agent + Human) | 7 | None | None | Phase 1, 2 |
| 5 | Polish | 3 | None | None | Phase 3, 4 |

Phases 3 and 4 are independent of each other and MAY run in parallel after Phase 2.

Phase 5 depends on both Phase 3 and Phase 4 being functionally complete.

---

## Phase 1: App Shell + Auth

**Goal**: Standalone Tauri app that boots, authenticates, and renders an empty layout with route skeleton.

### Tasks

#### 1.1 Project Scaffold
- Create `nimi/apps/realm-drift/` with `package.json`, `tsconfig.json`, `vite.config.ts`
- Add to pnpm workspace (pattern `apps/*` auto-discovers)
- Vite config per RD-SHELL-007: root `src/shell/renderer`, port 1424, aliases
- Dependencies: `@nimiplatform/sdk`, `@nimiplatform/shell-core`, React 19, Zustand, TanStack Query, react-router-dom

#### 1.2 Tauri Shell
- Copy `src-tauri/` from forge (entire directory including runtime_bridge)
- Update `tauri.conf.json` per RD-SHELL-001: identifier, productName, devUrl, CSP
- Update `Cargo.toml`: package name
- Verify: `cargo check` passes

#### 1.3 Bridge Layer
- Copy `src/shell/renderer/bridge/` from forge (env, types, invoke, runtime-defaults, runtime-daemon, index)
- No modifications needed — same IPC protocol

#### 1.4 Bootstrap
- Create `src/shell/renderer/infra/bootstrap/drift-bootstrap.ts`
- 5-step sequence per RD-SHELL-003
- Create `src/runtime/platform-client.ts` — copy from forge, change `DEFAULT_APP_ID` to `'nimi.realm-drift'`

#### 1.5 App Shell
- Create `App.tsx` with bootstrap trigger and route rendering
- Create `app-store.ts` per RD-SHELL-008
- Create `app-providers.tsx` per RD-SHELL-006
- Create `app-routes.tsx` with 2 route stubs: `/` and `/world/:worldId`
- Create minimal `index.html`, `main.tsx`, `styles.css`
- Create `i18n/index.ts` (minimal English-only)

### Milestone: App boots in Tauri, authenticates, shows empty browser page at `/`

---

## Phase 2: World Browser

**Goal**: Grid of nimi worlds displayed on the browser page, clickable to navigate to viewer.

**Prerequisite**: Phase 1 (app shell)

### Tasks

#### 2.1 World List Queries
- Create `features/world-browser/world-browser-queries.ts`
- TanStack Query hooks wrapping Realm SDK world list calls
- Handle loading, error, empty states

#### 2.2 World Browser Page
- Create `features/world-browser/world-browser.tsx`
- Grid layout per RD-EXPLORE-001: responsive columns, world cards with metadata
- Click handler: navigate to `/world/:worldId`
- Search/filter (optional for demo — world name text filter)

### Milestone: Browser page shows grid of worlds with icons, names, genres; clicking navigates to viewer

---

## Phase 3: Marble 3D Integration

**Goal**: Generate 3D environments from nimi world data via Marble API and embed the viewer.

**Prerequisite**: Phase 2 (world browser — need world detail fetching)

### Tasks

#### 3.1 Marble API Client
- Create `features/world-viewer/marble-api.ts`
- Functions per RD-MARBLE-004 and RD-MARBLE-005:
  - `generateMarbleWorld(apiKey, input)` → `{ operationId }`
  - `pollMarbleWorld(apiKey, operationId, onProgress, signal)` → `MarbleWorldResult`
- Types for request/response shapes per `external-api-surface.yaml`

#### 3.2 Prompt Composer
- Create `features/world-viewer/marble-prompt.ts`
- Composition algorithm per RD-MARBLE-002
- Image-guided generation support per RD-MARBLE-003
- Handle sparse world data gracefully

#### 3.3 Marble Viewer Component
- Create `features/world-viewer/marble-viewer.tsx`
- Four visual states per RD-EXPLORE-005: idle, generating, ready, error
- iframe embedding per RD-EXPLORE-004 with Tauri dual Webview fallback
- Quality toggle (mini/standard) per RD-MARBLE-006

#### 3.4 World Viewer Page
- Create `features/world-viewer/world-viewer.tsx`
- Split-pane layout per RD-EXPLORE-003: 70% viewer + 30% chat
- Parallel data fetching per RD-EXPLORE-002
- Header bar with back button, world name, regenerate button
- Wire: fetch world data → compose prompt → generate → poll → embed viewer

### Milestone: User can select a world, generate 3D, and explore it in the embedded Marble viewer

---

## Phase 4: Chat (Agent + Human)

**Goal**: Chat with world agents AND human friends in the right panel while exploring 3D.

**Prerequisite**: Phase 2 (world data fetching provides agent list)

### Tasks

#### 4.1 Right Panel Tab Structure
- Add tab selector to right panel: **Agents** | **People**
- Per RD-HCHAT-002: Agents tab shows agent chat, People tab shows human chat
- Tab state stored in Zustand

#### 4.2 Agent List Component
- Create `features/agent-chat/agent-list.tsx`
- Display per RD-CHAT-001: avatar, name, bio, click to select
- Handle empty state (no agents)

#### 4.3 Agent Chat Stream Controller
- Create `features/agent-chat/chat-stream.ts`
- System prompt construction per RD-CHAT-003
- Runtime SDK `text.stream()` invocation per RD-CHAT-004
- AbortController for cancellation
- Delta rendering callback

#### 4.4 Agent Chat Panel Component
- Create `features/agent-chat/agent-chat-panel.tsx`
- Layout per RD-CHAT-002: header, message list, input
- Streaming delta rendering
- State management per RD-CHAT-005
- Agent switch behavior per RD-CHAT-006

#### 4.5 Socket.IO Realtime Connection
- Create `features/human-chat/realtime-connection.ts`
- Socket.IO connection to Realm realtime endpoint per RD-HCHAT-001
- Event handlers: `chat:session.ready`, `chat:event`, `presence`
- Reconnection with resume token per RD-HCHAT-005
- Event deduplication by eventId

#### 4.6 Friend List Component
- Create `features/human-chat/friend-list.tsx`
- Fetch friends via Realm SDK per RD-HCHAT-003
- Online/offline status from Socket.IO presence events
- Sort: online first, then offline

#### 4.7 Human Chat Panel Component
- Create `features/human-chat/human-chat-panel.tsx`
- Layout per RD-HCHAT-002: friend header, message list, input
- Send messages via Realm SDK per RD-HCHAT-004
- Receive messages via Socket.IO events per RD-HCHAT-005
- Read receipts on chat open
- State management per RD-HCHAT-006

### Milestone: User can chat with AI agents (Agents tab) and human friends across apps (People tab) while 3D viewer is active

---

## Phase 5: Polish

**Goal**: Loading states, error handling, and minor UX improvements.

**Prerequisite**: Phase 3 + Phase 4 (core features complete)

### Tasks

#### 5.1 Loading States
- Skeleton loaders for world browser cards
- Generation progress indicator with elapsed time and ETA
- Chat streaming indicator (typing dots)

#### 5.2 Error Handling
- Marble API errors: rate limit, invalid key, server error
- Runtime errors: unavailable, stream failure
- Network errors: offline, timeout
- Each error state provides actionable recovery (retry, check config)

#### 5.3 I18n Setup
- Minimal English-only i18n via i18next
- All user-facing strings in locale file
- No Chinese localization for demo phase

### Milestone: Complete, polished demo with graceful error handling

---

## Dependency Graph

```
Phase 1 (App Shell)
  └── Phase 2 (World Browser)
        ├── Phase 3 (Marble 3D Integration)
        │     └── Phase 5 (Polish)
        └── Phase 4 (Chat: Agent + Human)
              ├── 4.1-4.4 Agent Chat (Runtime SDK)
              ├── 4.5-4.7 Human Chat (Realm API + Socket.IO)
              └── Phase 5 (Polish)
```

## Backend Work Summary

**None.** Realm Drift consumes existing nimi Realm API and Runtime services. No new backend modules, controllers, or Prisma models are required.

The only external dependency is the World Labs Marble API, which is a third-party service with its own authentication and billing.

## Verification Checklist

- [ ] All routes in `routes.yaml` have corresponding page components
- [ ] All features in `feature-matrix.yaml` have a contract rule reference
- [ ] Tauri app builds and launches: `pnpm --filter @nimiplatform/realm-drift dev:shell`
- [ ] World browser loads worlds from Realm API
- [ ] Marble generation completes and viewer iframe loads
- [ ] If iframe is blocked by X-Frame-Options, Tauri dual Webview fallback activates
- [ ] Agent chat streams responses via Runtime SDK
- [ ] Human chat: messages sent from Realm Drift appear in Desktop/Relay
- [ ] Human chat: messages sent from Desktop/Relay appear in Realm Drift in real-time
- [ ] Friend list shows online/offline status via Socket.IO presence
- [ ] Tab switching between Agents and People preserves each tab's state
- [ ] Navigating between worlds preserves Marble job state
- [ ] Switching agents aborts active stream and clears chat
- [ ] `pnpm --filter @nimiplatform/realm-drift typecheck` passes
- [ ] CSP allows `frame-src https://marble.worldlabs.ai`
- [ ] `VITE_MARBLE_API_KEY` absence shows clear configuration error

# World Migration Contract — FG-WORLD-*

> Migration of World-Studio mod functionality into Forge as native pages.

## FG-WORLD-001: Migration Scope

World-Studio (`world.nimi.world-studio`) is a runtime mod in the desktop app. Forge migrates its functionality into native pages with the following approach:

| Layer | Strategy |
|-------|----------|
| Engine (`engine/*`) | Direct import via `@world-engine/engine/*` — zero changes |
| Services (`services/*`) | Direct import via `@world-engine/services/*` — zero changes |
| Generation (`generation/*`) | Direct import via `@world-engine/generation/*` — zero changes |
| Contracts (`contracts/*`) | Direct import via `@world-engine/contracts/*` — zero changes |
| Data (`data/*`) | **Rewrite** — replace `hookClient.data.query()` with SDK realm client |
| State (`state/*`) | **Adapt** — `useCreatorWorldStore` based on `workspace-store.ts`, remove mod awareness |
| UI (`ui/*`) | **Selective migration** — import panels, wrap in Forge layout |
| Hooks (`hooks/*`) | **Adapt** — replace hook-client calls with direct SDK calls |

Forge no longer exposes world create/maintain as isolated top-level creator flows. They are embedded inside a higher-level **Forge workspace shell** that owns local review drafts, import evidence, agent drafts, and publish planning.

## FG-WORLD-002: Data Query Rewrite

World-Studio accesses backend via `hookClient.data.query(capabilityId, params)`. Forge replaces these with direct SDK realm client calls.

Approximately 25 data query functions require rewriting:

| World-Studio Capability | Forge SDK Call |
|------------------------|----------------------|
| `data.query.world-control.access-me` | `realmClient.worldControl.getAccessMe()` |
| `data.query.world-control.landing` | `realmClient.worldControl.getLanding()` |
| `data.query.world-drafts.list` | `realmClient.worldDrafts.list()` |
| `data.query.world-drafts.get` | `realmClient.worldDrafts.get(draftId)` |
| `data.query.world-drafts.create` | `realmClient.worldDrafts.create(body)` |
| `data.query.world-drafts.update` | `realmClient.worldDrafts.update(draftId, body)` |
| `data.query.world-drafts.publish` | `realmClient.worldDrafts.publish(draftId)` |
| `data.query.worlds.mine` | `realmClient.worlds.listMine()` |
| `data.query.worlds.maintenance.get` | `realmClient.worlds.getMaintenance(worldId)` |
| `data.query.worlds.maintenance.update` | `realmClient.worlds.updateMaintenance(worldId, body)` |
| `data.query.worlds.events.list` | `realmClient.worlds.listEvents(worldId)` |
| `data.query.worlds.events.batch-upsert` | `realmClient.worlds.batchUpsertEvents(worldId, body)` |
| `data.query.worlds.events.delete` | `realmClient.worlds.deleteEvent(worldId, eventId)` |
| `data.query.worlds.lorebooks.list` | `realmClient.worlds.listLorebooks(worldId)` |
| `data.query.worlds.lorebooks.batch-upsert` | `realmClient.worlds.batchUpsertLorebooks(worldId, body)` |
| `data.query.worlds.lorebooks.delete` | `realmClient.worlds.deleteLorebook(worldId, lorebookId)` |
| `data.query.worlds.media-bindings.list` | `realmClient.worlds.listMediaBindings(worldId, params)` |
| `data.query.worlds.media-bindings.batch-upsert` | `realmClient.worlds.batchUpsertMediaBindings(worldId, body)` |
| `data.query.worlds.media-bindings.delete` | `realmClient.worlds.deleteMediaBinding(worldId, bindingId)` |
| `data.query.worlds.scenes.list` | `realmClient.worlds.listScenes(worldId, params)` |
| `data.query.creator.agents.list` | `realmClient.creator.listAgents()` |
| `data.query.creator.agents.create` | `realmClient.creator.createAgent(body)` |
| `data.query.creator.agents.batch-create` | `realmClient.creator.batchCreateAgents(body)` |

Implementation: a thin adapter module `src/shell/renderer/data/world-data-client.ts` wraps the SDK realm client with the same function signatures as World-Studio's data layer, enabling engine/generation code to work unchanged.

## FG-WORLD-003: CREATE Pipeline

The CREATE pipeline follows World-Studio's 7-step chain (per WS-PIPE-002):

```
SOURCE → INGEST → EXTRACT → CHECKPOINTS → SYNTHESIZE → DRAFT → PUBLISH
```

### UI Panels (8 panels migrated from World-Studio)

These panels are hosted inside the workbench `WORLD_TRUTH` panel, not as standalone top-level routes.

| Panel | Source | Host Surface |
|-------|--------|--------------|
| Source Input | `ui/create/source-input-panel.tsx` | Workbench world truth (step 1) |
| Phase 1 Progress | `ui/create/phase1-panel.tsx` | Workbench world truth (step 2) |
| Checkpoints Review | `ui/create/checkpoints-panel.tsx` | Workbench world truth (step 3) |
| Event Graph Editor | `ui/create/event-graph-editor.tsx` | Workbench world truth (step 4) |
| Phase 2 Synthesis | `ui/create/phase2-panel.tsx` | Workbench world truth (step 5) |
| Draft Editor | `ui/create/draft-editor-panel.tsx` | Workbench world truth (step 6) |
| Character Portraits | Inline in draft editor | Workbench world truth (step 6) |
| Publish | `ui/create/publish-panel.tsx` | Workbench world truth (step 7) |

### Pipeline State Machine

Inherits from WS-PIPE-002. States tracked in `useCreatorWorldStore.createStep`.

### Task Lifecycle

Inherits from WS-TASK-001 through WS-TASK-006:
- Single-flight execution (max 1 active task)
- Pause/resume/cancel for Phase 1 extraction
- Checkpoint-based recovery on reload

## FG-WORLD-004: MAINTAIN Pipeline

The MAINTAIN pipeline handles published world editing (per WS-PIPE-006):

### UI Panels (6 panels migrated)

These panels are hosted inside the workbench `WORLD_TRUTH` panel for an existing world-backed workspace.

| Panel | Source | Host Surface |
|-------|--------|--------------|
| World Base | `ui/maintain/world-base-panel.tsx` | Workbench world truth |
| Worldview | `ui/maintain/worldview-panel.tsx` | Workbench world truth |
| Events | `ui/maintain/events-panel.tsx` | Workbench world truth |
| Lorebooks | `ui/maintain/lorebooks-panel.tsx` | Workbench world truth |
| Event Graph | `ui/maintain/event-graph-maintenance.tsx` | Workbench world truth |
| Timeline | `ui/maintain/world-base-panel.tsx` + `state/history timeline` | Workbench world truth |

### Operations

- `save-maintenance` — Patch world metadata + worldview
- `sync-events` — Batch upsert events (merge or replace mode)
- `sync-lorebooks` — Batch upsert lorebooks
- `reload-remote` — Refetch from server, replace local snapshot

Conflict recovery per WS-CONFLICT-001 through WS-CONFLICT-005.

## FG-WORLD-005: State Store

```typescript
// useCreatorWorldStore — adapted from workspace-store.ts
interface CreatorWorldStore {
  // Snapshot (same shape as WorldStudioWorkspaceSnapshot)
  snapshot: WorldStudioWorkspaceSnapshot;

  // Actions
  patchSnapshot(patch: Partial<WorldStudioWorkspaceSnapshot>): void;
  setCreateStep(step: CreateStep): void;
  resetSnapshot(): void;

  // Persistence (localStorage, keyed by userId)
  hydrateForUser(userId: string): void;
  persistForUser(userId: string): void;
}
```

Key difference from World-Studio: no `modId` scoping in storage keys. Forge uses `nimi:forge:workspace:{userId}` as the storage key prefix.

Forge additionally wraps this inner world-studio state with a higher-level local workspace store:

```typescript
interface ForgeWorkspaceStore {
  activeWorkspaceId: string | null;
  workspaces: Record<string, ForgeWorkspaceSnapshot>;
  createWorkspace(input?: CreateWorkspaceInput): string;
  ensureWorkspaceForWorld(input: { worldId: string; title: string }): string;
  ensureWorkspaceForDraft(input: { draftId: string; title: string; targetWorldId?: string | null }): string;
  setWorkspacePanel(workspaceId: string, panel: ForgeWorkspacePanel): void;
  patchWorldDraft(workspaceId: string, patch: Partial<WorldDraftState>): void;
  buildPublishPlan(workspaceId: string): ForgePublishPlan | null;
}
```

`useCreatorWorldStore` remains the world-engine-compatible inner state for CREATE/MAINTAIN. `ForgeWorkspaceStore` is the outer creator workflow container.

## FG-WORLD-006: Backend API Dependencies (All Existing)

All required backend APIs already exist. No new backend work needed for World management.

| API Group | Endpoints | Controller |
|-----------|-----------|------------|
| World Control | `GET /api/world-control/access/me`, `GET /api/world-control/landing` | `world-control.controller.ts` |
| World Drafts | `POST/GET /api/world-drafts`, `GET/PATCH /api/world-drafts/:draftId`, `POST /api/world-drafts/:draftId/publish` | `world-control.controller.ts` |
| World State | `GET /api/worlds/:worldId/state`, `POST /api/worlds/:worldId/state/commits`, `GET /api/worlds/mine` | `world-control.controller.ts` |
| World History | `GET /api/worlds/:worldId/history`, `POST /api/worlds/:worldId/history/appends` | `world-control.controller.ts` |
| World Lorebooks | `GET /api/worlds/:worldId/lorebooks` (read-only projection) | `world-control.controller.ts` |
| World Rules | `GET/POST /api/world/by-id/:worldId/rules`, `PATCH /api/world/by-id/:worldId/rules/:ruleId`, `POST /api/world/by-id/:worldId/rules/:ruleId/deprecate`, `POST /api/world/by-id/:worldId/rules/:ruleId/archive` | `world-rules.controller.ts` |
| Agent Rules | `GET/POST /api/world/by-id/:worldId/agents/:agentId/rules`, `PATCH /api/world/by-id/:worldId/agents/:agentId/rules/:ruleId`, `POST /api/world/by-id/:worldId/agents/:agentId/rules/:ruleId/deprecate`, `POST /api/world/by-id/:worldId/agents/:agentId/rules/:ruleId/archive` | `agent-rules.controller.ts` |
| Media Bindings | `GET /api/worlds/:worldId/media-bindings` (read-only projection) | `world-control.controller.ts` |
| Scenes | `GET /api/worlds/:worldId/scenes` | `world-control.controller.ts` |
## FG-WORLD-007: Quality Gate Integration

Inherits WS-QG-001 through WS-QG-005. Quality gate logic lives in `@world-engine/engine/quality-gate.ts` and is invoked unchanged. Threshold policies from `world-studio/spec/kernel/tables/quality-gate-policies.yaml` apply.

## FG-WORLD-008: Acceptance Criteria

1. User can complete full CREATE pipeline from a workbench workspace: source upload → extraction → review → synthesis → draft editing → publish
2. User can open a published world inside the workbench and edit events, lorebooks, worldview
3. Pause/resume works for Phase 1 extraction with checkpoint recovery
4. Conflict detection and reload-remote work per WS-CONFLICT-*
5. Quality gate blocks Phase 2 when critical issues exist (per WS-QG-003)
6. All data operations use SDK realm client (no hookClient.data.query calls)
7. World-Studio engine/services/generation code runs unchanged via `@world-engine` alias

`media-bindings` remain world-display APIs only:
- they bind existing assets, or create assets inline for world display during world workflows
- they do not provide the canonical asset reference for social post publishing
- post publishing references `Post.media[].assetId` directly

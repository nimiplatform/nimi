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
| `data.query.worlds.visual-bindings.list` | `realmClient.worlds.listVisualBindings(worldId, params)` |
| `data.query.worlds.visual-bindings.batch-upsert` | `realmClient.worlds.batchUpsertVisualBindings(worldId, body)` |
| `data.query.worlds.visual-bindings.delete` | `realmClient.worlds.deleteVisualBinding(worldId, bindingId)` |
| `data.query.worlds.mutations.list` | `realmClient.worlds.listMutations(worldId)` |
| `data.query.worlds.narrative-contexts.list` | `realmClient.worlds.listNarrativeContexts(worldId, params)` |
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

| Panel | Source | Route |
|-------|--------|-------|
| Source Input | `ui/create/source-input-panel.tsx` | `/worlds/create` (step 1) |
| Phase 1 Progress | `ui/create/phase1-panel.tsx` | `/worlds/create` (step 2) |
| Checkpoints Review | `ui/create/checkpoints-panel.tsx` | `/worlds/create` (step 3) |
| Event Graph Editor | `ui/create/event-graph-editor.tsx` | `/worlds/create` (step 4) |
| Phase 2 Synthesis | `ui/create/phase2-panel.tsx` | `/worlds/create` (step 5) |
| Draft Editor | `ui/create/draft-editor-panel.tsx` | `/worlds/create` (step 6) |
| Character Portraits | Inline in draft editor | `/worlds/create` (step 6) |
| Publish | `ui/create/publish-panel.tsx` | `/worlds/create` (step 7) |

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

| Panel | Source | Route |
|-------|--------|-------|
| World Base | `ui/maintain/world-base-panel.tsx` | `/worlds/:worldId/maintain` |
| Worldview | `ui/maintain/worldview-panel.tsx` | `/worlds/:worldId/maintain` |
| Events | `ui/maintain/events-panel.tsx` | `/worlds/:worldId/maintain` |
| Lorebooks | `ui/maintain/lorebooks-panel.tsx` | `/worlds/:worldId/maintain` |
| Event Graph | `ui/maintain/event-graph-maintenance.tsx` | `/worlds/:worldId/maintain` |
| Mutations | `ui/maintain/mutations-panel.tsx` | `/worlds/:worldId/maintain` |

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

## FG-WORLD-006: Backend API Dependencies (All Existing)

All required backend APIs already exist. No new backend work needed for World management.

| API Group | Endpoints | Controller |
|-----------|-----------|------------|
| World Control | `GET /api/world-control/access/me`, `GET /api/world-control/landing` | `world-control.controller.ts` |
| World Drafts | `POST/GET /api/world-drafts`, `GET/PATCH /api/world-drafts/:draftId`, `POST /api/world-drafts/:draftId/publish` | `world-control.controller.ts` |
| World Maintenance | `GET/PATCH /api/worlds/:worldId/maintenance`, `GET /api/worlds/mine` | `world-control.controller.ts` |
| World Events | `GET /api/worlds/:worldId/events`, `POST /api/worlds/:worldId/events/batch-upsert`, `DELETE /api/worlds/:worldId/events/:eventId` | `world-control.controller.ts` |
| World Lorebooks | `GET /api/worlds/:worldId/lorebooks`, `POST /api/worlds/:worldId/lorebooks/batch-upsert`, `DELETE /api/worlds/:worldId/lorebooks/:lorebookId` | `world-control.controller.ts` |
| Visual Bindings | `GET /api/worlds/:worldId/visual-bindings`, `POST /api/worlds/:worldId/visual-bindings/batch-upsert`, `DELETE /api/worlds/:worldId/visual-bindings/:bindingId` | `world-control.controller.ts` |
| Mutations | `GET /api/worlds/:worldId/mutations` | `world-control.controller.ts` |
| Scenes | `GET /api/worlds/:worldId/scenes` | `world-control.controller.ts` |
| Narrative Contexts | `GET /api/worlds/:worldId/narrative-contexts` | `world-control.controller.ts` |

## FG-WORLD-007: Quality Gate Integration

Inherits WS-QG-001 through WS-QG-005. Quality gate logic lives in `@world-engine/engine/quality-gate.ts` and is invoked unchanged. Threshold policies from `world-studio/spec/kernel/tables/quality-gate-policies.yaml` apply.

## FG-WORLD-008: Acceptance Criteria

1. User can complete full CREATE pipeline: source upload → extraction → review → synthesis → draft editing → publish
2. User can open published world in MAINTAIN mode and edit events, lorebooks, worldview
3. Pause/resume works for Phase 1 extraction with checkpoint recovery
4. Conflict detection and reload-remote work per WS-CONFLICT-*
5. Quality gate blocks Phase 2 when critical issues exist (per WS-QG-003)
6. All data operations use SDK realm client (no hookClient.data.query calls)
7. World-Studio engine/services/generation code runs unchanged via `@world-engine` alias

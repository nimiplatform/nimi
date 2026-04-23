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

Realm `world-drafts` remain available, but only as minimal publish candidates for `Truth / World State / World History`. Forge-local workspace state remains authoritative for editor workflow, extraction progress, and asset generation.

Migration posture clarification:

- current authority split：`nimi-mods/spec/**` 仍持有 `world-studio` 与 shared
  chain 的 mods-local authority；`apps/forge/spec/**` 持有 Forge native app
  host model 与 migration posture
- current active state：World-Studio mod 仍存在，Forge 仍复用其部分 engine/services/code paths
- admitted migration posture：Forge 正在把 World-Studio workflow 迁入 native pages
- non-goal of this contract：不得把“长期逐步替代 World-Studio”误写成已完成替代事实

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
| `data.query.worlds.history.list` | `realmClient.worlds.listHistory(worldId)` |
| `data.query.worlds.history.append` | `realmClient.worlds.appendHistory(worldId, body)` |
| `data.query.worlds.lorebooks.list` | `realmClient.worlds.listLorebooks(worldId)` |
| `data.query.worlds.lorebooks.batch-upsert` | `realmClient.worlds.batchUpsertLorebooks(worldId, body)` |
| `data.query.worlds.lorebooks.delete` | `realmClient.worlds.deleteLorebook(worldId, lorebookId)` |
| `data.query.worlds.resource-bindings.list` | `realmClient.worlds.listResourceBindings(worldId, params)` |
| `data.query.worlds.resource-bindings.batch-upsert` | `realmClient.worlds.batchUpsertResourceBindings(worldId, body)` |
| `data.query.worlds.resource-bindings.delete` | `realmClient.worlds.deleteResourceBinding(worldId, bindingId)` |
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

### Draft Persistence Boundary

- Forge local workspace persists: `createStep`, extraction/checkpoint progress, review UI state, selected start-time/editor choices, asset generation state
- Realm `world-drafts` persist only: `importSource`, `truthDraft`, `stateDraft`, `historyDraft`
- Resuming from a remote draft restores only minimal reviewable candidate data; it does not reconstruct full editor process state

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
- `append-history` — Append canonical world-history facts
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
| Resource Bindings | `GET/POST /api/worlds/:worldId/resource-bindings`, `DELETE /api/worlds/:worldId/resource-bindings/:bindingId` | `world-control.controller.ts` |

## FG-WORLD-006A: World Catalog Surfaces

Forge owns the world detail catalog surface as the stable creator inspection
surface for a published or draft-backed world. This surface is not a redirect
veneer for the workbench.

The world detail surface must provide:

- world identity, status, and high-level maintenance summary
- current active world-family selections for admitted families from
  `FG-CONTENT-001`
- world-owned agent count plus agent completeness summary
- explicit links to:
  - workbench truth editing
  - the world-owned agent roster surface
  - the world asset-ops surface

Authority boundary:

- catalog inspection consumes existing world, history, and resource-binding
  reads only
- catalog inspection does not own deep truth editing, publish planning, or
  local draft reconstruction
- world detail completeness must be derived from admitted family
  `confirmed`/`bound` semantics, not from resource presence alone

## FG-WORLD-006B: World-Owned Agent Roster

Forge owns the world-owned agent roster surface as the canonical roster for
agents that belong to a world from a creator inspection and asset-ops point of
view.

The roster must expose per agent:

- identity and ownership posture
- active avatar/cover/greeting/voice-demo status using the family grammar from
  `FG-CONTENT-001`
- completeness state that distinguishes missing, confirmed, and bound
  deliverables
- links to:
  - world-scoped truth editing when the agent is `WORLD_OWNED`
  - the agent asset-ops surface for asset-family operations

Topology rule:

- world-owned and master-owned agents may continue to differ in truth-edit
  routing
- both must share one admitted asset-family grammar for inspection and ops

## FG-WORLD-006C: World Asset Operations

Forge owns the world asset-ops hub and family-focus surfaces as the canonical
world asset-ops surfaces.

World asset ops now admit the following families:

- `world-icon`
- `world-cover`
- `world-background`
- `world-scene`

These surfaces own:

- candidate generation entry
- review queue visibility
- approve / reject decisions
- family confirmation
- binding through the existing world resource-binding write surface

Explicit boundary rules:

- workbench `ENRICHMENT` is a bounded producer helper; it may generate or save
  candidate resources, but it does not remain an independent authority for
  active world asset truth
- runtime/provider outputs remain consumption-only inputs; they do not imply
  approval or binding
- this pack admits no new world asset backend API beyond the existing resource
  and resource-binding surfaces listed in `FG-WORLD-006`
- if a candidate cannot be bound through the admitted existing write surface,
  Forge must fail closed rather than invent a world-local or provider-local
  bind path

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
8. Creator can inspect a world in the world detail catalog surface without
   being redirected into the workbench.
9. Creator can inspect world-owned agents in the world roster surface with
   per-agent asset/demo completeness status.
10. World asset ops treat `world-icon`, `world-cover`, `world-background`, and
    `world-scene` as explicit families with candidate/review/confirm/bind
    semantics.
11. Workbench `ENRICHMENT` remains producer-only and is not treated as
    independent world asset authority once world asset ops are admitted.
12. World completeness and active-selection visibility distinguish
    `confirmed`/`bound` state from simple resource presence.

`resource-bindings` remain explicit world-display APIs:
- they bind existing resources, or create resources inline for world display during world workflows
- they are typed write surfaces for world-maintain flows, not read-only projections
- they are not part of Realm `world-draft` payloads
- they do not provide the canonical asset reference for social post publishing
- post publishing persists canonical attachment references as `Post.attachments[].targetType + targetId`

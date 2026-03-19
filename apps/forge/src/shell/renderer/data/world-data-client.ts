/**
 * World Data Client — Forge adapter (FG-WORLD-002)
 *
 * Replaces World-Studio's hookClient.data.query() calls with
 * direct SDK realm client calls. Same function signatures as
 * World-Studio's data layer, enabling engine/generation code
 * to work unchanged.
 */

import { getPlatformClient } from '@nimiplatform/sdk';
import type { RealmServiceArgs } from '@nimiplatform/sdk/realm';

function realm() {
  return getPlatformClient().realm;
}

type CreateWorldDraftInput = RealmServiceArgs<'WorldControlService', 'worldControlControllerCreateDraft'>[0];
type UpdateWorldDraftInput = RealmServiceArgs<'WorldControlService', 'worldControlControllerUpdateDraft'>[1];
type PublishWorldDraftInput = RealmServiceArgs<'WorldControlService', 'worldControlControllerPublishDraft'>[1];
type UpdateWorldMaintenanceInput = RealmServiceArgs<'WorldControlService', 'worldControlControllerUpdateMaintenance'>[1];
type BatchUpsertWorldEventsInput = RealmServiceArgs<'WorldControlService', 'worldControlControllerBatchUpsertWorldEvents'>[1];
type ListWorldMediaBindingsQuery = {
  take?: RealmServiceArgs<'WorldControlService', 'worldControlControllerListWorldMediaBindings'>[1];
  slot?: RealmServiceArgs<'WorldControlService', 'worldControlControllerListWorldMediaBindings'>[2];
};
type BatchUpsertWorldMediaBindingsInput = RealmServiceArgs<'WorldControlService', 'worldControlControllerBatchUpsertWorldMediaBindings'>[1];
type CreateCreatorAgentInput = RealmServiceArgs<'CreatorService', 'creatorControllerCreateAgent'>[0];
type BatchCreateCreatorAgentsInput = RealmServiceArgs<'CreatorService', 'creatorControllerBatchCreateAgents'>[0];
type CreateWorldRuleInput = RealmServiceArgs<'WorldRulesService', 'worldRulesControllerCreateRule'>[1];
type UpdateWorldRuleInput = RealmServiceArgs<'WorldRulesService', 'worldRulesControllerUpdateRule'>[2];
type ListAgentRulesQuery = {
  layer?: RealmServiceArgs<'AgentRulesService', 'agentRulesControllerListRules'>[2];
  status?: RealmServiceArgs<'AgentRulesService', 'agentRulesControllerListRules'>[3];
};
type CreateAgentRuleInput = RealmServiceArgs<'AgentRulesService', 'agentRulesControllerCreateRule'>[2];
type UpdateAgentRuleInput = RealmServiceArgs<'AgentRulesService', 'agentRulesControllerUpdateRule'>[3];
type ListWorldNarrativeContextsParams = {
  take?: RealmServiceArgs<'WorldControlService', 'worldControlControllerListWorldNarrativeContexts'>[1];
  targetSubjectId?: RealmServiceArgs<'WorldControlService', 'worldControlControllerListWorldNarrativeContexts'>[2];
};
type ListWorldScenesParams = {
  take?: RealmServiceArgs<'WorldControlService', 'worldControlControllerListWorldScenes'>[1];
  sceneIds?: RealmServiceArgs<'WorldControlService', 'worldControlControllerListWorldScenes'>[2];
};
export type ForgeCreateWorldDraftInput = CreateWorldDraftInput | {
  name?: string;
  description?: string;
  sourceType?: string;
  sourceRef?: string;
  [key: string]: unknown;
};
export type ForgeUpdateWorldDraftInput = UpdateWorldDraftInput & { [key: string]: unknown };
export type ForgePublishWorldDraftInput = PublishWorldDraftInput & { [key: string]: unknown };
export type ForgeUpdateWorldMaintenanceInput = UpdateWorldMaintenanceInput & {
  name?: string;
  [key: string]: unknown;
};
export type ForgeBatchUpsertWorldEventsInput = BatchUpsertWorldEventsInput | {
  events?: unknown[];
  eventUpserts?: unknown[];
  reason?: string;
  mode?: 'merge' | 'replace';
  ifSnapshotVersion?: string;
  [key: string]: unknown;
};
export type ForgeBatchUpsertWorldMediaBindingsInput = BatchUpsertWorldMediaBindingsInput | {
  bindingUpserts?: unknown[];
  reason?: string;
  [key: string]: unknown;
};
export type ForgeCreateWorldRuleInput = CreateWorldRuleInput | {
  ruleKey?: string;
  title?: string;
  statement?: string;
  [key: string]: unknown;
};
export type ForgeUpdateWorldRuleInput = UpdateWorldRuleInput | {
  ruleKey?: string;
  title?: string;
  statement?: string;
  [key: string]: unknown;
};
export type ForgeCreateAgentRuleInput = CreateAgentRuleInput | {
  ruleKey?: string;
  title?: string;
  statement?: string;
  [key: string]: unknown;
};
export type ForgeUpdateAgentRuleInput = UpdateAgentRuleInput | {
  ruleKey?: string;
  title?: string;
  statement?: string;
  [key: string]: unknown;
};
export type ForgeBatchCreateCreatorAgentsInput = {
  items: Array<CreateCreatorAgentInput | { [key: string]: unknown }>;
  continueOnError?: boolean;
};
export type ForgeCreateWorldCreatorAgentInput = CreateCreatorAgentInput | {
  name?: string;
  displayName?: string;
  handle?: string;
  concept?: string;
  [key: string]: unknown;
};

// ── Draft Queries ──────────────────────────────────────────

export async function getMyWorldAccess() {
  return realm().services.WorldControlService.worldControlControllerGetMyAccess();
}

export async function resolveWorldLanding() {
  return realm().services.WorldControlService.worldControlControllerResolveLanding();
}

export async function createWorldDraft(payload: ForgeCreateWorldDraftInput) {
  const sourceType = payload.sourceType === 'FILE' ? 'FILE' : 'TEXT';
  return realm().services.WorldControlService.worldControlControllerCreateDraft({
    ...payload,
    sourceType,
    sourceRef: payload.sourceRef || String(payload.sourceType || '').trim(),
  });
}

export async function getWorldDraft(draftId: string) {
  return realm().services.WorldControlService.worldControlControllerGetDraft(draftId);
}

export async function listWorldDrafts() {
  return realm().services.WorldControlService.worldControlControllerListDrafts();
}

export async function updateWorldDraft(draftId: string, patch: ForgeUpdateWorldDraftInput) {
  return realm().services.WorldControlService.worldControlControllerUpdateDraft(draftId, patch);
}

export async function publishWorldDraft(draftId: string, payload: ForgePublishWorldDraftInput = {}) {
  return realm().services.WorldControlService.worldControlControllerPublishDraft(draftId, payload);
}

// ── Maintenance Queries ────────────────────────────────────

export async function getWorldMaintenance(worldId: string) {
  return realm().services.WorldControlService.worldControlControllerGetMaintenance(worldId);
}

export async function updateWorldMaintenance(worldId: string, patch: ForgeUpdateWorldMaintenanceInput) {
  return realm().services.WorldControlService.worldControlControllerUpdateMaintenance(worldId, patch);
}

export async function listMyWorlds() {
  return realm().services.WorldControlService.worldControlControllerListMyWorlds();
}

export async function listWorldMutations(worldId: string) {
  return realm().services.WorldControlService.worldControlControllerListWorldMutations(worldId);
}

// ── Events & Lorebooks ─────────────────────────────────────

export async function listWorldEvents(worldId: string) {
  return realm().services.WorldControlService.worldControlControllerListWorldEvents(worldId);
}

export async function batchUpsertWorldEvents(worldId: string, payload: ForgeBatchUpsertWorldEventsInput) {
  return realm().services.WorldControlService.worldControlControllerBatchUpsertWorldEvents(worldId, {
    ...payload,
    eventUpserts: ('eventUpserts' in payload && Array.isArray(payload.eventUpserts)
      ? payload.eventUpserts
      : 'events' in payload && Array.isArray(payload.events)
        ? payload.events
        : []) as BatchUpsertWorldEventsInput['eventUpserts'],
  });
}

export async function deleteWorldEvent(worldId: string, eventId: string) {
  return realm().services.WorldControlService.worldControlControllerDeleteWorldEvent(worldId, eventId);
}

export async function listWorldLorebooks(worldId: string) {
  return realm().services.WorldControlService.worldControlControllerListWorldLorebooks(worldId);
}

// ── Visual Bindings ────────────────────────────────────────

export async function listWorldMediaBindings(worldId: string, query?: ListWorldMediaBindingsQuery) {
  return realm().services.WorldControlService.worldControlControllerListWorldMediaBindings(worldId, query?.take, query?.slot);
}

export async function batchUpsertWorldMediaBindings(worldId: string, payload: ForgeBatchUpsertWorldMediaBindingsInput) {
  return realm().services.WorldControlService.worldControlControllerBatchUpsertWorldMediaBindings(worldId, {
    ...payload,
    bindingUpserts: (Array.isArray(payload.bindingUpserts) ? payload.bindingUpserts : []) as BatchUpsertWorldMediaBindingsInput['bindingUpserts'],
  });
}

export async function deleteWorldMediaBinding(worldId: string, bindingId: string) {
  return realm().services.WorldControlService.worldControlControllerDeleteWorldMediaBinding(worldId, bindingId);
}

// ── Creator Agents ─────────────────────────────────────────

export async function listCreatorAgents() {
  return realm().services.CreatorService.creatorControllerListAgents();
}

export async function createCreatorAgent(payload: ForgeCreateWorldCreatorAgentInput) {
  const fallbackName = 'name' in payload ? payload.name : '';
  return realm().services.CreatorService.creatorControllerCreateAgent({
    ...payload,
    handle: String(payload.handle || payload.displayName || fallbackName || '').trim(),
    displayName: String(payload.displayName || fallbackName || '').trim(),
    concept: String(payload.concept || payload.displayName || fallbackName || '').trim(),
  });
}

export async function batchCreateCreatorAgents(payload: ForgeBatchCreateCreatorAgentsInput) {
  return realm().services.CreatorService.creatorControllerBatchCreateAgents({
    items: payload.items.map((item) => item as CreateCreatorAgentInput),
    continueOnError: payload.continueOnError ?? false,
  });
}

// ── Rule Truth CRUD ────────────────────────────────────────

export async function listWorldRules(worldId: string, status?: string) {
  return realm().services.WorldRulesService.worldRulesControllerGetRules(worldId, status);
}

export async function createWorldRule(worldId: string, payload: ForgeCreateWorldRuleInput) {
  return realm().services.WorldRulesService.worldRulesControllerCreateRule(worldId, payload as CreateWorldRuleInput);
}

export async function updateWorldRule(
  worldId: string,
  ruleId: string,
  payload: ForgeUpdateWorldRuleInput,
) {
  return realm().services.WorldRulesService.worldRulesControllerUpdateRule(worldId, ruleId, payload);
}

export async function deprecateWorldRule(worldId: string, ruleId: string) {
  return realm().services.WorldRulesService.worldRulesControllerDeprecateRule(worldId, ruleId);
}

export async function archiveWorldRule(worldId: string, ruleId: string) {
  return realm().services.WorldRulesService.worldRulesControllerArchiveRule(worldId, ruleId);
}

export async function listAgentRules(
  worldId: string,
  agentId: string,
  query?: ListAgentRulesQuery,
) {
  return realm().services.AgentRulesService.agentRulesControllerListRules(
    worldId,
    agentId,
    query?.layer,
    query?.status,
  );
}

export async function createAgentRule(
  worldId: string,
  agentId: string,
  payload: ForgeCreateAgentRuleInput,
) {
  return realm().services.AgentRulesService.agentRulesControllerCreateRule(
    worldId,
    agentId,
    payload as CreateAgentRuleInput,
  );
}

export async function updateAgentRule(
  worldId: string,
  agentId: string,
  ruleId: string,
  payload: ForgeUpdateAgentRuleInput,
) {
  return realm().services.AgentRulesService.agentRulesControllerUpdateRule(
    worldId,
    agentId,
    ruleId,
    payload,
  );
}

export async function deprecateAgentRule(
  worldId: string,
  agentId: string,
  ruleId: string,
) {
  return realm().services.AgentRulesService.agentRulesControllerDeprecateRule(
    worldId,
    agentId,
    ruleId,
  );
}

export async function archiveAgentRule(
  worldId: string,
  agentId: string,
  ruleId: string,
) {
  return realm().services.AgentRulesService.agentRulesControllerArchiveRule(
    worldId,
    agentId,
    ruleId,
  );
}

// ── Additional Queries (Narrative / Scenes) ────────────────

export async function listWorldNarrativeContexts(worldId: string, params?: ListWorldNarrativeContextsParams) {
  return realm().services.WorldControlService.worldControlControllerListWorldNarrativeContexts(
    worldId,
    params?.take,
    params?.targetSubjectId,
  );
}

export async function listWorldScenes(worldId: string, params?: ListWorldScenesParams) {
  return realm().services.WorldControlService.worldControlControllerListWorldScenes(
    worldId,
    params?.take,
    params?.sceneIds,
  );
}

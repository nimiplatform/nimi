/**
 * World Data Client — Forge adapter (FG-WORLD-002)
 *
 * Replaces World-Studio's hookClient.data.query() calls with
 * direct SDK realm client calls. Same function signatures as
 * World-Studio's data layer, enabling engine/generation code
 * to work unchanged.
 */

import { getPlatformClient } from '@runtime/platform-client.js';

function realm() {
  return getPlatformClient().realm;
}

// ── Draft Queries ──────────────────────────────────────────

export async function getMyWorldAccess() {
  return realm().services.WorldControlService.worldControlControllerGetMyAccess();
}

export async function resolveWorldLanding() {
  return realm().services.WorldControlService.worldControlControllerResolveLanding();
}

export async function createWorldDraft(payload: Record<string, unknown>) {
  return realm().services.WorldControlService.worldControlControllerCreateDraft(payload);
}

export async function getWorldDraft(draftId: string) {
  return realm().services.WorldControlService.worldControlControllerGetDraft(draftId);
}

export async function listWorldDrafts() {
  return realm().services.WorldControlService.worldControlControllerListDrafts();
}

export async function updateWorldDraft(draftId: string, patch: Record<string, unknown>) {
  return realm().services.WorldControlService.worldControlControllerUpdateDraft(draftId, patch);
}

export async function publishWorldDraft(draftId: string, payload?: Record<string, unknown>) {
  return realm().services.WorldControlService.worldControlControllerPublishDraft(draftId, payload || {});
}

// ── Maintenance Queries ────────────────────────────────────

export async function getWorldMaintenance(worldId: string) {
  return realm().services.WorldControlService.worldControlControllerGetMaintenance(worldId);
}

export async function updateWorldMaintenance(worldId: string, patch: Record<string, unknown>) {
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

export async function batchUpsertWorldEvents(worldId: string, payload: Record<string, unknown>) {
  return realm().services.WorldControlService.worldControlControllerBatchUpsertWorldEvents(worldId, payload);
}

export async function deleteWorldEvent(worldId: string, eventId: string) {
  return realm().services.WorldControlService.worldControlControllerDeleteWorldEvent(worldId, eventId);
}

export async function listWorldLorebooks(worldId: string) {
  return realm().services.WorldControlService.worldControlControllerListWorldLorebooks(worldId);
}

// ── Visual Bindings ────────────────────────────────────────

export async function listWorldMediaBindings(worldId: string, query?: Record<string, unknown>) {
  return realm().services.WorldControlService.worldControlControllerListWorldMediaBindings(worldId, query?.take as number | undefined, query?.slot as string | undefined);
}

export async function batchUpsertWorldMediaBindings(worldId: string, payload: Record<string, unknown>) {
  return realm().services.WorldControlService.worldControlControllerBatchUpsertWorldMediaBindings(worldId, payload);
}

export async function deleteWorldMediaBinding(worldId: string, bindingId: string) {
  return realm().services.WorldControlService.worldControlControllerDeleteWorldMediaBinding(worldId, bindingId);
}

// ── Creator Agents ─────────────────────────────────────────

export async function listCreatorAgents() {
  return realm().services.CreatorService.creatorControllerListAgents();
}

export async function createCreatorAgent(payload: Record<string, unknown>) {
  return realm().services.CreatorService.creatorControllerCreateAgent(payload);
}

export async function batchCreateCreatorAgents(payload: {
  items: Array<Record<string, unknown>>;
  continueOnError?: boolean;
}) {
  return realm().services.CreatorService.creatorControllerBatchCreateAgents(payload);
}

// ── Rule Truth CRUD ────────────────────────────────────────

export async function listWorldRules(worldId: string, status?: string) {
  return realm().services.WorldRulesService.worldRulesControllerGetRules(worldId, status);
}

export async function createWorldRule(worldId: string, payload: Record<string, unknown>) {
  return realm().services.WorldRulesService.worldRulesControllerCreateRule(worldId, payload);
}

export async function updateWorldRule(
  worldId: string,
  ruleId: string,
  payload: Record<string, unknown>,
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
  query?: Record<string, unknown>,
) {
  return realm().services.AgentRulesService.agentRulesControllerListRules(
    worldId,
    agentId,
    query?.layer as string | undefined,
    query?.status as string | undefined,
  );
}

export async function createAgentRule(
  worldId: string,
  agentId: string,
  payload: Record<string, unknown>,
) {
  return realm().services.AgentRulesService.agentRulesControllerCreateRule(
    worldId,
    agentId,
    payload,
  );
}

export async function updateAgentRule(
  worldId: string,
  agentId: string,
  ruleId: string,
  payload: Record<string, unknown>,
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

export async function listWorldNarrativeContexts(worldId: string, params?: Record<string, unknown>) {
  return realm().services.WorldControlService.worldControlControllerListWorldNarrativeContexts(
    worldId,
    params?.take as number | undefined,
    params?.targetSubjectId as string | undefined,
  );
}

export async function listWorldScenes(worldId: string, params?: Record<string, unknown>) {
  return realm().services.WorldControlService.worldControlControllerListWorldScenes(
    worldId,
    params?.take as number | undefined,
    params?.sceneIds as string[] | undefined,
  );
}

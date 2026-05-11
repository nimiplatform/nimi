/**
 * World Data Client — Forge adapter (FG-WORLD-002)
 *
 * Replaces World-Studio's hookClient.data.query() calls with
 * direct SDK realm client calls. Same function signatures as
 * World-Studio's data layer, enabling engine/generation code
 * to work unchanged.
 */

import { getPlatformClient } from '@nimiplatform/sdk';
import type { RealmServiceArgs, RealmServiceResult } from '@nimiplatform/sdk/realm';
import {
  buildAgentRuleInput,
  buildCreatorAgentInput,
  buildDraftPayload,
  buildForgeMutationCommit,
  buildHistoryAppend,
  buildStateWrite,
  buildWorldRuleInput,
  type ForgeAppendWorldHistoryInput,
  type ForgeBatchCreateCreatorAgentsInput,
  type ForgeCommitWorldStateInput,
  type ForgeCreateAgentRuleInput,
  type ForgeCreateWorldCreatorAgentInput,
  type ForgeCreateWorldDraftInput,
  type ForgeCreateWorldRuleInput,
  type ForgePublishWorldDraftInput,
  type ForgeUpdateAgentRuleInput,
  type ForgeUpdateWorldDraftInput,
  type ForgeUpdateWorldRuleInput,
} from './world-data-client-payloads.js';
export {
  createOfficialFactoryBatchRun,
  getOfficialFactoryBatchRun,
  getWorldRelease,
  listOfficialFactoryBatchRuns,
  listWorldReleases,
  listWorldTitleLineage,
  publishWorldPackage,
  reportOfficialFactoryBatchItemFailure,
  retryOfficialFactoryBatchRun,
  rollbackWorldRelease,
} from './world-data-client-governance.js';

function realm() {
  return getPlatformClient().realm;
}

export const FORGE_WORLD_WORKSPACE_TARGET_PATH = 'forge.workspace.world';
export const FORGE_WORLD_WORKSPACE_SCHEMA_ID = 'forge.world.workspace';
export const FORGE_WORLD_WORKSPACE_SCHEMA_VERSION = '1';
export const FORGE_WORLD_HISTORY_EVENT_TYPE = 'WORLD_EVENT';
export const FORGE_WORLD_HISTORY_SCHEMA_ID = 'world.history.append';
export const FORGE_WORLD_HISTORY_SCHEMA_VERSION = '1';

export type ForgeWorldAccessRecord = {
  id: string;
  userId: string;
  scopeType: 'CREATE' | 'MAINTAIN';
  scopeWorldId?: string;
  canCreateWorld: boolean;
  canMaintainWorld: boolean;
  maintainRole: 'OWNER' | 'MAINTAINER';
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED' | 'SUSPENDED';
  expiresAt?: string | null;
};

export type ForgeWorldAccessResult = {
  hasAccess: boolean;
  canCreateWorld: boolean;
  canMaintainWorld: boolean;
  records: ForgeWorldAccessRecord[];
};

export type ForgeWorldLandingResult = {
  target: 'NO_ACCESS' | 'CREATE' | 'MAINTAIN';
  worldId?: string | null;
  reason?: string;
};

type GetWorldTruthResult = RealmServiceResult<'WorldsService', 'worldControllerGetWorld'>;
type GetWorldviewTruthResult = RealmServiceResult<'WorldsService', 'worldControllerGetWorldview'>;
type ListWorldResourceBindingsQuery = {
  take?: RealmServiceArgs<'WorldControlService', 'worldControlControllerListWorldBindings'>[1];
  bindingPoint?: RealmServiceArgs<'WorldControlService', 'worldControlControllerListWorldBindings'>[2];
  bindingKind?: RealmServiceArgs<'WorldControlService', 'worldControlControllerListWorldBindings'>[3];
  hostId?: RealmServiceArgs<'WorldControlService', 'worldControlControllerListWorldBindings'>[4];
  hostType?: RealmServiceArgs<'WorldControlService', 'worldControlControllerListWorldBindings'>[5];
  objectId?: RealmServiceArgs<'WorldControlService', 'worldControlControllerListWorldBindings'>[6];
  objectType?: RealmServiceArgs<'WorldControlService', 'worldControlControllerListWorldBindings'>[7];
};
type BatchUpsertWorldResourceBindingsInput = RealmServiceArgs<
  'WorldControlService',
  'worldControlControllerBatchUpsertWorldBindings'
>[1];
type ListAgentRulesQuery = {
  layer?: RealmServiceArgs<'AgentRulesService', 'agentRulesControllerListRules'>[2];
  status?: RealmServiceArgs<'AgentRulesService', 'agentRulesControllerListRules'>[3];
};
export type ForgeBatchUpsertWorldResourceBindingsInput = BatchUpsertWorldResourceBindingsInput;
export type {
  ForgeAppendWorldHistoryInput,
  ForgeBatchCreateCreatorAgentsInput,
  ForgeCommitWorldStateInput,
  ForgeCreateAgentRuleInput,
  ForgeCreateWorldCreatorAgentInput,
  ForgeCreateWorldDraftInput,
  ForgeCreateWorldRuleInput,
  ForgeDraftHistoryEvent,
  ForgePublishWorldDraftInput,
  ForgeUpdateAgentRuleInput,
  ForgeUpdateWorldDraftInput,
  ForgeUpdateWorldRuleInput,
} from './world-data-client-payloads.js';
export type {
  ForgeCreateOfficialFactoryBatchRunInput,
  ForgeOfficialFactoryBatchRun,
  ForgeOfficialWorldTitleLineage,
  ForgePublishWorldPackageInput,
  ForgePublishWorldPackageResult,
  ForgeReportOfficialFactoryBatchItemFailureInput,
  ForgeRollbackWorldReleaseInput,
  ForgeRollbackWorldReleaseResult,
  ForgeWorldRelease,
} from './world-data-client-governance.js';

type WorldAccessResponse = RealmServiceResult<'WorldControlService', 'worldControlControllerGetMyAccess'>;
type WorldLandingResponse = RealmServiceResult<'WorldControlService', 'worldControlControllerResolveLanding'>;

function normalizeWorldAccessResponse(response: WorldAccessResponse): ForgeWorldAccessResult {
  return {
    hasAccess: response.hasActiveAccess,
    canCreateWorld: response.canCreateWorld,
    canMaintainWorld: response.canMaintainWorld,
    records: response.records.map((r) => ({
      id: r.id,
      userId: r.userId,
      scopeType: r.scopeType,
      scopeWorldId: r.scopeWorldId,
      canCreateWorld: r.canCreateWorld,
      canMaintainWorld: r.canMaintainWorld,
      maintainRole: r.maintainRole,
      status: r.status,
      expiresAt: r.expiresAt ?? null,
    })),
  };
}

function normalizeWorldLandingResponse(response: WorldLandingResponse): ForgeWorldLandingResult {
  return {
    target: response.target,
    worldId: response.worldId ?? null,
    reason: response.reason,
  };
}

// ── Draft Queries ──────────────────────────────────────────

export async function getMyWorldAccess() {
  const response = await realm().services.WorldControlService.worldControlControllerGetMyAccess();
  return normalizeWorldAccessResponse(response);
}

export async function resolveWorldLanding(): Promise<ForgeWorldLandingResult> {
  const response = await realm().services.WorldControlService.worldControlControllerResolveLanding();
  return normalizeWorldLandingResponse(response);
}

export async function createWorldDraft(payload: ForgeCreateWorldDraftInput) {
  const draftPayload = buildDraftPayload(payload.draftPayload);
  const importSource = draftPayload.importSource as { sourceType: string };
  if (importSource.sourceType !== payload.sourceType) {
    throw new Error('FORGE_DRAFT_SOURCE_TYPE_MISMATCH');
  }
  return realm().services.WorldControlService.worldControlControllerCreateDraft({
    sourceType: payload.sourceType,
    sourceRef: payload.sourceRef,
    targetWorldId: payload.targetWorldId,
    draftPayload,
  });
}

export async function getWorldDraft(draftId: string) {
  return realm().services.WorldControlService.worldControlControllerGetDraft(draftId);
}

export async function listWorldDrafts() {
  return realm().services.WorldControlService.worldControlControllerListDrafts();
}

export async function updateWorldDraft(draftId: string, patch: ForgeUpdateWorldDraftInput) {
  return realm().services.WorldControlService.worldControlControllerUpdateDraft(draftId, {
    status: patch.status,
    draftPayload: patch.draftPayload ? buildDraftPayload(patch.draftPayload) : undefined,
  });
}

export async function publishWorldDraft(draftId: string, payload: ForgePublishWorldDraftInput = {}) {
  return realm().services.WorldControlService.worldControlControllerPublishDraft(draftId, payload);
}

// ── State Queries ──────────────────────────────────────────

export async function getWorldState(worldId: string) {
  return realm().services.WorldControlService.worldControlControllerGetState(worldId);
}

export async function getWorldDetail(worldId: string): Promise<GetWorldTruthResult> {
  return realm().services.WorldsService.worldControllerGetWorld(worldId);
}

export async function getWorldTruth(worldId: string): Promise<GetWorldTruthResult> {
  return realm().services.WorldsService.worldControllerGetWorld(worldId);
}

export async function getWorldviewTruth(worldId: string): Promise<GetWorldviewTruthResult> {
  return realm().services.WorldsService.worldControllerGetWorldview(worldId);
}

export async function commitWorldState(worldId: string, patch: ForgeCommitWorldStateInput) {
  if (!Array.isArray(patch.writes)) {
    throw new Error('FORGE_WORLD_STATE_WRITES_REQUIRED');
  }
  return realm().services.WorldControlService.worldControlControllerCommitState(worldId, {
    ...patch,
    writes: patch.writes.map((item) => buildStateWrite(item)),
    commit: buildForgeMutationCommit({
      worldId,
      effectClass: 'STATE_ONLY',
      schemaId: FORGE_WORLD_WORKSPACE_SCHEMA_ID,
      schemaVersion: FORGE_WORLD_WORKSPACE_SCHEMA_VERSION,
      reason: patch.reason,
      sessionId: patch.sessionId,
      existing: patch.commit,
    }),
  });
}

export async function listMyWorlds() {
  return realm().services.WorldControlService.worldControlControllerListMyWorlds();
}

// ── History & Lorebooks ────────────────────────────────────

export async function listWorldHistory(worldId: string) {
  return realm().services.WorldControlService.worldControlControllerListWorldHistory(worldId);
}

export async function appendWorldHistory(worldId: string, payload: ForgeAppendWorldHistoryInput) {
  if (!Array.isArray(payload.historyAppends)) {
    throw new Error('FORGE_WORLD_HISTORY_APPENDS_REQUIRED');
  }
  return realm().services.WorldControlService.worldControlControllerAppendWorldHistory(worldId, {
    ...payload,
    historyAppends: payload.historyAppends.map((item) => buildHistoryAppend(item)),
    commit: buildForgeMutationCommit({
      worldId,
      effectClass: 'STATE_AND_HISTORY',
      schemaId: FORGE_WORLD_HISTORY_SCHEMA_ID,
      schemaVersion: FORGE_WORLD_HISTORY_SCHEMA_VERSION,
      reason: payload.reason,
      sessionId: payload.sessionId,
      existing: payload.commit,
    }),
  });
}

export async function listWorldLorebooks(worldId: string) {
  return realm().services.WorldControlService.worldControlControllerListWorldLorebooks(worldId);
}

// ── Visual Bindings ────────────────────────────────────────

export async function listWorldResourceBindings(worldId: string, query?: ListWorldResourceBindingsQuery) {
  return realm().services.WorldControlService.worldControlControllerListWorldBindings(
    worldId,
    query?.take,
    query?.bindingPoint,
    query?.bindingKind,
    query?.hostId,
    query?.hostType,
    query?.objectId,
    query?.objectType,
  );
}

export async function batchUpsertWorldResourceBindings(
  worldId: string,
  payload: BatchUpsertWorldResourceBindingsInput,
) {
  return realm().services.WorldControlService.worldControlControllerBatchUpsertWorldBindings(
    worldId,
    payload,
  );
}

export async function deleteWorldResourceBinding(worldId: string, bindingId: string) {
  return realm().services.WorldControlService.worldControlControllerDeleteWorldBinding(
    worldId,
    bindingId,
  );
}

// ── Creator Agents ─────────────────────────────────────────

export async function listCreatorAgents() {
  return realm().services.CreatorService.creatorControllerListAgents();
}

export async function createCreatorAgent(payload: ForgeCreateWorldCreatorAgentInput) {
  return realm().services.CreatorService.creatorControllerCreateAgent(buildCreatorAgentInput(payload));
}

export async function batchCreateCreatorAgents(payload: ForgeBatchCreateCreatorAgentsInput) {
  return realm().services.CreatorService.creatorControllerBatchCreateAgents({
    items: payload.items.map((item) => buildCreatorAgentInput(item)),
    continueOnError: payload.continueOnError ?? false,
  });
}

// ── Rule Truth CRUD ────────────────────────────────────────

export async function listWorldRules(worldId: string, status?: string) {
  return realm().services.WorldRulesService.worldRulesControllerGetRules(worldId, status);
}

export async function createWorldRule(worldId: string, payload: ForgeCreateWorldRuleInput) {
  return realm().services.WorldRulesService.worldRulesControllerCreateRule(
    worldId,
    buildWorldRuleInput(payload),
  );
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
    buildAgentRuleInput(payload),
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

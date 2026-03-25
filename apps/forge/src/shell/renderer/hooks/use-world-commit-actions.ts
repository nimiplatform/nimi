/**
 * Forge World Commit Actions (FG-WORLD-002)
 *
 * Replaces World-Studio's legacy write-action hook.
 * Uses direct SDK realm client calls via world-data-client instead of hookClient.
 */

import { useMutation } from '@tanstack/react-query';
import type { JsonObject } from '@renderer/bridge/types.js';
import {
  batchUpsertWorldResourceBindings,
  createWorldDraft,
  updateWorldDraft,
  publishWorldDraft,
  commitWorldState,
  listWorldRules,
  createWorldRule,
  updateWorldRule,
  deprecateWorldRule,
  archiveWorldRule,
  listAgentRules,
  createAgentRule,
  updateAgentRule,
  deprecateAgentRule,
  archiveAgentRule,
  appendWorldHistory,
  batchCreateCreatorAgents,
  FORGE_WORLD_WORKSPACE_TARGET_PATH,
  type ForgeBatchUpsertWorldResourceBindingsInput,
  type ForgeBatchCreateCreatorAgentsInput,
  type ForgeAppendWorldHistoryInput,
  type ForgeCreateAgentRuleInput,
  type ForgeCreateWorldDraftInput,
  type ForgeCreateWorldRuleInput,
  type ForgePublishWorldDraftInput,
  type ForgeUpdateAgentRuleInput,
  type ForgeUpdateWorldDraftInput,
  type ForgeUpdateWorldRuleInput,
} from '@renderer/data/world-data-client.js';

type SaveDraftInput = {
  draftId?: string;
  sourceType: ForgeCreateWorldDraftInput['sourceType'];
  sourceRef: string;
  status: 'DRAFT' | 'SYNTHESIZE' | 'REVIEW' | 'PUBLISH' | 'FAILED';
  draftPayload: NonNullable<ForgeCreateWorldDraftInput['draftPayload']>;
  targetWorldId?: string;
};

export function useWorldCommitActions() {
  const saveDraftMutation = useMutation({
    mutationFn: async (input: SaveDraftInput) => {
      if (input.draftId) {
        const patch: ForgeUpdateWorldDraftInput = {
          status: input.status,
          draftPayload: input.draftPayload,
        };
        return await updateWorldDraft(input.draftId, patch);
      }
      const payload: ForgeCreateWorldDraftInput = {
        sourceType: input.sourceType,
        sourceRef: input.sourceRef,
        targetWorldId: input.targetWorldId,
        draftPayload: input.draftPayload,
      };
      return await createWorldDraft(payload);
    },
  });

  const publishDraftMutation = useMutation({
    mutationFn: async (input: { draftId: string; reason: string }) => {
      const payload: ForgePublishWorldDraftInput = { reason: input.reason };
      return await publishWorldDraft(input.draftId, payload);
    },
  });

  const saveMaintenanceMutation = useMutation({
    mutationFn: async (input: {
      worldId: string;
      worldState: JsonObject;
      reason: string;
      sessionId: string;
      ifSnapshotVersion?: string;
    }) => {
      const payload = {
        writes: [{
          scope: 'WORLD' as const,
          scopeKey: input.worldId,
          targetPath: FORGE_WORLD_WORKSPACE_TARGET_PATH,
          payload: input.worldState,
          metadata: { owner: 'forge-maintenance' },
        }],
        reason: input.reason,
        sessionId: input.sessionId,
        ifSnapshotVersion: input.ifSnapshotVersion,
      };
      return await commitWorldState(input.worldId, payload);
    },
  });

  const listWorldRulesMutation = useMutation({
    mutationFn: async (input: { worldId: string; status?: string }) =>
      await listWorldRules(input.worldId, input.status),
  });

  const createWorldRuleMutation = useMutation({
    mutationFn: async (input: {
      worldId: string;
      payload: ForgeCreateWorldRuleInput;
    }) => await createWorldRule(input.worldId, input.payload),
  });

  const updateWorldRuleMutation = useMutation({
    mutationFn: async (input: {
      worldId: string;
      ruleId: string;
      payload: ForgeUpdateWorldRuleInput;
    }) => await updateWorldRule(input.worldId, input.ruleId, input.payload),
  });

  const deprecateWorldRuleMutation = useMutation({
    mutationFn: async (input: { worldId: string; ruleId: string }) =>
      await deprecateWorldRule(input.worldId, input.ruleId),
  });

  const archiveWorldRuleMutation = useMutation({
    mutationFn: async (input: { worldId: string; ruleId: string }) =>
      await archiveWorldRule(input.worldId, input.ruleId),
  });

  const listAgentRulesMutation = useMutation({
    mutationFn: async (input: {
      worldId: string;
      agentId: string;
      layer?: string;
      status?: string;
    }) =>
      await listAgentRules(input.worldId, input.agentId, {
        layer: input.layer,
        status: input.status,
      }),
  });

  const createAgentRuleMutation = useMutation({
    mutationFn: async (input: {
      worldId: string;
      agentId: string;
      payload: ForgeCreateAgentRuleInput;
    }) => await createAgentRule(input.worldId, input.agentId, input.payload),
  });

  const updateAgentRuleMutation = useMutation({
    mutationFn: async (input: {
      worldId: string;
      agentId: string;
      ruleId: string;
      payload: ForgeUpdateAgentRuleInput;
    }) => await updateAgentRule(input.worldId, input.agentId, input.ruleId, input.payload),
  });

  const deprecateAgentRuleMutation = useMutation({
    mutationFn: async (input: {
      worldId: string;
      agentId: string;
      ruleId: string;
    }) => await deprecateAgentRule(input.worldId, input.agentId, input.ruleId),
  });

  const archiveAgentRuleMutation = useMutation({
    mutationFn: async (input: {
      worldId: string;
      agentId: string;
      ruleId: string;
    }) => await archiveAgentRule(input.worldId, input.agentId, input.ruleId),
  });

  const syncEventsMutation = useMutation({
    mutationFn: async (input: {
      worldId: string;
      historyAppends: NonNullable<ForgeAppendWorldHistoryInput['historyAppends']>;
      reason: string;
      sessionId: string;
      ifSnapshotVersion?: string;
    }) => {
      const payload = {
        historyAppends: input.historyAppends,
        reason: input.reason,
        sessionId: input.sessionId,
        ifSnapshotVersion: input.ifSnapshotVersion,
      };
      return await appendWorldHistory(input.worldId, payload);
    },
  });

  const syncResourceBindingsMutation = useMutation({
    mutationFn: async (input: {
      worldId: string;
      bindingUpserts: NonNullable<ForgeBatchUpsertWorldResourceBindingsInput['bindingUpserts']>;
      reason: string;
      sessionId: string;
    }) => await batchUpsertWorldResourceBindings(input.worldId, {
      bindingUpserts: input.bindingUpserts,
    }),
  });

  const deleteEventMutation = useMutation({
    mutationFn: async () => {
      throw new Error('WORLD_HISTORY_APPEND_ONLY');
    },
  });

  const batchCreateCreatorAgentsMutation = useMutation({
    mutationFn: async (input: {
      items: ForgeBatchCreateCreatorAgentsInput['items'];
      continueOnError?: boolean;
    }) =>
      await batchCreateCreatorAgents({
        items: input.items,
        continueOnError: input.continueOnError !== false,
      }),
  });

  return {
    saveDraftMutation,
    publishDraftMutation,
    saveMaintenanceMutation,
    listWorldRulesMutation,
    createWorldRuleMutation,
    updateWorldRuleMutation,
    deprecateWorldRuleMutation,
    archiveWorldRuleMutation,
    listAgentRulesMutation,
    createAgentRuleMutation,
    updateAgentRuleMutation,
    deprecateAgentRuleMutation,
    archiveAgentRuleMutation,
    syncEventsMutation,
    syncResourceBindingsMutation,
    deleteEventMutation,
    batchCreateCreatorAgentsMutation,
  };
}

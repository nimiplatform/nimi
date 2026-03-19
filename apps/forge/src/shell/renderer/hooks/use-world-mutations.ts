/**
 * Forge World Mutations (FG-WORLD-002)
 *
 * Replaces World-Studio's useWorldStudioMutations hook.
 * Uses direct SDK realm client calls via world-data-client instead of hookClient.
 */

import { useMutation } from '@tanstack/react-query';
import {
  createWorldDraft,
  updateWorldDraft,
  publishWorldDraft,
  updateWorldMaintenance,
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
  batchUpsertWorldEvents,
  batchUpsertWorldMediaBindings,
  deleteWorldEvent,
  batchCreateCreatorAgents,
  type ForgeBatchCreateCreatorAgentsInput,
  type ForgeBatchUpsertWorldEventsInput,
  type ForgeBatchUpsertWorldMediaBindingsInput,
  type ForgeCreateAgentRuleInput,
  type ForgeCreateWorldDraftInput,
  type ForgeCreateWorldRuleInput,
  type ForgePublishWorldDraftInput,
  type ForgeUpdateAgentRuleInput,
  type ForgeUpdateWorldDraftInput,
  type ForgeUpdateWorldMaintenanceInput,
  type ForgeUpdateWorldRuleInput,
} from '@renderer/data/world-data-client.js';

const LOREBOOK_PROJECTION_READ_ONLY = 'WORLD_LOREBOOK_PROJECTION_READ_ONLY';

type SaveDraftInput = {
  draftId?: string;
  sourceType: ForgeCreateWorldDraftInput['sourceType'];
  sourceRef: string;
  status: 'DRAFT' | 'SYNTHESIZE' | 'REVIEW' | 'PUBLISH' | 'FAILED';
  pipelineState: NonNullable<ForgeCreateWorldDraftInput['pipelineState']>;
  draftPayload: NonNullable<ForgeCreateWorldDraftInput['draftPayload']>;
  targetWorldId?: string;
};

export function useWorldMutations() {
  const saveDraftMutation = useMutation({
    mutationFn: async (input: SaveDraftInput) => {
      if (input.draftId) {
        const patch: ForgeUpdateWorldDraftInput = {
          status: input.status,
          pipelineState: input.pipelineState,
          draftPayload: input.draftPayload,
        };
        return await updateWorldDraft(input.draftId, patch);
      }
      const payload: ForgeCreateWorldDraftInput = {
        sourceType: input.sourceType,
        sourceRef: input.sourceRef,
        targetWorldId: input.targetWorldId,
        pipelineState: input.pipelineState,
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
      worldPatch: NonNullable<ForgeUpdateWorldMaintenanceInput['worldPatch']>;
      reason: string;
      ifSnapshotVersion?: string;
    }) => {
      const payload: ForgeUpdateWorldMaintenanceInput = {
        worldPatch: input.worldPatch,
        reason: input.reason,
        ifSnapshotVersion: input.ifSnapshotVersion,
      };
      return await updateWorldMaintenance(input.worldId, payload);
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

  const syncLorebooksMutation = useMutation({
    mutationFn: async () => {
      throw new Error(LOREBOOK_PROJECTION_READ_ONLY);
    },
  });

  const syncEventsMutation = useMutation({
    mutationFn: async (input: {
      worldId: string;
      eventUpserts: NonNullable<ForgeBatchUpsertWorldEventsInput['eventUpserts']>;
      reason: string;
      mode?: 'merge' | 'replace';
      ifSnapshotVersion?: string;
    }) => {
      const payload: ForgeBatchUpsertWorldEventsInput = {
        eventUpserts: input.eventUpserts,
        mode: input.mode || 'merge',
        reason: input.reason,
        ifSnapshotVersion: input.ifSnapshotVersion,
      };
      return await batchUpsertWorldEvents(input.worldId, payload);
    },
  });

  const syncMediaBindingsMutation = useMutation({
    mutationFn: async (input: {
      worldId: string;
      bindingUpserts: NonNullable<ForgeBatchUpsertWorldMediaBindingsInput['bindingUpserts']>;
      reason: string;
    }) => {
      const payload: ForgeBatchUpsertWorldMediaBindingsInput = {
        bindingUpserts: input.bindingUpserts,
        reason: input.reason,
      };
      return await batchUpsertWorldMediaBindings(input.worldId, payload);
    },
  });

  const deleteLorebookMutation = useMutation({
    mutationFn: async () => {
      throw new Error(LOREBOOK_PROJECTION_READ_ONLY);
    },
  });

  const deleteEventMutation = useMutation({
    mutationFn: async (input: { worldId: string; eventId: string }) =>
      await deleteWorldEvent(input.worldId, input.eventId),
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
    syncLorebooksMutation,
    syncEventsMutation,
    syncMediaBindingsMutation,
    deleteLorebookMutation,
    deleteEventMutation,
    batchCreateCreatorAgentsMutation,
  };
}

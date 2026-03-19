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
} from '@renderer/data/world-data-client.js';

const LOREBOOK_PROJECTION_READ_ONLY = 'WORLD_LOREBOOK_PROJECTION_READ_ONLY';

type SaveDraftInput = {
  draftId?: string;
  sourceType: 'TEXT' | 'FILE';
  sourceRef: string;
  status: 'DRAFT' | 'SYNTHESIZE' | 'REVIEW' | 'PUBLISH' | 'FAILED';
  pipelineState: Record<string, unknown>;
  draftPayload: Record<string, unknown>;
  targetWorldId?: string;
};

export function useWorldMutations() {
  const saveDraftMutation = useMutation({
    mutationFn: async (input: SaveDraftInput) => {
      if (input.draftId) {
        return await updateWorldDraft(input.draftId, {
          status: input.status,
          pipelineState: input.pipelineState,
          draftPayload: input.draftPayload,
        });
      }
      return await createWorldDraft({
        sourceType: input.sourceType,
        sourceRef: input.sourceRef,
        targetWorldId: input.targetWorldId,
        pipelineState: input.pipelineState,
        draftPayload: input.draftPayload,
      });
    },
  });

  const publishDraftMutation = useMutation({
    mutationFn: async (input: { draftId: string; reason: string }) =>
      await publishWorldDraft(input.draftId, { reason: input.reason }),
  });

  const saveMaintenanceMutation = useMutation({
    mutationFn: async (input: {
      worldId: string;
      worldPatch: Record<string, unknown>;
      reason: string;
      ifSnapshotVersion?: string;
    }) =>
      await updateWorldMaintenance(input.worldId, {
        worldPatch: input.worldPatch,
        reason: input.reason,
        ifSnapshotVersion: input.ifSnapshotVersion,
      }),
  });

  const listWorldRulesMutation = useMutation({
    mutationFn: async (input: { worldId: string; status?: string }) =>
      await listWorldRules(input.worldId, input.status),
  });

  const createWorldRuleMutation = useMutation({
    mutationFn: async (input: {
      worldId: string;
      payload: Record<string, unknown>;
    }) => await createWorldRule(input.worldId, input.payload),
  });

  const updateWorldRuleMutation = useMutation({
    mutationFn: async (input: {
      worldId: string;
      ruleId: string;
      payload: Record<string, unknown>;
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
      payload: Record<string, unknown>;
    }) => await createAgentRule(input.worldId, input.agentId, input.payload),
  });

  const updateAgentRuleMutation = useMutation({
    mutationFn: async (input: {
      worldId: string;
      agentId: string;
      ruleId: string;
      payload: Record<string, unknown>;
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
      eventUpserts: Array<Record<string, unknown>>;
      reason: string;
      mode?: 'merge' | 'replace';
      ifSnapshotVersion?: string;
    }) =>
      await batchUpsertWorldEvents(input.worldId, {
        eventUpserts: input.eventUpserts,
        mode: input.mode || 'merge',
        reason: input.reason,
        ifSnapshotVersion: input.ifSnapshotVersion,
      }),
  });

  const syncMediaBindingsMutation = useMutation({
    mutationFn: async (input: {
      worldId: string;
      bindingUpserts: Array<Record<string, unknown>>;
      reason: string;
    }) =>
      await batchUpsertWorldMediaBindings(input.worldId, {
        bindingUpserts: input.bindingUpserts,
        reason: input.reason,
      }),
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
      items: Array<Record<string, unknown>>;
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

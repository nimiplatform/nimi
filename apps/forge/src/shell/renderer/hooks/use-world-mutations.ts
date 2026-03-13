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
  batchUpsertWorldEvents,
  batchUpsertWorldLorebooks,
  batchUpsertWorldMediaBindings,
  deleteWorldEvent,
  deleteWorldLorebook,
  batchCreateCreatorAgents,
} from '@renderer/data/world-data-client.js';

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
      worldviewPatch: Record<string, unknown>;
      reason: string;
      ifSnapshotVersion?: string;
    }) =>
      await updateWorldMaintenance(input.worldId, {
        worldPatch: input.worldPatch,
        worldviewPatch: input.worldviewPatch,
        reason: input.reason,
        ifSnapshotVersion: input.ifSnapshotVersion,
      }),
  });

  const syncLorebooksMutation = useMutation({
    mutationFn: async (input: {
      worldId: string;
      lorebookUpserts: Array<Record<string, unknown>>;
      reason: string;
    }) =>
      await batchUpsertWorldLorebooks(input.worldId, {
        lorebookUpserts: input.lorebookUpserts,
        reason: input.reason,
      }),
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
    mutationFn: async (input: { worldId: string; lorebookId: string }) =>
      await deleteWorldLorebook(input.worldId, input.lorebookId),
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
    syncLorebooksMutation,
    syncEventsMutation,
    syncMediaBindingsMutation,
    deleteLorebookMutation,
    deleteEventMutation,
    batchCreateCreatorAgentsMutation,
  };
}

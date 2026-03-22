import { useEffect, useRef } from 'react';
import type {
  EventNodeDraft,
  WorldStudioCreateStep,
  WorldStudioWorkspaceSnapshot,
} from '@world-engine/contracts.js';
import type { JsonObject } from '@renderer/bridge/types.js';
import { getWorldDraft } from '@renderer/data/world-data-client.js';
import type { ForgeWorkspacePatch } from '@renderer/state/creator-world-workspace.js';
import {
  restoreAgentSyncFromAgentRuleDrafts,
  restoreWorldviewPatchFromWorldRules,
} from './world-create-page-helpers.js';

function asRecord(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function requireRecord(value: unknown, code: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(code);
  }
  return value as JsonObject;
}

function toObjectArray(value: unknown, code: string): JsonObject[] {
  if (!Array.isArray(value)) {
    throw new Error(code);
  }
  return value.filter((item): item is JsonObject => Boolean(item && typeof item === 'object' && !Array.isArray(item)));
}

type UseWorldCreatePageDraftPersistenceInput = {
  hydrateForUser: (userId: string) => void;
  patchWorkspaceSnapshot: (patch: ForgeWorkspacePatch) => void;
  persistForUser: (userId: string) => void;
  resumeDraftId: string;
  setCreateStep: (step: WorldStudioCreateStep) => void;
  setNotice: (message: string | null) => void;
  snapshot: unknown;
  userId: string;
};

export function useWorldCreatePageDraftPersistence(input: UseWorldCreatePageDraftPersistenceInput) {
  useEffect(() => {
    if (input.userId) {
      input.hydrateForUser(input.userId);
    }
  }, [input.hydrateForUser, input.userId]);

  const draftLoadedRef = useRef(false);
  useEffect(() => {
    if (!input.resumeDraftId || draftLoadedRef.current) {
      return;
    }
    draftLoadedRef.current = true;

    async function loadDraft() {
      try {
        const data = await getWorldDraft(input.resumeDraftId);
        if (data && typeof data === 'object') {
          const record = asRecord(data);
          const draftPayload = requireRecord(record.draftPayload, 'FORGE_WORLD_DRAFT_PAYLOAD_REQUIRED');
          const pipelineState = asRecord(record.pipelineState);
          const importSource = requireRecord(draftPayload.importSource, 'FORGE_WORLD_DRAFT_IMPORT_SOURCE_REQUIRED');
          const truthDraft = requireRecord(draftPayload.truthDraft, 'FORGE_WORLD_DRAFT_TRUTH_REQUIRED');
          const stateDraft = requireRecord(draftPayload.stateDraft, 'FORGE_WORLD_DRAFT_STATE_REQUIRED');
          const historyDraft = requireRecord(draftPayload.historyDraft, 'FORGE_WORLD_DRAFT_HISTORY_REQUIRED');
          const workflowState = requireRecord(draftPayload.workflowState, 'FORGE_WORLD_DRAFT_WORKFLOW_REQUIRED');
          const worldRules = toObjectArray(truthDraft.worldRules, 'FORGE_WORLD_DRAFT_WORLD_RULES_REQUIRED');
          const agentRules = toObjectArray(truthDraft.agentRules, 'FORGE_WORLD_DRAFT_AGENT_RULES_REQUIRED') as Array<{
            characterName: string;
            payload: JsonObject;
          }>;
          const worldStateDraft = requireRecord(stateDraft.worldState, 'FORGE_WORLD_DRAFT_WORLD_STATE_REQUIRED');
          const historyEvents = requireRecord(historyDraft.events, 'FORGE_WORLD_DRAFT_HISTORY_EVENTS_REQUIRED');
          const restoredWorldviewPatch = restoreWorldviewPatchFromWorldRules(worldRules);
          const restoredAgentSync = restoreAgentSyncFromAgentRuleDrafts(agentRules);
          const restoredSelectedCharacters = Array.isArray(workflowState.selectedCharacters)
            ? workflowState.selectedCharacters.map((item) => String(item || '')).filter(Boolean)
            : restoredAgentSync.selectedCharacterIds;
          const restoredRuleTruthDraft = {
            worldRules,
            agentRules,
          };
          const restoredStep = String(
            workflowState.createStep
            || (String(record.status || 'DRAFT') === 'REVIEW' ? 'DRAFT' : record.status || 'SOURCE'),
          ) as WorldStudioCreateStep;

          const patch: ForgeWorkspacePatch = {
            sourceText: String(importSource.sourceText || ''),
            sourceRef: String(importSource.sourceRef || record.sourceRef || ''),
            worldStateDraft,
            worldviewPatch: restoredWorldviewPatch,
            ruleTruthDraft: restoredRuleTruthDraft,
            futureEventsText: String(workflowState.futureEventsText || ''),
            selectedStartTimeId: String(workflowState.selectedStartTimeId || ''),
            selectedCharacters: restoredSelectedCharacters,
            eventsDraft: {
              primary: Array.isArray(historyEvents.primary)
                ? historyEvents.primary as EventNodeDraft[]
                : [],
              secondary: Array.isArray(historyEvents.secondary)
                ? historyEvents.secondary as EventNodeDraft[]
                : [],
            },
            lorebooksDraft: [],
            agentSync: restoredAgentSync as ForgeWorkspacePatch['agentSync'],
            parseJob: asRecord(workflowState.parseJob || pipelineState.parseJob) as ForgeWorkspacePatch['parseJob'],
            phase1Artifact: asRecord(workflowState.phase1Artifact || pipelineState.phase1Artifact) as ForgeWorkspacePatch['phase1Artifact'],
            workspaceVersion: String(workflowState.workspaceVersion || ''),
            assets: {
              worldCover: asRecord(asRecord(draftPayload.assetBindingsDraft).worldCover),
              characterPortraits: asRecord(
                asRecord(draftPayload.assetBindingsDraft).characterPortraits,
              ) as NonNullable<ForgeWorkspacePatch['assets']>['characterPortraits'],
              locationImages: asRecord(
                asRecord(draftPayload.assetBindingsDraft).locationImages,
              ) as NonNullable<ForgeWorkspacePatch['assets']>['locationImages'],
            } as ForgeWorkspacePatch['assets'],
          };

          input.patchWorkspaceSnapshot(patch);
          input.setCreateStep(restoredStep);
        }
      } catch {
        input.setNotice('Failed to load draft. Starting fresh.');
      }
    }

    void loadDraft();
  }, [input.patchWorkspaceSnapshot, input.resumeDraftId, input.setCreateStep, input.setNotice]);

  useEffect(() => {
    if (input.userId) {
      input.persistForUser(input.userId);
    }
  }, [input.persistForUser, input.snapshot, input.userId]);
}

import { useEffect, useRef } from 'react';
import type {
  EventNodeDraft,
  WorldStudioCreateStep,
  WorldStudioSnapshotPatch,
  WorldStudioWorkspaceSnapshot,
} from '@world-engine/contracts.js';
import type { JsonObject } from '@renderer/bridge/types.js';
import { getWorldDraft } from '@renderer/data/world-data-client.js';
import {
  deriveRuleTruthDraftFromWorkspace,
  restoreAgentSyncFromAgentRuleDrafts,
  restoreWorldviewPatchFromWorldRules,
} from './world-create-page-helpers.js';

function asRecord(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

type UseWorldCreatePageDraftPersistenceInput = {
  hydrateForUser: (userId: string) => void;
  patchSnapshot: (patch: WorldStudioSnapshotPatch) => void;
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
          const draftPayload = asRecord(record.draftPayload);
          const pipelineState = asRecord(record.pipelineState);
          const restoredWorldviewPatch = restoreWorldviewPatchFromWorldRules(draftPayload.worldRules);
          const restoredAgentSync = restoreAgentSyncFromAgentRuleDrafts(draftPayload.agentRules);
          const restoredSelectedCharacters = Array.isArray(draftPayload.selectedCharacters)
            ? draftPayload.selectedCharacters.map((item) => String(item || '')).filter(Boolean)
            : restoredAgentSync.selectedCharacterIds;
          const restoredRuleTruthDraft = (
            Array.isArray(draftPayload.worldRules)
            || Array.isArray(draftPayload.agentRules)
          )
            ? {
              worldRules: Array.isArray(draftPayload.worldRules)
                ? draftPayload.worldRules.filter((item): item is JsonObject => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
                : [],
              agentRules: Array.isArray(draftPayload.agentRules)
                ? draftPayload.agentRules.filter((item): item is { characterName: string; payload: JsonObject } => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
                : [],
            }
            : deriveRuleTruthDraftFromWorkspace({
              worldviewPatch: restoredWorldviewPatch,
              sourceRef: String(draftPayload.sourceRef || record.sourceRef || ''),
              selectedCharacters: restoredSelectedCharacters,
              agentSync: restoredAgentSync as WorldStudioWorkspaceSnapshot['agentSync'],
            });
          const restoredStep = String(
            pipelineState.createStep
            || (String(record.status || 'DRAFT') === 'REVIEW' ? 'DRAFT' : record.status || 'SOURCE'),
          ) as WorldStudioCreateStep;

          const patch: WorldStudioSnapshotPatch = {
            sourceText: String(draftPayload.sourceText || ''),
            sourceRef: String(draftPayload.sourceRef || record.sourceRef || ''),
            worldPatch: asRecord(draftPayload.worldPatch),
            worldviewPatch: restoredWorldviewPatch,
            ruleTruthDraft: restoredRuleTruthDraft,
            futureEventsText: String(draftPayload.futureEventsText || ''),
            selectedStartTimeId: String(draftPayload.selectedStartTimeId || ''),
            selectedCharacters: restoredSelectedCharacters,
            eventsDraft: {
              primary: Array.isArray(asRecord(draftPayload.eventsDraft).primary)
                ? (asRecord(draftPayload.eventsDraft).primary as EventNodeDraft[])
                : [],
              secondary: Array.isArray(asRecord(draftPayload.eventsDraft).secondary)
                ? (asRecord(draftPayload.eventsDraft).secondary as EventNodeDraft[])
                : [],
            },
            lorebooksDraft: [],
            agentSync: restoredAgentSync as WorldStudioSnapshotPatch['agentSync'],
            parseJob: asRecord(pipelineState.parseJob) as WorldStudioSnapshotPatch['parseJob'],
            phase1Artifact: asRecord(pipelineState.phase1Artifact) as WorldStudioSnapshotPatch['phase1Artifact'],
          };

          input.patchSnapshot(patch);
          input.setCreateStep(restoredStep);
        }
      } catch {
        input.setNotice('Failed to load draft. Starting fresh.');
      }
    }

    void loadDraft();
  }, [input.patchSnapshot, input.resumeDraftId, input.setCreateStep, input.setNotice]);

  useEffect(() => {
    if (input.userId) {
      input.persistForUser(input.userId);
    }
  }, [input.persistForUser, input.snapshot, input.userId]);
}

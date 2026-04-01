import { useEffect, useMemo, useState } from 'react';
import type { Runtime } from '@nimiplatform/sdk/runtime';
import { getAgentPortraitBinding, getLookdevAgentAuthoringContext, type LookdevAgentRecord } from '@renderer/data/lookdev-data-client.js';
import type { RuntimeTargetOption } from '@renderer/app-shell/providers/app-store.js';
import { createCaptureStateKey, materializePortraitBriefFromCaptureState, synthesizeSilentCaptureState } from './capture-harness.js';
import type { LookdevCaptureState, LookdevLanguage, LookdevPortraitBrief, LookdevWorldStylePack } from './types.js';
import { expectedCaptureStateSignature, filterReadyCaptureStates, portraitBriefKey } from './create-batch-page-helpers.js';

type UseLookdevCaptureStateSynthesisInput = {
  stylePackConfirmed: boolean;
  worldStylePack: LookdevWorldStylePack | null;
  styleDialogueTarget: RuntimeTargetOption | null;
  selectedAgents: Array<Omit<LookdevAgentRecord, 'description' | 'scenario' | 'greeting' | 'currentPortrait'>>;
  captureSelectionAgentIds: string[];
  storedCaptureStates: Record<string, LookdevCaptureState>;
  storedPortraitBriefs: Record<string, LookdevPortraitBrief>;
  currentLanguage: LookdevLanguage;
  runtime: Runtime;
  saveCaptureState(state: LookdevCaptureState): void;
  savePortraitBrief(brief: LookdevPortraitBrief): void;
};

export function useLookdevCaptureStateSynthesis(input: UseLookdevCaptureStateSynthesisInput) {
  const {
    captureSelectionAgentIds,
    currentLanguage,
    runtime,
    saveCaptureState,
    savePortraitBrief,
    selectedAgents,
    storedCaptureStates,
    storedPortraitBriefs,
    styleDialogueTarget,
    stylePackConfirmed,
    worldStylePack,
  } = input;
  const [captureSynthesisBusy, setCaptureSynthesisBusy] = useState(false);
  const [captureSynthesisError, setCaptureSynthesisError] = useState<string | null>(null);

  const captureStateEntries = useMemo(
    () => !stylePackConfirmed || !worldStylePack
      ? []
      : selectedAgents.map((agent) => {
        const key = createCaptureStateKey(agent.worldId, agent.id);
        const storedState = storedCaptureStates[key];
        const expectedSignature = expectedCaptureStateSignature({
          agent,
          worldStylePack,
          captureMode: captureSelectionAgentIds.includes(agent.id) ? 'capture' : 'batch_only',
        });
        if (!storedState || storedState.seedSignature !== expectedSignature) {
          return null;
        }
        return storedState;
      }),
    [captureSelectionAgentIds, selectedAgents, storedCaptureStates, stylePackConfirmed, worldStylePack],
  );

  const portraitBriefs = useMemo(
    () => !stylePackConfirmed || !worldStylePack
      ? []
      : filterReadyCaptureStates(captureStateEntries)
        .map((state) => storedPortraitBriefs[portraitBriefKey(state.worldId, state.agentId)] || materializePortraitBriefFromCaptureState(state)),
    [captureStateEntries, storedPortraitBriefs, stylePackConfirmed, worldStylePack],
  );

  const captureStatesReady = stylePackConfirmed
    && selectedAgents.length > 0
    && captureStateEntries.length === selectedAgents.length
    && captureStateEntries.every((state) => state !== null);

  const captureStates = useMemo(
    () => filterReadyCaptureStates(captureStateEntries),
    [captureStateEntries],
  );

  useEffect(() => {
    let cancelled = false;
    if (!stylePackConfirmed || !worldStylePack || !styleDialogueTarget || selectedAgents.length === 0) {
      setCaptureSynthesisBusy(false);
      return () => {
        cancelled = true;
      };
    }
    const pendingAgents = selectedAgents.filter((agent) => {
      const key = createCaptureStateKey(agent.worldId, agent.id);
      const existingState = storedCaptureStates[key];
      const captureMode = captureSelectionAgentIds.includes(agent.id) ? 'capture' : 'batch_only';
      const expectedSignature = expectedCaptureStateSignature({
        agent,
        worldStylePack,
        captureMode,
      });
      return !existingState || existingState.seedSignature !== expectedSignature;
    });
    if (pendingAgents.length === 0) {
      setCaptureSynthesisBusy(false);
      setCaptureSynthesisError(null);
      return () => {
        cancelled = true;
      };
    }
    void (async () => {
      setCaptureSynthesisBusy(true);
      setCaptureSynthesisError(null);
      try {
        for (const agent of pendingAgents) {
          if (!agent.worldId) {
            throw new Error('LOOKDEV_WORLD_ID_REQUIRED');
          }
          const [authoringContext, portraitBinding] = await Promise.all([
            getLookdevAgentAuthoringContext(agent.worldId, agent.id).catch(() => null),
            getAgentPortraitBinding(agent.worldId, agent.id).catch(() => null),
          ]);
          const nextState = await synthesizeSilentCaptureState({
            runtime,
            target: styleDialogueTarget,
            language: currentLanguage,
            agent: {
              id: agent.id,
              displayName: agent.displayName,
              concept: agent.concept,
              description: authoringContext?.detail?.description || null,
              truthBundle: authoringContext?.truthBundle || null,
              worldId: agent.worldId,
              importance: agent.importance,
              existingPortraitUrl: portraitBinding?.url || null,
            },
            worldStylePack,
            captureMode: captureSelectionAgentIds.includes(agent.id) ? 'capture' : 'batch_only',
            existingState: storedCaptureStates[createCaptureStateKey(agent.worldId, agent.id)] || null,
          });
          if (cancelled) {
            return;
          }
          saveCaptureState(nextState);
          savePortraitBrief(materializePortraitBriefFromCaptureState(nextState));
        }
      } catch (captureError) {
        if (!cancelled) {
          setCaptureSynthesisError(captureError instanceof Error ? captureError.message : String(captureError));
        }
      } finally {
        if (!cancelled) {
          setCaptureSynthesisBusy(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    captureSelectionAgentIds,
    currentLanguage,
    runtime,
    saveCaptureState,
    savePortraitBrief,
    selectedAgents,
    storedCaptureStates,
    styleDialogueTarget,
    stylePackConfirmed,
    worldStylePack,
  ]);

  return {
    captureStates,
    captureStatesReady,
    captureSynthesisBusy,
    captureSynthesisError,
    portraitBriefs,
    setCaptureSynthesisError,
  };
}

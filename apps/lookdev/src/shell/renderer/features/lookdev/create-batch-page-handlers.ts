import type { Runtime } from '@nimiplatform/sdk/runtime';
import type { LookdevAgentRecord } from '@renderer/data/lookdev-data-client.js';
import { getAgentPortraitBinding, getLookdevAgentAuthoringContext } from '@renderer/data/lookdev-data-client.js';
import {
  createCaptureStateKey,
  materializePortraitBriefFromCaptureState,
  runInteractiveCaptureTurn,
  synthesizeSilentCaptureState,
} from './capture-harness.js';
import {
  appendWorldStyleSessionAnswer,
  createWorldStyleSession,
  markWorldStyleSessionSynthesized,
  synthesizeWorldStylePackFromSession,
  type SessionAgentContext,
} from './world-style-session.js';
import { confirmWorldStylePack, type LookdevCaptureState, type LookdevLanguage, type LookdevSelectionSource, type LookdevWorldStylePack, type LookdevWorldStyleSession } from './types.js';
import { toErrorMessage, withLookdevBatchAgentFields, type LookdevSelectedAgent } from './create-batch-page-helpers.js';
import type { LookdevRuntimeTargetOption } from './lookdev-route.js';
import type { CreateBatchInput } from './lookdev-store.js';
import type { TFunction } from 'i18next';

type StyleSessionContext = {
  runtime: Runtime;
  styleDialogueTarget: LookdevRuntimeTargetOption | null;
  styleAgents: SessionAgentContext[];
  t: TFunction;
  saveWorldStyleSession: (session: LookdevWorldStyleSession) => void;
  saveWorldStylePack: (pack: LookdevWorldStylePack) => void;
  setStyleSession: (updater: LookdevWorldStyleSession | null | ((current: LookdevWorldStyleSession | null) => LookdevWorldStyleSession | null)) => void;
  setWorldStylePack: (updater: LookdevWorldStylePack | null | ((current: LookdevWorldStylePack | null) => LookdevWorldStylePack | null)) => void;
  setShowAdvancedStyleEditor: (value: boolean | ((current: boolean) => boolean)) => void;
  setStyleSessionInput: (value: string) => void;
  setStyleSessionError: (value: string | null) => void;
  setStyleSessionBusy: (value: boolean) => void;
};

export async function handleStyleSessionReply(
  styleSession: LookdevWorldStyleSession,
  styleSessionInput: string,
  worldStylePack: LookdevWorldStylePack | null,
  ctx: StyleSessionContext,
): Promise<void> {
  ctx.setStyleSessionBusy(true);
  ctx.setStyleSessionError(null);
  try {
    const nextSession = await appendWorldStyleSessionAnswer({
      runtime: ctx.runtime,
      target: ctx.styleDialogueTarget,
      session: styleSession,
      answer: styleSessionInput,
      agents: ctx.styleAgents,
    });
    ctx.setStyleSession(nextSession);
    ctx.saveWorldStyleSession(nextSession);
    ctx.setStyleSessionInput('');
    if (worldStylePack) {
      const invalidatedPack = {
        ...worldStylePack,
        status: 'draft' as const,
        confirmedAt: null,
        sourceSessionId: nextSession.sessionId,
        summary: nextSession.summary || worldStylePack.summary,
        updatedAt: new Date().toISOString(),
      };
      ctx.setWorldStylePack(invalidatedPack);
      ctx.saveWorldStylePack(invalidatedPack);
      ctx.setShowAdvancedStyleEditor(true);
    } else {
      ctx.setWorldStylePack(null);
      ctx.setShowAdvancedStyleEditor(false);
    }
  } catch (nextError) {
    ctx.setStyleSessionError(toErrorMessage(nextError, ctx.t));
  } finally {
    ctx.setStyleSessionBusy(false);
  }
}

export function handleRestartStyleSession(
  resolvedWorldId: string,
  resolvedWorldName: string,
  currentLanguage: 'en' | 'zh',
  ctx: StyleSessionContext,
): void {
  if (!resolvedWorldId) {
    return;
  }
  const nextSession = createWorldStyleSession(
    resolvedWorldId,
    resolvedWorldName,
    currentLanguage,
    ctx.styleAgents,
  );
  ctx.setStyleSession(nextSession);
  ctx.saveWorldStyleSession(nextSession);
  ctx.setWorldStylePack(null);
  ctx.setShowAdvancedStyleEditor(false);
  ctx.setStyleSessionInput('');
  ctx.setStyleSessionError(null);
}

export async function handleSynthesizeStylePack(
  styleSession: LookdevWorldStyleSession,
  worldStylePack: LookdevWorldStylePack | null,
  ctx: StyleSessionContext,
): Promise<void> {
  ctx.setStyleSessionBusy(true);
  ctx.setStyleSessionError(null);
  try {
    const nextPack = await synthesizeWorldStylePackFromSession({
      runtime: ctx.runtime,
      target: ctx.styleDialogueTarget,
      session: styleSession,
      agents: ctx.styleAgents,
      existingPack: worldStylePack,
    });
    const nextSession = markWorldStyleSessionSynthesized(styleSession, nextPack.summary);
    ctx.setStyleSession(nextSession);
    ctx.saveWorldStyleSession(nextSession);
    ctx.setWorldStylePack(nextPack);
    ctx.saveWorldStylePack(nextPack);
    ctx.setShowAdvancedStyleEditor(true);
  } catch (nextError) {
    ctx.setStyleSessionError(toErrorMessage(nextError, ctx.t));
  } finally {
    ctx.setStyleSessionBusy(false);
  }
}

export function handleConfirmWorldStylePack(
  worldStylePack: LookdevWorldStylePack | null,
  setWorldStylePack: (pack: LookdevWorldStylePack | null) => void,
  saveWorldStylePack: (pack: LookdevWorldStylePack) => void,
): void {
  if (!worldStylePack) {
    return;
  }
  const confirmedPack = confirmWorldStylePack(worldStylePack);
  setWorldStylePack(confirmedPack);
  saveWorldStylePack(confirmedPack);
}

type InteractiveCaptureContext = {
  runtime: Runtime;
  styleDialogueTarget: LookdevRuntimeTargetOption | null;
  currentLanguage: LookdevLanguage;
  selectedAgents: LookdevSelectedAgent[];
  saveCaptureState: (state: LookdevCaptureState) => void;
  savePortraitBrief: (brief: ReturnType<typeof materializePortraitBriefFromCaptureState>) => void;
  setInteractiveCaptureBusy: (value: boolean) => void;
  setInteractiveCaptureResetBusy: (value: boolean) => void;
  setInteractiveCaptureError: (value: string | null) => void;
  setInteractiveCaptureDrafts: (updater: (current: Record<string, string>) => Record<string, string>) => void;
};

export async function handleInteractiveCaptureRefine(
  activeCaptureState: LookdevCaptureState | null,
  worldStylePack: LookdevWorldStylePack | null,
  activeCaptureDraftKey: string | null,
  interactiveCaptureInput: string,
  ctx: InteractiveCaptureContext,
): Promise<void> {
  if (!activeCaptureState || !worldStylePack) {
    return;
  }
  const draftKey = activeCaptureDraftKey;
  const userMessage = interactiveCaptureInput.trim();
  if (!userMessage) {
    return;
  }
  const agent = ctx.selectedAgents.find((entry) => entry.id === activeCaptureState.agentId);
  if (!agent) {
    return;
  }
  ctx.setInteractiveCaptureBusy(true);
  ctx.setInteractiveCaptureError(null);
  try {
    if (!agent.worldId) {
      throw new Error('LOOKDEV_WORLD_ID_REQUIRED');
    }
    const [authoringContext, portraitBinding] = await Promise.all([
      getLookdevAgentAuthoringContext(agent.worldId, agent.id).catch(() => null),
      getAgentPortraitBinding(agent.worldId, agent.id).catch(() => null),
    ]);
    const nextState = await runInteractiveCaptureTurn({
      runtime: ctx.runtime,
      target: ctx.styleDialogueTarget,
      language: ctx.currentLanguage,
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
      state: activeCaptureState,
      userMessage,
    });
    ctx.saveCaptureState(nextState);
    ctx.savePortraitBrief(materializePortraitBriefFromCaptureState(nextState));
    if (draftKey) {
      ctx.setInteractiveCaptureDrafts((current) => {
        if (!Object.prototype.hasOwnProperty.call(current, draftKey)) {
          return current;
        }
        const next = { ...current };
        delete next[draftKey];
        return next;
      });
    }
  } catch (captureError) {
    ctx.setInteractiveCaptureError(captureError instanceof Error ? captureError.message : String(captureError));
  } finally {
    ctx.setInteractiveCaptureBusy(false);
  }
}

export async function handleResetInteractiveCapture(
  activeCaptureState: LookdevCaptureState | null,
  worldStylePack: LookdevWorldStylePack | null,
  activeCaptureDraftKey: string | null,
  ctx: InteractiveCaptureContext,
): Promise<void> {
  if (!activeCaptureState || !worldStylePack) {
    return;
  }
  const draftKey = activeCaptureDraftKey;
  const agent = ctx.selectedAgents.find((entry) => entry.id === activeCaptureState.agentId);
  if (!agent) {
    return;
  }
  ctx.setInteractiveCaptureResetBusy(true);
  ctx.setInteractiveCaptureError(null);
  try {
    if (!agent.worldId) {
      throw new Error('LOOKDEV_WORLD_ID_REQUIRED');
    }
    const [authoringContext, portraitBinding] = await Promise.all([
      getLookdevAgentAuthoringContext(agent.worldId, agent.id).catch(() => null),
      getAgentPortraitBinding(agent.worldId, agent.id).catch(() => null),
    ]);
    const nextState = await synthesizeSilentCaptureState({
      runtime: ctx.runtime,
      target: ctx.styleDialogueTarget,
      language: ctx.currentLanguage,
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
      captureMode: 'capture',
    });
    ctx.saveCaptureState(nextState);
    ctx.savePortraitBrief(materializePortraitBriefFromCaptureState(nextState));
    if (draftKey) {
      ctx.setInteractiveCaptureDrafts((current) => {
        if (!Object.prototype.hasOwnProperty.call(current, draftKey)) {
          return current;
        }
        const next = { ...current };
        delete next[draftKey];
        return next;
      });
    }
  } catch (captureError) {
    ctx.setInteractiveCaptureError(captureError instanceof Error ? captureError.message : String(captureError));
  } finally {
    ctx.setInteractiveCaptureResetBusy(false);
  }
}

type HandleCreateContext = {
  t: TFunction;
  navigate: (path: string) => void;
  createBatch: (input: CreateBatchInput) => Promise<string>;
  saveWorldStylePack: (pack: LookdevWorldStylePack) => void;
  saveWorldStyleSession: (session: LookdevWorldStyleSession) => void;
  saveCaptureState: (state: LookdevCaptureState) => void;
  savePortraitBrief: (brief: ReturnType<typeof materializePortraitBriefFromCaptureState>) => void;
  setSaving: (value: boolean) => void;
  setError: (value: string | null) => void;
};

export async function handleCreate(input: {
  intakeLoading: boolean;
  intakeError: unknown;
  worldSelectionUnavailable: boolean;
  rawSelectedAgents: LookdevSelectedAgent[];
  rawSelectedWorldIds: string[];
  resolvedWorldId: string;
  resolvedWorldName: string;
  worldStylePack: LookdevWorldStylePack | null;
  stylePackConfirmed: boolean;
  captureSynthesisBusy: boolean;
  interactiveCaptureResetBusy: boolean;
  captureStatesReady: boolean;
  generationTarget: CreateBatchInput['generationTarget'] | null;
  evaluationTarget: CreateBatchInput['evaluationTarget'] | null;
  styleSession: LookdevWorldStyleSession | null;
  captureStates: LookdevCaptureState[];
  portraitBriefs: Array<ReturnType<typeof materializePortraitBriefFromCaptureState>>;
  name: string;
  selectionSource: LookdevSelectionSource;
  selectedAgents: LookdevSelectedAgent[];
  captureSelectionAgentIds: string[];
  maxConcurrency: string;
  scoreThreshold: string;
  ctx: HandleCreateContext;
}): Promise<void> {
  const { ctx } = input;
  ctx.setSaving(true);
  ctx.setError(null);
  try {
    if (input.intakeLoading) {
      throw new Error(ctx.t('createBatch.errorIntakeLoading'));
    }
    if (input.intakeError) {
      throw new Error(ctx.t('createBatch.errorIntakeUnavailable'));
    }
    if (input.worldSelectionUnavailable) {
      throw new Error(ctx.t('createBatch.errorWorldCastUnavailable', { worldName: input.resolvedWorldName }));
    }
    if (input.rawSelectedAgents.length === 0) {
      throw new Error(ctx.t('createBatch.errorAgentsRequired'));
    }
    if (input.rawSelectedWorldIds.length > 1) {
      throw new Error(ctx.t('createBatch.errorSingleWorldRequired'));
    }
    if (!input.resolvedWorldId || !input.worldStylePack) {
      throw new Error(ctx.t('createBatch.errorWorldRequired'));
    }
    if (!input.stylePackConfirmed) {
      throw new Error(ctx.t('createBatch.errorStylePackConfirmationRequired'));
    }
    if (input.captureSynthesisBusy) {
      throw new Error(ctx.t('createBatch.errorCaptureStatePending', { defaultValue: 'Capture-state synthesis is still running.' }));
    }
    if (input.interactiveCaptureResetBusy) {
      throw new Error(ctx.t('createBatch.errorCaptureStatePending', { defaultValue: 'Capture-state synthesis is still running.' }));
    }
    if (!input.captureStatesReady) {
      throw new Error(ctx.t('createBatch.errorCaptureStateRequired', { defaultValue: 'Every selected agent needs a capture state before batch creation.' }));
    }
    if (!input.generationTarget) {
      throw new Error(ctx.t('createBatch.errorGenerationTargetRequired'));
    }
    if (!input.evaluationTarget) {
      throw new Error(ctx.t('createBatch.errorEvaluationTargetRequired'));
    }
    ctx.saveWorldStylePack(input.worldStylePack);
    if (input.styleSession) {
      ctx.saveWorldStyleSession(input.styleSession);
    }
    input.captureStates.forEach((state) => ctx.saveCaptureState(state));
    input.portraitBriefs.forEach((brief) => ctx.savePortraitBrief(brief));
    const batchId = await ctx.createBatch({
      name: input.name,
      selectionSource: input.selectionSource,
      agents: input.selectedAgents.map(withLookdevBatchAgentFields),
      worldId: input.resolvedWorldId,
      worldStylePack: input.worldStylePack,
      captureSelectionAgentIds: input.captureSelectionAgentIds,
      generationTarget: input.generationTarget,
      evaluationTarget: input.evaluationTarget,
      maxConcurrency: Number(input.maxConcurrency),
      scoreThreshold: Number(input.scoreThreshold),
    });
    ctx.navigate(`/batches/${batchId}`);
  } catch (nextError) {
    ctx.setError(nextError instanceof Error ? nextError.message : String(nextError));
  } finally {
    ctx.setSaving(false);
  }
}

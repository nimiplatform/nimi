// Relay send-flow — adapted from local-chat send-flow.ts
// Removed: mod SDK imports (createRendererFlowId, getPromptLocale, RuntimeRouteBinding)
// Removed: localChatMessage i18n (replaced with English strings)
// Removed: routeBinding / routeOptions (relay uses routeSnapshot only)
// Adapted: MainProcessChatContext instead of React state, callback pattern
// Adapted: waitForNextPaint → setTimeout(0), createUlid instead of createRendererFlowId

import type { ChatMessage, RelayChatTurnSendInput, MediaExecutionDecision } from './types.js';
import { buildErrorTurnPayload } from './error-handler.js';
import { buildFirstBeatRequestInput, buildFullTurnRequestInput } from './request-builder.js';
import {
  commitAssistantMessage,
  persistUserTurns,
  scheduleAssistantTurnDeliveries,
  type TurnDeliveryScheduleHandle,
} from './session-persist.js';
import { logTurnScheduleCancelled, logTurnSendDone, logTurnSendFailed, logTurnSendStart, createLocalChatFlowId } from './logging.js';
import { decideMediaExecution } from '../media/media-decision-policy.js';
import { executeMediaDecision } from '../media/media-execution-pipeline.js';
import { isMediaRouteReady } from '../media/media-route.js';
import { deriveInteractionProfile } from './interaction-profile.js';
import { resolveTurnMode } from './turn-mode-resolver.js';
import { resolveFastTurnPerception } from './fast-turn-perception.js';
import { perceiveTurn } from './turn-perception.js';
import { composeInteractionTurnPlan } from './turn-composer.js';
import { runFirstBeatReactor } from './first-beat-reactor.js';
import { orchestrateBeatModalities } from './modality-orchestrator.js';
import { applyResolvedContentBoundaryHint, compileResolvedExperiencePolicy } from './resolved-experience-policy.js';
import { buildPromptTrace, buildTurnAudit } from './diagnostics.js';
import { derivePacingPlan } from './context-assembler.js';
import { compileLocalChatPrompt } from '../prompt/compiler.js';
import {
  appendTurnsToSession,
  createLocalChatTurnRecord,
  listLocalChatSessions,
  createLocalChatSession,
  getSessionById,
  createSessionTurn,
  listLocalChatExactHistoryTurns,
  getInteractionSnapshot,
  getRelationMemorySlots,
  getRecallIndex,
} from '../session-store/index.js';
import type { LocalChatTurnSendPhase } from './types.js';
import { persistLocalChatInteractionArtifacts } from './interaction-artifact-persistence.js';
import { createUlid } from './ulid.js';
import { buildLocalChatTurnContextKey, buildLocalChatTurnContextSnapshot } from './context-key.js';
import type { MainProcessChatContext } from './main-process-context.js';
import {
  type OrchestratedBeat,
  createTurnTxnId,
  createTurnId,
  waitForNextPaint,
  createCancelledAudit,
  normalizeBeatText,
  toMarkerOverrideIntent,
  assertExplicitMediaAssetRequest,
  bindMediaDecisionToDelivery,
  createStandaloneMediaDelivery,
  buildAssistantDeliveries,
  resolveFirstBeatIntent,
  ensureNotAborted,
  isAbortedError,
  upsertTransientFirstBeatMessage,
} from './send-flow-helpers.js';

async function ensureWorkingSession(input: {
  selectedSessionId: string;
  viewerId: string;
  selectedTarget: RelayChatTurnSendInput['selectedTarget'];
  chatContext: MainProcessChatContext;
}): Promise<{ id: string }> {
  const existingId = String(input.selectedSessionId || '').trim();
  if (existingId) {
    const existing = await getSessionById(existingId, input.viewerId);
    if (existing) return existing;
  }
  if (!input.selectedTarget) throw new Error('RELAY_NO_TARGET');
  const session = await createLocalChatSession({
    targetId: input.selectedTarget.id,
    viewerId: input.viewerId,
    worldId: input.selectedTarget.worldId,
  });
  input.chatContext.setSelectedSessionId(session.id);
  return session;
}

function createUserMessage(text: string): ChatMessage {
  return {
    id: `msg_${createUlid()}`,
    role: 'user',
    kind: 'text',
    content: text,
    timestamp: new Date(),
  };
}

export async function runLocalChatTurnSend(input: {
  context: RelayChatTurnSendInput;
  chatContext: MainProcessChatContext;
  abortSignal?: AbortSignal;
  setSendPhase: (next: LocalChatTurnSendPhase) => void;
  getCurrentContextKey: () => string;
  registerSchedule: (input: {
    handle: TurnDeliveryScheduleHandle;
    context: ReturnType<typeof buildLocalChatTurnContextSnapshot>;
  }) => void;
  clearScheduleByTxn: (turnTxnId: string) => void;
}) {
  const { context, chatContext } = input;
  if (context.isTranscribing) return;
  const text = String(context.inputText || '').trim();
  if (!text) return;
  if (!context.selectedTarget) {
    chatContext.setStatusBanner({
      kind: 'warning',
      message: 'No Agent friend available. Please add an Agent friend in Contacts first.',
    });
    return;
  }
  const selectedTarget = context.selectedTarget;
  const userMessage = createUserMessage(text);
  const turnTxnId = createTurnTxnId();
  const turnId = createTurnId();
  const firstBeatMessageId = `beat_${createUlid()}`;
  const voiceConversationMode = context.voiceConversationMode || context.defaultSettings.voiceConversationMode || 'off';
  const existingSessionId = String(context.selectedSessionId || '').trim();
  const canOptimisticallyReflectUserTurn = Boolean(existingSessionId);

  let sessionId = '';
  let sendContextKey = '';
  let hasWorkingSession = false;
  let userTurnPersisted = false;
  let assistantTurnRecordCreated = false;
  let firstBeatCommitted = false;
  let handedOffToSchedule = false;

  if (canOptimisticallyReflectUserTurn) {
    chatContext.setMessages((prev) => [...prev, userMessage]);
    chatContext.setInputText('');
    input.setSendPhase('awaiting-first-beat');
    await waitForNextPaint();
  }

  const flowId = createLocalChatFlowId('relay-send-turn');
  const startedAt = performance.now();

  try {
    const workingSession = await ensureWorkingSession({
      selectedSessionId: context.selectedSessionId,
      viewerId: context.viewerId,
      selectedTarget,
      chatContext,
    });
    sessionId = workingSession.id;
    hasWorkingSession = true;
    context.onSessionResolved?.(sessionId);
    ensureNotAborted(input.abortSignal);
    sendContextKey = buildLocalChatTurnContextKey({
      targetId: selectedTarget.id,
      sessionId,
    });
    if (!canOptimisticallyReflectUserTurn) {
      chatContext.setMessages((prev) => [...prev, userMessage]);
      chatContext.setInputText('');
      input.setSendPhase('awaiting-first-beat');
      await waitForNextPaint();
    }
    await persistUserTurns({
      sessionId,
      targetId: selectedTarget.id,
      viewerId: context.viewerId,
      userTurns: [createSessionTurn({ message: userMessage })],
      setSessions: chatContext.setSessions,
    });
    userTurnPersisted = true;
    ensureNotAborted(input.abortSignal);
    logTurnSendStart({ flowId, target: selectedTarget, sessionId, turnTxnId });

    const interactionProfile = deriveInteractionProfile(selectedTarget);
    const regexTurnMode = resolveTurnMode({ userText: text, interactionProfile });
    const recentTurns = await listLocalChatExactHistoryTurns(sessionId, context.viewerId);
    const interactionSnapshot = await getInteractionSnapshot(sessionId);
    const promptLocale = 'en' as const;

    const firstBeatPrepared = buildFirstBeatRequestInput({
      text,
      viewerId: context.viewerId,
      viewerDisplayName: context.viewerDisplayName,
      selectedTarget,
      selectedSessionId: sessionId,
      runtimeMode: context.runtimeMode,
      routeSnapshot: context.routeSnapshot,
      allowMultiReply: context.defaultSettings.deliveryStyle === 'natural',
      turnMode: regexTurnMode,
      voiceConversationMode,
      promptLocale,
      recentTurns,
      interactionSnapshot,
      compilePrompt: (compileInput) => compileLocalChatPrompt({
        contextPacket: compileInput.contextPacket,
        profile: compileInput.profile,
      }),
    });
    ensureNotAborted(input.abortSignal);

    const fastPerception = resolveFastTurnPerception({
      userText: text,
      interactionProfile: firstBeatPrepared.contextPacket.target.interactionProfile,
      snapshot: firstBeatPrepared.contextPacket.interactionSnapshot || null,
      recentTurns: firstBeatPrepared.contextPacket.recentTurns,
      promptLocale,
    });
    const resolvedExperiencePolicy = compileResolvedExperiencePolicy({
      interactionProfile: firstBeatPrepared.contextPacket.target.interactionProfile,
      interactionSnapshot: firstBeatPrepared.contextPacket.interactionSnapshot || null,
      settings: context.defaultSettings,
      requestedVoiceConversationMode: voiceConversationMode,
      routeSource: context.routeSnapshot?.source || 'cloud',
    });
    applyResolvedContentBoundaryHint({
      contextPacket: firstBeatPrepared.contextPacket,
      policy: resolvedExperiencePolicy,
    });
    let turnMode = fastPerception.turnMode;
    firstBeatPrepared.contextPacket.perceptionOverlay = {
      refinedTurnMode: fastPerception.turnMode,
      emotionalState: fastPerception.emotionalState?.detected || '',
      emotionalCause: fastPerception.emotionalState?.cause || '',
      suggestedApproach: fastPerception.emotionalState?.suggestedApproach || '',
      directive: fastPerception.conversationDirective || '',
      intimacyCeiling: fastPerception.intimacyCeiling,
    };
    firstBeatPrepared.contextPacket.turnMode = fastPerception.turnMode;
    firstBeatPrepared.contextPacket.pacingPlan = derivePacingPlan({
      text,
      interactionProfile: firstBeatPrepared.contextPacket.target.interactionProfile,
      allowMultiReply: resolvedExperiencePolicy.deliveryPolicy.allowMultiReply,
      turnMode,
      emotionalHint: fastPerception.emotionalState?.detected,
      suggestedApproach: fastPerception.emotionalState?.suggestedApproach,
      momentum: firstBeatPrepared.contextPacket.interactionSnapshot?.conversationMomentum,
    });
    const effectiveVoiceConversationMode = resolvedExperiencePolicy.voicePolicy.conversationMode;

    // Start deep perception in parallel
    const relationMemorySlots = await getRelationMemorySlots({ targetId: selectedTarget.id, viewerId: context.viewerId });
    const recallIndex = await getRecallIndex(sessionId);
    const deepPreparedPromise = Promise.resolve(buildFullTurnRequestInput({
      text,
      viewerId: context.viewerId,
      viewerDisplayName: context.viewerDisplayName,
      selectedTarget,
      selectedSessionId: sessionId,
      runtimeMode: context.runtimeMode,
      routeSnapshot: context.routeSnapshot,
      allowMultiReply: resolvedExperiencePolicy.deliveryPolicy.allowMultiReply,
      turnMode,
      voiceConversationMode,
      promptLocale,
      recentTurns,
      interactionSnapshot,
      relationMemorySlots,
      recallIndex,
      platformWarmStart: null,
      compilePrompt: (compileInput) => compileLocalChatPrompt({
        contextPacket: compileInput.contextPacket,
        profile: compileInput.profile,
      }),
    }));

    const createPerceptionStatePromise = async () => {
      try {
        const prepared = await deepPreparedPromise;
        const recentTurnsForPerception = prepared.contextPacket.recentTurns
          .slice(-5)
          .map((turn) => ({ role: turn.role, text: turn.lines.join(' ') }));
        const perception = await perceiveTurn({
          aiClient: context.aiClient,
          invokeInput: prepared.invokeInput,
          userText: text,
          snapshot: prepared.contextPacket.interactionSnapshot || null,
          memorySlots: prepared.contextPacket.relationMemorySlots || [],
          recentTurns: recentTurnsForPerception,
          regexFallbackTurnMode: regexTurnMode,
          promptLocale,
        });
        return { ok: true as const, perception, prepared };
      } catch (error) {
        return { ok: false as const, error };
      }
    };
    let perceptionStatePromise = createPerceptionStatePromise();

    const firstBeatCompiledPrompt = compileLocalChatPrompt({
      contextPacket: firstBeatPrepared.contextPacket,
      profile: 'first-beat',
    });
    const firstBeatResult = await runFirstBeatReactor({
      aiClient: context.aiClient,
      invokeInput: {
        ...firstBeatPrepared.invokeInput,
        prompt: firstBeatCompiledPrompt.prompt,
      },
      contextPacket: firstBeatPrepared.contextPacket,
      userText: text,
      transientMessageId: firstBeatMessageId,
      abortSignal: input.abortSignal,
      debugContext: {
        entry: 'send-flow',
        flowId,
        turnTxnId,
        targetId: selectedTarget.id,
        sessionId,
      },
      onPreview: (preview) => {
        input.setSendPhase('streaming-first-beat');
        upsertTransientFirstBeatMessage({
          chatContext,
          messageId: firstBeatMessageId,
          content: preview,
          turnId,
          turnMode,
          voiceConversationMode: effectiveVoiceConversationMode,
        });
      },
    });
    ensureNotAborted(input.abortSignal);
    if (!normalizeBeatText(firstBeatResult.text)) {
      throw new Error('LOCAL_CHAT_FIRST_BEAT_EMPTY');
    }

    await createLocalChatTurnRecord({
      conversationId: sessionId,
      role: 'assistant',
      turnTxnId,
      turnId,
      beatCount: 1,
    });
    assistantTurnRecordCreated = true;

    const firstBeatIntent = resolveFirstBeatIntent(turnMode);
    const firstBeatMessage: ChatMessage = {
      id: firstBeatMessageId,
      role: 'assistant',
      kind: 'text',
      content: normalizeBeatText(firstBeatResult.text),
      timestamp: new Date(),
      latencyMs: firstBeatResult.latencyMs,
      meta: {
        turnId,
        beatId: firstBeatMessageId,
        beatIndex: 0,
        beatCount: 1,
        beatModality: 'text',
        pauseMs: 0,
        relationMove: turnMode,
        sceneMove: turnMode,
        turnMode,
        voiceConversationMode: effectiveVoiceConversationMode,
        channelDecision: 'text',
        intent: firstBeatIntent,
        segmentId: firstBeatMessageId,
        segmentIndex: 1,
        segmentCount: 1,
      },
    };
    await commitAssistantMessage({
      sessionId,
      targetId: selectedTarget.id,
      viewerId: context.viewerId,
      assistantTurnId: turnId,
      messageId: firstBeatMessageId,
      message: firstBeatMessage,
      setMessages: chatContext.setMessages,
      setSessions: chatContext.setSessions,
    });
    firstBeatCommitted = true;
    input.setSendPhase('planning-tail');

    const perceptionState = await perceptionStatePromise;
    if (!perceptionState.ok) throw perceptionState.error;
    const perception = perceptionState.perception;
    const prepared = perceptionState.prepared;
    ensureNotAborted(input.abortSignal);

    turnMode = perception.turnMode;
    if (perception.relevantMemoryIds.length > 0 && prepared.contextPacket.relationMemorySlots) {
      const relevantSet = new Set(perception.relevantMemoryIds);
      prepared.contextPacket.relationMemorySlots = prepared.contextPacket.relationMemorySlots
        .filter((slot) => relevantSet.has(slot.id));
    }
    const activeDirective = perception.conversationDirective
      || fastPerception.conversationDirective
      || prepared.contextPacket.interactionSnapshot?.conversationDirective
      || null;
    prepared.contextPacket.perceptionOverlay = {
      refinedTurnMode: turnMode,
      emotionalState: perception.emotionalState?.detected || '',
      emotionalCause: perception.emotionalState?.cause || '',
      suggestedApproach: perception.emotionalState?.suggestedApproach || '',
      directive: activeDirective || '',
      intimacyCeiling: perception.intimacyCeiling,
    };
    applyResolvedContentBoundaryHint({ contextPacket: prepared.contextPacket, policy: resolvedExperiencePolicy });
    prepared.contextPacket.turnMode = turnMode;
    prepared.contextPacket.pacingPlan = derivePacingPlan({
      text,
      interactionProfile: prepared.contextPacket.target.interactionProfile,
      allowMultiReply: resolvedExperiencePolicy.deliveryPolicy.allowMultiReply,
      turnMode,
      emotionalHint: perception.emotionalState?.detected,
      suggestedApproach: perception.emotionalState?.suggestedApproach,
      momentum: prepared.contextPacket.interactionSnapshot?.conversationMomentum,
    });
    const recompiledResult = compileLocalChatPrompt({
      contextPacket: prepared.contextPacket,
      profile: 'full-turn',
    });
    prepared.invokeInput.prompt = recompiledResult.prompt;

    const recentBeatTexts = prepared.contextPacket.recentTurns
      .filter((turn) => turn.role === 'assistant')
      .slice(-3)
      .flatMap((turn) => turn.lines)
      .filter(Boolean);
    const plan = await composeInteractionTurnPlan({
      aiClient: context.aiClient,
      invokeInput: prepared.invokeInput,
      contextPacket: prepared.contextPacket,
      userText: text,
      turnId,
      turnMode,
      deliveryStyle: resolvedExperiencePolicy.deliveryPolicy.style,
      emotionalState: perception.emotionalState?.detected || '',
      directive: activeDirective || '',
      intimacyCeiling: perception.intimacyCeiling,
      recentBeatTexts: [...recentBeatTexts, firstBeatMessage.content],
      sealedFirstBeatText: firstBeatMessage.content,
    });
    ensureNotAborted(input.abortSignal);

    const orchestratedTailBeats = orchestrateBeatModalities({
      beats: plan.beats,
      turnMode,
      interactionProfile: prepared.contextPacket.target.interactionProfile,
      snapshot: prepared.contextPacket.interactionSnapshot || null,
      policy: resolvedExperiencePolicy,
    }).map((beat) => ({ ...beat, beatCount: 1 + plan.beats.length }));
    const deliveries = buildAssistantDeliveries({
      beats: orchestratedTailBeats,
      planId: plan.planId,
      turnMode,
      voiceConversationMode: effectiveVoiceConversationMode,
    });

    const latencyMs = firstBeatResult.latencyMs;
    const nsfwPolicy = resolvedExperiencePolicy.mediaPolicy.nsfwPolicy;
    const mediaRouteReady = {
      image: isMediaRouteReady({ kind: 'image', settings: context.defaultSettings }),
      video: isMediaRouteReady({ kind: 'video', settings: context.defaultSettings }),
    };
    const plannedBeatCount = 1 + deliveries.length;
    const firstMediaBeat = deliveries.find((d) => d.kind === 'image' || d.kind === 'video')?.beat || null;
    const firstMediaIntent = firstMediaBeat ? toMarkerOverrideIntent({ beat: firstMediaBeat, turnTxnId }) : null;
    assertExplicitMediaAssetRequest({
      turnMode,
      markerOverrideIntent: firstMediaIntent,
    });
    const effectiveFirstMediaIntent = firstMediaIntent;

    const promptTrace = buildPromptTrace({
      compiledPrompt: recompiledResult,
      contextPacket: prepared.contextPacket,
      routeSnapshot: context.routeSnapshot,
      routeBinding: null,
      chatRouteOptions: null,
      planner: 'stream',
      planSegments: plannedBeatCount,
      voiceSegments: deliveries.filter((d) => d.kind === 'voice').length,
      textSegments: 1 + deliveries.filter((d) => d.kind === 'text').length,
      schedulerTotalDelayMs: deliveries.reduce((sum, d) => sum + (Number(d.delayMs) || 0), 0),
      streamDeltaCount: firstBeatResult.streamDeltaCount,
      streamDurationMs: firstBeatResult.streamDurationMs,
      segmentParseMode: 'single-message',
      nsfwPolicy,
      plannerUsed: effectiveFirstMediaIntent !== null,
      plannerKind: effectiveFirstMediaIntent?.type || 'none',
      plannerTrigger: effectiveFirstMediaIntent ? 'marker-override' : 'none',
      plannerConfidence: effectiveFirstMediaIntent?.plannerConfidence ?? null,
      plannerBlockedReason: null,
      imageReady: mediaRouteReady.image,
      videoReady: mediaRouteReady.video,
      imageDependencyStatus: mediaRouteReady.image ? 'ready' : 'unknown',
      videoDependencyStatus: mediaRouteReady.video ? 'ready' : 'unknown',
      mediaDecisionSource: effectiveFirstMediaIntent ? 'planner' : 'none',
      mediaDecisionKind: effectiveFirstMediaIntent?.type || 'none',
      mediaExecutionStatus: 'none',
      mediaExecutionRouteSource: null,
      mediaExecutionRouteModel: null,
      mediaExecutionReason: null,
    });
    promptTrace.turnMode = turnMode;
    promptTrace.interactionProfile = prepared.contextPacket.target.interactionProfile;
    promptTrace.voiceConversationMode = effectiveVoiceConversationMode;
    const turnAudit = buildTurnAudit({ selectedTarget, latencyMs });
    chatContext.setLatestPromptTrace(promptTrace);
    chatContext.setLatestTurnAudit(turnAudit);

    const assistantText = [
      firstBeatMessage.content,
      ...deliveries.map((d) => normalizeBeatText(d.content)).filter(Boolean),
    ].join('\n\n');
    let latestPromptTrace = { ...promptTrace };

    // Media decision
    const rawMediaDecision = await decideMediaExecution({
      aiClient: context.aiClient,
      turnTxnId,
      defaultSettings: context.defaultSettings,
      resolvedPolicy: resolvedExperiencePolicy,
      userText: text,
      assistantText,
      target: selectedTarget,
      worldId: selectedTarget.worldId || null,
      messages: [
        ...chatContext.messages.filter((m) => m.id !== userMessage.id && m.id !== firstBeatMessage.id),
        userMessage,
        firstBeatMessage,
      ],
      promptTrace: latestPromptTrace,
      nsfwPolicy,
      routeSourceHint: context.routeSnapshot?.source === 'cloud' ? 'cloud' : 'local',
      markerOverrideIntent: effectiveFirstMediaIntent,
    });
    latestPromptTrace = { ...latestPromptTrace, ...rawMediaDecision.promptTracePatch };

    let mediaDecision: MediaExecutionDecision = rawMediaDecision;
    let mediaDeliveryId: string | null = null;
    if (rawMediaDecision.kind !== 'none') {
      let mediaDelivery = deliveries.find((d) => d.kind === 'image' || d.kind === 'video')
        || deliveries.find((d) => d.kind === 'text')
        || null;
      if (!mediaDelivery && deliveries.length === 0) {
        mediaDelivery = createStandaloneMediaDelivery({
          decision: rawMediaDecision,
          turnId,
          turnMode,
          planId: plan.planId,
          voiceConversationMode: effectiveVoiceConversationMode,
          beatIndex: 1,
        });
        deliveries.push(mediaDelivery);
        orchestratedTailBeats.push(mediaDelivery.beat);
      }
      if (mediaDelivery) {
        mediaDeliveryId = mediaDelivery.id;
        const boundMediaDecision = bindMediaDecisionToDelivery(rawMediaDecision, mediaDelivery.id);
        mediaDecision = boundMediaDecision;
        mediaDelivery.kind = boundMediaDecision.intent.type;
        mediaDelivery.meta = {
          ...(mediaDelivery.meta || {}),
          mediaType: boundMediaDecision.intent.type,
          mediaPrompt: boundMediaDecision.intent.prompt,
          mediaPlannerTrigger: boundMediaDecision.intent.plannerTrigger,
          mediaIntentSource: boundMediaDecision.intent.source,
        };
        mediaDelivery.beat = {
          ...mediaDelivery.beat,
          modality: boundMediaDecision.intent.type,
          intent: 'media',
          assetRequest: {
            kind: boundMediaDecision.intent.type,
            prompt: boundMediaDecision.intent.prompt,
            confidence: boundMediaDecision.intent.plannerConfidence ?? 0.65,
            nsfwIntent: boundMediaDecision.intent.plannerSuggestsNsfw ? 'suggested' : 'none',
          },
        };
      }
    }

    const totalBeatCount = 1 + deliveries.length;
    deliveries.forEach((d) => {
      d.beat = { ...d.beat, beatCount: totalBeatCount };
      d.meta = { ...(d.meta || {}), beatCount: totalBeatCount, segmentCount: totalBeatCount };
    });
    latestPromptTrace = {
      ...latestPromptTrace,
      planSegments: totalBeatCount,
      voiceSegments: deliveries.filter((d) => d.kind === 'voice').length,
      textSegments: 1 + deliveries.filter((d) => d.kind === 'text').length,
      schedulerTotalDelayMs: deliveries.reduce((sum, d) => sum + (Number(d.delayMs) || 0), 0),
    };
    chatContext.setLatestPromptTrace(latestPromptTrace);

    const finalizedFirstBeatMessage: ChatMessage = {
      ...firstBeatMessage,
      meta: {
        ...(firstBeatMessage.meta || {}),
        relationMove: turnMode,
        sceneMove: turnMode,
        turnMode,
        voiceConversationMode: effectiveVoiceConversationMode,
        intent: resolveFirstBeatIntent(turnMode),
        interactionPlanId: plan.planId,
        planId: plan.planId,
        beatCount: totalBeatCount,
        segmentCount: totalBeatCount,
      },
    };
    await commitAssistantMessage({
      sessionId,
      targetId: selectedTarget.id,
      viewerId: context.viewerId,
      assistantTurnId: turnId,
      messageId: firstBeatMessageId,
      message: finalizedFirstBeatMessage,
      setMessages: chatContext.setMessages,
      setSessions: chatContext.setSessions,
      promptTrace: latestPromptTrace,
      turnAudit,
    });

    const deliveredBeats: OrchestratedBeat[] = [
      {
        beatId: firstBeatMessageId,
        turnId,
        beatIndex: 0,
        beatCount: totalBeatCount,
        intent: firstBeatIntent,
        relationMove: turnMode,
        sceneMove: turnMode,
        modality: 'text',
        text: finalizedFirstBeatMessage.content,
        pauseMs: 0,
        cancellationScope: 'turn',
      },
      ...orchestratedTailBeats.map((beat) => ({ ...beat, beatCount: totalBeatCount })),
    ];
    const deliveredBeatIds = new Set<string>([firstBeatMessageId]);

    if (deliveries.length === 0) {
      await persistLocalChatInteractionArtifacts({
        sessionId,
        targetId: selectedTarget.id,
        viewerId: context.viewerId,
        assistantTurnId: turnId,
        deliveredBeats,
        aiClient: context.aiClient,
        conversationDirective: activeDirective,
        userText: text,
      });
      logTurnSendDone({
        flowId, target: selectedTarget, latencyMs, turnTxnId,
        planId: plan.planId, followupSent: false, segmentCount: totalBeatCount,
        textSegments: 1, voiceSegments: 0, schedulerTotalDelayMs: 0,
        streamDeltaCount: firstBeatResult.streamDeltaCount,
        streamDurationMs: firstBeatResult.streamDurationMs,
        segmentParseMode: 'single-message',
      });
      input.setSendPhase('idle');
      return;
    }

    input.setSendPhase('delivering-tail');
    const schedule = await scheduleAssistantTurnDeliveries({
      sessionId,
      targetId: selectedTarget.id,
      viewerId: context.viewerId,
      turnTxnId,
      assistantTurnId: turnId,
      assistantBeatCount: totalBeatCount,
      deliveries: deliveries.map((delivery) => ({
        id: delivery.id,
        delayMs: delivery.delayMs,
        run: async ({ assistantTurnId }) => {
          if (delivery.kind === 'text' || delivery.kind === 'voice') {
            const message: ChatMessage = {
              id: delivery.id,
              role: 'assistant',
              kind: delivery.kind,
              content: delivery.content,
              timestamp: new Date(),
              meta: { ...(delivery.meta || {}), scheduledDelayMs: delivery.delayMs },
            };
            await commitAssistantMessage({
              sessionId, targetId: selectedTarget.id, viewerId: context.viewerId,
              assistantTurnId, messageId: message.id, message,
              setMessages: chatContext.setMessages, setSessions: chatContext.setSessions,
            });
            deliveredBeatIds.add(delivery.beat.beatId);
            return;
          }
          const decision = mediaDeliveryId === delivery.id ? mediaDecision : null;
          if (!decision || decision.kind === 'none') {
            const textOnlyMessage: ChatMessage = {
              id: delivery.id,
              role: 'assistant',
              kind: 'text',
              content: delivery.content,
              timestamp: new Date(),
              meta: { ...(delivery.meta || {}), scheduledDelayMs: delivery.delayMs },
            };
            await commitAssistantMessage({
              sessionId, targetId: selectedTarget.id, viewerId: context.viewerId,
              assistantTurnId, messageId: textOnlyMessage.id, message: textOnlyMessage,
              setMessages: chatContext.setMessages, setSessions: chatContext.setSessions,
            });
            deliveredBeatIds.add(delivery.beat.beatId);
            return;
          }
          const executionTracePatch = await executeMediaDecision({
            decision,
            aiClient: context.aiClient,
            defaultSettings: context.defaultSettings,
            nsfwPolicy,
            sessionId,
            target: selectedTarget,
            targetId: selectedTarget.id,
            viewerId: context.viewerId,
            assistantTurnId,
            setMessages: chatContext.setMessages,
            setSessions: chatContext.setSessions,
            promptTrace: null,
            turnAudit: null,
            messageMeta: delivery.meta,
            sendContextKey,
            getCurrentContextKey: input.getCurrentContextKey,
          });
          if (executionTracePatch) {
            latestPromptTrace = { ...latestPromptTrace, ...executionTracePatch };
            chatContext.setLatestPromptTrace(latestPromptTrace);
          }
          deliveredBeatIds.add(delivery.beat.beatId);
        },
      })),
      setSessions: chatContext.setSessions,
      skipCreateAssistantTurnRecord: true,
      onScheduleCancelled: (scheduleCancelled) => {
        const cancelledAudit = createCancelledAudit({
          reason: scheduleCancelled.reason,
          targetId: selectedTarget.id,
          worldId: selectedTarget.worldId || null,
          latencyMs,
        });
        chatContext.setLatestTurnAudit(cancelledAudit);
        logTurnScheduleCancelled({
          flowId, target: selectedTarget, turnTxnId: scheduleCancelled.turnTxnId,
          planId: plan.planId, segmentCount: totalBeatCount,
          textSegments: 1 + deliveries.filter((d) => d.kind === 'text').length,
          voiceSegments: deliveries.filter((d) => d.kind === 'voice').length,
          schedulerTotalDelayMs: deliveries.reduce((sum, d) => sum + d.delayMs, 0),
          cancelReason: scheduleCancelled.reason, deliveredCount: scheduleCancelled.deliveredCount,
          pendingCount: scheduleCancelled.pendingCount,
        });
      },
    });
    input.registerSchedule({
      handle: schedule,
      context: buildLocalChatTurnContextSnapshot({ targetId: selectedTarget.id, sessionId }),
    });
    handedOffToSchedule = true;

    void schedule.done
      .then(async () => {
        await persistLocalChatInteractionArtifacts({
          sessionId,
          targetId: selectedTarget.id,
          viewerId: context.viewerId,
          assistantTurnId: schedule.assistantTurnId,
          deliveredBeats: deliveredBeats.filter((beat) => deliveredBeatIds.has(beat.beatId)),
          aiClient: context.aiClient,
          conversationDirective: activeDirective,
          userText: text,
        });
      })
      .catch((scheduleError) => {
        chatContext.setStatusBanner({
          kind: 'warning',
          message: scheduleError instanceof Error ? scheduleError.message : String(scheduleError || ''),
        });
      })
      .finally(() => {
        input.clearScheduleByTxn(turnTxnId);
        input.setSendPhase('idle');
      });

    logTurnSendDone({
      flowId, target: selectedTarget, latencyMs, turnTxnId,
      planId: plan.planId, followupSent: deliveries.length > 0,
      segmentCount: totalBeatCount,
      textSegments: 1 + deliveries.filter((d) => d.kind === 'text').length,
      voiceSegments: deliveries.filter((d) => d.kind === 'voice').length,
      schedulerTotalDelayMs: deliveries.reduce((sum, d) => sum + d.delayMs, 0),
      streamDeltaCount: firstBeatResult.streamDeltaCount,
      streamDurationMs: firstBeatResult.streamDurationMs,
      segmentParseMode: 'single-message',
    });
  } catch (error) {
    if (isAbortedError(error)) {
      if (!firstBeatCommitted) {
        chatContext.setMessages((prev) => prev.filter((m) => m.id !== firstBeatMessageId));
      }
      return;
    }
    const latencyMs = Math.round(performance.now() - startedAt);
    const errorPayload = buildErrorTurnPayload({ selectedTarget, error, latencyMs });
    chatContext.setLatestPromptTrace(null);
    chatContext.setLatestTurnAudit(errorPayload.turnAudit);
    chatContext.setMessages((prev) => prev.filter((m) => m.id !== firstBeatMessageId));
    if (hasWorkingSession && !userTurnPersisted) {
      await appendTurnsToSession(sessionId, [createSessionTurn({ message: userMessage })]);
      chatContext.setSessions(await listLocalChatSessions(selectedTarget.id, context.viewerId));
    }
    chatContext.setStatusBanner({ kind: 'error', message: errorPayload.message });
    logTurnSendFailed(flowId, errorPayload.message);
  } finally {
    if (!handedOffToSchedule) {
      input.setSendPhase('idle');
    }
  }
}

/** Relay-specific alias used by ipc-handlers.ts */
export const runRelayChatTurnSend = runLocalChatTurnSend;

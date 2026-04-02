import type {
  ChatMessage,
  LocalChatTurnMode,
  MediaExecutionDecision,
} from './types.js';
import {
  commitAssistantMessage,
  scheduleAssistantTurnDeliveries,
  type TurnDeliveryScheduleHandle,
} from './session-persist.js';
import { logTurnScheduleCancelled, logTurnSendDone } from './logging.js';
import { executeMediaDecision } from '../media/media-execution-pipeline.js';
import { persistLocalChatInteractionArtifacts } from './interaction-artifact-persistence.js';
import { buildLocalChatTurnContextSnapshot } from './context-key.js';
import type { MainProcessChatContext } from './main-process-context.js';
import type { OrchestratedBeat } from './send-flow-helpers.js';
import { createCancelledAudit } from './send-flow-helpers.js';
import type { LocalChatTurnSendPhase } from './types.js';

export type DeliveryEntry = {
  id: string;
  kind: string;
  content: string;
  delayMs: number;
  meta: Record<string, unknown>;
  beat: OrchestratedBeat;
};

export type ScheduleDeliveryInput = {
  sessionId: string;
  targetId: string;
  viewerId: string;
  turnTxnId: string;
  turnId: string;
  totalBeatCount: number;
  deliveries: DeliveryEntry[];
  mediaDecision: MediaExecutionDecision;
  mediaDeliveryId: string | null;
  nsfwPolicy: string;
  sendContextKey: string;
  deliveredBeats: OrchestratedBeat[];
  orchestratedTailBeats: OrchestratedBeat[];
  firstBeatResult: { latencyMs: number; streamDeltaCount: number; streamDurationMs: number };
  flowId: string;
  turnMode: LocalChatTurnMode;
  planId: string;
  activeDirective: string | null;
  latestPromptTrace: Record<string, unknown>;
  turnAudit: Record<string, unknown>;
  chatContext: MainProcessChatContext;
  selectedTarget: { id: string; worldId?: string | null; [key: string]: unknown };
  context: { aiClient: unknown; defaultSettings: Record<string, unknown>; viewerId: string; routeSnapshot?: Record<string, unknown> | null };
  input: {
    abortSignal?: AbortSignal;
    setSendPhase: (next: LocalChatTurnSendPhase, turnTxnId?: string) => void;
    getCurrentContextKey: () => string;
    registerSchedule: (input: {
      handle: TurnDeliveryScheduleHandle;
      context: ReturnType<typeof buildLocalChatTurnContextSnapshot>;
    }) => void;
    clearScheduleByTxn: (turnTxnId: string) => void;
  };
};

export async function scheduleAndDeliverTailBeats(params: ScheduleDeliveryInput): Promise<void> {
  const {
    sessionId,
    targetId,
    viewerId,
    turnTxnId,
    turnId,
    totalBeatCount,
    deliveries,
    mediaDecision,
    mediaDeliveryId,
    nsfwPolicy,
    sendContextKey,
    deliveredBeats,
    firstBeatResult,
    flowId,
    turnMode,
    planId,
    activeDirective,
    chatContext,
    selectedTarget,
    context,
    input,
  } = params;
  let latestPromptTrace = { ...params.latestPromptTrace };
  const deliveredBeatIds = new Set<string>(deliveredBeats.filter((_, i) => i === 0).map((b) => b.beatId));

  input.setSendPhase('delivering-tail', turnTxnId);
  const schedule = await scheduleAssistantTurnDeliveries({
    sessionId,
    targetId,
    viewerId,
    turnTxnId,
    assistantTurnId: turnId,
    assistantBeatCount: totalBeatCount,
    deliveries: deliveries.map((delivery) => ({
      id: delivery.id,
      delayMs: delivery.delayMs,
      run: async ({ assistantTurnId }: { assistantTurnId: string }) => {
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
            sessionId, targetId, viewerId,
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
            sessionId, targetId, viewerId,
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
          targetId,
          viewerId,
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
        targetId,
        worldId: selectedTarget.worldId || null,
        latencyMs: firstBeatResult.latencyMs,
      });
      chatContext.setLatestTurnAudit(cancelledAudit);
      logTurnScheduleCancelled({
        flowId, target: selectedTarget, turnTxnId: scheduleCancelled.turnTxnId,
        planId, segmentCount: totalBeatCount,
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
    context: buildLocalChatTurnContextSnapshot({ targetId, sessionId }),
  });

  void schedule.done
    .then(async () => {
      await persistLocalChatInteractionArtifacts({
        sessionId,
        targetId,
        viewerId,
        assistantTurnId: schedule.assistantTurnId,
        deliveredBeats: deliveredBeats.filter((beat) => deliveredBeatIds.has(beat.beatId)),
        aiClient: context.aiClient,
        conversationDirective: activeDirective,
        userText: '',
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
      input.setSendPhase('idle', turnTxnId);
    });

  logTurnSendDone({
    flowId, target: selectedTarget, latencyMs: firstBeatResult.latencyMs, turnTxnId,
    planId, followupSent: deliveries.length > 0,
    segmentCount: totalBeatCount,
    textSegments: 1 + deliveries.filter((d) => d.kind === 'text').length,
    voiceSegments: deliveries.filter((d) => d.kind === 'voice').length,
    schedulerTotalDelayMs: deliveries.reduce((sum, d) => sum + d.delayMs, 0),
    streamDeltaCount: firstBeatResult.streamDeltaCount,
    streamDurationMs: firstBeatResult.streamDurationMs,
    segmentParseMode: 'single-message',
  });
}

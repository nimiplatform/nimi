// Relay proactive engine — adapted from local-chat proactive/engine.ts
// Removed: mod SDK imports (createRendererFlowId, data layer, state layer, services)
// Adapted: uses relay chat-pipeline modules, session-store, Electron main process context
// Simplified: no IPC to renderer (proactive runs silently in main; renderer picks up on next load)

import { ReasonCode } from '@nimiplatform/sdk/types';
import { createLocalChatFlowId } from '../chat-pipeline/logging.js';
import {
  createLocalChatTurnRecord,
  listAllLocalChatSessions,
} from '../session-store/index.js';
import {
  evaluateLocalChatProactivePolicy,
  recordLocalChatProactiveContact,
  resolveLocalChatWakeStrategy,
} from './policy.js';
import type {
  LocalChatProactiveAuditEvent,
  LocalChatProactiveHeartbeatInput,
} from './types.js';
import { buildFirstBeatRequestInput, buildFullTurnRequestInput } from '../chat-pipeline/request-builder.js';
import { buildPromptTrace, buildTurnAudit } from '../chat-pipeline/diagnostics.js';
import { composeInteractionTurnPlan } from '../chat-pipeline/turn-composer.js';
import { runFirstBeatReactor } from '../chat-pipeline/first-beat-reactor.js';
import { orchestrateBeatModalities } from '../chat-pipeline/modality-orchestrator.js';
import {
  applyResolvedContentBoundaryHint,
  compileResolvedExperiencePolicy,
} from '../chat-pipeline/resolved-experience-policy.js';
import { deriveInteractionProfile } from '../chat-pipeline/interaction-profile.js';
import { derivePacingPlan } from '../chat-pipeline/context-assembler.js';
import { resolveTurnMode } from '../chat-pipeline/turn-mode-resolver.js';
import { persistLocalChatInteractionArtifacts } from '../chat-pipeline/interaction-artifact-persistence.js';
import { compileLocalChatPrompt } from '../prompt/compiler.js';
import { createUlid } from '../chat-pipeline/ulid.js';
import {
  commitAssistantMessage,
  scheduleAssistantTurnDeliveries,
} from '../chat-pipeline/session-persist.js';
import {
  normalizeBeatText,
  buildAssistantDeliveries,
} from '../chat-pipeline/send-flow-helpers.js';
import type { ChatMessage } from '../chat-pipeline/types.js';
import type { LocalChatDefaultSettings } from '../settings/types.js';
import {
  getInteractionSnapshot,
  getRelationMemorySlots,
  getRecallIndex,
  listLocalChatExactHistoryTurns,
} from '../session-store/index.js';

type OrchestratedBeat = ReturnType<typeof orchestrateBeatModalities>[number];

function toErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '');
}

function parseLastUserIdleMs(input: {
  nowMs: number;
  sessionUpdatedAt: string;
  turns: Array<{ role: string; timestamp?: string }>;
}): number | null {
  const turns = input.turns;
  if (!Array.isArray(turns) || turns.length === 0) return null;
  const lastTurn = turns[turns.length - 1];
  if (!lastTurn || lastTurn.role !== 'user') return null;
  const lastUserAtMs = Date.parse(String(lastTurn.timestamp || input.sessionUpdatedAt || ''));
  if (!Number.isFinite(lastUserAtMs)) return null;
  return input.nowMs - lastUserAtMs;
}

function emitAudit(
  sink: (event: LocalChatProactiveAuditEvent) => void,
  event: LocalChatProactiveAuditEvent,
): void {
  try {
    sink(event);
  } catch {
    // Audit sink failure must not stop proactive flow.
  }
}

function defaultAuditSink(event: LocalChatProactiveAuditEvent): void {
  const level = event.level || 'info';
  const method = level === 'warn' ? console.warn : level === 'error' ? console.error : console.info;
  method(`[relay:proactive] ${event.source}`, {
    targetId: event.targetId,
    sessionId: event.sessionId,
    reasonCode: event.reasonCode,
    actionHint: event.actionHint,
    ...(event.details || {}),
  });
}

export async function runLocalChatProactiveHeartbeatCycle(
  input: LocalChatProactiveHeartbeatInput & { settings: LocalChatDefaultSettings },
): Promise<void> {
  const flowId = createLocalChatFlowId('relay-proactive-heartbeat');
  const nowMsCandidate = input.nowMs ? Number(input.nowMs()) : Date.now();
  const nowMs = Number.isFinite(nowMsCandidate) ? nowMsCandidate : Date.now();
  const auditSink = input.onAuditEvent || defaultAuditSink;
  const settings = input.settings;

  const targets = input.targets;
  if (targets.length === 0) return;

  const targetsById = new Map(targets.map((target) => [target.id, target]));
  const sessions = (await listAllLocalChatSessions(input.viewerId))
    .filter((session) => targetsById.has(session.targetId));

  for (const session of sessions) {
    const idleMs = parseLastUserIdleMs({
      nowMs,
      sessionUpdatedAt: String(session.updatedAt || ''),
      turns: Array.isArray(session.turns) ? session.turns : [],
    });
    if (!Number.isFinite(idleMs)) continue;
    const resolvedIdleMs = Number(idleMs);

    const target = targetsById.get(session.targetId);
    if (!target) continue;

    const wakeStrategy = resolveLocalChatWakeStrategy(target);
    const policy = await evaluateLocalChatProactivePolicy({
      allowProactiveContact: settings.allowProactiveContact,
      wakeStrategy,
      targetId: target.id,
      sessionId: session.id,
      idleMs: resolvedIdleMs,
      nowMs,
    });

    emitAudit(auditSink, {
      flowId,
      source: 'runLocalChatProactiveHeartbeatCycle',
      targetId: target.id,
      sessionId: session.id,
      reasonCode: policy.reasonCode,
      actionHint: policy.actionHint,
      level: policy.allowed ? 'debug' : 'info',
      details: {
        idleMs: resolvedIdleMs,
        wakeStrategy: wakeStrategy || null,
      },
    });

    if (!policy.allowed) continue;

    try {
      const interactionProfile = deriveInteractionProfile(target);
      const voiceConversationMode = settings.enableVoice
        ? settings.voiceConversationMode
        : 'off';
      const turnMode = resolveTurnMode({
        userText: '',
        interactionProfile,
        proactive: true,
      });

      const recentTurns = await listLocalChatExactHistoryTurns(session.id, session.viewerId);
      const interactionSnapshot = await getInteractionSnapshot(session.id);
      const relationMemorySlots = await getRelationMemorySlots({ targetId: target.id, viewerId: session.viewerId });
      const recallIndex = await getRecallIndex(session.id);

      const prepared = buildFullTurnRequestInput({
        text: '',
        viewerId: session.viewerId,
        viewerDisplayName: 'User',
        selectedTarget: target,
        selectedSessionId: session.id,
        runtimeMode: 'STORY',
        routeSnapshot: null,
        allowMultiReply: settings.deliveryStyle === 'natural',
        turnMode,
        voiceConversationMode,
        recentTurns,
        interactionSnapshot,
        relationMemorySlots,
        recallIndex,
        platformWarmStart: null,
        compilePrompt: (compileInput) => compileLocalChatPrompt({
          contextPacket: compileInput.contextPacket,
          profile: compileInput.profile,
        }),
      });
      const resolvedExperiencePolicy = compileResolvedExperiencePolicy({
        interactionProfile: prepared.contextPacket.target.interactionProfile,
        interactionSnapshot: prepared.contextPacket.interactionSnapshot || null,
        settings,
        requestedVoiceConversationMode: voiceConversationMode,
        routeSource: 'cloud',
      });
      applyResolvedContentBoundaryHint({
        contextPacket: prepared.contextPacket,
        policy: resolvedExperiencePolicy,
      });
      const effectiveVoiceConversationMode = resolvedExperiencePolicy.voicePolicy.conversationMode;
      const proactiveDirective = 'Naturally reach out to the user, like you just thought of them. Do not explain the reason.';
      prepared.contextPacket.pacingPlan = derivePacingPlan({
        text: proactiveDirective,
        interactionProfile: prepared.contextPacket.target.interactionProfile,
        allowMultiReply: resolvedExperiencePolicy.deliveryPolicy.allowMultiReply,
        turnMode,
        momentum: prepared.contextPacket.interactionSnapshot?.conversationMomentum,
      });

      const turnId = `turn_${createUlid()}`;
      const firstBeatId = `beat_${createUlid()}`;
      const firstBeatCompiledPrompt = compileLocalChatPrompt({
        contextPacket: prepared.contextPacket,
        profile: 'first-beat',
      });
      const firstBeatResult = await runFirstBeatReactor({
        aiClient: input.aiClient,
        invokeInput: {
          ...prepared.invokeInput,
          prompt: firstBeatCompiledPrompt.prompt,
        },
        contextPacket: prepared.contextPacket,
        userText: proactiveDirective,
        transientMessageId: firstBeatId,
        debugContext: {
          entry: 'proactive',
          turnTxnId: turnId,
          targetId: target.id,
          sessionId: session.id,
        },
      });
      const firstBeatText = normalizeBeatText(firstBeatResult.text);
      if (!firstBeatText) {
        throw new Error('LOCAL_CHAT_FIRST_BEAT_EMPTY');
      }
      await createLocalChatTurnRecord({
        conversationId: session.id,
        role: 'assistant',
        turnTxnId: turnId,
        turnId,
        beatCount: 1,
      });
      const firstBeatIntent: OrchestratedBeat['intent'] = 'checkin';
      const firstBeatMessage: ChatMessage = {
        id: firstBeatId,
        role: 'assistant',
        kind: 'text',
        content: firstBeatText,
        timestamp: new Date(nowMs),
        latencyMs: firstBeatResult.latencyMs,
        meta: {
          turnId,
          beatId: firstBeatId,
          beatIndex: 0,
          beatCount: 1,
          beatModality: 'text',
          pauseMs: 0,
          relationMove: 'checkin',
          sceneMove: 'idle-reachout',
          turnMode,
          voiceConversationMode: effectiveVoiceConversationMode,
          channelDecision: 'text',
          intent: firstBeatIntent,
          segmentId: firstBeatId,
          segmentIndex: 1,
          segmentCount: 1,
        },
      };

      const recompiledPrompt = compileLocalChatPrompt({
        contextPacket: prepared.contextPacket,
        profile: 'full-turn',
      });
      prepared.invokeInput.prompt = recompiledPrompt.prompt;

      const plan = await composeInteractionTurnPlan({
        aiClient: input.aiClient,
        invokeInput: prepared.invokeInput,
        contextPacket: prepared.contextPacket,
        userText: proactiveDirective,
        turnId,
        turnMode,
        deliveryStyle: resolvedExperiencePolicy.deliveryPolicy.style,
        sealedFirstBeatText: firstBeatText,
      });
      const orchestratedBeats = orchestrateBeatModalities({
        beats: plan.beats,
        turnMode,
        interactionProfile: prepared.contextPacket.target.interactionProfile,
        snapshot: prepared.contextPacket.interactionSnapshot || null,
        policy: resolvedExperiencePolicy,
      });
      const deliveries = buildAssistantDeliveries({
        beats: orchestratedBeats,
        planId: plan.planId,
        turnMode,
        voiceConversationMode: effectiveVoiceConversationMode,
      });
      const totalBeatCount = 1 + deliveries.length;

      const finalizedFirstBeatMessage: ChatMessage = {
        ...firstBeatMessage,
        meta: {
          ...(firstBeatMessage.meta || {}),
          interactionPlanId: plan.planId,
          planId: plan.planId,
          beatCount: totalBeatCount,
          segmentCount: totalBeatCount,
        },
      };

      // No-op setMessages/setSessions — proactive runs in background
      const noopSetMessages = () => {};
      const noopSetSessions = () => {};

      await commitAssistantMessage({
        sessionId: session.id,
        targetId: target.id,
        viewerId: session.viewerId,
        assistantTurnId: turnId,
        messageId: firstBeatId,
        setMessages: noopSetMessages,
        setSessions: noopSetSessions,
        message: finalizedFirstBeatMessage,
      });

      const deliveredBeats: OrchestratedBeat[] = [
        {
          beatId: firstBeatId,
          turnId,
          beatIndex: 0,
          beatCount: totalBeatCount,
          intent: firstBeatIntent,
          relationMove: 'checkin',
          sceneMove: 'idle-reachout',
          modality: 'text',
          text: firstBeatText,
          pauseMs: 0,
          cancellationScope: 'turn',
        },
        ...orchestratedBeats.map((beat) => ({
          ...beat,
          beatCount: totalBeatCount,
        })),
      ];
      const deliveredBeatIds = new Set<string>([firstBeatId]);

      const schedule = await scheduleAssistantTurnDeliveries({
        sessionId: session.id,
        targetId: target.id,
        viewerId: session.viewerId,
        turnTxnId: turnId,
        assistantTurnId: turnId,
        assistantBeatCount: totalBeatCount,
        deliveries: deliveries.map((delivery) => ({
          id: delivery.id,
          delayMs: delivery.delayMs,
          run: async ({ assistantTurnId }) => {
            if (delivery.kind === 'text' || delivery.kind === 'voice') {
              await commitAssistantMessage({
                sessionId: session.id,
                targetId: target.id,
                viewerId: session.viewerId,
                assistantTurnId,
                messageId: delivery.id,
                setMessages: noopSetMessages,
                setSessions: noopSetSessions,
                message: {
                  id: delivery.id,
                  role: 'assistant',
                  kind: delivery.kind,
                  content: delivery.content,
                  timestamp: new Date(nowMs + delivery.delayMs),
                  meta: delivery.meta,
                },
              });
              deliveredBeatIds.add(delivery.beat.beatId);
              return;
            }
            // For media beats in proactive, fall back to text
            await commitAssistantMessage({
              sessionId: session.id,
              targetId: target.id,
              viewerId: session.viewerId,
              assistantTurnId,
              messageId: delivery.id,
              setMessages: noopSetMessages,
              setSessions: noopSetSessions,
              message: {
                id: delivery.id,
                role: 'assistant',
                kind: 'text',
                content: delivery.content,
                timestamp: new Date(nowMs + delivery.delayMs),
                meta: delivery.meta,
              },
            });
            deliveredBeatIds.add(delivery.beat.beatId);
          },
        })),
        setSessions: noopSetSessions,
        skipCreateAssistantTurnRecord: true,
      });
      await schedule.done;

      await persistLocalChatInteractionArtifacts({
        aiClient: input.aiClient,
        sessionId: session.id,
        targetId: target.id,
        viewerId: session.viewerId,
        assistantTurnId: turnId,
        deliveredBeats: deliveredBeats.filter((beat) => deliveredBeatIds.has(beat.beatId)),
      });
      await recordLocalChatProactiveContact({
        targetId: target.id,
        atMs: nowMs,
      });

      emitAudit(auditSink, {
        flowId,
        source: 'runLocalChatProactiveHeartbeatCycle',
        targetId: target.id,
        sessionId: session.id,
        reasonCode: ReasonCode.LOCAL_CHAT_PROACTIVE_ALLOWED,
        actionHint: 'contact-sent',
        level: 'info',
        details: { turnMode },
      });
      break; // One contact per cycle
    } catch (error) {
      emitAudit(auditSink, {
        flowId,
        source: 'runLocalChatProactiveHeartbeatCycle',
        targetId: target.id,
        sessionId: session.id,
        reasonCode: ReasonCode.LOCAL_CHAT_PROACTIVE_POLICY_UNAVAILABLE,
        actionHint: 'decision-generation-failed',
        level: 'warn',
        details: { error: toErrorText(error) },
      });
    }
  }
}

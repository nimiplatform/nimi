import { ReasonCode } from '../types/index.js';
import { createNimiError } from '../core/errors.js';
import {
  asRecord,
  normalizeText,
  parseCount,
  toIsoFromTimestamp,
} from './runtime-value-utils.js';
import {
  AgentPresentationEventFamily,
  type AgentPresentationEventDetail,
  AgentExecutionState,
  AgentStateEventFamily,
  HookAdmissionState,
  HookEffect,
  HookTriggerFamily,
  type AgentEvent,
  type AgentPostureProjection,
  type HookTriggerDetail,
} from './generated/runtime/v1/agent_service.js';
import { ReasonCode as RuntimeProtoReasonCode } from './generated/runtime/v1/common.js';
import { parseRuntimeAgentPresentationConsumeEvent } from './runtime-agent-presentation-parsers.js';
import type { RuntimeAgentConsumeEvent, RuntimeAgentHookAdmissionState } from './types-runtime-agent.js';
import { expectCurrentEmotion, expectLocalAgentIdentity, expectString, optionalString } from './runtime-agent-surface-parser-common.js';

type RuntimeAgentHookEventName =
  | 'runtime.agent.hook.intent_proposed'
  | 'runtime.agent.hook.pending'
  | 'runtime.agent.hook.rejected'
  | 'runtime.agent.hook.running'
  | 'runtime.agent.hook.completed'
  | 'runtime.agent.hook.failed'
  | 'runtime.agent.hook.canceled'
  | 'runtime.agent.hook.rescheduled';

function durationToMilliseconds(value: unknown): number | undefined {
  const payload = asRecord(value);
  const seconds = parseCount(payload.seconds);
  const nanos = typeof payload.nanos === 'number' ? payload.nanos : undefined;
  if (seconds === undefined && nanos === undefined) {
    return undefined;
  }
  return ((seconds ?? 0) * 1000) + Math.trunc((nanos ?? 0) / 1_000_000);
}
function parsePostureProjection(value?: AgentPostureProjection): { actionFamily: string; interruptMode: string } | undefined {
  if (!value) {
    return undefined;
  }
  const actionFamily = normalizeText(value.actionFamily);
  const interruptMode = normalizeText(value.interruptMode);
  if (!actionFamily || !interruptMode) {
    return undefined;
  }
  return {
    actionFamily,
    interruptMode,
  };
}
function parseHookTriggerDetail(value?: HookTriggerDetail): Record<string, unknown> {
  switch (value?.detail.oneofKind) {
    case 'time':
      return {
        kind: 'time',
        ...(durationToMilliseconds(value.detail.time.delay) !== undefined
          ? { delayMs: durationToMilliseconds(value.detail.time.delay) }
          : {}),
      };
    case 'eventUserIdle':
      return {
        kind: 'event_user_idle',
        ...(durationToMilliseconds(value.detail.eventUserIdle.idleFor) !== undefined
          ? { idleForMs: durationToMilliseconds(value.detail.eventUserIdle.idleFor) }
          : {}),
      };
    case 'eventChatEnded':
      return {
        kind: 'event_chat_ended',
      };
    default:
      return {};
  }
}
function parseHookTriggerFamily(value: HookTriggerFamily): 'time' | 'event' | '' {
  switch (value) {
    case HookTriggerFamily.TIME:
      return 'time';
    case HookTriggerFamily.EVENT:
      return 'event';
    default:
      return '';
  }
}
function parseHookEffect(value: HookEffect): 'follow-up-turn' | '' {
  switch (value) {
    case HookEffect.FOLLOW_UP_TURN:
      return 'follow-up-turn';
    default:
      return '';
  }
}
function parseHookAdmissionState(
  value: HookAdmissionState,
): RuntimeAgentHookEventName | '' {
  switch (value) {
    case HookAdmissionState.PROPOSED:
      return 'runtime.agent.hook.intent_proposed';
    case HookAdmissionState.PENDING:
      return 'runtime.agent.hook.pending';
    case HookAdmissionState.REJECTED:
      return 'runtime.agent.hook.rejected';
    case HookAdmissionState.RUNNING:
      return 'runtime.agent.hook.running';
    case HookAdmissionState.COMPLETED:
      return 'runtime.agent.hook.completed';
    case HookAdmissionState.FAILED:
      return 'runtime.agent.hook.failed';
    case HookAdmissionState.CANCELED:
      return 'runtime.agent.hook.canceled';
    case HookAdmissionState.RESCHEDULED:
      return 'runtime.agent.hook.rescheduled';
    default:
      return '';
  }
}
function parseHookAdmissionStateValue(value: HookAdmissionState): RuntimeAgentHookAdmissionState | '' {
  switch (value) {
    case HookAdmissionState.PROPOSED:
      return 'proposed';
    case HookAdmissionState.PENDING:
      return 'pending';
    case HookAdmissionState.REJECTED:
      return 'rejected';
    case HookAdmissionState.RUNNING:
      return 'running';
    case HookAdmissionState.COMPLETED:
      return 'completed';
    case HookAdmissionState.FAILED:
      return 'failed';
    case HookAdmissionState.CANCELED:
      return 'canceled';
    case HookAdmissionState.RESCHEDULED:
      return 'rescheduled';
    default:
      return '';
  }
}
function parseExecutionState(
  value: AgentExecutionState,
): 'idle' | 'chat_active' | 'life_pending' | 'life_running' | 'suspended' | '' {
  switch (value) {
    case AgentExecutionState.IDLE:
      return 'idle';
    case AgentExecutionState.CHAT_ACTIVE:
      return 'chat_active';
    case AgentExecutionState.LIFE_PENDING:
      return 'life_pending';
    case AgentExecutionState.LIFE_RUNNING:
      return 'life_running';
    case AgentExecutionState.SUSPENDED:
      return 'suspended';
    default:
      return '';
  }
}
function optionalRuntimeReasonCode(value: RuntimeProtoReasonCode): string | undefined {
  if (value === RuntimeProtoReasonCode.REASON_CODE_UNSPECIFIED) {
    return undefined;
  }
  const normalized = RuntimeProtoReasonCode[value];
  return typeof normalized === 'string' ? normalized : undefined;
}
function presentationMessageType(value: AgentPresentationEventFamily): string {
  switch (value) {
    case AgentPresentationEventFamily.ACTIVITY_REQUESTED:
      return 'runtime.agent.presentation.activity_requested';
    case AgentPresentationEventFamily.MOTION_REQUESTED:
      return 'runtime.agent.presentation.motion_requested';
    case AgentPresentationEventFamily.EXPRESSION_REQUESTED:
      return 'runtime.agent.presentation.expression_requested';
    case AgentPresentationEventFamily.POSE_REQUESTED:
      return 'runtime.agent.presentation.pose_requested';
    case AgentPresentationEventFamily.POSE_CLEARED:
      return 'runtime.agent.presentation.pose_cleared';
    case AgentPresentationEventFamily.LOOKAT_REQUESTED:
      return 'runtime.agent.presentation.lookat_requested';
    default:
      return '';
  }
}
function presentationExpectedDurationMs(detail: AgentPresentationEventDetail): string {
  switch (detail.family) {
    case AgentPresentationEventFamily.MOTION_REQUESTED:
      return detail.motionExpectedDurationMs;
    case AgentPresentationEventFamily.EXPRESSION_REQUESTED:
      return detail.expressionExpectedDurationMs;
    case AgentPresentationEventFamily.POSE_REQUESTED:
      return detail.poseExpectedDurationMs;
    default:
      return '';
  }
}
export function parseAgentConsumeEvent(event: AgentEvent): RuntimeAgentConsumeEvent {
  const identity = expectLocalAgentIdentity(
    event.localAgentRef,
    event.ownerUserId,
    event.realmAgentId,
    'runtime.agent.event',
  );
  switch (event.detail.oneofKind) {
    case 'state': {
      const detail = event.detail.state;
      const origin = {
        ...(optionalString(detail.conversationAnchorId) ? { conversationAnchorId: optionalString(detail.conversationAnchorId) } : {}),
        ...(optionalString(detail.originatingTurnId) ? { originatingTurnId: optionalString(detail.originatingTurnId) } : {}),
        ...(optionalString(detail.originatingStreamId) ? { originatingStreamId: optionalString(detail.originatingStreamId) } : {}),
      };
      switch (detail.family) {
        case AgentStateEventFamily.STATUS_TEXT_CHANGED:
          return {
            eventName: 'runtime.agent.state.status_text_changed',
            ...identity,
            ...origin,
            detail: {
              currentStatusText: normalizeText(detail.currentStatusText),
              ...(detail.hasPreviousStatusText && normalizeText(detail.previousStatusText)
                ? { previousStatusText: normalizeText(detail.previousStatusText) }
                : {}),
            },
          };
        case AgentStateEventFamily.EXECUTION_STATE_CHANGED: {
          const currentExecutionState = parseExecutionState(detail.currentExecutionState);
          if (!currentExecutionState) {
            break;
          }
          const previousExecutionState = parseExecutionState(detail.previousExecutionState);
          return {
            eventName: 'runtime.agent.state.execution_state_changed',
            ...identity,
            ...origin,
            detail: {
              currentExecutionState,
              ...(previousExecutionState ? { previousExecutionState } : {}),
            },
          };
        }
        case AgentStateEventFamily.EMOTION_CHANGED:
          return {
            eventName: 'runtime.agent.state.emotion_changed',
            ...identity,
            ...origin,
            detail: {
              currentEmotion: expectCurrentEmotion(detail.currentEmotion, 'current_emotion', 'runtime.agent.state.emotion_changed'),
              ...(normalizeText(detail.previousEmotion) ? { previousEmotion: normalizeText(detail.previousEmotion) } : {}),
              source: expectString(detail.emotionSource, 'source', 'runtime.agent.state.emotion_changed'),
            },
          };
        case AgentStateEventFamily.POSTURE_CHANGED: {
          const currentPosture = parsePostureProjection(detail.currentPosture);
          if (!currentPosture) {
            break;
          }
          const previousPosture = parsePostureProjection(detail.previousPosture);
          return {
            eventName: 'runtime.agent.state.posture_changed',
            ...identity,
            ...origin,
            detail: {
              currentPosture,
              ...(previousPosture ? { previousPosture } : {}),
            },
          };
        }
        default:
          break;
      }
      break;
    }
    case 'hook': {
      const detail = event.detail.hook;
      const eventName = parseHookAdmissionState(detail.family);
      const admissionState = parseHookAdmissionStateValue(detail.family);
      const triggerFamily = detail.intent ? parseHookTriggerFamily(detail.intent.triggerFamily) : '';
      const effect = detail.intent ? parseHookEffect(detail.intent.effect) : '';
      const intentId = normalizeText(detail.intent?.intentId);
      if (!eventName || !admissionState || !triggerFamily || !effect || !intentId) {
        break;
      }
      return {
        eventName,
        ...identity,
        ...(detail.intent && optionalString(detail.intent.conversationAnchorId)
          ? { conversationAnchorId: optionalString(detail.intent.conversationAnchorId) }
          : {}),
        ...(detail.intent && optionalString(detail.intent.originatingTurnId)
          ? { originatingTurnId: optionalString(detail.intent.originatingTurnId) }
          : {}),
        ...(detail.intent && optionalString(detail.intent.originatingStreamId)
          ? { originatingStreamId: optionalString(detail.intent.originatingStreamId) }
          : {}),
        detail: {
          intentId,
          triggerFamily,
          triggerDetail: parseHookTriggerDetail(detail.intent?.triggerDetail),
          effect,
          admissionState,
          ...(optionalRuntimeReasonCode(detail.reasonCode) ? { reasonCode: optionalRuntimeReasonCode(detail.reasonCode) } : {}),
          ...(normalizeText(detail.message) ? { message: normalizeText(detail.message) } : {}),
          ...(normalizeText(detail.reason) ? { reason: normalizeText(detail.reason) } : {}),
          ...(toIsoFromTimestamp(detail.observedAt) ? { observedAt: toIsoFromTimestamp(detail.observedAt) } : {}),
        },
      };
    }
    case 'presentation': {
      const detail = event.detail.presentation;
      const messageType = presentationMessageType(detail.family);
      if (!messageType) {
        break;
      }
      const payload = {
        agent_id: identity.localAgentRef,
        conversation_anchor_id: detail.conversationAnchorId,
        turn_id: detail.turnId,
        stream_id: detail.streamId,
        detail: {
          activity_name: detail.activityName,
          activity_category: detail.activityCategory,
          category: detail.activityCategory,
          activity_intensity: detail.activityIntensity,
          intensity: detail.activityIntensity,
          activity_source: detail.activitySource,
          source: detail.activitySource,
          motion_id: detail.motionId,
          priority: detail.motionPriority,
          expected_duration_ms: presentationExpectedDurationMs(detail),
          expression_id: detail.expressionId,
          pose_id: detail.poseId,
          previous_pose_id: detail.previousPoseId,
          target_kind: detail.lookatTargetKind,
          x: detail.lookatX,
          y: detail.lookatY,
          z: detail.lookatZ,
        },
      };
      const parsed = parseRuntimeAgentPresentationConsumeEvent(
        messageType,
        payload,
        identity.localAgentRef,
        expectString(detail.conversationAnchorId, 'conversation_anchor_id', messageType),
        () => {
          throw createNimiError({
            message: `${messageType} agent event timeline is not supported`,
            reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
            actionHint: 'check_runtime_agent_projection_shape',
            source: 'sdk',
          });
        },
      );
      if (parsed) {
        return parsed;
      }
      break;
    }
    default:
      break;
  }
  throw createNimiError({
    message: `unsupported runtime agent consume family: ${event.detail.oneofKind || 'unknown'}`,
    reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    actionHint: 'check_runtime_agent_projection_shape',
    source: 'sdk',
  });
}

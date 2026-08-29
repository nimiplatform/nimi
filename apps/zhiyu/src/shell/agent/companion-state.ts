import type {
  NimiLocalAppAgentHandle,
  NimiLocalAppEmbodimentSnapshot,
} from '@nimiplatform/sdk/app';
import type { ZhiyuEvidence } from '../app/evidence';
import type { ZhiyuConversationHomeStatus } from './conversation-home';
import {
  initialZhiyuCompanionEmotionProjection,
  projectZhiyuCompanionEmotion,
} from './companion-emotion';

const UNSUPPORTED_EXPLAINABILITY_FIELDS = [
  'stateConfidence',
  'whyThisState',
  'relationshipContext',
  'stateChangeHistory',
] as const;

export type ZhiyuCompanionStateStatus = ZhiyuEvidence['companion'];

export type ZhiyuCompanionStateReadInput = Readonly<{
  readonly agentHandle: NimiLocalAppAgentHandle;
  readonly conversationAnchorId: string;
}>;

export type ZhiyuCompanionStateReader = (
  input: ZhiyuCompanionStateReadInput,
) => Promise<NimiLocalAppEmbodimentSnapshot>;

export interface ZhiyuCompanionStateProbeOptions {
  readonly observedAt?: string;
  readonly readEmbodiment?: ZhiyuCompanionStateReader;
}

// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.r011
export async function probeZhiyuRuntimeCompanionState(
  conversation: ZhiyuConversationHomeStatus,
  options: ZhiyuCompanionStateProbeOptions = {},
): Promise<ZhiyuCompanionStateStatus> {
  const target = conversationTarget(conversation);
  if (!target) {
    return companionUnavailable({
      reasonCode: 'zhiyu-conversation-anchor-required',
      actionHint: 'open_runtime_conversation_anchor',
      source: conversation.source,
      message: 'Zhiyu requires the current formal Agent and exact Conversation anchor before reading companion facts.',
      agentHandle: conversation.agentHandle,
    });
  }
  if (!options.readEmbodiment) {
    return companionUnavailable({
      reasonCode: 'zhiyu-embodiment-projection-unavailable',
      actionHint: 'retry_formal_app_embodiment_projection',
      source: 'sdk',
      message: 'The common typed embodiment projection is unavailable.',
      agentHandle: target.agentHandle,
    });
  }
  try {
    return companionAvailable(
      await options.readEmbodiment(target),
      target.agentHandle,
      stringOr(options.observedAt, new Date().toISOString()),
    );
  } catch (error) {
    return normalizeCompanionStateError(error, target.agentHandle);
  }
}

function companionAvailable(
  snapshot: NimiLocalAppEmbodimentSnapshot,
  agentHandle: NimiLocalAppAgentHandle,
  observedAt: string,
): ZhiyuCompanionStateStatus {
  const emotion = projectZhiyuCompanionEmotion({
    current: initialZhiyuCompanionEmotionProjection(),
    emotion: snapshot.emotion?.name,
  });
  const projectedFields = [
    snapshot.activity ? 'activity' : '',
    snapshot.emotion ? 'emotion' : '',
    snapshot.posture ? 'posture' : '',
    snapshot.voiceTiming ? 'voiceTiming' : '',
  ].filter(Boolean);
  return {
    transport: 'electron-ipc',
    ready: true,
    state: 'projected',
    reasonCode: 'runtime-embodiment-snapshot-projected',
    actionHint: 'inspect_runtime_embodiment_projection',
    source: 'runtime',
    message: 'Common typed embodiment facts were projected for the current Conversation.',
    agentHandle,
    observedAt,
    stateUpdatedAt: timestamp(snapshot.observedAt) ?? observedAt,
    executionState: snapshot.activity?.name ?? null,
    statusText: snapshot.activity?.category ?? null,
    activityCategory: snapshot.activity?.category ?? null,
    activityIntensity: snapshot.activity?.intensity || null,
    postureActionFamily: snapshot.posture?.actionFamily ?? null,
    postureInterruptMode: snapshot.posture?.interruptMode ?? null,
    currentEmotion: emotion.currentEmotion,
    currentEmotionId: emotion.currentEmotionId,
    currentEmotionCue: emotion.currentEmotionCue,
    currentEmotionIntensity: emotion.currentEmotionIntensity,
    emotionViolation: emotion.emotionViolation,
    projectedFields,
    unsupportedExplainabilityFields: [...UNSUPPORTED_EXPLAINABILITY_FIELDS],
  };
}

function normalizeCompanionStateError(
  error: unknown,
  agentHandle: NimiLocalAppAgentHandle,
): ZhiyuCompanionStateStatus {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  return companionUnavailable({
    reasonCode: stringOr(record.reasonCode, 'zhiyu-embodiment-projection-unavailable'),
    actionHint: stringOr(record.actionHint, 'retry_formal_app_embodiment_projection'),
    source: stringOr(record.source, 'sdk'),
    message: error instanceof Error && error.message.trim()
      ? error.message.trim()
      : 'Common typed embodiment facts are unavailable.',
    agentHandle,
  });
}

function companionUnavailable(input: {
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
  readonly agentHandle?: NimiLocalAppAgentHandle | null;
}): ZhiyuCompanionStateStatus {
  return {
    transport: 'electron-ipc',
    ready: false,
    state: 'blocked',
    reasonCode: input.reasonCode,
    actionHint: input.actionHint,
    source: input.source,
    message: input.message,
    agentHandle: input.agentHandle ?? null,
    observedAt: null,
    stateUpdatedAt: null,
    executionState: null,
    statusText: null,
    activityCategory: null,
    activityIntensity: null,
    postureActionFamily: null,
    postureInterruptMode: null,
    currentEmotion: null,
    currentEmotionId: null,
    currentEmotionCue: null,
    currentEmotionIntensity: null,
    emotionViolation: null,
    projectedFields: [],
    unsupportedExplainabilityFields: [...UNSUPPORTED_EXPLAINABILITY_FIELDS],
  };
}

function conversationTarget(conversation: ZhiyuConversationHomeStatus): ZhiyuCompanionStateReadInput | null {
  if (!conversation.ready || !conversation.agentHandle || !conversation.conversationAnchorId) return null;
  return {
    agentHandle: conversation.agentHandle,
    conversationAnchorId: conversation.conversationAnchorId,
  };
}

function timestamp(value: Readonly<{ seconds: string; nanos: number }>): string | null {
  try {
    const milliseconds = Number(BigInt(value.seconds) * 1_000n + BigInt(Math.floor(value.nanos / 1_000_000)));
    return Number.isSafeInteger(milliseconds) ? new Date(milliseconds).toISOString() : null;
  } catch {
    return null;
  }
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

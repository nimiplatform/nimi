import type { NimiRuntimeAgentStateSnapshot } from '@nimiplatform/sdk/runtime';
import type { ZhiyuEvidence } from '../app/evidence';
import type { ZhiyuLocalAgentStatus } from './local-agent-status';
import {
  initialZhiyuCompanionEmotionProjection,
  projectZhiyuCompanionEmotion,
} from './companion-emotion';

const APP_ID = 'nimi.zhiyu';
const UNSUPPORTED_EXPLAINABILITY_FIELDS = [
  'posture',
  'postureSource',
  'stateConfidence',
  'whyThisState',
  'relationshipContext',
  'stateChangeHistory',
] as const;

export type ZhiyuCompanionStateStatus = ZhiyuEvidence['companion'];

export interface ZhiyuCompanionStateReadInput {
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
}

export type ZhiyuCompanionStateReader = (
  input: ZhiyuCompanionStateReadInput,
) => Promise<NimiRuntimeAgentStateSnapshot>;

export interface ZhiyuCompanionStateProbeOptions {
  readonly observedAt?: string;
  readonly readAgentState?: ZhiyuCompanionStateReader;
}

export async function probeZhiyuRuntimeCompanionState(
  localAgent: ZhiyuLocalAgentStatus,
  options: ZhiyuCompanionStateProbeOptions = {},
): Promise<ZhiyuCompanionStateStatus> {
  if (localAgent.ready && stringOr(localAgent.source, '') !== 'runtime') {
    return companionUnavailable({
      reasonCode: 'zhiyu-runtime-owned-local-agent-required',
      actionHint: 'select_runtime_owned_partner',
      source: localAgent.source,
      message: 'Zhiyu requires Runtime-owned LocalAgent evidence before reading companion state.',
      ownerUserId: localAgent.ownerUserId,
      runtimeSourceRef: localAgent.runtimeSourceRef,
      localAgentRef: localAgent.localAgentRef,
    });
  }
  const identity = localAgentIdentity(localAgent);
  if (!identity) {
    return companionUnavailable({
      reasonCode: 'zhiyu-local-agent-required',
      actionHint: 'select_runtime_owned_partner',
      source: localAgent.source,
      message: 'Zhiyu requires a Runtime-owned LocalAgent before reading companion state.',
      ownerUserId: localAgent.ownerUserId,
      runtimeSourceRef: localAgent.runtimeSourceRef,
      localAgentRef: localAgent.localAgentRef,
    });
  }

  if (!options.readAgentState) {
    return companionUnavailable({
      reasonCode: 'zhiyu-companion-state-capability-not-admitted',
      actionHint: 'admit_zhiyu_companion_state_capability',
      source: 'sdk',
      message: 'Companion state is not admitted on the Zhiyu local-app carrier.',
      ...identity,
    });
  }

  try {
    const snapshot = await options.readAgentState(identity);
    return companionAvailable(snapshot, identity, stringOr(options.observedAt, new Date().toISOString()));
  } catch (error) {
    return normalizeCompanionStateError(error, identity);
  }
}

function companionAvailable(
  snapshot: NimiRuntimeAgentStateSnapshot,
  identity: {
    readonly ownerUserId: string;
    readonly runtimeSourceRef: string;
    readonly localAgentRef: string;
  },
  observedAt: string,
): ZhiyuCompanionStateStatus {
  if (!snapshot.updatedAt) {
    return companionUnavailable({
      reasonCode: 'runtime-agent-state-timestamp-required',
      actionHint: 'check_runtime_agent_state_projection',
      source: 'runtime',
      message: 'Runtime Agent state projection is missing updatedAt.',
      ...identity,
    });
  }
  const participation = companionParticipationProjection(snapshot);
  const emotion = projectZhiyuCompanionEmotion({
    current: initialZhiyuCompanionEmotionProjection(),
    emotion: snapshot.currentEmotion,
  });
  const projectedFields = [
    snapshot.executionState ? 'executionState' : '',
    snapshot.statusText ? 'statusText' : '',
    snapshot.activeWorldId ? 'activeWorldId' : '',
    snapshot.activeUserId ? 'activeUserId' : '',
    snapshot.updatedAt ? 'stateUpdatedAt' : '',
    emotion.currentEmotion ? 'currentEmotion' : '',
    emotion.currentEmotionId ? 'currentEmotionId' : '',
    emotion.currentEmotionCue ? 'currentEmotionCue' : '',
    emotion.currentEmotionIntensity ? 'currentEmotionIntensity' : '',
    emotion.emotionViolation ? 'emotionViolation' : '',
    'participationMode',
    'participationSource',
  ].filter(Boolean);
  return {
    transport: 'electron-ipc',
    ready: true,
    state: 'projected',
    reasonCode: 'runtime-agent-state-projected',
    actionHint: 'inspect_runtime_agent_state_projection',
    source: 'runtime',
    message: 'Runtime Agent state was projected through SDK Runtime Agent state read.',
    ...identity,
    observedAt,
    stateUpdatedAt: snapshot.updatedAt,
    executionState: snapshot.executionState,
    statusText: snapshot.statusText,
    activeWorldId: snapshot.activeWorldId,
    activeUserId: snapshot.activeUserId,
    currentEmotion: emotion.currentEmotion,
    currentEmotionId: emotion.currentEmotionId,
    currentEmotionCue: emotion.currentEmotionCue,
    currentEmotionIntensity: emotion.currentEmotionIntensity,
    emotionViolation: emotion.emotionViolation,
    participationMode: participation.mode,
    participationSource: participation.source,
    projectedFields,
    unsupportedExplainabilityFields: [...UNSUPPORTED_EXPLAINABILITY_FIELDS],
  };
}

function companionParticipationProjection(snapshot: NimiRuntimeAgentStateSnapshot): {
  readonly mode: ZhiyuCompanionStateStatus['participationMode'];
  readonly source: string;
} {
  if (snapshot.activeWorldId) {
    return { mode: 'world', source: snapshot.activeWorldId };
  }
  if (snapshot.activeUserId) {
    return { mode: 'dyadic', source: snapshot.activeUserId };
  }
  return { mode: 'idle', source: 'runtime-agent-state' };
}

function normalizeCompanionStateError(
  error: unknown,
  identity: {
    readonly ownerUserId: string;
    readonly runtimeSourceRef: string;
    readonly localAgentRef: string;
  },
): ZhiyuCompanionStateStatus {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  return companionUnavailable({
    reasonCode: stringOr(record.reasonCode, 'zhiyu-runtime-agent-state-unavailable'),
    actionHint: stringOr(record.actionHint, 'check_runtime_agent_state_projection'),
    source: stringOr(record.source, 'sdk'),
    message: error instanceof Error && error.message.trim()
      ? error.message.trim()
      : 'Runtime Agent state projection is unavailable.',
    ...identity,
  });
}

function companionUnavailable(input: {
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
  readonly ownerUserId?: string | null;
  readonly runtimeSourceRef?: string | null;
  readonly localAgentRef?: string | null;
}): ZhiyuCompanionStateStatus {
  return {
    transport: 'electron-ipc',
    ready: false,
    state: 'blocked',
    reasonCode: input.reasonCode,
    actionHint: input.actionHint,
    source: input.source,
    message: input.message,
    ownerUserId: input.ownerUserId ?? null,
    runtimeSourceRef: input.runtimeSourceRef ?? null,
    localAgentRef: input.localAgentRef ?? null,
    observedAt: null,
    stateUpdatedAt: null,
    executionState: null,
    statusText: null,
    activeWorldId: null,
    activeUserId: null,
    currentEmotion: null,
    currentEmotionId: null,
    currentEmotionCue: null,
    currentEmotionIntensity: null,
    emotionViolation: null,
    participationMode: 'not_projected',
    participationSource: null,
    projectedFields: [],
    unsupportedExplainabilityFields: [...UNSUPPORTED_EXPLAINABILITY_FIELDS],
  };
}

function localAgentIdentity(localAgent: ZhiyuLocalAgentStatus): {
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
} | null {
  if (!localAgent.ready) {
    return null;
  }
  const ownerUserId = stringOr(localAgent.ownerUserId, '');
  const runtimeSourceRef = stringOr(localAgent.runtimeSourceRef, '');
  const localAgentRef = stringOr(localAgent.localAgentRef, '');
  if (!ownerUserId || !runtimeSourceRef || !localAgentRef) {
    return null;
  }
  return {
    ownerUserId,
    runtimeSourceRef,
    localAgentRef,
  };
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

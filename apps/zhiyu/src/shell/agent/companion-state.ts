import type {
  NimiRuntimeAgentProactiveEventProjection,
  NimiRuntimeAgentProactiveInterruptibilityProjection,
  NimiRuntimeAgentStateSnapshot,
} from '@nimiplatform/sdk/runtime';
import type {
  ZhiyuEvidence,
  ZhiyuProactiveInterruptibilityState,
  ZhiyuProactiveInterruptibilityStatus,
} from '../app/evidence';
import type { ZhiyuLocalAgentStatus } from './local-agent-discovery';
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
  'diaryReflection',
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

  const reader = options.readAgentState ?? readRuntimeAgentState;
  if (!options.readAgentState && !await hasRuntimeBridge()) {
    return companionUnavailable({
      reasonCode: 'electron-runtime-bridge-unavailable',
      actionHint: 'restart_zhiyu_electron_shell',
      source: 'renderer',
      message: 'Electron Runtime bridge is not available.',
      ...identity,
    });
  }

  try {
    const snapshot = await reader(identity);
    return companionAvailable(snapshot, identity, stringOr(options.observedAt, new Date().toISOString()));
  } catch (error) {
    return normalizeCompanionStateError(error, identity);
  }
}

async function readRuntimeAgentState(
  input: ZhiyuCompanionStateReadInput,
): Promise<NimiRuntimeAgentStateSnapshot> {
  const {
    buildRuntimeAgentRequestContext,
    projectNimiRuntimeAgentStateSnapshot,
  } = await import('@nimiplatform/sdk/runtime');
  const {
    withZhiyuRuntimeAgentBindingRequired,
  } = await import('../agent-chat/runtime-agent-binding');
  const { getZhiyuRuntime } = await import('../auth/runtime-platform');
  const runtime = getZhiyuRuntime();
  const context = buildRuntimeAgentRequestContext({
    runtimeAppId: APP_ID,
    subjectUserId: input.ownerUserId,
    ...input,
  });
  const response = await withZhiyuRuntimeAgentBindingRequired(['runtime.agent.read'], (callOptions) => runtime.agents.getAgentState({
    context,
    agentId: input.localAgentRef,
  }, callOptions));
  return projectNimiRuntimeAgentStateSnapshot(response.state);
}

async function hasRuntimeBridge(): Promise<boolean> {
  if (typeof window === 'undefined') {
    return false;
  }
  const { hasElectronRuntime } = await import('@nimiplatform/kit/shell/renderer/bridge');
  return hasElectronRuntime();
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
  const proactiveInterruptibility = projectZhiyuProactiveInterruptibility(
    snapshot.proactiveInterruptibility,
    identity,
    observedAt,
  );
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
    proactiveInterruptibility.ready ? 'proactiveInterruptibility' : '',
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
    voiceOutputMode: null,
    voicePlaybackState: null,
    voiceAudioArtifactId: null,
    voiceAudioMimeType: null,
    voicePlaybackTarget: null,
    voiceStreamId: null,
    participationMode: participation.mode,
    participationSource: participation.source,
    projectedFields,
    unsupportedExplainabilityFields: [...UNSUPPORTED_EXPLAINABILITY_FIELDS],
    diagnostics: {
      runtimeProjectionEvents: [],
    },
    proactiveInterruptibility,
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

function projectZhiyuProactiveInterruptibility(
  projection: NimiRuntimeAgentProactiveInterruptibilityProjection | undefined,
  identity: {
    readonly ownerUserId: string;
    readonly runtimeSourceRef: string;
    readonly localAgentRef: string;
  },
  observedAt: string,
): ZhiyuProactiveInterruptibilityStatus {
  if (!projection || projection.unsupportedFields.includes('proactive_interruptibility')) {
    return proactiveInterruptibilityUnavailable({
      reasonCode: 'runtime-agent-proactive-interruptibility-not-projected',
      actionHint: 'inspect_runtime_agent_proactive_interruptibility',
      source: 'runtime',
      message: 'Runtime Agent proactive interruptibility projection is not available.',
      unsupportedFields: projection?.unsupportedFields ?? ['proactive_interruptibility'],
      ...identity,
    });
  }

  const unsupportedFields = uniqueTexts([
    ...projection.unsupportedFields,
    ...eventUnsupportedFields(projection.suggestedEvent),
    ...eventUnsupportedFields(projection.lastDeliveredEvent),
    ...eventUnsupportedFields(projection.lastSuppressedEvent),
  ]);
  const requiredMissing = [
    projection.projectionId ? '' : 'projection_id',
    projection.projectionKind ? '' : 'projection_kind',
    projection.mode ? '' : 'mode',
    projection.optInState ? '' : 'opt_in_state',
    projection.deliveryChannel ? '' : 'delivery_channel',
    projection.quietHoursState ? '' : 'quiet_hours',
    projection.frequencyCapState ? '' : 'frequency_cap',
  ].filter(Boolean);
  const hasEvent = Boolean(
    projection.suggestedEvent
      || projection.lastDeliveredEvent
      || projection.lastSuppressedEvent,
  );
  const auditRefs = proactiveAuditRefs(projection);
  if (requiredMissing.length > 0 || (hasEvent && auditRefs.length === 0)) {
    return proactiveInterruptibilityUnavailable({
      reasonCode: 'runtime-agent-proactive-interruptibility-incomplete',
      actionHint: 'inspect_runtime_agent_proactive_interruptibility',
      source: 'runtime',
      message: 'Runtime Agent proactive interruptibility projection is missing owner fields.',
      unsupportedFields: uniqueTexts([
        ...unsupportedFields,
        ...requiredMissing,
        ...(hasEvent && auditRefs.length === 0 ? ['audit_refs'] : []),
      ]),
      ...identity,
    });
  }

  const state = resolveProactiveState(projection);
  const primaryEvent = primaryProactiveEvent(projection, state);
  const reasonCode = proactiveReasonCode(state, primaryEvent);
  return {
    transport: 'electron-ipc',
    ready: true,
    deliveryReady: state === 'delivered',
    state,
    reasonCode,
    actionHint: proactiveActionHint(state),
    source: 'runtime',
    message: proactiveMessage(state),
    ...identity,
    observedAt,
    projectionId: projection.projectionId,
    projectionKind: projection.projectionKind,
    mode: projection.mode,
    optInState: projection.optInState,
    deliveryChannel: projection.deliveryChannel,
    quietHoursState: projection.quietHoursState,
    frequencyCapState: projection.frequencyCapState,
    suggestedReasonCode: projection.suggestedEvent?.reasonCode ?? null,
    lastDeliveredReasonCode: projection.lastDeliveredEvent?.reasonCode ?? null,
    lastSuppressedReasonCode: projection.lastSuppressedEvent?.reasonCode ?? null,
    lastSuppressionReason: projection.lastSuppressedEvent?.suppressionReason ?? null,
    sourceHookId: primaryEvent?.sourceHookId ?? null,
    sourceCadenceId: primaryEvent?.sourceCadenceId ?? null,
    auditRefs,
    unsupportedFields,
  };
}

function proactiveInterruptibilityUnavailable(input: {
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly source: string;
  readonly message: string;
  readonly unsupportedFields: readonly string[];
  readonly ownerUserId?: string | null;
  readonly runtimeSourceRef?: string | null;
  readonly localAgentRef?: string | null;
}): ZhiyuProactiveInterruptibilityStatus {
  return {
    transport: 'electron-ipc',
    ready: false,
    deliveryReady: false,
    state: 'blocked',
    reasonCode: input.reasonCode,
    actionHint: input.actionHint,
    source: input.source,
    message: input.message,
    ownerUserId: input.ownerUserId ?? null,
    runtimeSourceRef: input.runtimeSourceRef ?? null,
    localAgentRef: input.localAgentRef ?? null,
    observedAt: null,
    projectionId: null,
    projectionKind: null,
    mode: null,
    optInState: null,
    deliveryChannel: null,
    quietHoursState: null,
    frequencyCapState: null,
    suggestedReasonCode: null,
    lastDeliveredReasonCode: null,
    lastSuppressedReasonCode: null,
    lastSuppressionReason: null,
    sourceHookId: null,
    sourceCadenceId: null,
    auditRefs: [],
    unsupportedFields: uniqueTexts(input.unsupportedFields),
  };
}

function resolveProactiveState(
  projection: NimiRuntimeAgentProactiveInterruptibilityProjection,
): ZhiyuProactiveInterruptibilityState {
  if (projection.mode === 'off' || projection.optInState === 'off') {
    return 'off';
  }
  switch (projection.optInState) {
    case 'denied':
      return 'permission-denied';
    case 'revoked':
      return 'permission-revoked';
    case 'missing':
      return 'permission-missing';
    case 'expired':
      return 'permission-expired';
  }
  if (projection.quietHoursState === 'active') {
    return 'quiet-hours-active';
  }
  if (projection.frequencyCapState === 'capped') {
    return 'frequency-capped';
  }
  if (projection.lastDeliveredEvent) {
    return 'delivered';
  }
  if (projection.lastSuppressedEvent) {
    return 'suppressed';
  }
  if (projection.suggestedEvent) {
    return 'suggested';
  }
  return 'projected';
}

function primaryProactiveEvent(
  projection: NimiRuntimeAgentProactiveInterruptibilityProjection,
  state: ZhiyuProactiveInterruptibilityState,
): NimiRuntimeAgentProactiveEventProjection | null {
  if (state === 'delivered') {
    return projection.lastDeliveredEvent;
  }
  if (
    state === 'suppressed'
    || state === 'quiet-hours-active'
    || state === 'frequency-capped'
    || state.startsWith('permission-')
  ) {
    return projection.lastSuppressedEvent;
  }
  if (state === 'suggested') {
    return projection.suggestedEvent;
  }
  return projection.lastDeliveredEvent
    ?? projection.lastSuppressedEvent
    ?? projection.suggestedEvent;
}

function proactiveReasonCode(
  state: ZhiyuProactiveInterruptibilityState,
  event: NimiRuntimeAgentProactiveEventProjection | null,
): string {
  if (event?.reasonCode) {
    return event.reasonCode;
  }
  switch (state) {
    case 'off':
      return 'runtime-agent-proactive-default-off';
    case 'quiet-hours-active':
      return 'runtime-agent-proactive-quiet-hours-active';
    case 'frequency-capped':
      return 'runtime-agent-proactive-frequency-cap-exceeded';
    case 'permission-denied':
      return 'runtime-agent-proactive-permission-denied';
    case 'permission-revoked':
      return 'runtime-agent-proactive-permission-revoked';
    case 'permission-missing':
      return 'runtime-agent-proactive-permission-missing';
    case 'permission-expired':
      return 'runtime-agent-proactive-permission-expired';
    case 'delivered':
      return 'runtime-agent-proactive-delivered';
    case 'suppressed':
      return 'runtime-agent-proactive-suppressed';
    case 'suggested':
      return 'runtime-agent-proactive-suggested';
    case 'projected':
      return 'runtime-agent-proactive-interruptibility-projected';
    case 'blocked':
      return 'runtime-agent-proactive-interruptibility-not-projected';
  }
}

function proactiveActionHint(state: ZhiyuProactiveInterruptibilityState): string {
  switch (state) {
    case 'off':
      return 'request_runtime_proactive_interruptibility_opt_in';
    case 'delivered':
      return 'inspect_runtime_proactive_delivery_audit';
    case 'suggested':
      return 'inspect_runtime_proactive_suggestion';
    case 'projected':
      return 'inspect_runtime_agent_proactive_interruptibility';
    default:
      return 'inspect_runtime_proactive_suppression_audit';
  }
}

function proactiveMessage(state: ZhiyuProactiveInterruptibilityState): string {
  switch (state) {
    case 'off':
      return 'Runtime Agent proactive interruptibility is default-off.';
    case 'delivered':
      return 'Runtime Agent proactive interruptibility delivered an in-app projection.';
    case 'suggested':
      return 'Runtime Agent proactive interruptibility has a suggestion that has not delivered.';
    case 'projected':
      return 'Runtime Agent proactive interruptibility was projected without a terminal event.';
    case 'blocked':
      return 'Runtime Agent proactive interruptibility is not projected.';
    default:
      return 'Runtime Agent proactive interruptibility is suppressed by owner policy.';
  }
}

function proactiveAuditRefs(
  projection: NimiRuntimeAgentProactiveInterruptibilityProjection,
): readonly string[] {
  return uniqueTexts([
    ...projection.auditRefs,
    projection.suggestedEvent?.auditRef ?? '',
    projection.lastDeliveredEvent?.auditRef ?? '',
    projection.lastSuppressedEvent?.auditRef ?? '',
  ]);
}

function eventUnsupportedFields(event: NimiRuntimeAgentProactiveEventProjection | null): readonly string[] {
  return event?.unsupportedFields ?? [];
}

function uniqueTexts(values: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    const normalized = stringOr(value, '');
    if (normalized) {
      unique.add(normalized);
    }
  }
  return [...unique];
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
    voiceOutputMode: null,
    voicePlaybackState: null,
    voiceAudioArtifactId: null,
    voiceAudioMimeType: null,
    voicePlaybackTarget: null,
    voiceStreamId: null,
    participationMode: 'not_projected',
    participationSource: null,
    projectedFields: [],
    unsupportedExplainabilityFields: [...UNSUPPORTED_EXPLAINABILITY_FIELDS],
    diagnostics: {
      runtimeProjectionEvents: [],
    },
    proactiveInterruptibility: proactiveInterruptibilityUnavailable({
      reasonCode: input.reasonCode,
      actionHint: 'probe_runtime_agent_proactive_interruptibility',
      source: input.source,
      message: 'Runtime Agent proactive interruptibility cannot be read before companion state is available.',
      unsupportedFields: ['proactive_interruptibility'],
      ownerUserId: input.ownerUserId,
      runtimeSourceRef: input.runtimeSourceRef,
      localAgentRef: input.localAgentRef,
    }),
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

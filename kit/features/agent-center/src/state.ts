import { AGENT_CENTER_CAPABILITY_LABELS, AGENT_CENTER_SECTIONS } from './sections.js';
import type {
  AgentCenterAppearanceProjection,
  AgentCenterCapabilityId,
  AgentCenterCapabilityState,
  AgentCenterState,
  AgentCenterStateInput,
  AgentCenterStatusTone,
} from './types.js';

const CAPABILITIES: readonly AgentCenterCapabilityId[] = [
  'text.generate',
  'text.embed',
  'image.generate',
  'audio.synthesize',
  'voice_workflow.voice_clone',
  'voice_workflow.voice_design',
];

const DEFAULT_APPEARANCE: AgentCenterAppearanceProjection = {
  status: 'not_configured',
  backendKind: null,
  avatarAssetRef: null,
  backgroundRef: null,
  defaultVoiceReference: null,
  avatarAutoplay: false,
  disabledReason: 'appearance asset not configured',
};

function readinessSummary(state: AgentCenterCapabilityState): string {
  if (state.readinessState === 'ready') {
    return `${state.label} ready`;
  }
  if (state.readinessState === 'not_configured') {
    return state.required
      ? `${state.label} not configured`
      : `${state.label} optional route not configured`;
  }
  if (state.readinessState === 'unavailable') {
    return state.reasonCode === 'unknown'
      ? `${state.label} unavailable`
      : `${state.label} unavailable: ${state.reasonCode}`;
  }
  return `${state.label} readiness unknown`;
}

function buildCapabilityState(
  input: AgentCenterStateInput,
  capability: AgentCenterCapabilityId,
): AgentCenterCapabilityState {
  const readiness = input.readiness?.capabilities.find((entry) => entry.capability === capability);
  const binding = input.agentAIConfig?.intents[capability] || null;
  const required = capability === 'text.generate' || capability === 'text.embed';
  const state: AgentCenterCapabilityState = {
    capability,
    label: AGENT_CENTER_CAPABILITY_LABELS[capability],
    required,
    readinessState: readiness?.state || 'unknown',
    reasonCode: readiness?.reasonCode || (readiness ? '' : 'unknown'),
    probedAt: readiness?.probedAt || null,
    binding,
    blocksTextTurns: required && readiness?.state !== 'ready',
    editable: true,
    summary: '',
  };
  return {
    ...state,
    summary: readinessSummary(state),
  };
}

function statusTone(input: AgentCenterStateInput, baseTextReady: boolean): AgentCenterStatusTone {
  if (input.runtimeError) {
    return 'failed';
  }
  if (!input.readiness && !input.agentAIConfig && !input.inspect) {
    return 'disabled';
  }
  if (!baseTextReady) {
    return 'attention';
  }
  return 'ready';
}

export function buildAgentCenterState(input: AgentCenterStateInput): AgentCenterState {
  const capabilities = CAPABILITIES.map((capability) => buildCapabilityState(input, capability));
  const text = capabilities.find((capability) => capability.capability === 'text.generate');
  const baseTextReady = text?.readinessState === 'ready';
  const tone = statusTone(input, baseTextReady);
  const inspect = input.inspect || null;
  const memory = input.memory || null;
  const autonomyMutationAvailable = input.autonomyMutationAvailable === true;

  return {
    runtimeStatus: input.runtimeError
      ? 'failed'
      : (!input.readiness && !input.agentAIConfig && !inspect ? 'disabled' : 'ready'),
    statusTone: tone,
    baseTextReady,
    baseTextDisabledReason: baseTextReady ? null : (text?.summary || 'Text readiness unavailable'),
    configRevision: input.readiness?.configRevision ?? input.agentAIConfig?.revision ?? null,
    capabilities,
    autonomy: {
      enabled: inspect?.autonomyEnabled ?? null,
      mode: inspect?.autonomyMode ?? null,
      usedTokensInWindow: inspect?.autonomyUsedTokensInWindow ?? null,
      dailyTokenBudget: inspect?.autonomyDailyTokenBudget ?? null,
      maxTokensPerHook: inspect?.autonomyMaxTokensPerHook ?? null,
      windowStartedAt: inspect?.autonomyWindowStartedAt ?? null,
      suspendedUntil: inspect?.autonomySuspendedUntil ?? null,
      budgetExhausted: inspect?.autonomyBudgetExhausted ?? null,
      controlsDisabled: !inspect || !autonomyMutationAvailable,
      disabledReason: !inspect
        ? (input.runtimeError || 'runtime inspect unavailable')
        : (!autonomyMutationAvailable ? 'runtime autonomy mutation unavailable' : null),
    },
    cognition: {
      lifecycleStatus: inspect?.lifecycleStatus ?? null,
      executionState: inspect?.executionState ?? null,
      statusText: inspect?.statusText ?? null,
      currentEmotion: inspect?.currentEmotion ?? null,
      memoryState: inspect
        ? (inspect.recentCanonicalMemories.length > 0 || memory?.recordCount ? 'ready' : 'empty')
        : 'unavailable',
      recentCanonicalMemories: inspect?.recentCanonicalMemories || [],
    },
    appearance: input.appearance || inspect?.presentationProfile ? {
      ...DEFAULT_APPEARANCE,
      ...(inspect?.presentationProfile ? {
        backendKind: inspect.presentationProfile.backendKind,
        avatarAssetRef: inspect.presentationProfile.avatarAssetRef,
        defaultVoiceReference: inspect.presentationProfile.defaultVoiceReference,
        avatarAutoplay: inspect.presentationProfile.avatarAutoplay,
        status: inspect.presentationProfile.avatarAssetRef ? 'ready' : 'not_configured',
        disabledReason: inspect.presentationProfile.avatarAssetRef ? null : DEFAULT_APPEARANCE.disabledReason,
      } satisfies Partial<AgentCenterAppearanceProjection> : {}),
      ...(input.appearance || {}),
    } : DEFAULT_APPEARANCE,
    diagnostics: {
      source: input.runtimeError ? 'unavailable' : 'runtime-projection',
      configRevision: input.readiness?.configRevision ?? input.agentAIConfig?.revision ?? null,
      runtimeTurnId: null,
      runtimeStreamId: null,
      runtimeError: input.runtimeError || null,
    },
    sections: AGENT_CENTER_SECTIONS,
  };
}

export function isAgentCenterState(value: AgentCenterState | AgentCenterStateInput): value is AgentCenterState {
  return Array.isArray((value as AgentCenterState).capabilities)
    && Array.isArray((value as AgentCenterState).sections)
    && typeof (value as AgentCenterState).baseTextReady === 'boolean';
}

export function resolveAgentCenterState(value: AgentCenterState | AgentCenterStateInput): AgentCenterState {
  return isAgentCenterState(value) ? value : buildAgentCenterState(value);
}

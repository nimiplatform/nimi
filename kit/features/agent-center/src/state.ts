import { CANONICAL_CAPABILITY_CATALOG } from '@nimiplatform/kit/core/runtime-capabilities';
import { AGENT_CENTER_SECTIONS } from './sections.js';
import { projectAgentCenterSourceContext } from './source-context-projection.js';
import type {
  AgentCenterAppearanceProjection,
  AgentCenterCapabilityId,
  AgentCenterCapabilityState,
  AgentCenterState,
  AgentCenterStateInput,
  AgentCenterStatusTone,
  AgentCenterSourceContextStatus,
} from './types.js';

function capabilityLabel(capability: AgentCenterCapabilityId): string {
  return capability
    .split(/[._-]/gu)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function projectedCapabilities(input: AgentCenterStateInput): readonly AgentCenterCapabilityId[] {
  const reported = new Set<string>([
    ...(input.aiConfig?.capabilities || []),
    ...(input.aiConfig?.readiness.map((entry) => entry.capability) || []),
    ...(input.aiConfig?.routeIntents.map((entry) => entry.capability) || []),
  ]);
  return CANONICAL_CAPABILITY_CATALOG
    .map((descriptor) => descriptor.capabilityId)
    .filter((capability) => reported.has(capability));
}

const DEFAULT_APPEARANCE: AgentCenterAppearanceProjection = {
  status: 'not_configured',
  backendKind: null,
  avatarAssetRef: null,
  backgroundRef: null,
  defaultVoiceReference: null,
  avatarAutoplay: false,
  disabledReasonCode: 'avatar-not-configured',
  disabledReason: 'appearance asset not configured',
};

function readinessSummary(state: AgentCenterCapabilityState): string {
  if (state.readinessState === 'ready') return 'Ready';
  if (state.readinessState === 'not_configured') {
    return state.required ? 'Not configured' : 'Optional route not configured';
  }
  if (state.readinessState === 'unavailable') return 'Unavailable';
  if (state.readinessState === 'configured_unverified') return 'Configured, not yet execution-verified';
  return 'Readiness unknown';
}

function buildCapabilityState(
  input: AgentCenterStateInput,
  capability: AgentCenterCapabilityId,
): AgentCenterCapabilityState {
  const readiness = input.aiConfig?.readiness.find((entry) => entry.capability === capability);
  const binding = input.aiConfig?.routeIntents.find((entry) => entry.capability === capability) ?? null;
  const required = capability === 'text.generate' || capability === 'text.embed';
  const readinessState = readiness?.state === 'blocked' ? 'not_configured' : readiness?.state ?? 'unknown';
  const state: AgentCenterCapabilityState = {
    capability,
    label: capabilityLabel(capability),
    required,
    readinessState,
    probedAt: readiness?.observedAt ?? null,
    binding,
    blocksTextTurns: required && readinessState !== 'ready',
    editable: true,
    summary: '',
  };
  return {
    ...state,
    summary: readinessSummary(state),
  };
}

function statusTone(
  input: AgentCenterStateInput,
  baseTextReady: boolean,
  sourceContextStatus: AgentCenterSourceContextStatus,
): AgentCenterStatusTone {
  if (input.runtimeError) {
    return 'failed';
  }
  if (sourceContextStatus === 'failed') {
    return 'failed';
  }
  if (sourceContextStatus === 'blocked') {
    return 'attention';
  }
  if (!input.aiConfig && !input.inspect && !input.sourceContextStatus && !input.turnContextSummary) {
    return 'disabled';
  }
  if (!baseTextReady) {
    return 'attention';
  }
  return 'ready';
}

export function buildAgentCenterState(input: AgentCenterStateInput): AgentCenterState {
  const capabilities = projectedCapabilities(input).map((capability) => buildCapabilityState(input, capability));
  const text = capabilities.find((capability) => capability.capability === 'text.generate');
  const baseTextReady = text?.readinessState === 'ready' && text.binding !== null;
  const sourceContext = projectAgentCenterSourceContext(input);
  const tone = statusTone(input, baseTextReady, sourceContext.status);
  const inspect = input.inspect || null;
  const memory = input.memory || null;
  const autonomyProjection = input.autonomy || null;
  const autonomyRevision = autonomyProjection?.revision || null;
  const presentationRevision = input.appearance?.presentationRevision
    ?? inspect?.presentationProfileRevision
    ?? null;
  const configRevisionCandidate = input.aiConfig?.configurationRevision;
  const configRevision = typeof configRevisionCandidate === 'string' && /^(?:0|[1-9]\d*)$/u.test(configRevisionCandidate)
    ? configRevisionCandidate
    : null;
  const agentAIConfigMutationDisabledReason: AgentCenterState['agentAIConfigMutationDisabledReason'] = !input.aiConfig
    ? 'agent-ai-config-snapshot-unavailable'
    : configRevision === null
      ? 'agent-ai-config-revision-unavailable'
      : null;

  return {
    runtimeStatus: input.runtimeError
      ? 'failed'
      : (!input.aiConfig && !inspect && !input.sourceContextStatus && !input.turnContextSummary ? 'disabled' : 'ready'),
    statusTone: tone,
    baseTextReady,
    aiConfig: input.aiConfig ?? null,
    baseTextDisabledReason: baseTextReady ? null : (text?.summary || 'Text readiness unavailable'),
    configRevision,
    autonomyRevision,
    presentationRevision,
    agentAIConfigMutationDisabledReason,
    capabilities,
    autonomy: {
      revision: autonomyRevision,
      enabled: autonomyProjection?.enabled ?? inspect?.autonomyEnabled ?? null,
      mode: autonomyProjection?.mode ?? inspect?.autonomyMode ?? null,
      usedTokensInWindow: autonomyProjection?.usedTokensInWindow ?? inspect?.autonomyUsedTokensInWindow ?? null,
      dailyTokenBudget: autonomyProjection?.dailyTokenBudget ?? inspect?.autonomyDailyTokenBudget ?? null,
      maxTokensPerHook: autonomyProjection?.maxTokensPerHook ?? inspect?.autonomyMaxTokensPerHook ?? null,
      windowStartedAt: autonomyProjection?.windowStartedAt ?? inspect?.autonomyWindowStartedAt ?? null,
      suspendedUntil: autonomyProjection?.suspendedUntil ?? inspect?.autonomySuspendedUntil ?? null,
      budgetExhausted: autonomyProjection?.budgetExhausted ?? inspect?.autonomyBudgetExhausted ?? null,
      controlsDisabled: autonomyRevision === null,
      disabledReason: autonomyRevision === null
        ? 'runtime autonomy revision unavailable'
        : null,
    },
    cognition: {
      lifecycleStatus: inspect?.lifecycleStatus ?? null,
      executionState: inspect?.executionState ?? null,
      statusText: inspect?.statusText ?? null,
      currentEmotion: inspect?.currentEmotion ?? null,
      memoryState: inspect
        ? (inspect.recentCanonicalMemories.length > 0 || memory?.recordCount ? 'ready' : 'empty')
        : 'unavailable',
      recentCanonicalMemoryCount: inspect?.recentCanonicalMemories.length ?? 0,
    },
    appearance: input.appearance || inspect?.presentationProfile ? {
      ...DEFAULT_APPEARANCE,
      presentationRevision,
      ...(inspect?.presentationProfile ? {
        backendKind: inspect.presentationProfile.backendKind,
        avatarAssetRef: inspect.presentationProfile.avatarAssetRef,
        backgroundRef: inspect.presentationProfile.backgroundAssetRef,
        defaultVoiceReference: inspect.presentationProfile.defaultVoiceReference,
        avatarAutoplay: inspect.presentationProfile.avatarAutoplay,
        status: inspect.presentationProfile.avatarAssetRef ? 'ready' : 'not_configured',
        disabledReasonCode: inspect.presentationProfile.avatarAssetRef ? null : DEFAULT_APPEARANCE.disabledReasonCode,
        disabledReason: inspect.presentationProfile.avatarAssetRef ? null : DEFAULT_APPEARANCE.disabledReason,
      } satisfies Partial<AgentCenterAppearanceProjection> : {}),
      ...(input.appearance || {}),
    } : DEFAULT_APPEARANCE,
    diagnostics: {
      source: input.runtimeError ? 'unavailable' : 'runtime-projection',
      configRevision,
      runtimeTurnId: sourceContext.context?.turnId || null,
      runtimeError: input.runtimeError || null,
    },
    sourceContext,
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

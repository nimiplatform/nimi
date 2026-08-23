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
  AgentCenterSharedAIConfigProjection,
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
    ...(input.sharedAIConfig?.capabilities || []),
    ...(input.sharedAIConfig?.intents.map((entry) => entry.capability) || []),
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

function configurationSummary(state: AgentCenterCapabilityState): string {
  if (state.configurationState === 'configured') {
    return `${state.intent?.route === 'local' ? 'Local' : 'Cloud'} intent configured`;
  }
  if (state.configurationState === 'not_configured') {
    return state.required ? 'Not configured' : 'Optional capability not configured';
  }
  if (state.configurationState === 'unavailable') return 'Unavailable';
  return 'Configuration unknown';
}

function buildCapabilityState(
  input: AgentCenterStateInput,
  capability: AgentCenterCapabilityId,
): AgentCenterCapabilityState {
  const intent = input.sharedAIConfig?.intents.find((entry) => entry.capability === capability) ?? null;
  const required = capability === 'text.generate' || capability === 'text.embed';
  const configurationState = intent ? 'configured' : 'not_configured';
  const state: AgentCenterCapabilityState = {
    capability,
    label: capabilityLabel(capability),
    required,
    configurationState,
    intent,
    editable: true,
    summary: '',
  };
  return {
    ...state,
    summary: configurationSummary(state),
  };
}

function statusTone(
  input: AgentCenterStateInput,
  baseTextConfigured: boolean,
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
  if (input.sharedAIConfig === undefined && !input.inspect && !input.sourceContextStatus && !input.turnContextSummary) {
    return 'disabled';
  }
  if (!baseTextConfigured) {
    return 'attention';
  }
  return 'ready';
}

export function buildAgentCenterState(input: AgentCenterStateInput): AgentCenterState {
  const capabilities = projectedCapabilities(input).map((capability) => buildCapabilityState(input, capability));
  const text = capabilities.find((capability) => capability.capability === 'text.generate');
  const baseTextConfigured = text?.configurationState === 'configured' && text.intent !== null;
  const sourceContext = projectAgentCenterSourceContext(input);
  const tone = statusTone(input, baseTextConfigured, sourceContext.status);
  const inspect = input.inspect || null;
  const memory = input.memory || null;
  const autonomyProjection = input.autonomy || null;
  const autonomyRevision = autonomyProjection?.revision || null;
  const presentationRevision = input.appearance?.presentationRevision
    ?? inspect?.presentationProfileRevision
    ?? null;
  const agentAIConfigMutationDisabledReason: AgentCenterState['agentAIConfigMutationDisabledReason'] = input.sharedAIConfig === undefined
    ? 'agent-ai-config-snapshot-unavailable'
    : null;

  return {
    runtimeStatus: input.runtimeError
      ? 'failed'
      : (input.sharedAIConfig === undefined && !inspect && !input.sourceContextStatus && !input.turnContextSummary ? 'disabled' : 'ready'),
    statusTone: tone,
    baseTextConfigured,
    sharedAIConfig: input.sharedAIConfig ?? null,
    effectiveSelections: input.effectiveSelections,
    baseTextConfigurationDetail: baseTextConfigured ? null : (text?.summary || 'Text capability is not configured'),
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
      runtimeTurnId: sourceContext.context?.turnId || null,
      runtimeError: input.runtimeError || null,
    },
    sourceContext,
    sections: AGENT_CENTER_SECTIONS,
  };
}

export function replaceAgentCenterSharedAIConfig(
  state: AgentCenterState,
  sharedAIConfig: AgentCenterSharedAIConfigProjection,
): AgentCenterState {
  const input: AgentCenterStateInput = { sharedAIConfig };
  const capabilities = projectedCapabilities(input).map((capability) => buildCapabilityState(input, capability));
  const text = capabilities.find((capability) => capability.capability === 'text.generate');
  const baseTextConfigured = text?.configurationState === 'configured' && text.intent !== null;
  const statusTone: AgentCenterStatusTone = state.runtimeStatus === 'failed' || state.sourceContext.status === 'failed'
    ? 'failed'
    : state.sourceContext.status === 'blocked' || !baseTextConfigured
      ? 'attention'
      : 'ready';
  return {
    ...state,
    statusTone,
    baseTextConfigured,
    sharedAIConfig,
    baseTextConfigurationDetail: baseTextConfigured
      ? null
      : (text?.summary || 'Text capability is not configured'),
    agentAIConfigMutationDisabledReason: null,
    capabilities,
  };
}

export function isAgentCenterState(value: AgentCenterState | AgentCenterStateInput): value is AgentCenterState {
  return Array.isArray((value as AgentCenterState).capabilities)
    && Array.isArray((value as AgentCenterState).sections)
    && typeof (value as AgentCenterState).baseTextConfigured === 'boolean';
}

export function resolveAgentCenterState(value: AgentCenterState | AgentCenterStateInput): AgentCenterState {
  return isAgentCenterState(value) ? value : buildAgentCenterState(value);
}

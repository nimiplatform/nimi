import { CANONICAL_CAPABILITY_CATALOG } from '@nimiplatform/kit/core/runtime-capabilities';
import { AGENT_CENTER_SECTIONS } from './sections.js';
import {
  projectAgentCenterManagerSourceContext,
} from './source-context-projection.js';
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
  const catalog = new Set(CANONICAL_CAPABILITY_CATALOG.map((descriptor) => descriptor.capabilityId));
  return (input.participation ?? [])
    .map((row) => row.capabilityContract)
		.filter((capability) => catalog.has(capability));
}

const DEFAULT_APPEARANCE: AgentCenterAppearanceProjection = {
  status: 'not_configured',
  backendKind: null,
  avatarAssetRef: null,
  backgroundRef: null,
  resourcePackSelection: null,
  resourcePackTarget: null,
  resourcePackMutationPending: null,
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

function cognitionMemoryState(input: AgentCenterStateInput): AgentCenterState['cognition']['memoryState'] {
  const projection = input.cognitionMemory;
  if (projection) {
    if (!projection.enabled || projection.adoptionRequired || projection.outcome === 'unconfigured') return 'unconfigured';
    if (projection.outcome === 'building' || projection.outcome === 'pending') return 'building';
    if (projection.outcome === 'failed' || projection.outcome === 'invalid') return 'failed';
    if (projection.outcome === 'unavailable') return 'unavailable';
    return projection.currentCount > 0 ? 'ready' : 'empty';
  }
  return 'unavailable';
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
  if (input.sharedAIConfig === undefined
    && input.manager === undefined) {
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
  const sourceContext = projectAgentCenterManagerSourceContext(input.manager);
  const tone = statusTone(input, baseTextConfigured, sourceContext.status);
  const cognitionMemory = input.cognitionMemory || null;
  const autonomyProjection = input.autonomy || null;
  const autonomyRevision = autonomyProjection?.revision || null;
  const presentationRevision = input.appearance?.presentationRevision ?? null;
  const agentAIConfigMutationDisabledReason: AgentCenterState['agentAIConfigMutationDisabledReason'] = input.sharedAIConfig === undefined
    ? 'agent-ai-config-snapshot-unavailable'
    : null;

  return {
    runtimeStatus: input.runtimeError
      ? 'failed'
      : (input.sharedAIConfig === undefined
        && input.manager === undefined ? 'disabled' : 'ready'),
    statusTone: tone,
    baseTextConfigured,
    sharedAIConfig: input.sharedAIConfig ?? null,
    effectiveSelections: input.effectiveSelections,
    participation: Object.freeze([...(input.participation ?? [])]),
    baseTextConfigurationDetail: baseTextConfigured ? null : (text?.summary || 'Text capability is not configured'),
    autonomyRevision,
    presentationRevision,
    agentAIConfigMutationDisabledReason,
    capabilities,
    autonomy: {
      revision: autonomyRevision,
      enabled: autonomyProjection?.enabled ?? null,
      mode: autonomyProjection?.mode ?? null,
      usedTokensInWindow: autonomyProjection?.usedTokensInWindow ?? null,
      dailyTokenBudget: autonomyProjection?.dailyTokenBudget ?? null,
      maxTokensPerHook: autonomyProjection?.maxTokensPerHook ?? null,
      windowStartedAt: autonomyProjection?.windowStartedAt ?? null,
      suspendedUntil: autonomyProjection?.suspendedUntil ?? null,
      budgetExhausted: autonomyProjection?.budgetExhausted ?? null,
      controlsDisabled: autonomyRevision === null,
      disabledReason: autonomyRevision === null
        ? 'runtime autonomy revision unavailable'
        : null,
    },
    cognition: {
      lifecycleStatus: input.manager?.lifecycleStatus ?? null,
      executionState: input.manager?.executionState ?? null,
      statusText: input.manager?.statusText ?? null,
      currentEmotion: input.manager?.currentEmotion ?? null,
      memoryState: cognitionMemoryState(input),
      recentCanonicalMemoryCount: cognitionMemory?.currentCount ?? 0,
      memory: cognitionMemory,
    },
    appearance: input.appearance ? {
      ...DEFAULT_APPEARANCE,
      presentationRevision,
      ...(input.appearance || {}),
    } : DEFAULT_APPEARANCE,
    diagnostics: {
      source: input.runtimeError ? 'unavailable' : 'runtime-projection',
      runtimeError: input.runtimeError || null,
    },
    sourceContext,
    sections: AGENT_CENTER_SECTIONS,
  };
}

export function replaceAgentCenterSharedAIConfig(
  state: AgentCenterState,
  sharedAIConfig: AgentCenterSharedAIConfigProjection | null,
  effectiveSelections: AgentCenterStateInput['effectiveSelections'],
  participation: AgentCenterStateInput['participation'],
): AgentCenterState {
  const input: AgentCenterStateInput = { sharedAIConfig, effectiveSelections, participation };
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
    effectiveSelections,
    participation: Object.freeze([...(participation ?? state.participation)]),
    baseTextConfigurationDetail: baseTextConfigured
      ? null
      : (text?.summary || 'Text capability is not configured'),
    agentAIConfigMutationDisabledReason: null,
    capabilities,
  };
}

export function replaceAgentCenterMemoryProjection(
  state: AgentCenterState,
  cognitionMemory: NonNullable<AgentCenterStateInput['cognitionMemory']>,
): AgentCenterState {
  return {
    ...state,
    cognition: {
      ...state.cognition,
      memoryState: cognitionMemoryState({ cognitionMemory }),
      recentCanonicalMemoryCount: cognitionMemory.currentCount,
      memory: cognitionMemory,
    },
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

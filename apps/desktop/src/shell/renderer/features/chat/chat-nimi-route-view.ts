import {
  resolveConversationRuntimeRouteSetupStateFromProjection,
  type ConversationSetupState,
} from '@nimiplatform/kit/features/chat/headless';
import {
  isRuntimeRouteLocalOptionSelectable,
  runtimeRouteLocalOptionToBinding,
} from '@nimiplatform/sdk/ai';
import type {
  RuntimeRouteBinding,
  RuntimeRouteModelProfile,
  RuntimeRouteOptionsSnapshot,
} from '@nimiplatform/sdk/ai';
import type { ConversationCapabilityProjection } from './conversation-capability';

export type AiConversationRouteOption = {
  key: string;
  binding: RuntimeRouteBinding;
  label: string;
  detail: string;
};

const MIN_AGENT_CHAT_REQUEST_MAX_OUTPUT_TOKENS = 512;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildLocalRouteOption(binding: RuntimeRouteBinding): AiConversationRouteOption {
  const provider = normalizeText(binding.provider) || normalizeText(binding.engine) || 'local';
  const modelId = normalizeText(binding.modelId) || normalizeText(binding.model) || normalizeText(binding.localModelId);
  return {
    key: `local:${normalizeText(binding.localModelId) || modelId}`,
    binding,
    label: 'Local runtime',
    detail: [provider, modelId].filter(Boolean).join(' · ') || 'Local route',
  };
}

function buildCloudRouteOption(binding: RuntimeRouteBinding): AiConversationRouteOption {
  const provider = normalizeText(binding.provider) || normalizeText(binding.connectorId) || 'Cloud route';
  const modelId = normalizeText(binding.modelId) || normalizeText(binding.model) || 'Missing model';
  return {
    key: `cloud:${normalizeText(binding.connectorId)}:${modelId}`,
    binding,
    label: provider,
    detail: modelId,
  };
}

function toRouteOption(binding: RuntimeRouteBinding): AiConversationRouteOption {
  return binding.source === 'local'
    ? buildLocalRouteOption(binding)
    : buildCloudRouteOption(binding);
}

export function buildAiConversationRouteOptions(
  snapshot: RuntimeRouteOptionsSnapshot | null | undefined,
): AiConversationRouteOption[] {
  if (!snapshot) {
    return [];
  }

  const localOptions = snapshot.local.models
    .filter(isRuntimeRouteLocalOptionSelectable)
    .map((model) => toRouteOption(runtimeRouteLocalOptionToBinding(model, {
      defaultEndpoint: snapshot.local.defaultEndpoint,
    })));

  const cloudOptions = snapshot.connectors.flatMap((connector) => connector.models
    .map((modelId) => normalizeText(modelId))
    .filter(Boolean)
    .map((modelId) => toRouteOption({
      source: 'cloud',
      connectorId: normalizeText(connector.id),
      provider: normalizeText(connector.provider) || normalizeText(connector.label) || undefined,
      model: modelId,
      modelId,
    })));

  return [...localOptions, ...cloudOptions];
}

export function isAiConversationRouteOptionSelected(
  option: AiConversationRouteOption,
  binding: RuntimeRouteBinding | null | undefined,
): boolean {
  if (!binding || option.binding.source !== binding.source) {
    return false;
  }
  if (binding.source === 'local') {
    const optionLocalModelId = normalizeText(option.binding.localModelId);
    const bindingLocalModelId = normalizeText(binding.localModelId);
    if (optionLocalModelId && bindingLocalModelId) {
      return optionLocalModelId === bindingLocalModelId;
    }
    return (normalizeText(option.binding.modelId) || normalizeText(option.binding.model))
      === (normalizeText(binding.modelId) || normalizeText(binding.model));
  }
  return normalizeText(option.binding.connectorId) === normalizeText(binding.connectorId)
    && (normalizeText(option.binding.modelId) || normalizeText(option.binding.model))
      === (normalizeText(binding.modelId) || normalizeText(binding.model));
}

export function findRuntimeRouteModelProfile(
  snapshot: RuntimeRouteOptionsSnapshot | null | undefined,
  binding: RuntimeRouteBinding | null | undefined,
): RuntimeRouteModelProfile | null {
  if (!snapshot || !binding) {
    return null;
  }
  if (
    Number.isFinite(Number(binding.maxContextTokens))
    || Number.isFinite(Number(binding.maxOutputTokens))
  ) {
    return {
      model: normalizeText(binding.modelId) || normalizeText(binding.model),
      ...(Number.isFinite(Number(binding.maxContextTokens)) && Number(binding.maxContextTokens) > 0
        ? { maxContextTokens: Math.floor(Number(binding.maxContextTokens)) }
        : {}),
      ...(Number.isFinite(Number(binding.maxOutputTokens)) && Number(binding.maxOutputTokens) > 0
        ? { maxOutputTokens: Math.floor(Number(binding.maxOutputTokens)) }
        : {}),
    };
  }
  if (binding.source !== 'cloud') {
    return null;
  }
  const connector = snapshot.connectors.find((item) => (
    normalizeText(item.id) === normalizeText(binding.connectorId)
  )) || null;
  if (!connector) {
    return null;
  }
  const targetModel = normalizeText(binding.modelId) || normalizeText(binding.model);
  if (!targetModel) {
    return null;
  }
  return connector.modelProfiles?.find((profile) => (
    normalizeText(profile.model) === targetModel
  )) || null;
}

export function resolveAgentChatRequestedMaxOutputTokens(
  profile: RuntimeRouteModelProfile | null | undefined,
  userOverride?: number | null,
): number | null {
  // User override takes precedence when it satisfies the minimum floor.
  const overrideValue = Number(userOverride);
  if (Number.isFinite(overrideValue) && overrideValue >= MIN_AGENT_CHAT_REQUEST_MAX_OUTPUT_TOKENS) {
    return Math.floor(overrideValue);
  }
  const maxOutputTokens = Number(profile?.maxOutputTokens);
  // Route profile ceilings are capability metadata, not a reliable per-turn target.
  // Very small ceilings routinely truncate Runtime Agent structured output before commit.
  if (!Number.isFinite(maxOutputTokens) || maxOutputTokens < MIN_AGENT_CHAT_REQUEST_MAX_OUTPUT_TOKENS) {
    return null;
  }
  return Math.floor(maxOutputTokens);
}

export function resolveAiConversationSetupStateFromProjection(
  projection: ConversationCapabilityProjection | null,
): ConversationSetupState {
  return resolveConversationRuntimeRouteSetupStateFromProjection({
    mode: 'ai',
    projection,
    issueCode: 'ai-thread-route-unavailable',
    actionTargetId: 'runtime-overview',
    returnToMode: 'ai',
  });
}

function summarizeBinding(binding: RuntimeRouteBinding): { label: string; detail: string | null } {
  const option = toRouteOption(binding);
  return {
    label: option.label,
    detail: option.detail || null,
  };
}

export function buildAiConversationRouteSummary(input: {
  projection: ConversationCapabilityProjection | null;
  selectedBinding: RuntimeRouteBinding | null;
  routeOptions: readonly AiConversationRouteOption[];
}): { label: string; detail: string | null } {
  const resolvedBinding = input.projection?.resolvedBinding || null;
  if (resolvedBinding) {
    return summarizeBinding(resolvedBinding);
  }

  if (input.selectedBinding) {
    const selectedOption = input.routeOptions.find((option) => (
      isAiConversationRouteOptionSelected(option, input.selectedBinding)
    )) || null;
    if (selectedOption) {
      return {
        label: selectedOption.label,
        detail: selectedOption.detail,
      };
    }
    const fallbackSummary = summarizeBinding(input.selectedBinding);
    return {
      label: fallbackSummary.label,
      detail: fallbackSummary.detail || 'Selected route is unavailable',
    };
  }

  return {
    label: 'Route unavailable',
    detail: 'Select an AI route before starting a conversation.',
  };
}

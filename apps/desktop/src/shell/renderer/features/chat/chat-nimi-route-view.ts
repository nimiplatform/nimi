import {
  resolveConversationRuntimeRouteSetupStateFromProjection,
  type ConversationSetupState,
} from '@nimiplatform/kit/features/chat/headless';
import {
  isNimiRuntimeTargetInventoryItemSelectable,
  nimiRuntimeRouteTargetRefKey,
  nimiRuntimeRouteTargetRefsMatch,
  type NimiRuntimeResolvedBinding,
  type NimiRuntimeRouteModelProfile,
  type NimiRuntimeRouteOptionsSnapshot,
  type NimiRuntimeRouteTargetRef,
  type NimiRuntimeTargetInventoryItem,
} from '@nimiplatform/sdk/runtime';
import type { ConversationCapabilityProjection } from './conversation-capability';

export type AiConversationRouteOption = {
  key: string;
  targetRef: NimiRuntimeRouteTargetRef;
  label: string;
  detail: string;
};

const MIN_AGENT_CHAT_REQUEST_MAX_OUTPUT_TOKENS = 512;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function summarizeResolvedBinding(
  binding: NimiRuntimeResolvedBinding | null | undefined,
): { label: string; detail: string | null } {
  if (!binding) {
    return { label: 'Route unavailable', detail: null };
  }
  if (binding.source === 'local-runtime') {
    const provider = normalizeText(binding.provider) || normalizeText(binding.engine) || 'Local runtime';
    const model = normalizeText(binding.modelId) || normalizeText(binding.model) || normalizeText(binding.localAssetId);
    return { label: 'Local runtime', detail: [provider, model].filter(Boolean).join(' / ') || null };
  }
  return {
    label: normalizeText(binding.provider) || normalizeText(binding.connectorId) || 'Cloud route',
    detail: normalizeText(binding.providerModelId) || normalizeText(binding.modelId) || normalizeText(binding.model) || null,
  };
}

function summarizeTargetRef(
  targetRef: NimiRuntimeRouteTargetRef | null | undefined,
): { label: string; detail: string | null } {
  if (!targetRef) {
    return { label: 'Route unavailable', detail: null };
  }
  if (targetRef.kind === 'local-runtime') {
    return {
      label: 'Local runtime',
      detail: normalizeText(targetRef.profileBindingId) || normalizeText(targetRef.readinessRef) || null,
    };
  }
  return {
    label: normalizeText(targetRef.provider) || normalizeText(targetRef.connectorId) || 'Cloud route',
    detail: normalizeText(targetRef.providerModelId) || normalizeText(targetRef.remoteModelCatalogId) || null,
  };
}

function buildRouteOption(item: NimiRuntimeTargetInventoryItem): AiConversationRouteOption {
  const targetRef = item.targetRef;
  const summary = summarizeTargetRef(targetRef);
  const label = normalizeText(item.display.label)
    || normalizeText(item.display.provider)
    || summary.label;
  const detail = [
    normalizeText(item.display.provider),
    normalizeText(item.display.modelLabel),
    normalizeText(item.display.model),
    normalizeText(item.display.engine),
  ].filter(Boolean).join(' / ');
  return {
    key: nimiRuntimeRouteTargetRefKey(targetRef),
    targetRef,
    label,
    detail: detail || summary.detail || 'Route target',
  };
}

export function buildAiConversationRouteOptions(
  snapshot: NimiRuntimeRouteOptionsSnapshot | null | undefined,
): AiConversationRouteOption[] {
  if (!snapshot) {
    return [];
  }
  return snapshot.inventory.targets
    .filter(isNimiRuntimeTargetInventoryItemSelectable)
    .map(buildRouteOption);
}

export function isAiConversationRouteOptionSelected(
  option: AiConversationRouteOption,
  targetRef: NimiRuntimeRouteTargetRef | null | undefined,
): boolean {
  return nimiRuntimeRouteTargetRefsMatch(option.targetRef, targetRef);
}

export function resolveAgentChatRequestedMaxOutputTokens(
  profile: NimiRuntimeRouteModelProfile | null | undefined,
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

export function buildAiConversationRouteSummary(input: {
  projection: ConversationCapabilityProjection | null;
  selectedTargetRef: NimiRuntimeRouteTargetRef | null;
  routeOptions: readonly AiConversationRouteOption[];
}): { label: string; detail: string | null } {
  const resolvedBinding = input.projection?.resolvedBinding || null;
  if (resolvedBinding) {
    return summarizeResolvedBinding(resolvedBinding);
  }

  if (input.selectedTargetRef) {
    const selectedOption = input.routeOptions.find((option) => (
      isAiConversationRouteOptionSelected(option, input.selectedTargetRef)
    )) || null;
    if (selectedOption) {
      return {
        label: selectedOption.label,
        detail: selectedOption.detail,
      };
    }
    const fallbackSummary = summarizeTargetRef(input.selectedTargetRef);
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

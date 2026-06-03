// Pure-logic route binding helpers for AIConfig selectedBindings.
//
// Owns the model-config binding serialization boundary so feature renderers
// and app consumers do not duplicate RuntimeRouteBinding projection details.

import type { AIConfig } from '@nimiplatform/kit/core/sdk-contract';
import type {
  ModelConfigBindingSummary,
  ModelConfigCapabilityPatch,
  ModelConfigRouteBinding,
  ModelConfigRoutePickerSelection,
} from './types.js';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function optionalText(value: unknown): string | undefined {
  const normalized = normalizeText(value);
  return normalized || undefined;
}

export function normalizeModelConfigRouteBinding(
  binding: ModelConfigRouteBinding | null | undefined,
): ModelConfigRouteBinding | null {
  if (!binding) return null;
  const source = binding.source === 'cloud' ? 'cloud' : 'local';
  const model = normalizeText(binding.model)
    || normalizeText(binding.modelId)
    || normalizeText(binding.localModelId);
  return {
    source,
    connectorId: normalizeText(binding.connectorId),
    model,
    modelLabel: optionalText(binding.modelLabel),
    modelId: optionalText(binding.modelId),
    provider: optionalText(binding.provider),
    localModelId: optionalText(binding.localModelId),
    engine: optionalText(binding.engine),
    adapter: binding.adapter,
    providerHints: binding.providerHints,
    maxContextTokens: binding.maxContextTokens,
    maxOutputTokens: binding.maxOutputTokens,
    endpoint: optionalText(binding.endpoint),
    localProviderEndpoint: optionalText(binding.localProviderEndpoint),
    localOpenAiEndpoint: optionalText(binding.localOpenAiEndpoint),
    goRuntimeLocalModelId: optionalText(binding.goRuntimeLocalModelId),
    goRuntimeStatus: optionalText(binding.goRuntimeStatus),
  };
}

/**
 * Convert a RuntimeRouteBinding to a partial picker selection for initializing
 * a model picker. Core intentionally owns a structural picker-selection shape
 * rather than importing the renderer feature.
 */
export function bindingToPickerSelection(
  binding: ModelConfigRouteBinding | null | undefined,
): Partial<ModelConfigRoutePickerSelection> {
  const normalized = normalizeModelConfigRouteBinding(binding);
  if (!normalized) return {};
  return {
    source: normalized.source === 'cloud' ? 'cloud' : 'local',
    connectorId: normalizeText(normalized.connectorId),
    model: normalized.source === 'local'
      ? (normalizeText(normalized.localModelId) || normalizeText(normalized.model))
      : (normalizeText(normalized.model) || normalizeText(normalized.modelId)),
    provider: normalized.source === 'cloud'
      ? optionalText(normalized.provider)
      : undefined,
    modelLabel: optionalText(normalized.modelLabel),
    localModelId: normalized.source === 'local'
      ? optionalText(normalized.localModelId)
      : undefined,
    engine: normalized.source === 'local'
      ? optionalText(normalized.engine)
      : undefined,
  };
}

/**
 * Convert a picker selection to the RuntimeRouteBinding shape stored in
 * AIConfig.capabilities.selectedBindings.
 */
export function pickerSelectionToBinding(
  selection: ModelConfigRoutePickerSelection,
): ModelConfigRouteBinding | null {
  const model = normalizeText(selection.model);
  if (!model) return null;

  if (selection.source === 'local') {
    const localModelId = normalizeText(selection.localModelId) || model;
    const engine = optionalText(selection.engine);
    const assetId = normalizeText(selection.modelId) || model;
    return {
      source: 'local',
      connectorId: '',
      model: assetId,
      modelId: assetId,
      modelLabel: optionalText(selection.modelLabel),
      localModelId,
      engine,
      provider: engine,
      goRuntimeLocalModelId: localModelId,
    };
  }

  const connectorId = normalizeText(selection.connectorId);
  if (!connectorId) return null;

  return {
    source: 'cloud',
    connectorId,
    model,
    provider: optionalText(selection.provider),
    modelLabel: optionalText(selection.modelLabel),
  };
}

export function summarizeBinding(
  binding: ModelConfigRouteBinding | null | undefined,
): ModelConfigBindingSummary {
  const normalized = normalizeModelConfigRouteBinding(binding);
  if (!normalized) {
    return { label: 'Route not selected', detail: null };
  }
  if (normalized.source === 'local') {
    const provider = normalizeText(normalized.provider) || normalizeText(normalized.engine) || 'Local runtime';
    const model = normalizeText(normalized.model)
      || normalizeText(normalized.modelId)
      || normalizeText(normalized.localModelId)
      || 'Unknown model';
    return { label: 'Local runtime', detail: [provider, model].filter(Boolean).join(' · ') };
  }
  const provider = normalizeText(normalized.provider) || normalizeText(normalized.connectorId) || 'Cloud route';
  const model = normalizeText(normalized.model) || normalizeText(normalized.modelId) || 'Unknown model';
  return { label: provider, detail: model };
}

export function readModelConfigRouteBinding(
  config: AIConfig,
  capabilityId: string,
): ModelConfigRouteBinding | null {
  const stored = config.capabilities.selectedBindings?.[capabilityId];
  return normalizeModelConfigRouteBinding(stored ?? null);
}

export function hasModelConfigRouteBinding(
  config: AIConfig,
  capabilityId: string,
): boolean {
  return readModelConfigRouteBinding(config, capabilityId) !== null;
}

export function applyModelConfigCapabilityPatch(
  config: AIConfig,
  capabilityId: string,
  patch: ModelConfigCapabilityPatch,
): AIConfig {
  const nextBindings = { ...config.capabilities.selectedBindings };
  const nextParams = { ...config.capabilities.selectedParams };

  if (Object.prototype.hasOwnProperty.call(patch, 'binding')) {
    nextBindings[capabilityId] = normalizeModelConfigRouteBinding(patch.binding ?? null);
  }
  if (patch.params) {
    nextParams[capabilityId] = patch.params;
  }

  return {
    ...config,
    capabilities: {
      ...config.capabilities,
      selectedBindings: nextBindings,
      selectedParams: nextParams,
    },
  };
}

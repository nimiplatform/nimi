import type { RouteModelPickerSelection } from '@nimiplatform/nimi-kit/features/model-picker';
import type { ModelConfigRouteBinding } from './types.js';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Convert a RuntimeRouteBinding to a partial RouteModelPickerSelection
 * for initializing a model picker.
 *
 * Unifies: chat's toSelection(), tester's bindingToInitialSelection(),
 * and profile editor's inline initialSelection.
 */
export function bindingToPickerSelection(
  binding: ModelConfigRouteBinding | null | undefined,
): Partial<RouteModelPickerSelection> {
  if (!binding) return {};
  return {
    source: binding.source === 'cloud' ? 'cloud' : 'local',
    connectorId: normalizeText(binding.connectorId),
    model: binding.source === 'local'
      ? (normalizeText(binding.localModelId) || normalizeText(binding.model))
      : (normalizeText(binding.model) || normalizeText(binding.modelId)),
    provider: binding.source === 'cloud'
      ? (normalizeText(binding.provider) || undefined)
      : undefined,
    modelLabel: normalizeText(binding.modelLabel) || undefined,
    localModelId: binding.source === 'local'
      ? (normalizeText(binding.localModelId) || undefined)
      : undefined,
    engine: binding.source === 'local'
      ? (normalizeText(binding.engine) || undefined)
      : undefined,
  };
}

/**
 * Convert a RouteModelPickerSelection to a RuntimeRouteBinding.
 *
 * Unifies: chat's toRuntimeRouteBindingFromPickerSelection(),
 * tester's selectionToBinding(), and profile editor's handleSelect.
 */
export function pickerSelectionToBinding(
  selection: RouteModelPickerSelection,
): ModelConfigRouteBinding | null {
  const model = normalizeText(selection.model);
  if (!model) return null;

  if (selection.source === 'local') {
    const localModelId = normalizeText(selection.localModelId) || model;
    const engine = normalizeText(selection.engine) || undefined;
    // Use assetId (modelId) as the model field for Go runtime compatibility.
    // The picker sets `model` to localModelId for display, but the runtime
    // matches by assetId. Fall back to `model` if modelId is not available.
    const assetId = normalizeText(selection.modelId) || model;
    return {
      source: 'local',
      connectorId: '',
      model: assetId,
      modelId: assetId,
      modelLabel: normalizeText(selection.modelLabel) || undefined,
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
    provider: normalizeText(selection.provider) || undefined,
    modelLabel: normalizeText(selection.modelLabel) || undefined,
  };
}

/**
 * Produce a human-readable summary of a binding for display purposes.
 *
 * Extracted from chat's summarizeRouteBinding().
 */
export function summarizeBinding(
  binding: ModelConfigRouteBinding | null | undefined,
): { label: string; detail: string | null } {
  if (!binding) {
    return { label: 'Route not selected', detail: null };
  }
  if (binding.source === 'local') {
    const provider = normalizeText(binding.provider) || normalizeText(binding.engine) || 'Local runtime';
    const model = normalizeText(binding.model) || normalizeText(binding.modelId) || normalizeText(binding.localModelId) || 'Unknown model';
    return { label: 'Local runtime', detail: [provider, model].filter(Boolean).join(' · ') };
  }
  const provider = normalizeText(binding.provider) || normalizeText(binding.connectorId) || 'Cloud route';
  const model = normalizeText(binding.model) || normalizeText(binding.modelId) || 'Unknown model';
  return { label: provider, detail: model };
}

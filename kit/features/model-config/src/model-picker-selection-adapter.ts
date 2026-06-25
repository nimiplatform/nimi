import type { ModelConfigTargetRef } from '@nimiplatform/kit/core/model-config';
import type { RouteModelPickerSelection } from '@nimiplatform/kit/features/model-picker';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function targetRefToPickerSelection(
  targetRef: ModelConfigTargetRef | null | undefined,
): Partial<RouteModelPickerSelection> {
  if (!targetRef) {
    return {};
  }
  if (targetRef.kind === 'cloud-connector') {
    const model = normalizeText(targetRef.providerModelId);
    return {
      source: 'cloud',
      connectorId: normalizeText(targetRef.connectorId),
      model,
      provider: normalizeText(targetRef.provider) || undefined,
      remoteModelCatalogId: normalizeText(targetRef.remoteModelCatalogId) || undefined,
      providerModelId: model || undefined,
      modelLabel: model || undefined,
    };
  }
  if (targetRef.kind === 'local-runtime') {
    const localModelId = normalizeText(targetRef.profileBindingId) || normalizeText(targetRef.readinessRef);
    return {
      source: 'local',
      connectorId: '',
      model: localModelId,
      localModelId: localModelId || undefined,
      profileBindingId: normalizeText(targetRef.profileBindingId) || undefined,
      readinessRef: normalizeText(targetRef.readinessRef) || undefined,
    };
  }
  return {};
}

export function pickerSelectionToTargetRef(
  selection: RouteModelPickerSelection,
): ModelConfigTargetRef | null {
  if (selection.source === 'cloud') {
    const connectorId = normalizeText(selection.connectorId);
    const remoteModelCatalogId = normalizeText(selection.remoteModelCatalogId);
    const providerModelId = normalizeText(selection.providerModelId) || normalizeText(selection.model);
    if (!connectorId || !remoteModelCatalogId || !providerModelId) {
      return null;
    }
    return {
      kind: 'cloud-connector',
      connectorId,
      remoteModelCatalogId,
      providerModelId,
      ...(normalizeText(selection.provider) ? { provider: normalizeText(selection.provider) } : {}),
    };
  }

  const profileBindingId = normalizeText(selection.profileBindingId)
    || normalizeText(selection.localModelId)
    || normalizeText(selection.model);
  const readinessRef = normalizeText(selection.readinessRef);
  if (profileBindingId) {
    return { kind: 'local-runtime', version: 'v2', profileBindingId };
  }
  return readinessRef ? { kind: 'local-runtime', version: 'v2', readinessRef } : null;
}

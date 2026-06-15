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
      modelLabel: model || undefined,
    };
  }
  if (targetRef.kind === 'local-runtime') {
    const localModelId = normalizeText(targetRef.profileId)
      || normalizeText(targetRef.readinessRef)
      || normalizeText(targetRef.targetId);
    const targetId = normalizeText(targetRef.targetId);
    const engine = targetId && targetId !== localModelId && targetId !== 'local-runtime'
      ? targetId
      : undefined;
    return {
      source: 'local',
      connectorId: '',
      model: localModelId,
      localModelId: localModelId || undefined,
      engine,
    };
  }
  return {};
}

export function pickerSelectionToTargetRef(
  selection: RouteModelPickerSelection,
): ModelConfigTargetRef | null {
  if (selection.source === 'cloud') {
    const connectorId = normalizeText(selection.connectorId);
    const providerModelId = normalizeText(selection.model);
    if (!connectorId || !providerModelId) {
      return null;
    }
    return {
      kind: 'cloud-connector',
      connectorId,
      providerModelId,
      ...(normalizeText(selection.provider) ? { provider: normalizeText(selection.provider) } : {}),
    };
  }

  const localModelId = normalizeText(selection.goRuntimeLocalModelId)
    || normalizeText(selection.localModelId)
    || normalizeText(selection.model)
    || normalizeText(selection.modelId);
  if (!localModelId) {
    return null;
  }
  const targetId = normalizeText(selection.engine) || 'local-runtime';
  return {
    kind: 'local-runtime',
    targetId,
    profileId: localModelId,
    readinessRef: ['runtime-route', 'local', targetId, localModelId].join(':'),
  };
}

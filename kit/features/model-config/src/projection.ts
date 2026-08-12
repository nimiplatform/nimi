import type { NimiCapabilityAIConfigIntent } from '@nimiplatform/kit/core/sdk-contract';
import { runtimeAIConfigStructToJson } from '@nimiplatform/kit/core/sdk-contract';
import type {
  ModelConfigCapabilityPosture,
  ModelConfigLocalSelectionProjection,
  ModelConfigMachineAggregateInput,
} from './types.js';

function exactCloudTargetText(value: unknown): string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 ? value : '';
}

export function modelConfigHasExactCloudTarget(
  intent: NimiCapabilityAIConfigIntent | null | undefined,
): boolean {
  if (intent?.route.oneofKind !== 'cloud') return false;
  return modelConfigJsonHasExactCloudTarget(
    runtimeAIConfigStructToJson(intent.route.cloud.providerModelTarget),
  );
}

export function modelConfigJsonHasExactCloudTarget(
  fields: Readonly<Record<string, unknown>>,
): boolean {
  return !Object.hasOwn(fields, 'model')
    && Boolean(exactCloudTargetText(fields.provider))
    && Boolean(exactCloudTargetText(fields.providerModelId))
    && Boolean(exactCloudTargetText(fields.remoteModelCatalogId));
}

export function projectModelConfigLocalSelections(
  aggregate: ModelConfigMachineAggregateInput | null | undefined,
): readonly ModelConfigLocalSelectionProjection[] {
  if (!aggregate) return [];
  return aggregate.selections.map((selection) => {
    const configuration = aggregate.configurations.find(
      (entry) => entry.configurationId === selection.configurationId,
    );
    if (!configuration) {
      return {
        capabilityContract: selection.capabilityContract,
        state: 'broken' as const,
        configurationId: selection.configurationId,
        displayName: null,
        supportedFeatures: [],
        reasons: ['selected-configuration-not-found'],
        effectiveDefaults: null,
      };
    }
    const reasons = [
      ...(configuration.interpretability === 'interpretable' ? [] : ['configuration-uninterpretable']),
      ...(configuration.requirementResolution === 'configured' ? [] : ['configuration-unresolved']),
      ...configuration.reasons,
    ];
    return {
      capabilityContract: selection.capabilityContract,
      state: reasons.length === 0 ? 'selected' as const : 'broken' as const,
      configurationId: configuration.configurationId,
      displayName: configuration.displayName,
      supportedFeatures: configuration.supportedFeatures,
      reasons: [...new Set(reasons)],
      effectiveDefaults: selection.effectiveDefaults ?? null,
    };
  });
}

export function modelConfigMissingRequiredFeatures(
  intent: NimiCapabilityAIConfigIntent | null | undefined,
  selection: ModelConfigLocalSelectionProjection | null | undefined,
): readonly string[] {
  if (!intent || intent.route.oneofKind !== 'local' || selection?.state !== 'selected') return [];
  const supported = new Set(selection.supportedFeatures);
  return intent.requiredFeatures.filter((feature) => !supported.has(feature));
}

export function modelConfigCapabilityPosture(
  intent: NimiCapabilityAIConfigIntent | null | undefined,
  selection: ModelConfigLocalSelectionProjection | null | undefined,
): ModelConfigCapabilityPosture {
  if (!intent || !intent.route.oneofKind) return 'not-configured';
  if (intent.route.oneofKind === 'cloud') {
    return modelConfigHasExactCloudTarget(intent) ? 'cloud-configured' : 'not-configured';
  }
  if (!selection || selection.state === 'missing') return 'local-selection-missing';
  if (selection.state === 'unavailable' || selection.state === 'broken') return 'local-configuration-blocked';
  return modelConfigMissingRequiredFeatures(intent, selection).length > 0
    ? 'local-feature-mismatch'
    : 'local-configured';
}

export function modelConfigCapabilityFallbackLabel(capabilityContract: string): string {
  return capabilityContract
    .split(/[._-]/gu)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

import type { NimiPortableAppAIConfigIntent } from '@nimiplatform/kit/core/sdk-contract';
import { runtimeAIConfigStructToJson } from '@nimiplatform/kit/core/sdk-contract';
import type {
  ModelConfigCapabilityPosture,
  ModelConfigLocalSelectionProjection,
} from './types.js';

function exactCloudTargetText(value: unknown): string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 ? value : '';
}

export function modelConfigHasExactCloudTarget(
  intent: NimiPortableAppAIConfigIntent | null | undefined,
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

export function modelConfigMissingRequiredFeatures(
  intent: NimiPortableAppAIConfigIntent | null | undefined,
  selection: ModelConfigLocalSelectionProjection | null | undefined,
): readonly string[] {
  if (!intent || intent.route.oneofKind !== 'local' || selection?.state !== 'selected') return [];
  const supported = new Set(selection.supportedFeatures);
  return intent.requiredFeatures.filter((feature) => !supported.has(feature));
}

export function modelConfigCapabilityPosture(
  intent: NimiPortableAppAIConfigIntent | null | undefined,
  selection: ModelConfigLocalSelectionProjection | null | undefined,
): ModelConfigCapabilityPosture {
  if (!intent || !intent.route.oneofKind) return 'not-configured';
  if (intent.route.oneofKind === 'cloud') {
    return modelConfigHasExactCloudTarget(intent) ? 'cloud-configured' : 'not-configured';
  }
  // Protected Apps can configure the shared LocalAgent intent without receiving
  // the separate machine-owner Loadout projection. Only observed absence is a
  // missing selection; an unobserved selection does not invalidate AIConfig.
  if (selection === undefined) return 'local-configured';
  if (selection === null || selection.state === 'missing') return 'local-selection-missing';
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

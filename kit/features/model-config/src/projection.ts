import type { NimiPortableAppAIConfigIntent } from '@nimiplatform/kit/core/sdk-contract';
import { runtimeAIConfigStructToJson } from '@nimiplatform/kit/core/sdk-contract';
import type {
  ModelConfigCapabilityPosture,
  ModelConfigEffectiveSelectionProjection,
} from './types.js';

function exactCloudTargetText(value: unknown): string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 ? value : '';
}

export function modelConfigHasExactCloudTarget(
  intent: NimiPortableAppAIConfigIntent | null | undefined,
): boolean {
  if (intent?.route.oneofKind !== 'cloud') return false;
  return Boolean(intent.route.cloud.connectorRef?.trim()) && modelConfigJsonHasExactCloudTarget(
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
  selection: ModelConfigEffectiveSelectionProjection | null | undefined,
): readonly string[] {
  const local = selection?.resource?.oneofKind === 'local' ? selection.resource.local : null;
  if (!intent || intent.route.oneofKind !== 'local' || selection?.state !== 'ready' || !local) return [];
  const supported = new Set(local.supportedFeatures);
  return intent.requiredFeatures.filter((feature) => !supported.has(feature));
}

// @nimi-authority: rule.nimi.platform.ui-design-system.p-model-config-001
export function modelConfigCapabilityPosture(
  intent: NimiPortableAppAIConfigIntent | null | undefined,
  selection: ModelConfigEffectiveSelectionProjection | null | undefined,
): ModelConfigCapabilityPosture {
  if (!intent || !intent.route.oneofKind) return 'not-configured';
  if (intent.route.oneofKind === 'cloud') {
    if (!modelConfigHasExactCloudTarget(intent)) return 'not-configured';
    if (selection === undefined) return 'cloud-configured';
    if (selection === null || selection.state === 'unavailable') return 'cloud-configuration-unavailable';
    if (selection.state === 'missing') return 'cloud-selection-missing';
    if (selection.state === 'blocked') return 'cloud-configuration-blocked';
    return selection.resource?.oneofKind === 'cloud'
      ? 'cloud-configured'
      : 'cloud-configuration-unavailable';
  }
  // Protected Apps can configure the shared LocalAgent intent without receiving
  // the separate machine-owner Loadout projection. Only observed absence is a
  // missing selection; an unobserved selection does not invalidate AIConfig.
  if (selection === undefined) return 'local-configured';
  if (selection === null || selection.state === 'unavailable') return 'local-configuration-unavailable';
  if (selection.state === 'missing') return 'local-selection-missing';
  if (selection.state === 'blocked') return 'local-configuration-blocked';
  if (selection.resource?.oneofKind !== 'local') return 'local-configuration-unavailable';
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

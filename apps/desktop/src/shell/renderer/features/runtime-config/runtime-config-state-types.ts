import type { NimiRuntimeLocalCatalogRecommendation } from '@nimiplatform/sdk/runtime';
import type { JsonObject } from '@nimiplatform/sdk/types';
import { createNimiClientId } from '@nimiplatform/sdk';
import {
  NIMI_RUNTIME_LOCAL_RUNNABLE_ASSET_KIND_IDS,
  normalizeNimiRuntimeLocalRunnableAssetKindId,
  type NimiRuntimeLocalRunnableAssetKindId,
  createNimiRuntimeConfigConnectorDraft,
  normalizeNimiRuntimeConfigConnectorAuthMode,
  normalizeNimiRuntimeConfigConnectorModels,
  normalizeNimiRuntimeConfigConnectorProjection,
  normalizeNimiRuntimeConfigConnectorScope,
  normalizeNimiRuntimeConfigConnectorStatus,
  normalizeNimiRuntimeConfigConnectorVendor,
  NIMI_RUNTIME_CONFIG_DEFAULT_LOCAL_ENDPOINT,
  NIMI_RUNTIME_CONFIG_DEFAULT_CONNECTOR_ENDPOINT,
  nimiRuntimeConfigConnectorVendorLabel,
  normalizeNimiRuntimeConfigEndpoint,
  normalizeNimiRuntimeConfigLocalModelProjection,
  normalizeNimiRuntimeConfigLocalNodeMatrixEntryProjection,
  normalizeNimiRuntimeConfigStringList,
  type NimiRuntimeConfigConnectorProjection,
  type NimiRuntimeLocalProviderAdapterId,
  type NimiRuntimeConfigProviderStatus,
  type NimiRuntimeConnectorAuthMode,
  type NimiRuntimeConnectorScope,
  type NimiRuntimeConfigLocalModelProjection,
  type NimiRuntimeConfigLocalNodeCapability,
  type NimiRuntimeConfigLocalNodeMatrixEntryProjection,
  type NimiRuntimeConfigLocalProviderHints,
} from '@nimiplatform/sdk/runtime';

export const CAPABILITIES_V11 = NIMI_RUNTIME_LOCAL_RUNNABLE_ASSET_KIND_IDS;
export type CapabilityV11 = NimiRuntimeLocalRunnableAssetKindId;

export type SourceIdV11 = 'local' | 'cloud';
/**
 * Canonical six-section Runtime IA per
 * `.nimi/spec/desktop/kernel/runtime-panel-contract.md`.
 * Section merges from the Runtime Surface Cleanup table:
 *  - recommend + local (Local Models) + catalog  -> models
 *  - data-management + runtime (Operations)      -> environment
 *  - performance + developer-gated tools         -> advanced
 */
export type RuntimePageIdV11 =
  | 'overview'
  | 'profiles'
  | 'models'
  | 'cloud'
  | 'environment'
  | 'advanced';
/**
 * Sub-navigation targets used inside a section (e.g. the Models section's
 * recommend/installed/catalog sub-tabs, or cross-section "open Cloud Connectors"
 * deep links). Not top-level IA entries.
 */
export type RuntimeSetupPageIdV11 = 'models' | 'cloud';
export type UiModeV11 = 'simple' | 'advanced';
export type ProviderStatusV11 = NimiRuntimeConfigProviderStatus;
export type ApiConnectorScopeV11 = 'user' | 'machine-global' | 'runtime-system';
export type ApiVendor = string;
export type ApiConnectorAuthModeV11 = 'api_key' | 'oauth_managed';
export type RuntimeConfigActionFocus =
  | {
    page: 'cloud';
    action: 'add-connector';
    focus: 'runtime-config-action-focus.cloud-connector-draft';
  }
  | {
    page: 'models';
    action: 'install-model';
    focus: 'runtime-config-action-focus.models-catalog-install';
  };

export type LocalModelOptionV11 = NimiRuntimeConfigLocalModelProjection & {
  recommendation?: NimiRuntimeLocalCatalogRecommendation;
};

export type NodeCapabilityV11 = NimiRuntimeConfigLocalNodeCapability;

export type LocalProviderHintsV11 = NimiRuntimeConfigLocalProviderHints & JsonObject;

export type LocalNodeMatrixEntryV11 = NimiRuntimeConfigLocalNodeMatrixEntryProjection & {
  capability: NodeCapabilityV11;
  adapter?: NimiRuntimeLocalProviderAdapterId;
  providerHints?: LocalProviderHintsV11;
};

export type LocalStateV11 = {
  endpoint: string;
  models: LocalModelOptionV11[];
  nodeMatrix: LocalNodeMatrixEntryV11[];
  status: ProviderStatusV11;
  lastCheckedAt: string | null;
  lastDetail: string;
};

export type ApiConnector = NimiRuntimeConfigConnectorProjection;

export type RuntimeConfigStateV11 = {
  version: 11 | 12;
  initializedByV11: boolean;
  activePage: RuntimePageIdV11;
  actionFocus: RuntimeConfigActionFocus | null;
  diagnosticsCollapsed: boolean;
  selectedSource: SourceIdV11;
  activeCapability: CapabilityV11;
  uiMode: UiModeV11;
  local: LocalStateV11;
  connectors: ApiConnector[];
  selectedConnectorId: string;
};

export const DEFAULT_LOCAL_ENDPOINT_V11 = NIMI_RUNTIME_CONFIG_DEFAULT_LOCAL_ENDPOINT;
export const DEFAULT_CONNECTOR_ENDPOINT_V11 = NIMI_RUNTIME_CONFIG_DEFAULT_CONNECTOR_ENDPOINT;

export function normalizeSourceV11(value: unknown): SourceIdV11 {
  return value === 'cloud' ? 'cloud' : 'local';
}

export function normalizePageIdV11(value: unknown): RuntimePageIdV11 {
  if (
    value === 'overview'
    || value === 'profiles'
    || value === 'models'
    || value === 'cloud'
    || value === 'environment'
    || value === 'advanced'
  ) {
    return value;
  }
  return 'overview';
}

export function normalizeRuntimeConfigActionFocus(value: unknown): RuntimeConfigActionFocus | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    record.page === 'cloud'
    && record.action === 'add-connector'
    && record.focus === 'runtime-config-action-focus.cloud-connector-draft'
  ) {
    return {
      page: 'cloud',
      action: 'add-connector',
      focus: 'runtime-config-action-focus.cloud-connector-draft',
    };
  }
  if (
    record.page === 'models'
    && record.action === 'install-model'
    && record.focus === 'runtime-config-action-focus.models-catalog-install'
  ) {
    return {
      page: 'models',
      action: 'install-model',
      focus: 'runtime-config-action-focus.models-catalog-install',
    };
  }
  return null;
}

export function normalizeCapabilityV11(value: unknown): CapabilityV11 {
  return normalizeNimiRuntimeLocalRunnableAssetKindId(value);
}

export function normalizeUiModeV11(value: unknown): UiModeV11 {
  return value === 'advanced' ? 'advanced' : 'simple';
}

export function normalizeVendorV11(value: unknown): ApiVendor {
  return normalizeNimiRuntimeConfigConnectorVendor(value) as ApiVendor;
}

export function normalizeStatusV11(value: unknown): ProviderStatusV11 {
  return normalizeNimiRuntimeConfigConnectorStatus(value);
}

export function normalizeConnectorScopeV11(value: unknown): ApiConnectorScopeV11 {
  return normalizeNimiRuntimeConfigConnectorScope(value) as ApiConnectorScopeV11;
}

export function statusTextV11(status: ProviderStatusV11): string {
  if (status === 'healthy') return 'Healthy';
  if (status === 'degraded') return 'Degraded';
  if (status === 'unreachable') return 'Unreachable';
  if (status === 'unsupported') return 'Unsupported';
  return 'Not checked';
}

export function statusClassV11(status: ProviderStatusV11): string {
  if (status === 'healthy') return 'bg-[color-mix(in_srgb,var(--nimi-status-success)_12%,transparent)] text-[var(--nimi-status-success)]';
  if (status === 'degraded') return 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,transparent)] text-[var(--nimi-status-warning)]';
  if (status === 'unreachable') return 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)] text-[var(--nimi-status-danger)]';
  if (status === 'unsupported') return 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,transparent)] text-[var(--nimi-status-warning)]';
  return 'bg-[color-mix(in_srgb,var(--nimi-surface-card)_78%,var(--nimi-surface-panel))] text-[var(--nimi-text-secondary)]';
}

export function dedupeStringsV11(values: readonly string[]): string[] {
  return normalizeNimiRuntimeConfigStringList(values);
}

export function getVendorLabelV11(vendor: ApiVendor): string {
  return nimiRuntimeConfigConnectorVendorLabel(vendor);
}

export function normalizeEndpointV11(value: string, fallback: string): string {
  return normalizeNimiRuntimeConfigEndpoint(value, fallback);
}

export function randomIdV11(prefix: string): string {
  return createNimiClientId(prefix);
}

export function createConnectorV11(vendor: ApiVendor = 'custom', label?: string): ApiConnector {
  return createNimiRuntimeConfigConnectorDraft({ id: randomIdV11('connector'), vendor, label });
}

export function normalizeConnectorModelsV11(vendor: ApiVendor, rawModels: unknown): string[] {
  void vendor;
  return normalizeNimiRuntimeConfigConnectorModels(rawModels);
}

export function normalizeConnectorV11(raw: Partial<ApiConnector>): ApiConnector {
  return normalizeNimiRuntimeConfigConnectorProjection({
    ...raw,
    id: raw.id || randomIdV11('connector'),
    authMode: normalizeNimiRuntimeConfigConnectorAuthMode(raw.authMode) as NimiRuntimeConnectorAuthMode,
    scope: normalizeNimiRuntimeConfigConnectorScope(raw.scope) as NimiRuntimeConnectorScope,
  });
}

export function normalizeLocalModelV11(raw: Partial<LocalModelOptionV11>): LocalModelOptionV11 {
  return normalizeNimiRuntimeConfigLocalModelProjection(raw) as LocalModelOptionV11;
}

export function normalizeLocalNodeMatrixEntryV11(
  raw: Partial<LocalNodeMatrixEntryV11>,
): LocalNodeMatrixEntryV11 {
  return normalizeNimiRuntimeConfigLocalNodeMatrixEntryProjection(raw) as LocalNodeMatrixEntryV11;
}

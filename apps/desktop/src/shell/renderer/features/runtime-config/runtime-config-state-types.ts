import { createNimiClientId } from '@nimiplatform/sdk';
import type { TFunction } from 'i18next';
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
  NIMI_RUNTIME_CONFIG_DEFAULT_CONNECTOR_ENDPOINT,
  nimiRuntimeConfigConnectorVendorLabel,
  normalizeNimiRuntimeConfigEndpoint,
  normalizeNimiRuntimeConfigStringList,
  type NimiRuntimeConfigConnectorProjection,
  type NimiRuntimeConfigProviderStatus,
  type NimiRuntimeConnectorAuthMode,
  type NimiRuntimeConnectorScope,
} from '@nimiplatform/sdk/runtime';

export const CAPABILITIES_V11 = NIMI_RUNTIME_LOCAL_RUNNABLE_ASSET_KIND_IDS;
export type CapabilityV11 = NimiRuntimeLocalRunnableAssetKindId;

export type SourceIdV11 = 'local' | 'cloud';
/**
 * Runtime top-level pages. Model discovery and catalog-backed installation
 * stay inside Local Models; provider-scoped catalog overrides are contextual
 * actions rather than a first-level page.
 */
export type RuntimePageIdV11 =
  | 'overview'
  | 'profiles'
  | 'modelMarket'
  | 'localModels'
  | 'loadouts'
  | 'cloud'
  | 'environment';
export type UiModeV11 = 'simple' | 'advanced';
export type RuntimeConfigStatusV11 = NimiRuntimeConfigProviderStatus;
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
    page: 'localModels';
    action: 'install-model';
    focus: 'runtime-config-action-focus.local-models-discover';
  }
  | {
    page: 'loadouts';
    action: 'open-loadouts';
    focus: 'runtime-config-action-focus.loadouts';
  };

export type LocalStateV11 = {
  status: RuntimeConfigStatusV11;
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

export const DEFAULT_CONNECTOR_ENDPOINT_V11 = NIMI_RUNTIME_CONFIG_DEFAULT_CONNECTOR_ENDPOINT;

export function normalizeSourceV11(value: unknown): SourceIdV11 {
  return value === 'cloud' ? 'cloud' : 'local';
}

export function normalizePageIdV11(value: unknown): RuntimePageIdV11 {
  // Retired model navigation resolves to the nearest current task owner.
  if (value === 'models') {
    return 'localModels';
  }
  if (value === 'modelCatalog') {
    return 'cloud';
  }
  if (
    value === 'overview'
    || value === 'profiles'
    || value === 'modelMarket'
    || value === 'localModels'
    || value === 'loadouts'
    || value === 'cloud'
    || value === 'environment'
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
    record.page === 'localModels'
    && record.action === 'install-model'
    && record.focus === 'runtime-config-action-focus.local-models-discover'
  ) {
    return {
      page: 'localModels',
      action: 'install-model',
      focus: 'runtime-config-action-focus.local-models-discover',
    };
  }
  if (
    record.page === 'loadouts'
    && record.action === 'open-loadouts'
    && record.focus === 'runtime-config-action-focus.loadouts'
  ) {
    return {
      page: 'loadouts',
      action: 'open-loadouts',
      focus: 'runtime-config-action-focus.loadouts',
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

export function normalizeStatusV11(value: unknown): RuntimeConfigStatusV11 {
  return normalizeNimiRuntimeConfigConnectorStatus(value);
}

export function normalizeConnectorScopeV11(value: unknown): ApiConnectorScopeV11 {
  return normalizeNimiRuntimeConfigConnectorScope(value) as ApiConnectorScopeV11;
}

export function statusTextV11(status: RuntimeConfigStatusV11): string {
  if (status === 'healthy') return 'Healthy';
  if (status === 'degraded') return 'Degraded';
  if (status === 'unreachable') return 'Unreachable';
  if (status === 'unsupported') return 'Unsupported';
  return 'Not checked';
}

export function localizedStatusTextV11(status: RuntimeConfigStatusV11, t: TFunction): string {
  if (status === 'healthy') return t('runtimeConfig.common.statusHealthy', { defaultValue: statusTextV11(status) });
  if (status === 'degraded') return t('runtimeConfig.common.statusDegraded', { defaultValue: statusTextV11(status) });
  if (status === 'unreachable') return t('runtimeConfig.common.statusUnreachable', { defaultValue: statusTextV11(status) });
  if (status === 'unsupported') return t('runtimeConfig.common.statusUnsupported', { defaultValue: statusTextV11(status) });
  return t('runtimeConfig.common.statusNotChecked', { defaultValue: statusTextV11(status) });
}

export function statusClassV11(status: RuntimeConfigStatusV11): string {
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

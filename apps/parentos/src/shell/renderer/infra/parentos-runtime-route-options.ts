import { getPlatformClient } from '@nimiplatform/sdk';
import { createNimiError } from '@nimiplatform/sdk/runtime';
import {
  ReasonCode,
} from '@nimiplatform/sdk/types';
import {
  buildRuntimeRouteOptionsSnapshot,
  normalizeRuntimeRouteCapabilityToken,
  runtimeRouteLocalKindSupportsCapability,
  runtimeRouteModelSupportsCapability,
} from '@nimiplatform/sdk/mod';
import type {
  RuntimeCanonicalCapability,
  RuntimeRouteBinding,
  RuntimeRouteConnectorOption,
  RuntimeRouteLocalOption,
  RuntimeRouteOptionsSnapshot,
} from '@nimiplatform/sdk/mod';
import { useAppStore } from '../app-shell/app-store.js';
import { describeError, logRendererEvent } from './telemetry/renderer-log.js';

const CONNECTOR_KIND_REMOTE_MANAGED = 2;
const CONNECTOR_MODELS_PAGE_SIZE = 200;
const CONNECTOR_MODELS_MAX_PAGES = 200;
const LOCAL_ASSETS_PAGE_SIZE = 100;
const LOCAL_ASSETS_MAX_PAGES = 20;

type SupportedParentosCapability = 'text.generate' | 'audio.transcribe';

type LocalAssetRecord = {
  localAssetId: string;
  assetId: string;
  engine: string;
  endpoint?: string;
  status?: string;
  capabilities: string[];
  kind?: string;
  logicalModelId?: string;
};

type ConnectorRecord = {
  connectorId: string;
  provider: string;
  label: string;
};

type ConnectorModelRecord = {
  modelId: string;
  capabilities: string[];
};

function unsupportedCapabilityError(capability: string): Error {
  return createNimiError({
    message: `ParentOS route snapshot does not support capability ${capability}`,
    reasonCode: ReasonCode.ACTION_INPUT_INVALID,
    actionHint: 'use_text_generate_or_audio_transcribe',
    source: 'sdk',
  });
}

function asSupportedCapability(capability: RuntimeCanonicalCapability): SupportedParentosCapability {
  if (capability === 'text.generate' || capability === 'audio.transcribe') {
    return capability;
  }
  throw unsupportedCapabilityError(capability);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return String(value || '').trim();
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

function localAssetSupportsCapability(asset: LocalAssetRecord, capability: SupportedParentosCapability): boolean {
  return runtimeRouteModelSupportsCapability(asset.capabilities, capability)
    || runtimeRouteLocalKindSupportsCapability(asset.kind, capability);
}

function connectorModelSupportsCapability(model: ConnectorModelRecord, capability: SupportedParentosCapability): boolean {
  return runtimeRouteModelSupportsCapability(model.capabilities, capability);
}

function statusRank(value: string | undefined): number {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'active') return 0;
  if (normalized === 'installed') return 1;
  if (normalized === 'unhealthy') return 2;
  if (normalized === 'removed') return 3;
  return 4;
}

function normalizeAssetStatus(value: unknown): string | undefined {
  if (typeof value === 'number') {
    if (value === 2) return 'active';
    if (value === 3) return 'unhealthy';
    if (value === 4) return 'removed';
    return 'installed';
  }
  const normalized = asString(value).toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === 'active' || normalized === 'local_asset_status_active' || normalized === '2') return 'active';
  if (normalized === 'unhealthy' || normalized === 'local_asset_status_unhealthy' || normalized === '3') return 'unhealthy';
  if (normalized === 'removed' || normalized === 'local_asset_status_removed' || normalized === '4') return 'removed';
  if (normalized === 'installed' || normalized === 'local_asset_status_installed' || normalized === '1' || normalized === '0') return 'installed';
  return normalized;
}

function normalizeAssetKind(value: unknown): string | undefined {
  if (typeof value === 'number') {
    if (value === 1) return 'chat';
    if (value === 2) return 'image';
    if (value === 3) return 'video';
    if (value === 4) return 'tts';
    if (value === 5) return 'stt';
    if (value === 10) return 'vae';
    if (value === 11) return 'clip';
    if (value === 12) return 'lora';
    if (value === 13) return 'controlnet';
    if (value === 14) return 'auxiliary';
    return undefined;
  }
  const normalized = asString(value).toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === 'chat' || normalized === 'local_asset_kind_chat' || normalized === '1') return 'chat';
  if (normalized === 'image' || normalized === 'local_asset_kind_image' || normalized === '2') return 'image';
  if (normalized === 'video' || normalized === 'local_asset_kind_video' || normalized === '3') return 'video';
  if (normalized === 'tts' || normalized === 'local_asset_kind_tts' || normalized === '4') return 'tts';
  if (normalized === 'stt' || normalized === 'local_asset_kind_stt' || normalized === '5') return 'stt';
  if (normalized === 'vae' || normalized === 'local_asset_kind_vae' || normalized === '10') return 'vae';
  if (normalized === 'clip' || normalized === 'local_asset_kind_clip' || normalized === '11') return 'clip';
  if (normalized === 'lora' || normalized === 'local_asset_kind_lora' || normalized === '12') return 'lora';
  if (normalized === 'controlnet' || normalized === 'local_asset_kind_controlnet' || normalized === '13') return 'controlnet';
  if (normalized === 'auxiliary' || normalized === 'local_asset_kind_auxiliary' || normalized === '14') return 'auxiliary';
  return normalized;
}

function parseLocalAsset(value: unknown): LocalAssetRecord | null {
  const record = asRecord(value);
  const localAssetId = asString(record.localAssetId || record.local_asset_id);
  const assetId = asString(record.assetId || record.modelId || record.logicalModelId);
  if (!localAssetId || !assetId) {
    return null;
  }
  return {
    localAssetId,
    assetId,
    engine: asString(record.engine),
    endpoint: asString(record.endpoint) || undefined,
    status: normalizeAssetStatus(record.status),
    capabilities: asStringArray(record.capabilities),
    kind: normalizeAssetKind(record.kind),
    logicalModelId: asString(record.logicalModelId) || undefined,
  };
}

function parseConnector(value: unknown): ConnectorRecord | null {
  const record = asRecord(value);
  const connectorId = asString(record.connectorId);
  const provider = asString(record.provider);
  if (!connectorId || !provider) {
    return null;
  }
  return {
    connectorId,
    provider,
    label: asString(record.label) || provider,
  };
}

function parseConnectorModel(value: unknown): ConnectorModelRecord | null {
  const record = asRecord(value);
  if (!record.available) {
    return null;
  }
  const modelId = asString(record.modelId);
  if (!modelId) {
    return null;
  }
  return {
    modelId,
    capabilities: asStringArray(record.capabilities),
  };
}

async function listLocalAssets(): Promise<LocalAssetRecord[]> {
  const runtime = getPlatformClient().runtime.local;
  const assets: LocalAssetRecord[] = [];
  let pageToken = '';
  for (let pageIndex = 0; pageIndex < LOCAL_ASSETS_MAX_PAGES; pageIndex += 1) {
    const response = await runtime.listLocalAssets({
      statusFilter: 0,
      kindFilter: 0,
      engineFilter: '',
      pageSize: LOCAL_ASSETS_PAGE_SIZE,
      pageToken,
    });
    const record = asRecord(response);
    const pageAssets = Array.isArray(record.assets)
      ? record.assets.map(parseLocalAsset).filter((item): item is LocalAssetRecord => item !== null)
      : [];
    assets.push(...pageAssets);
    pageToken = asString(record.nextPageToken);
    if (!pageToken) {
      break;
    }
  }
  const deduped = new Map<string, LocalAssetRecord>();
  for (const asset of assets) {
    deduped.set(asset.localAssetId, asset);
  }
  return [...deduped.values()];
}

async function listManagedConnectors(): Promise<ConnectorRecord[]> {
  const response = await getPlatformClient().domains.runtimeAdmin.listConnectors({
    pageSize: 0,
    pageToken: '',
    kindFilter: CONNECTOR_KIND_REMOTE_MANAGED,
    statusFilter: 0,
    providerFilter: '',
  });
  const record = asRecord(response);
  const connectors = Array.isArray(record.connectors)
    ? record.connectors.map(parseConnector).filter((item): item is ConnectorRecord => item !== null)
    : [];
  return connectors;
}

async function listConnectorModels(connectorId: string): Promise<ConnectorModelRecord[]> {
  const runtimeAdmin = getPlatformClient().domains.runtimeAdmin;
  const models: ConnectorModelRecord[] = [];
  const seen = new Set<string>();
  let pageToken = '';
  for (let pageIndex = 0; pageIndex < CONNECTOR_MODELS_MAX_PAGES; pageIndex += 1) {
    const response = await runtimeAdmin.listConnectorModels({
      connectorId,
      forceRefresh: pageIndex === 0,
      pageSize: CONNECTOR_MODELS_PAGE_SIZE,
      pageToken,
    });
    const record = asRecord(response);
    const pageModels = Array.isArray(record.models)
      ? record.models.map(parseConnectorModel).filter((item): item is ConnectorModelRecord => item !== null)
      : [];
    for (const model of pageModels) {
      if (seen.has(model.modelId)) {
        continue;
      }
      seen.add(model.modelId);
      models.push(model);
    }
    pageToken = asString(record.nextPageToken);
    if (!pageToken) {
      break;
    }
  }
  return models;
}

function toLocalRouteOption(
  asset: LocalAssetRecord,
  capability: SupportedParentosCapability,
): RuntimeRouteLocalOption {
  const modelLabel = asset.logicalModelId || asset.assetId;
  const normalizedCapabilities = asset.capabilities
    .map((item) => normalizeRuntimeRouteCapabilityToken(item))
    .filter((item): item is SupportedParentosCapability => item === 'text.generate' || item === 'audio.transcribe');
  const routeCapabilities = normalizedCapabilities.length > 0
    ? normalizedCapabilities
    : (runtimeRouteLocalKindSupportsCapability(asset.kind, capability) ? [capability] : []);
  return {
    localModelId: asset.localAssetId,
    label: modelLabel,
    engine: asset.engine || undefined,
    model: asset.assetId,
    modelId: asset.assetId,
    provider: asset.engine || undefined,
    endpoint: asset.endpoint,
    status: asset.status,
    goRuntimeLocalModelId: asset.localAssetId,
    goRuntimeStatus: asset.status,
    capabilities: routeCapabilities,
  };
}

function readSelectedBinding(capability: SupportedParentosCapability): RuntimeRouteBinding | null {
  const selectedBindings = useAppStore.getState().aiConfig?.capabilities.selectedBindings || {};
  const binding = selectedBindings[capability] as RuntimeRouteBinding | null | undefined;
  if (!binding || !String(binding.model || '').trim()) {
    return null;
  }
  return {
    ...binding,
    connectorId: String(binding.connectorId || '').trim(),
    model: String(binding.model || '').trim(),
  };
}

export async function loadParentosRuntimeRouteOptions(
  capabilityInput: RuntimeCanonicalCapability,
): Promise<RuntimeRouteOptionsSnapshot> {
  const capability = asSupportedCapability(capabilityInput);
  const runtimeDefaults = useAppStore.getState().runtimeDefaults;
  const localDefaultEndpoint = capability === 'audio.transcribe'
    ? asString(runtimeDefaults?.runtime.localOpenAiEndpoint)
    : asString(runtimeDefaults?.runtime.localProviderEndpoint || runtimeDefaults?.runtime.localOpenAiEndpoint);

  let localAssets: LocalAssetRecord[] = [];
  try {
    localAssets = (await listLocalAssets())
      .filter((asset) => String(asset.status || '').trim().toLowerCase() !== 'removed')
      .filter((asset) => localAssetSupportsCapability(asset, capability))
      .sort((left, right) => {
        const rankDelta = statusRank(left.status) - statusRank(right.status);
        if (rankDelta !== 0) {
          return rankDelta;
        }
        return left.assetId.localeCompare(right.assetId);
      });
  } catch (error) {
    logRendererEvent({
      level: 'warn',
      area: 'runtime.route-options.local-assets',
      message: 'action:list-local-assets-failed',
      details: {
        capability,
        error: describeError(error),
      },
    });
    localAssets = [];
  }
  const localModels = localAssets.map((asset) => toLocalRouteOption(asset, capability));

  let connectors: ConnectorRecord[] = [];
  try {
    connectors = await listManagedConnectors();
  } catch (error) {
    logRendererEvent({
      level: 'warn',
      area: 'runtime.route-options.connectors',
      message: 'action:list-connectors-failed',
      details: {
        capability,
        error: describeError(error),
      },
    });
    connectors = [];
  }
  const connectorOptions: RuntimeRouteConnectorOption[] = [];
  for (const connector of connectors) {
    let models: ConnectorModelRecord[] = [];
    try {
      models = await listConnectorModels(connector.connectorId);
    } catch (error) {
      logRendererEvent({
        level: 'warn',
        area: 'runtime.route-options.connector-models',
        message: 'action:list-connector-models-failed',
        details: {
          capability,
          connectorId: connector.connectorId,
          error: describeError(error),
        },
      });
      models = [];
    }
    const matchingModels = models.filter((model) => connectorModelSupportsCapability(model, capability));
    if (matchingModels.length <= 0) {
      continue;
    }
    connectorOptions.push({
      id: connector.connectorId,
      label: connector.label,
      provider: connector.provider,
      models: matchingModels.map((model) => model.modelId),
      modelCapabilities: Object.fromEntries(
        matchingModels.map((model) => [model.modelId, model.capabilities]),
      ),
    });
  }
  connectorOptions.sort((left, right) => left.label.localeCompare(right.label));

  const selectedBinding = readSelectedBinding(capability);
  const snapshot = buildRuntimeRouteOptionsSnapshot({
    capability,
    selectedBinding,
    localModels,
    connectors: connectorOptions,
    defaultLocalEndpoint: localDefaultEndpoint || undefined,
  });
  logRendererEvent({
    level: 'info',
    area: 'runtime.route-options.snapshot',
    message: 'action:route-options-loaded',
    details: {
      capability,
      localModelCount: snapshot.local.models.length,
      connectorCount: snapshot.connectors.length,
      resolvedDefaultSource: snapshot.resolvedDefault?.source || '',
      selectedSource: snapshot.selected?.source || '',
    },
  });
  return snapshot;
}

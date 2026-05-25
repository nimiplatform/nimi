import type { PlatformClient } from '@nimiplatform/sdk';
import { ConnectorKind, ConnectorStatus } from '@nimiplatform/sdk/runtime';
import type {
  RouteConnector,
  RouteConnectorModel,
  RouteLocalModel,
  RouteModelPickerDataProvider,
} from '@nimiplatform/kit/features/model-picker';
import { getRuntimePlatformProjection } from '../shell/auth/runtime-platform.js';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean)
    : [];
}

type RuntimeConnectorRecord = RouteConnector & {
  kind: unknown;
  localCategory: unknown;
};

const LOCAL_CONNECTOR_CATEGORY_UNSPECIFIED = 0;
const LOCAL_CONNECTOR_CATEGORY_LLM = 1;
const LOCAL_CONNECTOR_CATEGORY_VISION = 2;
const LOCAL_CONNECTOR_CATEGORY_IMAGE = 3;
const LOCAL_CONNECTOR_CATEGORY_TTS = 4;
const LOCAL_CONNECTOR_CATEGORY_STT = 5;
const LOCAL_CONNECTOR_CATEGORY_CUSTOM = 6;

async function requireRuntimeClient(): Promise<PlatformClient> {
  const projection = await getRuntimePlatformProjection();
  if (projection.status !== 'ready') {
    throw new Error(projection.message || 'Runtime is unavailable; model catalog failed closed.');
  }
  return projection.client;
}

function statusName(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return 'unknown';
}

function normalizeConnector(value: unknown): RuntimeConnectorRecord | null {
  const record = asRecord(value);
  const connectorId = text(record.connectorId) || text(record.connector_id) || text(record.id);
  if (!connectorId) return null;
  const provider = text(record.provider) || connectorId;
  return {
    connectorId,
    provider,
    label: text(record.label) || provider,
    status: statusName(record.status),
    kind: record.kind,
    localCategory: record.localCategory ?? record.local_category,
  };
}

function normalizeConnectorModel(value: unknown, capability: string): RouteConnectorModel | null {
  const record = asRecord(value);
  const modelId = text(record.modelId) || text(record.model_id) || text(record.id) || text(record.model);
  if (!modelId) return null;
  const capabilities = stringList(record.capabilities);
  if (capability && capabilities.length > 0 && !capabilities.includes(capability)) {
    return null;
  }
  return {
    modelId,
    modelLabel: text(record.modelLabel) || text(record.model_label) || text(record.label) || modelId,
    available: typeof record.available === 'boolean' ? record.available : true,
    capabilities,
  };
}

function enumToken(value: unknown): string {
  if (typeof value === 'string') return value.trim().toUpperCase();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function isLocalConnector(connector: RuntimeConnectorRecord): boolean {
  const kind = enumToken(connector.kind);
  const localCategory = enumToken(connector.localCategory);
  return kind === String(ConnectorKind.LOCAL_MODEL)
    || kind === 'LOCAL_MODEL'
    || kind === 'CONNECTOR_KIND_LOCAL_MODEL'
    || (
      localCategory !== ''
      && localCategory !== String(LOCAL_CONNECTOR_CATEGORY_UNSPECIFIED)
      && localCategory !== 'UNSPECIFIED'
      && localCategory !== 'LOCAL_CONNECTOR_CATEGORY_UNSPECIFIED'
    );
}

function isRemoteManagedConnector(connector: RuntimeConnectorRecord): boolean {
  const kind = enumToken(connector.kind);
  return kind === String(ConnectorKind.REMOTE_MANAGED)
    || kind === 'REMOTE_MANAGED'
    || kind === 'CONNECTOR_KIND_REMOTE_MANAGED';
}

function localEngineFor(connector: RuntimeConnectorRecord): string {
  const category = enumToken(connector.localCategory);
  if (
    category === String(LOCAL_CONNECTOR_CATEGORY_TTS)
    || category === String(LOCAL_CONNECTOR_CATEGORY_STT)
    || category === 'TTS'
    || category === 'STT'
    || category === 'LOCAL_CONNECTOR_CATEGORY_TTS'
    || category === 'LOCAL_CONNECTOR_CATEGORY_STT'
  ) {
    return 'speech';
  }
  if (
    category === String(LOCAL_CONNECTOR_CATEGORY_VISION)
    || category === String(LOCAL_CONNECTOR_CATEGORY_IMAGE)
    || category === 'VISION'
    || category === 'IMAGE'
    || category === 'LOCAL_CONNECTOR_CATEGORY_VISION'
    || category === 'LOCAL_CONNECTOR_CATEGORY_IMAGE'
  ) {
    return 'media';
  }
  if (
    category === String(LOCAL_CONNECTOR_CATEGORY_CUSTOM)
    || category === 'CUSTOM'
    || category === 'LOCAL_CONNECTOR_CATEGORY_CUSTOM'
  ) {
    return 'sidecar';
  }
  if (
    category === String(LOCAL_CONNECTOR_CATEGORY_LLM)
    || category === 'LLM'
    || category === 'LOCAL_CONNECTOR_CATEGORY_LLM'
  ) {
    return 'runtime-local-llm';
  }
  return 'runtime-local-llm';
}

function localStatusFor(connector: RuntimeConnectorRecord, model: RouteConnectorModel): RouteLocalModel['status'] {
  if (!model.available) return 'unhealthy';
  const status = enumToken(connector.status);
  if (
    status === String(ConnectorStatus.ACTIVE)
    || status === 'ACTIVE'
    || status === 'CONNECTOR_STATUS_ACTIVE'
  ) {
    return 'active';
  }
  if (
    status === String(ConnectorStatus.DISABLED)
    || status === 'DISABLED'
    || status === 'CONNECTOR_STATUS_DISABLED'
  ) {
    return 'removed';
  }
  return 'installed';
}

async function listAllConnectors(client: PlatformClient): Promise<RuntimeConnectorRecord[]> {
  const connectors: RuntimeConnectorRecord[] = [];
  let pageToken = '';
  do {
    const response = await client.domains.runtimeAdmin.listConnectors({
      pageSize: 200,
      pageToken,
    });
    const records = Array.isArray(response.connectors) ? response.connectors : [];
    for (const connector of records) {
      const normalized = normalizeConnector(connector);
      if (normalized) connectors.push(normalized);
    }
    pageToken = text(response.nextPageToken);
  } while (pageToken);
  return connectors;
}

async function listAllConnectorModels(
  client: PlatformClient,
  connectorId: string,
  capability: string,
): Promise<RouteConnectorModel[]> {
  const models: RouteConnectorModel[] = [];
  let pageToken = '';
  do {
    const response = await client.domains.runtimeAdmin.listConnectorModels({
      connectorId,
      forceRefresh: false,
      pageSize: 200,
      pageToken,
    });
    const records = Array.isArray(response.models) ? response.models : [];
    for (const model of records) {
      const normalized = normalizeConnectorModel(model, capability);
      if (normalized) models.push(normalized);
    }
    pageToken = text(response.nextPageToken);
  } while (pageToken);
  return models;
}

async function listRuntimeLocalModels(client: PlatformClient, capability: string): Promise<RouteLocalModel[]> {
  const connectors = (await listAllConnectors(client)).filter(isLocalConnector);
  const byModelId = new Map<string, RouteLocalModel>();
  for (const connector of connectors) {
    const models = await listAllConnectorModels(client, connector.connectorId, capability);
    for (const model of models) {
      const modelId = text(model.modelId);
      if (!modelId || byModelId.has(modelId)) continue;
      byModelId.set(modelId, {
        localModelId: modelId,
        modelId,
        label: model.modelLabel || modelId,
        engine: localEngineFor(connector),
        status: localStatusFor(connector, model),
        capabilities: model.capabilities,
      });
    }
  }
  return [...byModelId.values()];
}

function toRouteConnector(connector: RuntimeConnectorRecord): RouteConnector {
  return {
    connectorId: connector.connectorId,
    provider: connector.provider,
    label: connector.label,
    status: connector.status,
  };
}

export function createTesterRuntimeModelPickerProviderFromClient(
  client: PlatformClient,
  capability: string,
): RouteModelPickerDataProvider {
  let connectorCache: RouteConnector[] | null = null;
  let localModelCache: RouteLocalModel[] | null = null;
  const modelCache = new Map<string, RouteConnectorModel[]>();

  return {
    async listLocalModels(): Promise<RouteLocalModel[]> {
      if (localModelCache) return localModelCache;
      localModelCache = await listRuntimeLocalModels(client, capability);
      return localModelCache;
    },
    async listConnectors(): Promise<RouteConnector[]> {
      if (connectorCache) return connectorCache;
      connectorCache = (await listAllConnectors(client))
        .filter((connector) => isRemoteManagedConnector(connector) && !isLocalConnector(connector))
        .map(toRouteConnector);
      return connectorCache;
    },
    async listConnectorModels(connectorId: string): Promise<RouteConnectorModel[]> {
      const normalizedConnectorId = text(connectorId);
      if (!normalizedConnectorId) return [];
      const cached = modelCache.get(normalizedConnectorId);
      if (cached) return cached;
      const models = await listAllConnectorModels(client, normalizedConnectorId, capability);
      modelCache.set(normalizedConnectorId, models);
      return models;
    },
    invalidate() {
      connectorCache = null;
      localModelCache = null;
      modelCache.clear();
    },
  };
}

export function createTesterRuntimeModelPickerProvider(capability: string): RouteModelPickerDataProvider {
  let providerPromise: Promise<RouteModelPickerDataProvider> | null = null;

  async function resolveProvider(): Promise<RouteModelPickerDataProvider> {
    if (!providerPromise) {
      providerPromise = requireRuntimeClient()
        .then((client) => createTesterRuntimeModelPickerProviderFromClient(client, capability));
    }
    return providerPromise;
  }

  const provider: RouteModelPickerDataProvider = {
    async listLocalModels() {
      return (await resolveProvider()).listLocalModels();
    },
    async listConnectors() {
      return (await resolveProvider()).listConnectors();
    },
    async listConnectorModels(connectorId: string) {
      return (await resolveProvider()).listConnectorModels(connectorId);
    },
    invalidate() {
      if (providerPromise) {
        void providerPromise.then((resolved) => resolved.invalidate?.());
      }
      providerPromise = null;
    },
  };
  return provider;
}

import {
  DEFAULT_LOCAL_ENDPOINT_V11,
  normalizeCapabilityV11,
  normalizeEndpointV11,
  normalizeLocalModelV11,
  normalizeLocalNodeMatrixEntryV11,
  normalizePageIdV11,
  normalizeSourceV11,
  normalizeUiModeV11,
  type RuntimeConfigStateV11,
} from './runtime-config-state-types';
import type { JsonObject } from '@runtime/net/json';
import type { RuntimeConfigSeedV11, StoredStateV11 } from './runtime-config-storage-defaults';
import { createDefaultStateV11 } from './runtime-config-storage-defaults';

function parseOptionalJsonObject(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
}

function normalizeLocalFromAny(
  seed: RuntimeConfigSeedV11,
  parsed: StoredStateV11 & JsonObject,
  fallback: RuntimeConfigStateV11,
): RuntimeConfigStateV11['local'] {
  const rawLocalRecord = parseOptionalJsonObject(parsed.local) || {};
  const rawLocal = rawLocalRecord as Partial<RuntimeConfigStateV11['local']>;

  const endpoint = normalizeEndpointV11(
    String(rawLocalRecord.endpoint || seed.localProviderEndpoint || seed.localOpenAiEndpoint),
    DEFAULT_LOCAL_ENDPOINT_V11,
  );

  const rawModels = Array.isArray(rawLocalRecord.models)
    ? rawLocalRecord.models
    : [];
  const models = rawModels
    .map((item) => parseOptionalJsonObject(item))
    .filter((item): item is JsonObject => Boolean(item))
    .map((item) => normalizeLocalModelV11(item as Partial<RuntimeConfigStateV11['local']['models'][number]>));
  const rawNodeMatrix = Array.isArray(rawLocalRecord.nodeMatrix)
    ? rawLocalRecord.nodeMatrix
    : [];
  const nodeMatrix = rawNodeMatrix
    .map((item) => parseOptionalJsonObject(item))
    .filter((item): item is JsonObject => Boolean(item))
    .map((item) => normalizeLocalNodeMatrixEntryV11(item as Partial<RuntimeConfigStateV11['local']['nodeMatrix'][number]>));

  return {
    ...fallback.local,
    ...(rawLocal || {}),
    endpoint,
    models: models.length > 0 ? models : fallback.local.models,
    nodeMatrix: nodeMatrix.length > 0 ? nodeMatrix : fallback.local.nodeMatrix,
  };
}

export function normalizeStoredStateV11(seed: RuntimeConfigSeedV11, parsed: StoredStateV11): RuntimeConfigStateV11 {
  const fallback = createDefaultStateV11(seed);
  const parsedRecord = parsed as StoredStateV11 & JsonObject;
  const local = normalizeLocalFromAny(seed, parsedRecord, fallback);

  const rawActivePage = parsedRecord.activePage || fallback.activePage;

  // Connectors are NOT loaded from localStorage — runtime bridge config (config.json)
  // is the single source of truth. Connectors start empty and are populated by bridge merge.
  return {
    version: 12,
    initializedByV11: Boolean(parsed.initializedByV11),
    activePage: normalizePageIdV11(rawActivePage),
    diagnosticsCollapsed: parsed.diagnosticsCollapsed !== false,
    uiMode: normalizeUiModeV11(parsed.uiMode || fallback.uiMode),
    selectedSource: normalizeSourceV11(parsed.selectedSource || fallback.selectedSource),
    activeCapability: normalizeCapabilityV11(parsed.activeCapability || fallback.activeCapability),
    local,
    connectors: [],
    selectedConnectorId: '',
  };
}

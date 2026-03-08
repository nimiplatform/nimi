import {
  DEFAULT_LOCAL_RUNTIME_ENDPOINT_V11,
  normalizeCapabilityV11,
  normalizeEndpointV11,
  normalizeLocalRuntimeModelV11,
  normalizeLocalRuntimeNodeMatrixEntryV11,
  normalizePageIdV11,
  normalizeSourceV11,
  normalizeUiModeV11,
  type RuntimeConfigStateV11,
} from './runtime-config-state-types';
import type { RuntimeConfigSeedV11, StoredStateV11 } from './runtime-config-storage-defaults';
import { createDefaultStateV11 } from './runtime-config-storage-defaults';

function normalizeLocalRuntimeFromAny(
  seed: RuntimeConfigSeedV11,
  parsed: StoredStateV11 & Record<string, unknown>,
  fallback: RuntimeConfigStateV11,
): RuntimeConfigStateV11['localRuntime'] {
  const rawLocalRuntime = (parsed.localRuntime && typeof parsed.localRuntime === 'object')
    ? parsed.localRuntime as Partial<RuntimeConfigStateV11['localRuntime']>
    : null;
  const rawLocalRuntimeRecord = (rawLocalRuntime ?? {}) as Record<string, unknown>;

  const endpoint = normalizeEndpointV11(
    String(rawLocalRuntimeRecord.endpoint || seed.localProviderEndpoint || seed.localOpenAiEndpoint),
    DEFAULT_LOCAL_RUNTIME_ENDPOINT_V11,
  );

  const rawModels = Array.isArray(rawLocalRuntimeRecord.models) ? rawLocalRuntimeRecord.models : [];
  const localRuntimeModels = rawModels
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .map((item) => normalizeLocalRuntimeModelV11(item as Partial<RuntimeConfigStateV11['localRuntime']['models'][number]>));
  const models = localRuntimeModels.length > 0
    ? localRuntimeModels
    : fallback.localRuntime.models;
  const rawNodeMatrix = Array.isArray(rawLocalRuntimeRecord.nodeMatrix)
    ? rawLocalRuntimeRecord.nodeMatrix
    : [];
  const nodeMatrix = rawNodeMatrix
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .map((item) => normalizeLocalRuntimeNodeMatrixEntryV11(item as Partial<RuntimeConfigStateV11['localRuntime']['nodeMatrix'][number]>));

  return {
    ...fallback.localRuntime,
    ...(rawLocalRuntime || {}),
    endpoint,
    models,
    nodeMatrix: nodeMatrix.length > 0 ? nodeMatrix : fallback.localRuntime.nodeMatrix,
  };
}

export function normalizeStoredStateV11(seed: RuntimeConfigSeedV11, parsed: StoredStateV11): RuntimeConfigStateV11 {
  const fallback = createDefaultStateV11(seed);
  const parsedRecord = parsed as StoredStateV11 & Record<string, unknown>;
  const localRuntime = normalizeLocalRuntimeFromAny(seed, parsedRecord, fallback);

  const rawActivePage = parsedRecord.activePage || fallback.activePage;

  // Connectors are NOT loaded from localStorage — runtime bridge config (config.json)
  // is the single source of truth. Connectors start empty and are populated by bridge merge.
  return {
    version: 11,
    initializedByV11: Boolean(parsed.initializedByV11),
    activePage: normalizePageIdV11(rawActivePage),
    diagnosticsCollapsed: parsed.diagnosticsCollapsed !== false,
    uiMode: normalizeUiModeV11(parsed.uiMode || fallback.uiMode),
    selectedSource: normalizeSourceV11(parsed.selectedSource || fallback.selectedSource),
    activeCapability: normalizeCapabilityV11(parsed.activeCapability || fallback.activeCapability),
    localRuntime,
    connectors: [],
    selectedConnectorId: '',
  };
}

import type { NimiRoutePolicy, Runtime } from '@nimiplatform/sdk/runtime';

export type LookdevRouteCapability = 'text.generate' | 'image.generate' | 'text.generate.vision';
export type LookdevRouteSource = 'local' | 'cloud';

export type LookdevRuntimeTargetOption = {
  key: string;
  capability: LookdevRouteCapability;
  source: LookdevRouteSource;
  route: NimiRoutePolicy;
  connectorId: string;
  connectorLabel: string;
  endpoint: string;
  provider: string;
  modelId: string;
  modelLabel: string;
  localModelId?: string;
};

export type LookdevRouteLoadIssue = {
  scope: 'local-models' | 'connectors' | 'connector-models';
  kind: 'timeout' | 'runtime-error';
  message: string;
  connectorId?: string;
  capability?: LookdevRouteCapability;
};

export type LookdevRouteCatalog = {
  capability: LookdevRouteCapability;
  options: LookdevRuntimeTargetOption[];
  defaultTargetKey?: string;
  loadStatus: 'ready' | 'degraded' | 'failed';
  issues: LookdevRouteLoadIssue[];
};

export type LookdevRuntimeTargetPreference = {
  connectorId?: string;
  provider?: string;
  modelId?: string;
  localModelId?: string;
  source?: LookdevRouteSource;
};

const LOAD_TIMEOUT_MS = 3_500;

const LOCAL_STATUS_MAP: Record<number, number> = {
  2: 0,
  1: 1,
  3: 2,
  4: 3,
  0: 4,
};

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}

function normalizeLocalModelId(modelId: string): string {
  const normalized = normalizeText(modelId);
  if (!normalized) {
    return '';
  }
  return normalized.startsWith('local/') ? normalized : `local/${normalized}`;
}

function displayLocalModelId(modelId: string): string {
  const normalized = normalizeText(modelId);
  return normalized.startsWith('local/') ? normalized.slice('local/'.length) : normalized;
}

function createLoadIssue(
  scope: LookdevRouteLoadIssue['scope'],
  kind: LookdevRouteLoadIssue['kind'],
  message: string,
  extras?: Pick<LookdevRouteLoadIssue, 'connectorId' | 'capability'>,
): LookdevRouteLoadIssue {
  return {
    scope,
    kind,
    message,
    ...(extras?.connectorId ? { connectorId: extras.connectorId } : {}),
    ...(extras?.capability ? { capability: extras.capability } : {}),
  };
}

function toLoadIssue(
  scope: LookdevRouteLoadIssue['scope'],
  error: unknown,
  extras?: Pick<LookdevRouteLoadIssue, 'connectorId' | 'capability'>,
): LookdevRouteLoadIssue {
  const message = error instanceof Error ? error.message : String(error || 'unknown runtime route failure');
  return createLoadIssue(
    scope,
    message.startsWith('timeout:') ? 'timeout' : 'runtime-error',
    message,
    extras,
  );
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout:${label}:${LOAD_TIMEOUT_MS}`)), LOAD_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function localStatusRank(value: unknown): number {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return LOCAL_STATUS_MAP[numeric] ?? Number.MAX_SAFE_INTEGER;
  }
  return Number.MAX_SAFE_INTEGER;
}

export function getRuntimeTargetOptionKey(input: {
  source: LookdevRouteSource;
  capability: LookdevRouteCapability;
  connectorId?: string;
  modelId: string;
  localModelId?: string;
}): string {
  return [
    input.capability,
    input.source,
    normalizeText(input.connectorId),
    normalizeText(input.modelId),
    normalizeText(input.localModelId),
  ].join('::');
}

function createLocalTargetOption(input: {
  capability: LookdevRouteCapability;
  modelId: string;
  localModelId?: string;
  engine?: string;
}): LookdevRuntimeTargetOption {
  const resolvedModelId = normalizeLocalModelId(input.modelId || input.localModelId || '');
  return {
    key: getRuntimeTargetOptionKey({
      capability: input.capability,
      source: 'local',
      modelId: resolvedModelId,
      localModelId: input.localModelId,
    }),
    capability: input.capability,
    source: 'local',
    route: 'local',
    connectorId: '',
    connectorLabel: '',
    endpoint: '',
    provider: normalizeText(input.engine) || 'local',
    modelId: resolvedModelId,
    modelLabel: displayLocalModelId(resolvedModelId) || normalizeText(input.localModelId) || resolvedModelId,
    localModelId: normalizeText(input.localModelId) || undefined,
  };
}

function createCloudTargetOption(input: {
  capability: LookdevRouteCapability;
  connectorId: string;
  connectorLabel: string;
  endpoint: string;
  provider: string;
  modelId: string;
  modelLabel: string;
}): LookdevRuntimeTargetOption {
  return {
    key: getRuntimeTargetOptionKey({
      capability: input.capability,
      source: 'cloud',
      connectorId: input.connectorId,
      modelId: input.modelId,
    }),
    capability: input.capability,
    source: 'cloud',
    route: 'cloud',
    connectorId: input.connectorId,
    connectorLabel: input.connectorLabel,
    endpoint: input.endpoint,
    provider: input.provider,
    modelId: input.modelId,
    modelLabel: input.modelLabel,
  };
}

async function loadLocalOptions(
  runtime: Runtime,
  capability: LookdevRouteCapability,
): Promise<LookdevRuntimeTargetOption[]> {
  const response = await withTimeout(
    runtime.local.listLocalAssets({} as Parameters<typeof runtime.local.listLocalAssets>[0]),
    `lookdev-local-models:${capability}`,
  );
  return (response.assets || [])
    .filter((asset) => asset.capabilities.includes(capability))
    .sort((left, right) => {
      const rankDelta = localStatusRank(left.status) - localStatusRank(right.status);
      if (rankDelta !== 0) {
        return rankDelta;
      }
      return normalizeText(left.localAssetId || left.logicalModelId || left.assetId).localeCompare(
        normalizeText(right.localAssetId || right.logicalModelId || right.assetId),
      );
    })
    .map((asset) => createLocalTargetOption({
      capability,
      modelId: normalizeText(asset.logicalModelId || asset.assetId || asset.localAssetId),
      localModelId: normalizeText(asset.localAssetId) || undefined,
      engine: normalizeText(asset.engine) || undefined,
    }))
    .filter((option) => Boolean(option.modelId));
}

async function loadCloudOptions(
  runtime: Runtime,
  capability: LookdevRouteCapability,
): Promise<{ options: LookdevRuntimeTargetOption[]; issues: LookdevRouteLoadIssue[] }> {
  const connectorsResponse = await withTimeout(
    runtime.connector.listConnectors({} as Parameters<typeof runtime.connector.listConnectors>[0]),
    `lookdev-connectors:${capability}`,
  );
  const issues: LookdevRouteLoadIssue[] = [];
  const options: LookdevRuntimeTargetOption[] = [];

  await Promise.all((connectorsResponse.connectors || []).map(async (connector) => {
    try {
      const modelsResponse = await withTimeout(
        runtime.connector.listConnectorModels({
          connectorId: connector.connectorId,
        } as Parameters<typeof runtime.connector.listConnectorModels>[0]),
        `lookdev-connector-models:${connector.connectorId}:${capability}`,
      );
      for (const model of modelsResponse.models || []) {
        if (!model.available || !model.capabilities.includes(capability)) {
          continue;
        }
        options.push(createCloudTargetOption({
          capability,
          connectorId: normalizeText(connector.connectorId),
          connectorLabel: normalizeText(connector.label || connector.provider || connector.connectorId),
          endpoint: normalizeText(connector.endpoint),
          provider: normalizeText(connector.provider),
          modelId: normalizeText(model.modelId),
          modelLabel: normalizeText(model.modelLabel || model.modelId),
        }));
      }
    } catch (error) {
      issues.push(toLoadIssue('connector-models', error, {
        connectorId: normalizeText(connector.connectorId),
        capability,
      }));
    }
  }));

  options.sort((left, right) => {
    const connectorDelta = normalizeText(left.connectorLabel || left.provider).localeCompare(normalizeText(right.connectorLabel || right.provider));
    if (connectorDelta !== 0) {
      return connectorDelta;
    }
    return normalizeText(left.modelLabel || left.modelId).localeCompare(normalizeText(right.modelLabel || right.modelId));
  });

  return { options, issues };
}

export function pickDefaultRuntimeTargetOption(
  options: LookdevRuntimeTargetOption[],
  preference?: LookdevRuntimeTargetPreference,
): LookdevRuntimeTargetOption | null {
  if (options.length === 0) {
    return null;
  }
  const normalizedConnectorId = normalizeText(preference?.connectorId);
  const normalizedProvider = normalizeText(preference?.provider);
  const normalizedModelId = normalizeText(preference?.modelId);
  const normalizedLocalModelId = normalizeText(preference?.localModelId);
  const normalizedSource = normalizeText(preference?.source);

  const exactConfiguredCloudTarget = options.find((option) =>
    option.source === 'cloud'
    && normalizedConnectorId
    && option.connectorId === normalizedConnectorId
    && normalizedModelId
    && option.modelId === normalizedModelId);
  if (exactConfiguredCloudTarget) {
    return exactConfiguredCloudTarget;
  }

  const configuredConnectorTarget = options.find((option) =>
    option.source === 'cloud'
    && normalizedConnectorId
    && option.connectorId === normalizedConnectorId);
  if (configuredConnectorTarget) {
    return configuredConnectorTarget;
  }

  const exactConfiguredProviderTarget = options.find((option) =>
    option.source === 'cloud'
    && normalizedProvider
    && option.provider === normalizedProvider
    && normalizedModelId
    && option.modelId === normalizedModelId);
  if (exactConfiguredProviderTarget) {
    return exactConfiguredProviderTarget;
  }

  const configuredProviderTarget = options.find((option) =>
    option.source === 'cloud'
    && normalizedProvider
    && option.provider === normalizedProvider);
  if (configuredProviderTarget) {
    return configuredProviderTarget;
  }

  const configuredLocalTarget = options.find((option) =>
    option.source === 'local'
    && normalizedLocalModelId
    && (option.localModelId === normalizedLocalModelId || option.modelId === normalizeLocalModelId(normalizedLocalModelId)));
  if (configuredLocalTarget) {
    return configuredLocalTarget;
  }

  if (normalizedSource === 'cloud') {
    const firstCloudTarget = options.find((option) => option.source === 'cloud');
    if (firstCloudTarget) {
      return firstCloudTarget;
    }
  }
  if (normalizedSource === 'local') {
    const firstLocalTarget = options.find((option) => option.source === 'local');
    if (firstLocalTarget) {
      return firstLocalTarget;
    }
  }
  return options.find((option) => option.source === 'local') || options[0] || null;
}

export async function loadRuntimeTargetCatalog(
  runtime: Runtime,
  capability: LookdevRouteCapability,
): Promise<LookdevRouteCatalog> {
  const issues: LookdevRouteLoadIssue[] = [];

  const [localResult, cloudResult] = await Promise.allSettled([
    loadLocalOptions(runtime, capability),
    loadCloudOptions(runtime, capability),
  ]);

  const options: LookdevRuntimeTargetOption[] = [];

  if (localResult.status === 'fulfilled') {
    options.push(...localResult.value);
  } else {
    issues.push(toLoadIssue('local-models', localResult.reason, { capability }));
  }

  if (cloudResult.status === 'fulfilled') {
    options.push(...cloudResult.value.options);
    issues.push(...cloudResult.value.issues);
  } else {
    issues.push(toLoadIssue('connectors', cloudResult.reason, { capability }));
  }

  const defaultTarget = pickDefaultRuntimeTargetOption(options);
  const loadStatus: LookdevRouteCatalog['loadStatus'] = issues.length === 0
    ? 'ready'
    : options.length === 0
      ? 'failed'
      : 'degraded';

  return {
    capability,
    options,
    defaultTargetKey: defaultTarget?.key,
    loadStatus,
    issues,
  };
}

import type { NimiRoutePolicy, Runtime } from '@nimiplatform/sdk/runtime';

export type MomentRouteCapability = 'text.generate' | 'text.generate.vision';
export type MomentRouteSource = 'local' | 'cloud';

export type MomentRuntimeTargetOption = {
  key: string;
  capability: MomentRouteCapability;
  source: MomentRouteSource;
  route: NimiRoutePolicy;
  connectorId: string;
  connectorLabel: string;
  endpoint: string;
  provider: string;
  modelId: string;
  modelLabel: string;
  localModelId?: string;
};

export type MomentRouteLoadIssue = {
  scope: 'local-models' | 'connectors' | 'connector-models';
  kind: 'timeout' | 'runtime-error';
  message: string;
  connectorId?: string;
  capability?: MomentRouteCapability;
};

export type MomentRouteCatalog = {
  capability: MomentRouteCapability;
  options: MomentRuntimeTargetOption[];
  defaultTargetKey?: string;
  loadStatus: 'ready' | 'degraded' | 'failed';
  issues: MomentRouteLoadIssue[];
};

export type MomentRuntimeTargetPreference = {
  connectorId?: string;
  provider?: string;
  modelId?: string;
  localModelId?: string;
  source?: MomentRouteSource;
};

const LOAD_TIMEOUT_MS = 3_500;

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
  scope: MomentRouteLoadIssue['scope'],
  kind: MomentRouteLoadIssue['kind'],
  message: string,
  extras?: Pick<MomentRouteLoadIssue, 'connectorId' | 'capability'>,
): MomentRouteLoadIssue {
  return {
    scope,
    kind,
    message,
    ...(extras?.connectorId ? { connectorId: extras.connectorId } : {}),
    ...(extras?.capability ? { capability: extras.capability } : {}),
  };
}

function toLoadIssue(
  scope: MomentRouteLoadIssue['scope'],
  error: unknown,
  extras?: Pick<MomentRouteLoadIssue, 'connectorId' | 'capability'>,
): MomentRouteLoadIssue {
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

export function getRuntimeTargetOptionKey(input: {
  source: MomentRouteSource;
  capability: MomentRouteCapability;
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
  capability: MomentRouteCapability;
  modelId: string;
  localModelId?: string;
  engine?: string;
}): MomentRuntimeTargetOption {
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
  capability: MomentRouteCapability;
  connectorId: string;
  connectorLabel: string;
  endpoint: string;
  provider: string;
  modelId: string;
  modelLabel: string;
}): MomentRuntimeTargetOption {
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
  capability: MomentRouteCapability,
): Promise<MomentRuntimeTargetOption[]> {
  const response = await withTimeout(
    runtime.local.listLocalModels({} as Parameters<typeof runtime.local.listLocalModels>[0]),
    `moment-local-models:${capability}`,
  );

  return (response.models || [])
    .filter((model) => model.capabilities.includes(capability))
    .map((model) => createLocalTargetOption({
      capability,
      modelId: normalizeText(model.modelId || model.localModelId),
      localModelId: normalizeText(model.localModelId) || undefined,
      engine: normalizeText(model.engine) || undefined,
    }))
    .filter((option) => Boolean(option.modelId));
}

async function loadCloudOptions(
  runtime: Runtime,
  capability: MomentRouteCapability,
): Promise<{ options: MomentRuntimeTargetOption[]; issues: MomentRouteLoadIssue[] }> {
  const connectorsResponse = await withTimeout(
    runtime.connector.listConnectors({} as Parameters<typeof runtime.connector.listConnectors>[0]),
    `moment-connectors:${capability}`,
  );

  const issues: MomentRouteLoadIssue[] = [];
  const options: MomentRuntimeTargetOption[] = [];

  await Promise.all((connectorsResponse.connectors || []).map(async (connector) => {
    try {
      const modelsResponse = await withTimeout(
        runtime.connector.listConnectorModels({
          connectorId: connector.connectorId,
        } as Parameters<typeof runtime.connector.listConnectorModels>[0]),
        `moment-connector-models:${connector.connectorId}:${capability}`,
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

  options.sort((left, right) => left.modelLabel.localeCompare(right.modelLabel));
  return { options, issues };
}

export function pickDefaultRuntimeTargetOption(
  options: MomentRuntimeTargetOption[],
  preference: MomentRuntimeTargetPreference,
): MomentRuntimeTargetOption | undefined {
  if (options.length === 0) {
    return undefined;
  }

  const normalizedConnectorId = normalizeText(preference.connectorId);
  const normalizedProvider = normalizeText(preference.provider).toLowerCase();
  const normalizedModelId = normalizeText(preference.modelId);
  const normalizedLocalModelId = normalizeLocalModelId(preference.localModelId || '');
  const normalizedSource = normalizeText(preference.source);

  return options.find((option) => (
    (normalizedSource ? option.source === normalizedSource : true)
    && (normalizedConnectorId ? option.connectorId === normalizedConnectorId : true)
    && (normalizedProvider ? option.provider.toLowerCase() === normalizedProvider : true)
    && (normalizedModelId ? option.modelId === normalizedModelId : true)
    && (normalizedLocalModelId ? option.modelId === normalizedLocalModelId : true)
  )) || options[0];
}

export async function loadRuntimeTargetCatalog(
  runtime: Runtime,
  capability: MomentRouteCapability,
): Promise<MomentRouteCatalog> {
  const issues: MomentRouteLoadIssue[] = [];
  const options: MomentRuntimeTargetOption[] = [];

  try {
    options.push(...await loadLocalOptions(runtime, capability));
  } catch (error) {
    issues.push(toLoadIssue('local-models', error, { capability }));
  }

  try {
    const cloud = await loadCloudOptions(runtime, capability);
    options.push(...cloud.options);
    issues.push(...cloud.issues);
  } catch (error) {
    issues.push(toLoadIssue('connectors', error, { capability }));
  }

  return {
    capability,
    options,
    loadStatus: options.length === 0 ? 'failed' : issues.length > 0 ? 'degraded' : 'ready',
    issues,
  };
}

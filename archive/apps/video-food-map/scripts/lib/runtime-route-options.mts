import { Runtime } from '../../../../sdk/src/runtime/index.ts';

export type VideoFoodMapRouteCapability = 'audio.transcribe' | 'text.generate';
export type VideoFoodMapRouteSource = 'local' | 'cloud';

export type VideoFoodMapRouteSetting = {
  routeSource: VideoFoodMapRouteSource;
  connectorId: string;
  model: string;
};

export type VideoFoodMapRuntimeSettings = {
  stt: VideoFoodMapRouteSetting;
  text: VideoFoodMapRouteSetting;
};

export type VideoFoodMapRuntimeOption = {
  key: string;
  capability: VideoFoodMapRouteCapability;
  source: VideoFoodMapRouteSource;
  connectorId: string;
  connectorLabel: string;
  provider: string;
  modelId: string;
  modelLabel: string;
  localModelId?: string;
};

export type VideoFoodMapRuntimeOptionsIssue = {
  scope: 'local-models' | 'connectors' | 'connector-models';
  kind: 'timeout' | 'runtime-error';
  message: string;
  connectorId?: string;
  capability?: VideoFoodMapRouteCapability;
};

export type VideoFoodMapRuntimeOptionsCatalog = {
  options: VideoFoodMapRuntimeOption[];
  loadStatus: 'ready' | 'degraded' | 'failed';
  issues: VideoFoodMapRuntimeOptionsIssue[];
};

export type VideoFoodMapRuntimeOptions = {
  stt: VideoFoodMapRuntimeOptionsCatalog;
  text: VideoFoodMapRuntimeOptionsCatalog;
};

export const DEFAULT_VIDEO_FOOD_MAP_ROUTE_SETTING: VideoFoodMapRouteSetting = {
  routeSource: 'cloud',
  connectorId: '',
  model: '',
};

export const DEFAULT_VIDEO_FOOD_MAP_RUNTIME_SETTINGS: VideoFoodMapRuntimeSettings = {
  stt: { ...DEFAULT_VIDEO_FOOD_MAP_ROUTE_SETTING },
  text: { ...DEFAULT_VIDEO_FOOD_MAP_ROUTE_SETTING },
};

const DEFAULT_APP_ID = 'nimi.video.food.route-options';
const DEFAULT_SUBJECT_USER_ID = 'video-food-route-options';
const DEFAULT_RUNTIME_GRPC_ADDR = '127.0.0.1:46371';
const LOAD_TIMEOUT_MS = 3_500;

const CAPABILITY_ALIAS: Record<string, VideoFoodMapRouteCapability> = {
  chat: 'text.generate',
  embedding: 'text.generate',
  image: 'text.generate',
  speech: 'audio.transcribe',
  stt: 'audio.transcribe',
  transcription: 'audio.transcribe',
};

const LOCAL_STATUS_RANK: Record<number, number> = {
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

function normalizeCapability(value: string): string {
  const normalized = normalizeText(value).toLowerCase();
  return CAPABILITY_ALIAS[normalized] ?? normalized;
}

function isMatchingCapability(capabilities: string[], capability: VideoFoodMapRouteCapability): boolean {
  return capabilities.map(normalizeCapability).includes(capability);
}

function normalizeRouteSource(value: unknown): VideoFoodMapRouteSource {
  return normalizeText(value) === 'local' ? 'local' : 'cloud';
}

function normalizeRouteSetting(value: unknown): VideoFoodMapRouteSetting {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_VIDEO_FOOD_MAP_ROUTE_SETTING };
  }
  const record = value as Record<string, unknown>;
  return {
    routeSource: normalizeRouteSource(record.routeSource),
    connectorId: normalizeText(record.connectorId),
    model: normalizeText(record.model),
  };
}

export function normalizeVideoFoodMapRuntimeSettings(value: unknown): VideoFoodMapRuntimeSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      stt: { ...DEFAULT_VIDEO_FOOD_MAP_RUNTIME_SETTINGS.stt },
      text: { ...DEFAULT_VIDEO_FOOD_MAP_RUNTIME_SETTINGS.text },
    };
  }
  const record = value as Record<string, unknown>;
  return {
    stt: normalizeRouteSetting(record.stt),
    text: normalizeRouteSetting(record.text),
  };
}

function createIssue(
  scope: VideoFoodMapRuntimeOptionsIssue['scope'],
  kind: VideoFoodMapRuntimeOptionsIssue['kind'],
  message: string,
  extras?: Pick<VideoFoodMapRuntimeOptionsIssue, 'connectorId' | 'capability'>,
): VideoFoodMapRuntimeOptionsIssue {
  return {
    scope,
    kind,
    message,
    ...(extras?.connectorId ? { connectorId: extras.connectorId } : {}),
    ...(extras?.capability ? { capability: extras.capability } : {}),
  };
}

function toIssue(
  scope: VideoFoodMapRuntimeOptionsIssue['scope'],
  error: unknown,
  extras?: Pick<VideoFoodMapRuntimeOptionsIssue, 'connectorId' | 'capability'>,
): VideoFoodMapRuntimeOptionsIssue {
  const message = error instanceof Error ? error.message : String(error || 'unknown runtime failure');
  return createIssue(
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
  if (!Number.isFinite(numeric)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return LOCAL_STATUS_RANK[numeric] ?? Number.MAX_SAFE_INTEGER;
}

function buildOptionKey(input: {
  capability: VideoFoodMapRouteCapability;
  source: VideoFoodMapRouteSource;
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

function createLocalOption(input: {
  capability: VideoFoodMapRouteCapability;
  modelId: string;
  localModelId?: string;
  provider?: string;
}): VideoFoodMapRuntimeOption {
  const resolvedModelId = normalizeLocalModelId(input.modelId || input.localModelId || '');
  return {
    key: buildOptionKey({
      capability: input.capability,
      source: 'local',
      modelId: resolvedModelId,
      localModelId: input.localModelId,
    }),
    capability: input.capability,
    source: 'local',
    connectorId: '',
    connectorLabel: '',
    provider: normalizeText(input.provider) || 'local',
    modelId: resolvedModelId,
    modelLabel: displayLocalModelId(resolvedModelId) || normalizeText(input.localModelId) || resolvedModelId,
    localModelId: normalizeText(input.localModelId) || undefined,
  };
}

function createCloudOption(input: {
  capability: VideoFoodMapRouteCapability;
  connectorId: string;
  connectorLabel: string;
  provider: string;
  modelId: string;
  modelLabel: string;
}): VideoFoodMapRuntimeOption {
  return {
    key: buildOptionKey({
      capability: input.capability,
      source: 'cloud',
      connectorId: input.connectorId,
      modelId: input.modelId,
    }),
    capability: input.capability,
    source: 'cloud',
    connectorId: input.connectorId,
    connectorLabel: input.connectorLabel,
    provider: input.provider,
    modelId: input.modelId,
    modelLabel: input.modelLabel,
  };
}

async function loadLocalOptions(
  runtime: Runtime,
  capability: VideoFoodMapRouteCapability,
): Promise<VideoFoodMapRuntimeOption[]> {
  const response = await withTimeout(
    runtime.local.listLocalAssets({} as Parameters<typeof runtime.local.listLocalAssets>[0]),
    `video-food-map:local:${capability}`,
  );
  return (response.assets || [])
    .filter((asset) => isMatchingCapability(asset.capabilities || [], capability))
    .sort((left, right) => {
      const rankDelta = localStatusRank(left.status) - localStatusRank(right.status);
      if (rankDelta !== 0) {
        return rankDelta;
      }
      return normalizeText(left.localAssetId || left.logicalModelId || left.assetId).localeCompare(
        normalizeText(right.localAssetId || right.logicalModelId || right.assetId),
      );
    })
    .map((asset) => createLocalOption({
      capability,
      modelId: normalizeText(asset.logicalModelId || asset.assetId || asset.localAssetId),
      localModelId: normalizeText(asset.localAssetId) || undefined,
      provider: normalizeText(asset.engine) || undefined,
    }))
    .filter((option) => Boolean(option.modelId));
}

async function loadCloudOptions(
  runtime: Runtime,
  capability: VideoFoodMapRouteCapability,
): Promise<{ options: VideoFoodMapRuntimeOption[]; issues: VideoFoodMapRuntimeOptionsIssue[] }> {
  const response = await withTimeout(
    runtime.connector.listConnectors({} as Parameters<typeof runtime.connector.listConnectors>[0]),
    `video-food-map:connectors:${capability}`,
  );
  const options: VideoFoodMapRuntimeOption[] = [];
  const issues: VideoFoodMapRuntimeOptionsIssue[] = [];

  await Promise.all((response.connectors || []).map(async (connector) => {
    try {
      const modelsResponse = await withTimeout(
        runtime.connector.listConnectorModels({
          connectorId: connector.connectorId,
        } as Parameters<typeof runtime.connector.listConnectorModels>[0]),
        `video-food-map:connector-models:${connector.connectorId}:${capability}`,
      );
      for (const model of modelsResponse.models || []) {
        if (!model.available || !isMatchingCapability(model.capabilities || [], capability)) {
          continue;
        }
        options.push(createCloudOption({
          capability,
          connectorId: normalizeText(connector.connectorId),
          connectorLabel: normalizeText(connector.label || connector.provider || connector.connectorId),
          provider: normalizeText(connector.provider),
          modelId: normalizeText(model.modelId),
          modelLabel: normalizeText(model.modelLabel || model.modelId),
        }));
      }
    } catch (error) {
      issues.push(toIssue('connector-models', error, {
        connectorId: normalizeText(connector.connectorId),
        capability,
      }));
    }
  }));

  options.sort((left, right) => {
    const connectorDelta = normalizeText(left.connectorLabel || left.provider).localeCompare(
      normalizeText(right.connectorLabel || right.provider),
    );
    if (connectorDelta !== 0) {
      return connectorDelta;
    }
    return normalizeText(left.modelLabel || left.modelId).localeCompare(normalizeText(right.modelLabel || right.modelId));
  });

  return { options, issues };
}

async function loadCatalog(
  runtime: Runtime,
  capability: VideoFoodMapRouteCapability,
): Promise<VideoFoodMapRuntimeOptionsCatalog> {
  const issues: VideoFoodMapRuntimeOptionsIssue[] = [];
  const options: VideoFoodMapRuntimeOption[] = [];

  try {
    options.push(...await loadLocalOptions(runtime, capability));
  } catch (error) {
    issues.push(toIssue('local-models', error, { capability }));
  }

  try {
    const cloud = await loadCloudOptions(runtime, capability);
    options.push(...cloud.options);
    issues.push(...cloud.issues);
  } catch (error) {
    issues.push(toIssue('connectors', error, { capability }));
  }

  const hasOptions = options.length > 0;
  return {
    options,
    loadStatus: issues.length === 0 ? 'ready' : hasOptions ? 'degraded' : 'failed',
    issues,
  };
}

export function createVideoFoodMapRuntime(runtimeGrpcAddr: string): Runtime {
  return new Runtime({
    appId: DEFAULT_APP_ID,
    transport: {
      type: 'node-grpc',
      endpoint: normalizeText(runtimeGrpcAddr) || DEFAULT_RUNTIME_GRPC_ADDR,
    },
    defaults: {
      callerKind: 'desktop-core',
      callerId: 'video-food-route-options',
    },
    subjectContext: {
      subjectUserId: DEFAULT_SUBJECT_USER_ID,
    },
  });
}

export async function loadVideoFoodMapRuntimeOptions(runtimeGrpcAddr: string): Promise<VideoFoodMapRuntimeOptions> {
  const runtime = createVideoFoodMapRuntime(runtimeGrpcAddr);
  const [stt, text] = await Promise.all([
    loadCatalog(runtime, 'audio.transcribe'),
    loadCatalog(runtime, 'text.generate'),
  ]);
  return { stt, text };
}

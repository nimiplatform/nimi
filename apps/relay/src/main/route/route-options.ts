// Route option aggregator — loads available local models + cloud connectors from runtime

import type { PlatformClient } from '@nimiplatform/sdk';
import type {
  RelayConnectorOption,
  RelayLocalModelOption,
  RelayRouteBinding,
  RelayRouteLoadIssue,
  RelayRouteOptions,
} from './types.js';

const LOAD_TIMEOUT_MS = 3500;

type LocalModelStatus = 0 | 1 | 2 | 3 | 4;

const STATUS_MAP: Record<LocalModelStatus, RelayLocalModelOption['status']> = {
  0: 'unspecified',
  1: 'installed',
  2: 'active',
  3: 'unhealthy',
  4: 'removed',
};

const STATUS_RANK: Record<RelayLocalModelOption['status'], number> = {
  active: 0,
  installed: 1,
  unhealthy: 2,
  removed: 3,
  unspecified: 4,
};

const CAPABILITY_ALIAS: Record<string, string> = {
  chat: 'text.generate',
  embedding: 'text.embed',
  embed: 'text.embed',
  image: 'image.generate',
  video: 'video.generate',
  music: 'music.generate',
  tts: 'audio.synthesize',
  speech: 'audio.synthesize',
  stt: 'audio.transcribe',
  transcription: 'audio.transcribe',
};

export function normalizeCapability(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  return CAPABILITY_ALIAS[trimmed] ?? trimmed;
}

function mapStatus(raw: number): RelayLocalModelOption['status'] {
  return STATUS_MAP[raw as LocalModelStatus] ?? 'unspecified';
}

function createRouteIssue(
  scope: RelayRouteLoadIssue['scope'],
  kind: RelayRouteLoadIssue['kind'],
  message: string,
  extras?: Pick<RelayRouteLoadIssue, 'connectorId' | 'capability'>,
): RelayRouteLoadIssue {
  return {
    scope,
    kind,
    message,
    ...(extras?.connectorId ? { connectorId: extras.connectorId } : {}),
    ...(extras?.capability ? { capability: extras.capability } : {}),
  };
}

function toRouteIssue(
  scope: RelayRouteLoadIssue['scope'],
  error: unknown,
  extras?: Pick<RelayRouteLoadIssue, 'connectorId' | 'capability'>,
): RelayRouteLoadIssue {
  const message = error instanceof Error ? error.message : String(error || 'unknown route options failure');
  return createRouteIssue(
    scope,
    message.startsWith('timeout:') ? 'timeout' : 'runtime-error',
    message,
    extras,
  );
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout:${label}:${ms}`)), ms);
  });
  try {
    const result = await Promise.race([promise, timeout]);
    clearTimeout(timer!);
    return result;
  } catch (err) {
    clearTimeout(timer!);
    throw err;
  }
}

async function loadLocalModels(
  runtime: PlatformClient['runtime'],
  capability = 'text.generate',
): Promise<RelayLocalModelOption[]> {
  const response = await runtime.local.listLocalAssets({} as Parameters<typeof runtime.local.listLocalAssets>[0]);
  const assets = response.assets || [];
  return assets
    .map((asset) => {
      const capabilities = asset.capabilities.map(normalizeCapability);
      return {
        localModelId: asset.localAssetId,
        modelId: asset.logicalModelId || asset.assetId,
        assetId: asset.assetId,
        engine: asset.engine || 'llama',
        status: mapStatus(asset.status),
        capabilities,
      };
    })
    .filter((model) => (
      model.status !== 'removed'
      && (!capability || model.capabilities.includes(capability))
    ))
    .sort((a: RelayLocalModelOption, b: RelayLocalModelOption) => {
      const rankDiff = STATUS_RANK[a.status] - STATUS_RANK[b.status];
      if (rankDiff !== 0) return rankDiff;
      return a.localModelId.localeCompare(b.localModelId);
    });
}

async function loadConnectors(
  runtime: PlatformClient['runtime'],
  capability = 'text.generate',
): Promise<{ connectors: RelayConnectorOption[]; issues: RelayRouteLoadIssue[] }> {
  const response = await withTimeout(
    runtime.connector.listConnectors({} as Parameters<typeof runtime.connector.listConnectors>[0]),
    LOAD_TIMEOUT_MS,
    `list-connectors:${capability}`,
  );
  const connectors = response.connectors || [];
  const issues: RelayRouteLoadIssue[] = [];

  const results = await Promise.all(
    connectors.map(async (connector): Promise<RelayConnectorOption> => {
      try {
        const modelsResponse = await withTimeout(
          runtime.connector.listConnectorModels({ connectorId: connector.connectorId } as Parameters<typeof runtime.connector.listConnectorModels>[0]),
          LOAD_TIMEOUT_MS,
          `list-connector-models:${connector.connectorId}:${capability}`,
        );
        const models = (modelsResponse.models || [])
          .filter((model) => model.capabilities.includes(capability))
          .map((model) => ({
            modelId: model.modelId,
            modelLabel: model.modelLabel,
            available: model.available,
            capabilities: model.capabilities,
          }));

        return {
          connectorId: connector.connectorId,
          provider: connector.provider,
          label: connector.label || connector.provider,
          status: String(connector.status),
          modelsStatus: 'ready',
          models,
        };
      } catch (err) {
        const issue = toRouteIssue('connector-models', err, {
          connectorId: connector.connectorId,
          capability,
        });
        issues.push(issue);
        console.warn('[relay:route] connector model load failed', {
          connectorId: connector.connectorId,
          capability,
          message: issue.message,
        }, err);
        return {
          connectorId: connector.connectorId,
          provider: connector.provider,
          label: connector.label || connector.provider,
          status: String(connector.status),
          modelsStatus: 'unavailable',
          modelsError: issue.message,
          models: [],
        };
      }
    }),
  );

  return { connectors: results, issues };
}

async function loadLocalRouteOptions(
  runtime: PlatformClient['runtime'],
  capability: string,
): Promise<{
  local: RelayRouteOptions['local'];
  issues: RelayRouteLoadIssue[];
}> {
  try {
    const models = await withTimeout(
      loadLocalModels(runtime, capability),
      LOAD_TIMEOUT_MS,
      `list-local-models:${capability}`,
    );
    return {
      local: {
        models,
        status: 'ready',
        error: undefined,
      },
      issues: [],
    };
  } catch (error) {
    const issue = toRouteIssue('local-models', error, { capability });
    const isAuthError = issue.message.includes('AUTH_') || issue.message.includes('UNAUTHENTICATED');
    console.warn('[relay:route] local model load failed', {
      capability,
      message: issue.message,
      hint: isAuthError ? 'JWT may be invalid — re-login or restart backend' : undefined,
    }, error);
    return {
      local: {
        models: [],
        status: 'unavailable',
        error: issue.message,
      },
      issues: [issue],
    };
  }
}

function resolveLoadStatus(
  local: RelayRouteOptions['local'],
  connectors: RelayConnectorOption[],
  issues: RelayRouteLoadIssue[],
): RelayRouteOptions['loadStatus'] {
  if (issues.length === 0) {
    return 'ready';
  }
  if (local.status === 'unavailable' && connectors.length === 0) {
    return 'failed';
  }
  return 'degraded';
}

export async function loadMediaRouteConnectors(
  runtime: PlatformClient['runtime'],
  capability: string,
): Promise<{
  local: RelayRouteOptions['local'];
  connectors: RelayConnectorOption[];
  loadStatus: RelayRouteOptions['loadStatus'];
  issues: RelayRouteLoadIssue[];
}> {
  const [localResult, connectorsResult] = await Promise.allSettled([
    loadLocalRouteOptions(runtime, capability),
    loadConnectors(runtime, capability),
  ]);

  const issues: RelayRouteLoadIssue[] = [];
  const local = localResult.status === 'fulfilled'
    ? localResult.value.local
    : {
        models: [],
        status: 'unavailable' as const,
        error: toRouteIssue('local-models', localResult.reason, { capability }).message,
      };
  if (localResult.status === 'fulfilled') {
    issues.push(...localResult.value.issues);
  } else {
    issues.push(toRouteIssue('local-models', localResult.reason, { capability }));
  }

  let connectors: RelayConnectorOption[] = [];
  if (connectorsResult.status === 'fulfilled') {
    connectors = connectorsResult.value.connectors;
    issues.push(...connectorsResult.value.issues);
  } else {
    const issue = toRouteIssue('connectors', connectorsResult.reason, { capability });
    issues.push(issue);
    console.warn('[relay:route] media connector load failed', { capability, message: issue.message }, connectorsResult.reason);
  }

  return {
    local,
    connectors,
    loadStatus: resolveLoadStatus(local, connectors, issues),
    issues,
  };
}

export async function loadRouteOptions(
  runtime: PlatformClient['runtime'],
  currentBinding: RelayRouteBinding | null,
): Promise<RelayRouteOptions> {
  const { local, connectors, loadStatus, issues } = await loadMediaRouteConnectors(runtime, 'text.generate');
  return {
    local,
    connectors,
    selected: currentBinding,
    loadStatus,
    issues,
  };
}

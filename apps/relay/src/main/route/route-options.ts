// Route option aggregator — loads available local models + cloud connectors from runtime

import type { PlatformClient } from '@nimiplatform/sdk';
import type {
  RelayLocalModelOption,
  RelayConnectorOption,
  RelayRouteLoadIssue,
  RelayRouteOptions,
  RelayRouteBinding,
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

/**
 * Normalize raw capability strings from Go runtime to canonical form.
 * Mirrors runtime/internal/localrouting/localrouting.go NormalizeCapability
 * and desktop normalizeCapabilityToken in runtime-bootstrap-route-options.ts.
 *
 * The Go runtime's ListLocalModels gRPC returns capabilities in their stored
 * form (e.g. "chat") without normalization. The relay must normalize on the
 * TS side to match against canonical capability strings.
 */
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

function createUnavailableRouteOptions(
  binding: RelayRouteBinding | null,
  issue: RelayRouteLoadIssue,
): RelayRouteOptions {
  return {
    local: {
      models: [],
      status: 'unavailable',
      error: issue.scope === 'local-models' ? issue.message : undefined,
    },
    connectors: [],
    selected: binding,
    loadStatus: 'failed',
    issues: [issue],
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

async function loadLocalModels(runtime: PlatformClient['runtime']): Promise<RelayLocalModelOption[]> {
  // Cast: protobuf request has required zero-value fields; SDK accepts partial input at runtime
  const response = await runtime.local.listLocalModels({} as Parameters<typeof runtime.local.listLocalModels>[0]);
  const models = response.models || [];
  return models
    .filter((m) => m.capabilities.some((c) => normalizeCapability(c) === 'text.generate'))
    .map((m) => ({
      localModelId: m.localModelId,
      modelId: m.modelId,
      engine: m.engine || 'llama',
      status: mapStatus(m.status),
      capabilities: m.capabilities.map(normalizeCapability),
    }))
    .sort((a, b) => {
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
    connectors.map(async (c): Promise<RelayConnectorOption> => {
      try {
        const modelsResponse = await withTimeout(
          runtime.connector.listConnectorModels({ connectorId: c.connectorId } as Parameters<typeof runtime.connector.listConnectorModels>[0]),
          LOAD_TIMEOUT_MS,
          `list-connector-models:${c.connectorId}:${capability}`,
        );
        const models = (modelsResponse.models || [])
          .filter((m) => m.capabilities.includes(capability))
          .map((m) => ({
            modelId: m.modelId,
            modelLabel: m.modelLabel,
            available: m.available,
            capabilities: m.capabilities,
          }));

        return {
          connectorId: c.connectorId,
          provider: c.provider,
          label: c.label || c.provider,
          status: String(c.status),
          modelsStatus: 'ready',
          models,
        };
      } catch (err) {
        const issue = toRouteIssue('connector-models', err, {
          connectorId: c.connectorId,
          capability,
        });
        issues.push(issue);
        console.warn('[relay:route] connector model load failed', {
          connectorId: c.connectorId,
          capability,
          message: issue.message,
        }, err);
        return {
          connectorId: c.connectorId,
          provider: c.provider,
          label: c.label || c.provider,
          status: String(c.status),
          modelsStatus: 'unavailable',
          modelsError: issue.message,
          models: [],
        };
      }
    }),
  );

  return { connectors: results, issues };
}

export async function loadMediaRouteConnectors(
  runtime: PlatformClient['runtime'],
  capability: string,
): Promise<{
  connectors: RelayConnectorOption[];
  loadStatus: RelayRouteOptions['loadStatus'];
  issues: RelayRouteLoadIssue[];
}> {
  try {
    const { connectors, issues } = await loadConnectors(runtime, capability);
    return {
      connectors,
      loadStatus: issues.length > 0 ? 'degraded' : 'ready',
      issues,
    };
  } catch (error) {
    const issue = toRouteIssue('connectors', error, { capability });
    console.warn('[relay:route] media connector load failed', { capability, message: issue.message }, error);
    return {
      connectors: [],
      loadStatus: 'failed',
      issues: [issue],
    };
  }
}

export async function loadRouteOptions(
  runtime: PlatformClient['runtime'],
  currentBinding: RelayRouteBinding | null,
): Promise<RelayRouteOptions> {
  const [localModelsResult, connectorsResult] = await Promise.allSettled([
    withTimeout(loadLocalModels(runtime), LOAD_TIMEOUT_MS, 'list-local-models'),
    loadConnectors(runtime),
  ]);

  const issues: RelayRouteLoadIssue[] = [];
  const local = {
    models: [] as RelayLocalModelOption[],
    status: 'ready' as 'ready' | 'unavailable',
    error: undefined as string | undefined,
  };
  let connectors: RelayConnectorOption[] = [];

  if (localModelsResult.status === 'fulfilled') {
    local.models = localModelsResult.value;
  } else {
    const issue = toRouteIssue('local-models', localModelsResult.reason);
    local.status = 'unavailable';
    local.error = issue.message;
    issues.push(issue);
    const isAuthError = issue.message.includes('AUTH_') || issue.message.includes('UNAUTHENTICATED');
    console.warn('[relay:route] local model load failed', {
      message: issue.message,
      hint: isAuthError ? 'JWT may be invalid — re-login or restart backend' : undefined,
    }, localModelsResult.reason);
  }

  if (connectorsResult.status === 'fulfilled') {
    connectors = connectorsResult.value.connectors;
    issues.push(...connectorsResult.value.issues);
  } else {
    const issue = toRouteIssue('connectors', connectorsResult.reason);
    issues.push(issue);
    console.warn('[relay:route] connector catalog load failed', { message: issue.message }, connectorsResult.reason);
  }

  const loadStatus: RelayRouteOptions['loadStatus'] = issues.length === 0
    ? 'ready'
    : local.status === 'unavailable' && connectors.length === 0
      ? 'failed'
      : 'degraded';

  return {
    local,
    connectors,
    selected: currentBinding,
    loadStatus,
    issues,
  };
}

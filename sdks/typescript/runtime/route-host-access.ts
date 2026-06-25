import {
  LocalAssetKind,
  LocalAssetStatus,
  ReasonCode as RuntimeGeneratedReasonCode,
  type CheckLocalAssetHealthRequest,
  type CheckLocalAssetHealthResponse,
  type RuntimeTypedCallOptions,
  type RuntimeTypedClient,
  type TestConnectorResponse,
} from '../core-generated/runtime-typed-client';
import { createNimiError, ReasonCode, type CoreMetadata, type JsonObject } from '../types';
import { parseNimiRuntimeLocalAssetStatusId } from './local-asset-vocabulary';
import {
  normalizeLower,
  normalizeText,
} from './route-host-codecs';
import type {
  NimiRuntimeResolvedBinding,
  NimiRuntimeRouteHealthInput,
  NimiRuntimeRouteHostProviderHealth,
} from './route-capability-types';
import type { NimiRuntimeRouteSource } from './route-options';

export type NimiRuntimeRouteHostAccessClient = {
  readonly connectors: Pick<RuntimeTypedClient, 'testConnector'>;
  readonly local: Pick<RuntimeTypedClient, 'checkLocalAssetHealth' | 'listLocalAssets' | 'warmLocalAsset'>;
};

export interface NimiRuntimeRouteHostRequestMetadataInput {
  readonly source: NimiRuntimeRouteSource;
  readonly connectorId?: string;
  readonly providerEndpoint?: string;
}

export interface NimiRuntimeRouteHostCallOptionsInput extends NimiRuntimeRouteHostRequestMetadataInput {
  readonly targetId: string;
  readonly timeoutMs: number;
}

export interface NimiRuntimeRouteHostStreamOptionsInput extends NimiRuntimeRouteHostCallOptionsInput {
  readonly signal?: AbortSignal;
}

export interface NimiRuntimeRouteHostStreamOptions extends RuntimeTypedCallOptions {
  readonly signal?: AbortSignal;
}

export interface NimiRuntimeRouteLocalWarmInput {
  readonly targetId: string;
  readonly resolvedBinding: NimiRuntimeResolvedBinding;
  readonly timeoutMs?: number;
  readonly onStateChange?: (state: 'warming' | 'ready', candidate: NimiRuntimeRouteLocalWarmCandidate) => void;
}

export interface NimiRuntimeRouteLocalWarmCandidate {
  readonly localAssetId: string;
  readonly assetId: string;
  readonly engine: string;
  readonly endpoint: string;
  readonly status: LocalAssetStatus | number;
}

export interface NimiRuntimeRouteLocalWarmCache {
  readonly warmedLocalModelKeys: Set<string>;
  readonly pendingLocalWarmups: Map<string, Promise<void>>;
}

export type NimiRuntimeRouteLocalWarmMetric =
  | {
    readonly kind: 'counter';
    readonly name: string;
    readonly value?: number;
    readonly details?: JsonObject;
  }
  | {
    readonly kind: 'timing';
    readonly name: string;
    readonly durationMs: number;
    readonly details?: JsonObject;
  };

export interface NimiHostRuntimeRouteAccessSurfaceOptions {
  readonly getRuntime: () => NimiRuntimeRouteHostAccessClient | null | undefined;
  readonly appId: string;
  readonly callerKind: string;
  readonly surfaceId: string;
  readonly callerIdPrefix?: string;
  readonly warmCache?: NimiRuntimeRouteLocalWarmCache;
  readonly emitWarmMetric?: (metric: NimiRuntimeRouteLocalWarmMetric) => void;
}

export interface NimiRuntimeRouteHostAccessSurface {
  getRuntimeClient(): NimiRuntimeRouteHostAccessClient;
  checkLocalHealth(input: NimiRuntimeRouteHealthInput): Promise<NimiRuntimeRouteHostProviderHealth>;
  buildRequestMetadata(input: NimiRuntimeRouteHostRequestMetadataInput): Promise<CoreMetadata>;
  buildCallOptions(input: NimiRuntimeRouteHostCallOptionsInput): Promise<RuntimeTypedCallOptions>;
  buildStreamOptions(input: NimiRuntimeRouteHostStreamOptionsInput): Promise<NimiRuntimeRouteHostStreamOptions>;
  ensureLocalModelWarm(input: NimiRuntimeRouteLocalWarmInput): Promise<void>;
  resetLocalModelWarmCache(): void;
}

const LOCAL_WARM_DEFAULT_TIMEOUT_MS = 60_000;
const LOCAL_WARM_MAX_TIMEOUT_MS = 300_000;
const LOCAL_WARM_PAGE_SIZE = 100;
const LOCAL_WARM_MAX_PAGES = 20;

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.round(nowMs() - startedAt));
}

function reasonCodeName(value: unknown): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0
    ? normalizeText(RuntimeGeneratedReasonCode[numeric as RuntimeGeneratedReasonCode])
    : '';
}

function createRuntimeUnavailableError(): Error {
  return createNimiError({
    message: 'Runtime SDK client unavailable.',
    reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
    actionHint: 'check_runtime_client_bootstrap',
    source: 'runtime',
  });
}

export function createNimiRuntimeRouteLocalWarmCache(): NimiRuntimeRouteLocalWarmCache {
  return {
    warmedLocalModelKeys: new Set<string>(),
    pendingLocalWarmups: new Map<string, Promise<void>>(),
  };
}

export function resetNimiRuntimeRouteLocalWarmCache(cache: NimiRuntimeRouteLocalWarmCache): void {
  cache.warmedLocalModelKeys.clear();
  cache.pendingLocalWarmups.clear();
}

export function createNimiRuntimeTraceId(prefix = 'runtime-call'): string {
  const normalizedPrefix = normalizeText(prefix) || 'runtime-call';
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${normalizedPrefix}:${crypto.randomUUID()}`;
  }
  return `${normalizedPrefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}

export function buildNimiRuntimeRouteRequestMetadata(input: {
  readonly connectorId?: string;
  readonly traceId?: string;
  readonly traceIdPrefix?: string;
} = {}): CoreMetadata {
  const traceId = normalizeText(input.traceId) || createNimiRuntimeTraceId(input.traceIdPrefix);
  return {
    traceId,
    'x-nimi-trace-id': traceId,
    ...(normalizeText(input.connectorId) ? { keySource: 'managed' } : {}),
  };
}

export function buildNimiRuntimeRouteTargetCallOptions(input: {
  readonly targetId: string;
  readonly timeoutMs: number;
  readonly callerKind: string;
  readonly surfaceId: string;
  readonly callerIdPrefix?: string;
  readonly connectorId?: string;
  readonly signal?: AbortSignal;
}): RuntimeTypedCallOptions {
  const callerIdPrefix = normalizeText(input.callerIdPrefix) || 'target';
  const traceId = createNimiRuntimeTraceId('runtime-call');
  return {
    timeoutMs: input.timeoutMs,
    signal: input.signal,
    metadata: {
      traceId,
      'x-nimi-trace-id': traceId,
      callerKind: normalizeText(input.callerKind),
      callerId: `${callerIdPrefix}:${normalizeText(input.targetId) || 'unknown'}`,
      surfaceId: normalizeText(input.surfaceId),
      ...(normalizeText(input.connectorId) ? { keySource: 'managed' } : {}),
    },
  };
}

function providerHealthFromConnectorResult(
  input: NimiRuntimeRouteHealthInput,
  result: TestConnectorResponse,
): NimiRuntimeRouteHostProviderHealth {
  const ok = result.ack?.ok === true;
  return {
    provider: normalizeText(input.provider),
    endpoint: normalizeText(input.localProviderEndpoint || input.localOpenAiEndpoint) || null,
    model: normalizeText(input.localProviderModel || input.localAssetId),
    status: ok ? 'healthy' : 'degraded',
    detail: ok ? '' : normalizeText(result.ack?.actionHint || 'connector health acknowledgement missing'),
    reasonCode: reasonCodeName(result.ack?.reasonCode) || undefined,
    actionHint: ok ? undefined : (normalizeText(result.ack?.actionHint) || 'verify_connector_health_ack'),
  };
}

function providerHealthFromLocalAsset(
  input: NimiRuntimeRouteHealthInput,
  response: CheckLocalAssetHealthResponse,
): NimiRuntimeRouteHostProviderHealth {
  const localAssetId = normalizeText(input.localAssetId);
  const health = response.assets.find((asset) => normalizeText(asset.localAssetId) === localAssetId)
    || response.assets[0];
  if (!health) {
    return {
      provider: normalizeText(input.provider),
      endpoint: normalizeText(input.localProviderEndpoint || input.localOpenAiEndpoint) || null,
      model: normalizeText(input.localProviderModel || input.localAssetId),
      status: 'unavailable',
      detail: 'local asset health evidence missing',
      actionHint: 'inspect_local_runtime_model_health',
    };
  }
  const status = parseNimiRuntimeLocalAssetStatusId(health.status);
  return {
    provider: normalizeText(input.provider),
    endpoint: normalizeText(health.endpoint || input.localProviderEndpoint || input.localOpenAiEndpoint) || null,
    model: normalizeText(input.localProviderModel || input.localAssetId),
    status: status === 'active' || status === 'installed' ? 'healthy' : 'unreachable',
    detail: normalizeText(health.detail),
    reasonCode: reasonCodeName(health.reasonCode) || undefined,
    actionHint: status === 'active' || status === 'installed' ? undefined : 'inspect_local_runtime_model_health',
  };
}

async function checkRouteHealth(
  runtime: NimiRuntimeRouteHostAccessClient,
  appId: string,
  input: NimiRuntimeRouteHealthInput,
): Promise<NimiRuntimeRouteHostProviderHealth> {
  if (normalizeText(input.connectorId)) {
    try {
      return providerHealthFromConnectorResult(
        input,
        await runtime.connectors.testConnector({ connectorId: normalizeText(input.connectorId) }),
      );
    } catch (error) {
      return {
        provider: normalizeText(input.provider),
        endpoint: normalizeText(input.localProviderEndpoint || input.localOpenAiEndpoint) || null,
        model: normalizeText(input.localProviderModel || input.localAssetId),
        status: 'unreachable',
        detail: error instanceof Error ? error.message : String(error || ''),
      };
    }
  }

  const localAssetId = normalizeText(input.localAssetId);
  if (!localAssetId) {
    return {
      provider: normalizeText(input.provider),
      endpoint: normalizeText(input.localProviderEndpoint || input.localOpenAiEndpoint) || null,
      model: normalizeText(input.localProviderModel),
      status: 'unsupported',
      detail: `no local asset id available for ${normalizeText(appId) || 'runtime host'}`,
      actionHint: 'resolve_runtime_route_binding',
    };
  }
  try {
    return providerHealthFromLocalAsset(
      input,
      await runtime.local.checkLocalAssetHealth({ localAssetId } satisfies CheckLocalAssetHealthRequest),
    );
  } catch (error) {
    return {
      provider: normalizeText(input.provider),
      endpoint: normalizeText(input.localProviderEndpoint || input.localOpenAiEndpoint) || null,
      model: normalizeText(input.localProviderModel || input.localAssetId),
      status: 'unreachable',
      detail: error instanceof Error ? error.message : String(error || ''),
    };
  }
}

function routeModelRoot(model: unknown): string {
  const normalized = normalizeText(model);
  const lower = normalized.toLowerCase();
  for (const prefix of ['llama/', 'media/', 'speech/', 'sidecar/', 'local/', 'cloud/', 'token/']) {
    if (lower.startsWith(prefix)) return normalized.slice(prefix.length).trim();
  }
  return normalized;
}

function localWarmCacheKey(candidate: NimiRuntimeRouteLocalWarmCandidate): string {
  return `${normalizeText(candidate.localAssetId)}|${normalizeText(candidate.endpoint)}`;
}

async function listLocalWarmAssets(runtime: NimiRuntimeRouteHostAccessClient): Promise<readonly NimiRuntimeRouteLocalWarmCandidate[]> {
  const assets: NimiRuntimeRouteLocalWarmCandidate[] = [];
  let pageToken = '';
  for (let page = 0; page < LOCAL_WARM_MAX_PAGES; page += 1) {
    const response = await runtime.local.listLocalAssets({
      statusFilter: LocalAssetStatus.UNSPECIFIED,
      kindFilter: LocalAssetKind.UNSPECIFIED,
      engineFilter: '',
      pageSize: LOCAL_WARM_PAGE_SIZE,
      pageToken,
    });
    for (const asset of response.assets || []) {
      assets.push({
        localAssetId: normalizeText(asset.localAssetId),
        assetId: normalizeText(asset.assetId),
        engine: normalizeLower(asset.engine),
        endpoint: normalizeText(asset.endpoint),
        status: asset.status,
      });
    }
    pageToken = normalizeText(response.nextPageToken);
    if (!pageToken) break;
  }
  return assets.filter((asset) => asset.localAssetId && asset.assetId && parseNimiRuntimeLocalAssetStatusId(asset.status) !== 'removed');
}

function selectLocalWarmCandidate(input: {
  readonly resolved: NimiRuntimeResolvedBinding;
  readonly assets: readonly NimiRuntimeRouteLocalWarmCandidate[];
}): NimiRuntimeRouteLocalWarmCandidate | null {
  const targetLocalAssetId = normalizeText(input.resolved.localAssetId);
  const targetModelRoot = routeModelRoot(input.resolved.modelId || input.resolved.model);
  const targetEndpoint = normalizeText(input.resolved.localProviderEndpoint || input.resolved.localOpenAiEndpoint || input.resolved.endpoint);
  const targetEngine = normalizeLower(input.resolved.engine || input.resolved.provider);
  if (targetLocalAssetId) {
    const direct = input.assets.find((asset) => normalizeText(asset.localAssetId) === targetLocalAssetId);
    if (direct) return direct;
  }
  return input.assets
    .filter((asset) => routeModelRoot(asset.assetId) === targetModelRoot)
    .filter((asset) => normalizeLower(asset.engine) === targetEngine)
    .map((asset) => {
      let score = 0;
      if (targetEndpoint && asset.endpoint === targetEndpoint) score += 4;
      if (parseNimiRuntimeLocalAssetStatusId(asset.status) === 'active') score += 1;
      return { asset, score };
    })
    .sort((left, right) => right.score - left.score || left.asset.localAssetId.localeCompare(right.asset.localAssetId))[0]?.asset || null;
}

async function ensureLocalModelWarm(
  runtime: NimiRuntimeRouteHostAccessClient,
  input: NimiRuntimeRouteLocalWarmInput,
  options: {
    readonly cache: NimiRuntimeRouteLocalWarmCache;
    readonly buildCallOptions: (call: NimiRuntimeRouteHostCallOptionsInput) => Promise<RuntimeTypedCallOptions>;
    readonly emitMetric?: (metric: NimiRuntimeRouteLocalWarmMetric) => void;
  },
): Promise<void> {
  if (input.resolvedBinding.source !== 'local-runtime') return;
  const startedAt = nowMs();
  const candidate = selectLocalWarmCandidate({
    resolved: input.resolvedBinding,
    assets: await listLocalWarmAssets(runtime),
  });
  if (!candidate) {
    throw createNimiError({
      message: 'Runtime local model unavailable.',
      reasonCode: ReasonCode.AI_LOCAL_MODEL_UNAVAILABLE,
      actionHint: 'inspect_local_runtime_model_health',
      source: 'runtime',
    });
  }
  const cacheKey = localWarmCacheKey(candidate);
  if (parseNimiRuntimeLocalAssetStatusId(candidate.status) === 'active' && options.cache.warmedLocalModelKeys.has(cacheKey)) {
    return;
  }
  const pending = options.cache.pendingLocalWarmups.get(cacheKey);
  if (pending) {
    await pending;
    return;
  }
  const timeoutMs = Math.min(
    LOCAL_WARM_MAX_TIMEOUT_MS,
    Math.max(1, Math.floor(Number(input.timeoutMs || LOCAL_WARM_DEFAULT_TIMEOUT_MS))),
  );
  const request = (async () => {
    input.onStateChange?.('warming', candidate);
    await runtime.local.warmLocalAsset(
      { localAssetId: candidate.localAssetId, timeoutMs },
      await options.buildCallOptions({
        targetId: input.targetId,
        timeoutMs,
        source: 'local-runtime',
        providerEndpoint: candidate.endpoint,
      }),
    );
    options.cache.warmedLocalModelKeys.add(cacheKey);
    input.onStateChange?.('ready', candidate);
  })().finally(() => {
    options.cache.pendingLocalWarmups.delete(cacheKey);
    options.emitMetric?.({
      kind: 'timing',
      name: 'runtime.route.local_warm_total_ms',
      durationMs: elapsedMs(startedAt),
      details: { localAssetId: candidate.localAssetId, engine: candidate.engine },
    });
  });
  options.cache.pendingLocalWarmups.set(cacheKey, request);
  await request;
}

export function createNimiHostRuntimeRouteAccessSurface(
  options: NimiHostRuntimeRouteAccessSurfaceOptions,
): NimiRuntimeRouteHostAccessSurface {
  const cache = options.warmCache || createNimiRuntimeRouteLocalWarmCache();
  const getRuntimeClient = (): NimiRuntimeRouteHostAccessClient => {
    const runtime = options.getRuntime();
    if (!runtime) throw createRuntimeUnavailableError();
    return runtime;
  };
  const buildCallOptions = async (
    input: NimiRuntimeRouteHostStreamOptionsInput,
  ): Promise<RuntimeTypedCallOptions> => buildNimiRuntimeRouteTargetCallOptions({
    targetId: input.targetId,
    timeoutMs: input.timeoutMs,
    callerKind: options.callerKind,
    surfaceId: options.surfaceId,
    callerIdPrefix: options.callerIdPrefix,
    connectorId: input.connectorId,
    signal: input.signal,
  });

  return {
    getRuntimeClient,
    async checkLocalHealth(input) {
      return checkRouteHealth(getRuntimeClient(), options.appId, input);
    },
    async buildRequestMetadata(input) {
      return buildNimiRuntimeRouteRequestMetadata({ connectorId: input.connectorId });
    },
    async buildCallOptions(input) {
      return buildCallOptions(input);
    },
    async buildStreamOptions(input) {
      return buildCallOptions(input);
    },
    async ensureLocalModelWarm(input) {
      return ensureLocalModelWarm(getRuntimeClient(), input, {
        cache,
        buildCallOptions,
        emitMetric: options.emitWarmMetric,
      });
    },
    resetLocalModelWarmCache() {
      resetNimiRuntimeRouteLocalWarmCache(cache);
    },
  };
}

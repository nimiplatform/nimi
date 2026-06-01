import { createNimiError } from '../core/errors.js';
import { ReasonCode } from '../types/index.js';
import type { RuntimeCallerKind, RuntimeCallOptions, RuntimeMetadata } from './types.js';
import type { Runtime } from './runtime.js';
import {
  buildRuntimeRequestMetadata,
  buildRuntimeTargetCallOptions,
  type RuntimeTargetCallOptions,
} from './runtime-call-options.js';
import {
  type RuntimeResolvedBinding,
  type RuntimeRouteLocalWarmCandidate,
  type RuntimeRouteSource,
} from './runtime-route.js';
import {
  createRuntimeRouteLocalWarmCache,
  ensureRuntimeRouteLocalWarmWithHost,
  resetRuntimeRouteLocalWarmCache,
  type RuntimeRouteLocalWarmCache,
  type RuntimeRouteLocalWarmMetric,
} from './runtime-route-host-facade.js';
import {
  checkRuntimeRouteProviderHealth,
  type RuntimeRouteProviderHealthProjection,
} from './runtime-route-provider-health.js';
import type {
  RuntimeRouteHostHealthInput,
} from './runtime-route-host-facade.js';
import type {
  CheckModelHealthRequest,
  CheckModelHealthResponse,
} from './generated/runtime/v1/model.js';

export const RUNTIME_TEXT_GENERATE_TIMEOUT_MS = 120_000;

export type RuntimeRouteHostAccessClient = Pick<Runtime, 'appId' | 'ai' | 'connector' | 'local' | 'media' | 'model'>;

export type RuntimeRouteHostRequestMetadataInput = {
  source: RuntimeRouteSource;
  connectorId?: string;
  providerEndpoint?: string;
};

export type RuntimeRouteHostCallOptionsInput = RuntimeRouteHostRequestMetadataInput & {
  targetId: string;
  timeoutMs: number;
};

export type RuntimeRouteHostStreamOptionsInput = RuntimeRouteHostCallOptionsInput & {
  signal?: AbortSignal;
};

export type RuntimeRouteHostStreamOptions = RuntimeTargetCallOptions & {
  signal?: AbortSignal;
};

export type RuntimeRouteHostLocalWarmInput = {
  targetId: string;
  resolvedBinding: RuntimeResolvedBinding;
  timeoutMs?: number;
  onStateChange?: (state: 'warming' | 'ready', candidate: RuntimeRouteLocalWarmCandidate) => void;
};

export type RuntimeRouteHostAccessSurface = {
  getRuntimeClient(): RuntimeRouteHostAccessClient;
  checkLocalHealth(input: RuntimeRouteHostHealthInput & {
    runtimeModelHealth?: (request: CheckModelHealthRequest) => Promise<CheckModelHealthResponse>;
  }): Promise<RuntimeRouteProviderHealthProjection>;
  buildRequestMetadata(input: RuntimeRouteHostRequestMetadataInput): Promise<Record<string, string>>;
  buildCallOptions(input: RuntimeRouteHostCallOptionsInput): Promise<RuntimeTargetCallOptions>;
  buildStreamOptions(input: RuntimeRouteHostStreamOptionsInput): Promise<RuntimeRouteHostStreamOptions>;
  ensureLocalModelWarm(input: RuntimeRouteHostLocalWarmInput): Promise<void>;
  resetLocalModelWarmCache(): void;
};

export type HostRuntimeRouteAccessSurfaceOptions = {
  getRuntime: () => RuntimeRouteHostAccessClient | null | undefined;
  appId?: string;
  callerKind: RuntimeCallerKind;
  surfaceId: string;
  callerIdPrefix?: string;
  warmCache?: RuntimeRouteLocalWarmCache;
  emitWarmMetric?: (metric: RuntimeRouteLocalWarmMetric) => void;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function createRuntimeUnavailableError(): Error {
  return createNimiError({
    message: 'runtime sdk client unavailable',
    reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
    actionHint: 'check_runtime_client_bootstrap',
    source: 'runtime',
  });
}

export function createHostRuntimeRouteAccessSurface(
  options: HostRuntimeRouteAccessSurfaceOptions,
): RuntimeRouteHostAccessSurface {
  const cache = options.warmCache || createRuntimeRouteLocalWarmCache();
  const callerIdPrefix = normalizeText(options.callerIdPrefix) || 'target';
  const getRuntimeClient = (): RuntimeRouteHostAccessClient => {
    const runtime = options.getRuntime();
    if (!runtime) {
      throw createRuntimeUnavailableError();
    }
    return runtime;
  };

  const buildTargetOptions = (
    input: RuntimeRouteHostStreamOptionsInput,
  ): RuntimeTargetCallOptions => buildRuntimeTargetCallOptions({
    targetId: input.targetId,
    timeoutMs: input.timeoutMs,
    callerKind: options.callerKind,
    surfaceId: options.surfaceId,
    callerIdPrefix,
    connectorId: input.connectorId,
    signal: input.signal,
  });

  return {
    getRuntimeClient,
    async checkLocalHealth(input) {
      const runtime = getRuntimeClient();
      return checkRuntimeRouteProviderHealth({
        ...input,
        appId: normalizeText(options.appId) || runtime.appId,
        checkModelHealth: input.runtimeModelHealth
          || ((request) => runtime.model.checkHealth(request)),
        testConnector: (request) => runtime.connector.testConnector(request),
      });
    },
    async buildRequestMetadata(input) {
      return buildRuntimeRequestMetadata({
        connectorId: input.connectorId,
      });
    },
    async buildCallOptions(input) {
      return buildTargetOptions(input);
    },
    async buildStreamOptions(input) {
      return buildTargetOptions(input) as RuntimeRouteHostStreamOptions;
    },
    async ensureLocalModelWarm(input) {
      const runtime = getRuntimeClient();
      await ensureRuntimeRouteLocalWarmWithHost(input, {
        cache,
        listLocalAssets: (request) => runtime.local.listLocalAssets(request),
        warmLocalAsset: (request, callOptions) => runtime.local.warmLocalAsset(request, callOptions),
        buildCallOptions: async (callInput) => buildTargetOptions(callInput) as RuntimeCallOptions & {
          metadata: RuntimeMetadata;
        },
        emitMetric: options.emitWarmMetric,
      });
    },
    resetLocalModelWarmCache() {
      resetRuntimeRouteLocalWarmCache(cache);
    },
  };
}

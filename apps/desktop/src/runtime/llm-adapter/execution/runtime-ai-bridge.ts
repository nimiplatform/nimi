import { getPlatformClient } from '@nimiplatform/sdk';
import { inferRouteSourceFromEndpoint, type InferenceRouteSource } from './inference-audit';
import { asNimiError, createNimiError } from '@nimiplatform/sdk/runtime';
import { ReasonCode, type NimiError } from '@nimiplatform/sdk/types';
import { emitRuntimeLog } from '../../telemetry/logger';

const ROUTE_POLICY_LOCAL = 1;
const ROUTE_POLICY_CLOUD = 2;
const DEFAULT_LOCAL_WARM_TIMEOUT_MS = 60_000;
const MAX_LOCAL_WARM_TIMEOUT_MS = 300_000;
const LOCAL_WARM_PAGE_SIZE = 100;
const LOCAL_WARM_MAX_PAGES = 20;

const RUNTIME_REASON_CODE_TO_LOCAL_AI: Record<string, string> = {
  AI_MODEL_NOT_FOUND: ReasonCode.AI_MODEL_NOT_FOUND,
  AI_MODEL_NOT_READY: 'LOCAL_AI_CAPABILITY_MISSING',
  AI_MODALITY_NOT_SUPPORTED: ReasonCode.AI_MODALITY_NOT_SUPPORTED,
  AI_MEDIA_OPTION_UNSUPPORTED: ReasonCode.AI_MEDIA_OPTION_UNSUPPORTED,
  AI_PROVIDER_UNAVAILABLE: 'LOCAL_AI_SERVICE_UNREACHABLE',
  AI_PROVIDER_TIMEOUT: 'LOCAL_AI_PROVIDER_TIMEOUT',
  AI_ROUTE_UNSUPPORTED: 'LOCAL_AI_CAPABILITY_MISSING',
  AI_ROUTE_FALLBACK_DENIED: 'LOCAL_AI_CAPABILITY_MISSING',
  AI_INPUT_INVALID: ReasonCode.AI_INPUT_INVALID,
  AI_OUTPUT_INVALID: 'LOCAL_AI_PROVIDER_INTERNAL_ERROR',
  AI_STREAM_BROKEN: 'LOCAL_AI_PROVIDER_INTERNAL_ERROR',
  AI_CONTENT_FILTER_BLOCKED: 'LOCAL_AI_CAPABILITY_MISSING',
};

const AI_REASON_CODE_NUMERIC: Record<number, string> = {
  200: 'AI_MODEL_NOT_FOUND',
  201: 'AI_MODEL_NOT_READY',
  202: 'AI_PROVIDER_UNAVAILABLE',
  203: 'AI_PROVIDER_TIMEOUT',
  204: 'AI_ROUTE_UNSUPPORTED',
  205: 'AI_ROUTE_FALLBACK_DENIED',
  206: 'AI_INPUT_INVALID',
  207: 'AI_OUTPUT_INVALID',
  208: 'AI_STREAM_BROKEN',
  209: 'AI_CONTENT_FILTER_BLOCKED',
  351: 'AI_MODALITY_NOT_SUPPORTED',
  411: 'AI_MEDIA_OPTION_UNSUPPORTED',
  560: 'AI_LOCAL_SPEECH_PREFLIGHT_BLOCKED',
  561: 'AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED',
  562: 'AI_LOCAL_SPEECH_ENV_INIT_FAILED',
  563: 'AI_LOCAL_SPEECH_HOST_INIT_FAILED',
  564: 'AI_LOCAL_SPEECH_CAPABILITY_DOWNLOAD_FAILED',
  565: 'AI_LOCAL_SPEECH_BUNDLE_DEGRADED',
};

const DEFAULT_RUNTIME_ACTION_HINT = 'retry_or_check_runtime_status';

type RuntimeLocalWarmCandidate = {
  localAssetId: string;
  assetId: string;
  engine: string;
  endpoint: string;
  updatedAt: string;
};

const warmedLocalModelKeys = new Set<string>();
const pendingLocalWarmups = new Map<string, Promise<void>>();

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.round(nowMs() - startedAt));
}

function logDesktopRuntimeAgentTiming(input: {
  stage: string;
  startedAt: number;
  details?: Record<string, unknown>;
}): void {
  emitRuntimeLog({
    level: 'info',
    area: 'desktop-runtime-agent-latency',
    message: `phase:${input.stage}`,
    costMs: elapsedMs(input.startedAt),
    details: {
      stage: input.stage,
      ...(input.details || {}),
    },
  });
}

function logDesktopRuntimeAgentCounter(input: {
  counter: string;
  value?: number;
  details?: Record<string, unknown>;
}): void {
  emitRuntimeLog({
    level: 'info',
    area: 'desktop-runtime-agent-latency',
    message: `action:${input.counter}`,
    details: {
      counter: input.counter,
      value: input.value ?? 1,
      ...(input.details || {}),
    },
  });
}

export const RUNTIME_MODAL_TEXT = 1;
export const RUNTIME_MODAL_IMAGE = 2;
export const RUNTIME_MODAL_VIDEO = 3;
export const RUNTIME_MODAL_STT = 5;
export const RUNTIME_MODAL_EMBEDDING = 6;

export type SourceAndModel = {
  source: InferenceRouteSource;
  routePolicy: number;
  modelId: string;
  endpoint: string;
  provider: string;
  adapter: string;
};

export type EnsureRuntimeLocalModelWarmInput = {
  modId: string;
  source: InferenceRouteSource;
  modelId: string;
  localModelId?: string;
  goRuntimeLocalModelId?: string;
  engine?: string;
  endpoint?: string;
  timeoutMs?: number;
  onStateChange?: (state: 'warming' | 'ready', candidate: RuntimeLocalWarmCandidate) => void;
};

export function createRuntimeTraceId(prefix = 'runtime-call'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeModelRoot(model: string): string {
  const normalized = String(model || '').trim();
  if (!normalized) return '';
  const lower = normalized.toLowerCase();
  if (lower.startsWith('llama/')) return normalized.slice('llama/'.length).trim();
  if (lower.startsWith('media/')) return normalized.slice('media/'.length).trim();
  if (lower.startsWith('sidecar/')) return normalized.slice('sidecar/'.length).trim();
  if (lower.startsWith('local/')) return normalized.slice('local/'.length).trim();
  if (lower.startsWith('cloud/')) return normalized.slice('cloud/'.length).trim();
  if (lower.startsWith('token/')) return normalized.slice('token/'.length).trim();
  return normalized;
}

function inferLocalEngine(provider: string): string {
  const normalized = String(provider || '').trim().toLowerCase();
  if (normalized.includes('sidecar')) return 'sidecar';
  if (normalized.includes('media')) return 'media';
  if (normalized.includes('llama') || normalized.includes('local')) return 'llama';
  return 'local';
}

function normalizeEngineName(value: string): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized.includes('llama')) return 'llama';
  if (normalized.includes('media')) return 'media';
  if (normalized.includes('sidecar')) return 'sidecar';
  return normalized;
}

function resolveWarmTimeoutMs(timeoutMs: number | undefined): number {
  const numeric = Math.floor(Number(timeoutMs || 0));
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return DEFAULT_LOCAL_WARM_TIMEOUT_MS;
  }
  if (numeric > MAX_LOCAL_WARM_TIMEOUT_MS) {
    return MAX_LOCAL_WARM_TIMEOUT_MS;
  }
  return numeric;
}

function localWarmCacheKey(candidate: RuntimeLocalWarmCandidate): string {
  return [
    String(candidate.localAssetId || '').trim(),
    String(candidate.endpoint || '').trim(),
  ].join('|');
}

function selectRuntimeLocalWarmCandidate(
  input: Omit<EnsureRuntimeLocalModelWarmInput, 'modId' | 'timeoutMs' | 'onStateChange'>,
  models: Array<Record<string, unknown>>,
): RuntimeLocalWarmCandidate | null {
  const targetLocalModelId = String(input.goRuntimeLocalModelId || input.localModelId || '').trim();
  const targetModelRoot = normalizeModelRoot(input.modelId);
  const targetEndpoint = String(input.endpoint || '').trim();
  const targetEngine = normalizeEngineName(input.engine || '');

  const candidates = models
    .map((item) => ({
      localAssetId: String(item.localAssetId || '').trim(),
      assetId: String(item.assetId || '').trim(),
      engine: String(item.engine || '').trim(),
      endpoint: String(item.endpoint || '').trim(),
      updatedAt: String(item.updatedAt || '').trim(),
      status: Number(item.status || 0),
    }))
    .filter((item) => item.localAssetId && item.assetId && item.status !== 3 && item.status !== 4);

  if (targetLocalModelId) {
    const direct = candidates.find((item) => item.localAssetId === targetLocalModelId) || null;
    if (direct) {
      return direct;
    }
  }

  const scored = candidates
    .filter((item) => normalizeModelRoot(item.assetId) === targetModelRoot)
    .map((item) => {
      let score = 0;
      if (targetEndpoint && item.endpoint === targetEndpoint) score += 4;
      if (targetEngine && normalizeEngineName(item.engine) === targetEngine) score += 2;
      if (item.status === 2) score += 1;
      return { item, score };
    })
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.item.localAssetId.localeCompare(right.item.localAssetId);
    });

  return scored[0]?.item || null;
}

async function listAllRuntimeLocalModels(): Promise<Array<Record<string, unknown>>> {
  const startedAt = nowMs();
  const runtime = getRuntimeClient();
  const models: Array<Record<string, unknown>> = [];
  let pages = 0;
  let pageToken = '';
  for (let index = 0; index < LOCAL_WARM_MAX_PAGES; index += 1) {
    const response = await runtime.local.listLocalAssets({
      statusFilter: 0,
      kindFilter: 0,
      engineFilter: '',
      pageSize: LOCAL_WARM_PAGE_SIZE,
      pageToken,
    });
    pages += 1;
    for (const model of response.assets || []) {
      if (model && typeof model === 'object' && !Array.isArray(model)) {
        models.push(model as unknown as Record<string, unknown>);
      }
    }
    pageToken = String(response.nextPageToken || '').trim();
    if (!pageToken) {
      break;
    }
  }
  logDesktopRuntimeAgentCounter({
    counter: 'desktop_runtime_agent_local_warm_list_pages_total',
    value: pages,
    details: {
      modelCount: models.length,
      hasNextPage: Boolean(pageToken),
    },
  });
  logDesktopRuntimeAgentTiming({
    stage: 'desktop.runtime_agent.local_warm_list_ms',
    startedAt,
    details: {
      modelCount: models.length,
      pages,
      hasNextPage: Boolean(pageToken),
    },
  });
  return models;
}

export function resetRuntimeLocalModelWarmCacheForTests(): void {
  warmedLocalModelKeys.clear();
  pendingLocalWarmups.clear();
}

export async function ensureRuntimeLocalModelWarm(input: EnsureRuntimeLocalModelWarmInput): Promise<void> {
  if (input.source !== 'local') {
    return;
  }
  const totalStartedAt = nowMs();
  logDesktopRuntimeAgentCounter({
    counter: 'desktop_runtime_agent_local_warm_attempt_total',
    details: {
      route: input.source,
      modelId: input.modelId,
      engine: input.engine || '',
      hasEndpoint: Boolean(String(input.endpoint || '').trim()),
    },
  });

  const selectionInput = {
    source: input.source,
    modelId: input.modelId,
    localModelId: input.localModelId,
    goRuntimeLocalModelId: input.goRuntimeLocalModelId,
    engine: input.engine,
    endpoint: input.endpoint,
  };
  const cacheCheckStartedAt = nowMs();
  const initialCandidate = selectRuntimeLocalWarmCandidate(selectionInput, await listAllRuntimeLocalModels());
  logDesktopRuntimeAgentTiming({
    stage: 'desktop.runtime_agent.local_warm_cache_check_ms',
    startedAt: cacheCheckStartedAt,
    details: {
      route: input.source,
      modelId: input.modelId,
      engine: input.engine || '',
      selectedLocalAssetId: initialCandidate?.localAssetId || null,
    },
  });
  if (!initialCandidate) {
    throw createNimiError({
      message: 'runtime local model unavailable',
      reasonCode: ReasonCode.AI_LOCAL_MODEL_UNAVAILABLE,
      actionHint: 'inspect_local_runtime_model_health',
      source: 'runtime',
    });
  }

  const initialCacheKey = localWarmCacheKey(initialCandidate);
  if (warmedLocalModelKeys.has(initialCacheKey)) {
    logDesktopRuntimeAgentCounter({
      counter: 'desktop_runtime_agent_local_warm_cache_hit_total',
      details: {
        modelId: input.modelId,
        localAssetId: initialCandidate.localAssetId,
        engine: initialCandidate.engine,
      },
    });
    logDesktopRuntimeAgentTiming({
      stage: 'desktop.runtime_agent.local_warm_total_ms',
      startedAt: totalStartedAt,
      details: {
        modelId: input.modelId,
        localAssetId: initialCandidate.localAssetId,
        engine: initialCandidate.engine,
        cacheHit: true,
      },
    });
    return;
  }
  logDesktopRuntimeAgentCounter({
    counter: 'desktop_runtime_agent_local_warm_cache_miss_total',
    details: {
      modelId: input.modelId,
      localAssetId: initialCandidate.localAssetId,
      engine: initialCandidate.engine,
    },
  });

  const pending = pendingLocalWarmups.get(initialCacheKey);
  if (pending) {
    await pending;
    logDesktopRuntimeAgentTiming({
      stage: 'desktop.runtime_agent.local_warm_total_ms',
      startedAt: totalStartedAt,
      details: {
        modelId: input.modelId,
        localAssetId: initialCandidate.localAssetId,
        engine: initialCandidate.engine,
        pendingJoined: true,
      },
    });
    return;
  }

  const warmPromise = (async () => {
    input.onStateChange?.('warming', initialCandidate);
    const timeoutMs = resolveWarmTimeoutMs(input.timeoutMs);
    const callOptions = await buildRuntimeCallOptions({
      modId: input.modId,
      timeoutMs,
      source: 'local',
      providerEndpoint: initialCandidate.endpoint,
    });
    await getRuntimeClient().local.warmLocalAsset({
      localAssetId: initialCandidate.localAssetId,
      timeoutMs,
    }, callOptions);
    const refreshedCandidate = selectRuntimeLocalWarmCandidate(
      {
        ...selectionInput,
        localModelId: initialCandidate.localAssetId,
        goRuntimeLocalModelId: initialCandidate.localAssetId,
      },
      await listAllRuntimeLocalModels(),
    ) || initialCandidate;
    warmedLocalModelKeys.add(localWarmCacheKey(refreshedCandidate));
    input.onStateChange?.('ready', refreshedCandidate);
  })().finally(() => {
    pendingLocalWarmups.delete(initialCacheKey);
  });

  pendingLocalWarmups.set(initialCacheKey, warmPromise);
  await warmPromise;
  logDesktopRuntimeAgentTiming({
    stage: 'desktop.runtime_agent.local_warm_total_ms',
    startedAt: totalStartedAt,
    details: {
      modelId: input.modelId,
      localAssetId: initialCandidate.localAssetId,
      engine: initialCandidate.engine,
      cacheHit: false,
    },
  });
}

function ensureRouteModelId(model: string, routePolicy: number, provider: string): string {
  const modelRoot = normalizeModelRoot(model);
  if (!modelRoot) {
    throw createNimiError({
      message: 'runtime model is required',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'select_runtime_model',
      source: 'runtime',
    });
  }
  if (routePolicy === ROUTE_POLICY_CLOUD) return `cloud/${modelRoot}`;
  const engine = inferLocalEngine(provider);
  if (engine === 'llama' || engine === 'media' || engine === 'speech' || engine === 'sidecar') {
    return `${engine}/${modelRoot}`;
  }
  return `local/${modelRoot}`;
}

export function getRuntimeClient() {
  const runtime = getPlatformClient().runtime;
  if (!runtime) {
    throw createNimiError({
      message: 'runtime sdk client unavailable',
      reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
      actionHint: 'check_runtime_client_bootstrap',
      source: 'runtime',
    });
  }
  return runtime;
}

export function resolveSourceAndModel(input: {
  provider: string;
  model?: string;
  localProviderEndpoint?: string;
  localProviderModel?: string;
  localOpenAiEndpoint?: string;
  connectorId?: string;
}): SourceAndModel {
  const endpoint = String(input.localProviderEndpoint || input.localOpenAiEndpoint || '').trim();
  const hasConnector = Boolean(String(input.connectorId || '').trim());
  const source = hasConnector ? 'cloud' : inferRouteSourceFromEndpoint(endpoint);
  const routePolicy = source === 'local' ? ROUTE_POLICY_LOCAL : ROUTE_POLICY_CLOUD;
  const provider = String(input.provider || '').trim();
  if (!provider) {
    throw createNimiError({
      message: 'runtime provider is required',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'select_runtime_provider',
      source: 'runtime',
    });
  }
  const model = String(input.model || input.localProviderModel || '').trim();
  return {
    source,
    routePolicy,
    modelId: ensureRouteModelId(model, routePolicy, provider),
    endpoint: hasConnector ? '' : endpoint,
    provider,
    adapter: 'openai_compat_adapter',
  };
}

function resolveCaller(modId: string): {
  callerKind: 'desktop-core' | 'desktop-mod';
  callerId: string;
} {
  const normalized = String(modId || '').trim();
  if (normalized.startsWith('core.')) {
    return { callerKind: 'desktop-core', callerId: normalized };
  }
  return { callerKind: 'desktop-mod', callerId: normalized ? `mod:${normalized}` : 'mod:unknown' };
}

export async function buildRuntimeRequestMetadata(input: {
  source: InferenceRouteSource;
  connectorId?: string;
  providerEndpoint?: string;
}): Promise<Record<string, string>> {
  const traceId = createRuntimeTraceId();
  const metadata: Record<string, string> = {
    traceId,
    'x-nimi-trace-id': traceId,
  };
  if (String(input.connectorId || '').trim()) {
    metadata.keySource = 'managed';
  }
  return metadata;
}

export async function buildRuntimeCallOptions(input: {
  modId: string;
  timeoutMs: number;
  source: InferenceRouteSource;
  connectorId?: string;
  providerEndpoint?: string;
}): Promise<{
  idempotencyKey: string;
  timeoutMs: number;
  metadata: {
    traceId: string;
    callerKind: 'desktop-core' | 'desktop-mod';
    callerId: string;
    surfaceId: string;
    keySource?: 'managed';
  };
}> {
  const caller = resolveCaller(input.modId);
  const traceId = createRuntimeTraceId();
  const idempotencyKey = createRuntimeTraceId('runtime-idem');
  return {
    idempotencyKey,
    timeoutMs: input.timeoutMs,
    metadata: {
      traceId,
      callerKind: caller.callerKind,
      callerId: caller.callerId,
      surfaceId: 'desktop.renderer',
      ...(String(input.connectorId || '').trim() ? { keySource: 'managed' as const } : {}),
    },
  };
}

export async function buildRuntimeStreamOptions(
  input: {
    modId: string;
    timeoutMs: number;
    signal?: AbortSignal;
    source: InferenceRouteSource;
    connectorId?: string;
    providerEndpoint?: string;
  },
): Promise<{
  idempotencyKey: string;
  timeoutMs: number;
  signal?: AbortSignal;
  metadata: {
    traceId: string;
    callerKind: 'desktop-core' | 'desktop-mod';
    callerId: string;
    surfaceId: string;
    keySource?: 'managed';
  };
}> {
  const caller = resolveCaller(input.modId);
  const traceId = createRuntimeTraceId();
  const idempotencyKey = createRuntimeTraceId('runtime-idem');
  return {
    idempotencyKey,
    timeoutMs: input.timeoutMs,
    signal: input.signal,
    metadata: {
      traceId,
      callerKind: caller.callerKind,
      callerId: caller.callerId,
      surfaceId: 'desktop.renderer',
      ...(String(input.connectorId || '').trim() ? { keySource: 'managed' as const } : {}),
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

type DesktopScenarioOutput = {
  output?: (
    | {
      oneofKind: 'textGenerate';
      textGenerate: {
        text: string;
      };
    }
    | {
      oneofKind: 'textEmbed';
      textEmbed: {
        vectors: Array<{
          values: number[];
        }>;
      };
    }
    | {
      oneofKind: 'imageGenerate';
      imageGenerate: {
        artifacts: unknown[];
      };
    }
    | {
      oneofKind: 'videoGenerate';
      videoGenerate: {
        artifacts: unknown[];
      };
    }
    | {
      oneofKind: 'speechTranscribe';
      speechTranscribe: {
        text: string;
        artifacts: unknown[];
      };
    }
    | {
      oneofKind: 'speechSynthesize';
      speechSynthesize: {
        artifacts: unknown[];
      };
    }
    | {
      oneofKind: 'musicGenerate';
      musicGenerate: {
        artifacts: unknown[];
      };
    }
    | {
      oneofKind: 'worldGenerate';
      worldGenerate: {
        worldId: string;
        spzUrls?: Record<string, string>;
        artifacts: unknown[];
      };
    }
    | {
      oneofKind: undefined;
    }
  );
};

export function extractTextFromGenerateOutput(output: DesktopScenarioOutput | undefined): string {
  const variant = output?.output;
  if (variant?.oneofKind === 'textGenerate') {
    return String(variant.textGenerate.text || '').trim();
  }
  return '';
}

export function extractEmbeddings(output: DesktopScenarioOutput | undefined): number[][] {
  const variant = output?.output;
  if (variant?.oneofKind !== 'textEmbed') {
    return [];
  }
  return variant.textEmbed.vectors.map((vector: { values: number[] }) => vector.values
    .map((value: number) => Number(value))
    .filter((value: number) => Number.isFinite(value)));
}

import { toBase64, fromBase64 } from '../../util/encoding.js';

export function base64FromBytes(bytes: Uint8Array): string {
  return toBase64(bytes);
}

function decodeBase64Payload(raw: string): Uint8Array {
  const normalized = String(raw || '').trim();
  if (!normalized) return new Uint8Array(0);
  const payload = normalized.includes(',') ? normalized.split(',').slice(-1)[0] || '' : normalized;
  return fromBase64(payload);
}

function parseDataUrl(input: string): {
  mimeType: string;
  payload: string;
  isBase64: boolean;
} | null {
  const normalized = String(input || '').trim();
  const match = normalized.match(/^data:([^;,]+)?(;base64)?,(.*)$/i);
  if (!match) return null;
  const mimeType = String(match[1] || '').trim();
  if (!mimeType) {
    throw createNimiError({
      message: 'audio data url missing mimeType',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'set_audio_mime_type',
      source: 'runtime',
    });
  }
  return {
    mimeType,
    payload: String(match[3] || ''),
    isBase64: Boolean(match[2]),
  };
}

export type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function resolveTranscribeAudio(input: {
  audioUri?: string;
  audioBase64?: string;
  mimeType?: string;
  fetchImpl?: FetchImpl;
}): Promise<{
  audioBytes: Uint8Array;
  mimeType: string;
}> {
  const explicitMimeType = String(input.mimeType || '').trim();
  const rawBase64 = String(input.audioBase64 || '').trim();
  if (rawBase64) {
    const parsed = parseDataUrl(rawBase64);
    if (parsed) {
      if (!parsed.isBase64) {
        throw createNimiError({
          message: 'audio data url must be base64',
          reasonCode: ReasonCode.AI_INPUT_INVALID,
          actionHint: 'set_audio_base64_payload',
          source: 'runtime',
        });
      }
      const decoded = decodeBase64Payload(parsed.payload);
      if (decoded.length === 0) {
        throw createNimiError({
          message: 'audio payload empty',
          reasonCode: ReasonCode.AI_INPUT_INVALID,
          actionHint: 'set_audio_payload',
          source: 'runtime',
        });
      }
      return { audioBytes: decoded, mimeType: explicitMimeType || parsed.mimeType };
    }
    const decoded = decodeBase64Payload(rawBase64);
    if (decoded.length === 0) {
      throw createNimiError({
        message: 'audio payload empty',
        reasonCode: ReasonCode.AI_INPUT_INVALID,
        actionHint: 'set_audio_payload',
        source: 'runtime',
      });
    }
    if (!explicitMimeType) {
      throw createNimiError({
        message: 'audio mimeType is required for raw base64 input',
        reasonCode: ReasonCode.AI_INPUT_INVALID,
        actionHint: 'set_audio_mime_type',
        source: 'runtime',
      });
    }
    return { audioBytes: decoded, mimeType: explicitMimeType };
  }

  const audioUri = String(input.audioUri || '').trim();
  if (!audioUri) {
    throw createNimiError({
      message: 'audio source required',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'set_audio_uri_or_base64',
      source: 'runtime',
    });
  }

  const parsedDataUrl = parseDataUrl(audioUri);
  if (parsedDataUrl) {
    if (!parsedDataUrl.isBase64) {
      throw createNimiError({
        message: 'audio data url must be base64',
        reasonCode: ReasonCode.AI_INPUT_INVALID,
        actionHint: 'set_audio_base64_payload',
        source: 'runtime',
      });
    }
    const decoded = decodeBase64Payload(parsedDataUrl.payload);
    if (decoded.length === 0) {
      throw createNimiError({
        message: 'audio payload empty',
        reasonCode: ReasonCode.AI_INPUT_INVALID,
        actionHint: 'set_audio_payload',
        source: 'runtime',
      });
    }
    return { audioBytes: decoded, mimeType: explicitMimeType || parsedDataUrl.mimeType };
  }

  const fetchImpl = input.fetchImpl || fetch;
  const response = await fetchImpl(audioUri);
  if (!response.ok) {
    throw createNimiError({
      message: `fetch audio failed HTTP_${response.status}`,
      reasonCode: ReasonCode.AI_PROVIDER_UNAVAILABLE,
      actionHint: 'check_audio_uri_or_network',
      source: 'runtime',
    });
  }
  const arrayBuffer = await response.arrayBuffer();
  const audioBytes = new Uint8Array(arrayBuffer);
  if (audioBytes.length === 0) {
    throw createNimiError({
      message: 'audio payload empty',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'set_audio_payload',
      source: 'runtime',
    });
  }
  const responseMimeType = String(response.headers.get('content-type') || '').trim();
  const resolvedMimeType = explicitMimeType || responseMimeType;
  if (!resolvedMimeType) {
    throw createNimiError({
      message: 'audio fetch response missing mimeType',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'set_audio_mime_type',
      source: 'runtime',
    });
  }
  return { audioBytes, mimeType: resolvedMimeType };
}

function extractReasonCodeCandidate(value: unknown): string | null {
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) return null;
    if (/^\d+$/.test(normalized)) return AI_REASON_CODE_NUMERIC[Number(normalized)] || null;
    return normalized;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return AI_REASON_CODE_NUMERIC[value] || null;
  return null;
}

export function extractRuntimeReasonCode(error: unknown): string | null {
  if (isRuntimeNimiError(error)) {
    const fromNimiError = extractReasonCodeCandidate(error.reasonCode);
    if (fromNimiError) return fromNimiError;
  }
  const record = asRecord(error);
  const direct = extractReasonCodeCandidate(record.reasonCode);
  if (direct) return direct;
  const message = String(record.message || (error instanceof Error ? error.message : '') || '').trim();
  if (!message) return null;
  const explicit = message.match(/\b(AI_[A-Z_]+)\b/);
  if (explicit?.[1]) return explicit[1];
  const numeric = message.match(/\b(\d{3})\b/);
  if (numeric?.[1]) {
    const mapped = AI_REASON_CODE_NUMERIC[Number(numeric[1])];
    if (mapped) return mapped;
  }
  return null;
}

export function toLocalRuntimeReasonCode(error: unknown): string | null {
  const runtimeCode = extractRuntimeReasonCode(error);
  if (!runtimeCode) return null;
  return RUNTIME_REASON_CODE_TO_LOCAL_AI[runtimeCode] || null;
}

function isRuntimeNimiError(error: unknown): error is NimiError {
  if (!error || typeof error !== 'object') return false;
  const record = error as Record<string, unknown>;
  return typeof record.reasonCode === 'string' && typeof record.actionHint === 'string';
}

export function asRuntimeInvokeError(
  error: unknown,
  fallback: {
    traceId?: string;
    reasonCode?: string;
    actionHint?: string;
  } = {},
): NimiError {
  return asNimiError(error, {
    reasonCode: fallback.reasonCode || ReasonCode.RUNTIME_CALL_FAILED,
    actionHint: fallback.actionHint || DEFAULT_RUNTIME_ACTION_HINT,
    traceId: fallback.traceId || '',
    source: 'runtime',
  });
}

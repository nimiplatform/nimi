import { getPlatformClient } from '@runtime/platform-client';
import { inferRouteSourceFromEndpoint, type InferenceRouteSource } from './inference-audit';
import { asNimiError, createNimiError } from '@nimiplatform/sdk/runtime';
import { ReasonCode, type NimiError } from '@nimiplatform/sdk/types';

const ROUTE_POLICY_LOCAL_RUNTIME = 1;
const ROUTE_POLICY_TOKEN_API = 2;
const FALLBACK_POLICY_DENY = 1;

const RUNTIME_REASON_CODE_TO_LOCAL_AI: Record<string, string> = {
  AI_MODEL_NOT_FOUND: 'LOCAL_AI_CAPABILITY_MISSING',
  AI_MODEL_NOT_READY: 'LOCAL_AI_CAPABILITY_MISSING',
  AI_PROVIDER_UNAVAILABLE: 'LOCAL_AI_SERVICE_UNREACHABLE',
  AI_PROVIDER_TIMEOUT: 'LOCAL_AI_PROVIDER_TIMEOUT',
  AI_ROUTE_UNSUPPORTED: 'LOCAL_AI_CAPABILITY_MISSING',
  AI_ROUTE_FALLBACK_DENIED: 'LOCAL_AI_CAPABILITY_MISSING',
  AI_INPUT_INVALID: 'LOCAL_AI_CAPABILITY_MISSING',
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
};

const DEFAULT_RUNTIME_ACTION_HINT = 'retry_or_check_runtime_status';

export const RUNTIME_MODAL_TEXT = 1;
export const RUNTIME_MODAL_IMAGE = 2;
export const RUNTIME_MODAL_VIDEO = 3;
export const RUNTIME_MODAL_STT = 5;
export const RUNTIME_MODAL_EMBEDDING = 6;

export type SourceAndModel = {
  source: InferenceRouteSource;
  routePolicy: number;
  fallbackPolicy: number;
  modelId: string;
  endpoint: string;
  provider: string;
  adapter: string;
};

export function createRuntimeTraceId(prefix = 'runtime-call'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeModelRoot(model: string): string {
  const normalized = String(model || '').trim();
  if (!normalized) return 'default';
  const lower = normalized.toLowerCase();
  if (lower.startsWith('local/')) return normalized.slice('local/'.length).trim() || 'default';
  if (lower.startsWith('cloud/')) return normalized.slice('cloud/'.length).trim() || 'default';
  if (lower.startsWith('token/')) return normalized.slice('token/'.length).trim() || 'default';
  return normalized;
}

function ensureRouteModelId(model: string, routePolicy: number): string {
  const modelRoot = normalizeModelRoot(model);
  if (routePolicy === ROUTE_POLICY_TOKEN_API) return `cloud/${modelRoot}`;
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
  const source = hasConnector ? 'token-api' : inferRouteSourceFromEndpoint(endpoint);
  const routePolicy = source === 'local-runtime' ? ROUTE_POLICY_LOCAL_RUNTIME : ROUTE_POLICY_TOKEN_API;
  const model = String(input.model || input.localProviderModel || '').trim() || 'default';
  return {
    source,
    routePolicy,
    fallbackPolicy: FALLBACK_POLICY_DENY,
    modelId: ensureRouteModelId(model, routePolicy),
    endpoint: hasConnector ? '' : endpoint,
    provider: String(input.provider || '').trim() || 'openai-compatible',
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
  void input;
  const traceId = createRuntimeTraceId();
  return {
    keySource: 'managed',
    traceId,
    'x-nimi-trace-id': traceId,
  };
}

export async function buildRuntimeCallOptions(input: {
  modId: string;
  timeoutMs: number;
  source: InferenceRouteSource;
  connectorId?: string;
  providerEndpoint?: string;
}): Promise<{
  timeoutMs: number;
  metadata: {
    traceId: string;
    callerKind: 'desktop-core' | 'desktop-mod';
    callerId: string;
    surfaceId: string;
    keySource: 'managed';
  };
}> {
  const caller = resolveCaller(input.modId);
  const traceId = createRuntimeTraceId();
  return {
    timeoutMs: input.timeoutMs,
    metadata: {
      traceId,
      callerKind: caller.callerKind,
      callerId: caller.callerId,
      surfaceId: 'desktop.renderer',
      keySource: 'managed',
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
  timeoutMs: number;
  signal?: AbortSignal;
  metadata: {
    traceId: string;
    callerKind: 'desktop-core' | 'desktop-mod';
    callerId: string;
    surfaceId: string;
    keySource: 'managed';
  };
}> {
  const caller = resolveCaller(input.modId);
  const traceId = createRuntimeTraceId();
  return {
    timeoutMs: input.timeoutMs,
    signal: input.signal,
    metadata: {
      traceId,
      callerKind: caller.callerKind,
      callerId: caller.callerId,
      surfaceId: 'desktop.renderer',
      keySource: 'managed',
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function extractTextFromGenerateOutput(output: unknown): string {
  const record = asRecord(output);
  const fields = asRecord(record.fields);
  const textValue = asRecord(fields.text);
  const kind = asRecord(textValue.kind);
  if (kind.oneofKind === 'stringValue') {
    return String(kind.stringValue || '').trim();
  }
  return '';
}

export function extractEmbeddings(vectorsValue: unknown): number[][] {
  const vectors = Array.isArray(vectorsValue) ? vectorsValue : [];
  return vectors.map((entry) => {
    const rowRecord = asRecord(entry);
    const values = Array.isArray(rowRecord.values) ? rowRecord.values : [];
    const row: number[] = [];
    for (const value of values) {
      const valueRecord = asRecord(value);
      const kind = asRecord(valueRecord.kind);
      if (kind.oneofKind === 'numberValue') {
        const n = Number(kind.numberValue);
        if (Number.isFinite(n)) row.push(n);
      }
    }
    return row;
  });
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
  return {
    mimeType: String(match[1] || '').trim() || 'application/octet-stream',
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
    return { audioBytes: decoded, mimeType: explicitMimeType || 'audio/wav' };
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
  return { audioBytes, mimeType: explicitMimeType || responseMimeType || 'audio/wav' };
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
  const numeric = message.match(/\b(20\d)\b/);
  if (numeric?.[1]) {
    const mapped = AI_REASON_CODE_NUMERIC[Number(numeric[1])];
    if (mapped) return mapped;
  }
  return null;
}

export function toLocalAiReasonCode(error: unknown): string | null {
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

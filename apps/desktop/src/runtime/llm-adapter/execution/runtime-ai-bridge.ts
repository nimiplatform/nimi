import { getPlatformClient } from '@runtime/platform-client';
import { inferRouteSourceFromEndpoint, type InferenceRouteSource } from './inference-audit';
import { resolveProviderExecutionPlan } from './provider-plan';
import type { FetchImpl, LocalAiProviderHints, ProviderPlan } from './types';
import { TauriCredentialVault } from '../credential-vault.js';

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

export const RUNTIME_MODAL_TEXT = 1;
export const RUNTIME_MODAL_IMAGE = 2;
export const RUNTIME_MODAL_VIDEO = 3;
export const RUNTIME_MODAL_STT = 5;
export const RUNTIME_MODAL_EMBEDDING = 6;

export type RuntimeAiCallResolution = {
  plan: ProviderPlan;
  source: InferenceRouteSource;
  routePolicy: number;
  fallbackPolicy: number;
  modelId: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function normalizeModelRoot(model: string): string {
  const normalized = String(model || '').trim();
  if (!normalized) {
    return 'default';
  }
  const lower = normalized.toLowerCase();
  if (lower.startsWith('local/')) {
    return normalized.slice('local/'.length).trim() || 'default';
  }
  if (lower.startsWith('cloud/')) {
    return normalized.slice('cloud/'.length).trim() || 'default';
  }
  if (lower.startsWith('token/')) {
    return normalized.slice('token/'.length).trim() || 'default';
  }
  return normalized;
}

function ensureRouteModelId(model: string, routePolicy: number): string {
  const modelRoot = normalizeModelRoot(model);
  if (routePolicy === ROUTE_POLICY_TOKEN_API) {
    return `cloud/${modelRoot}`;
  }
  return `local/${modelRoot}`;
}

export function getRuntimeClient() {
  const runtime = getPlatformClient().runtime;
  if (!runtime) {
    throw new Error('RUNTIME_CLIENT_NOT_READY: runtime sdk client unavailable');
  }
  return runtime;
}

const credentialVault = new TauriCredentialVault();

export async function resolveProviderApiKeyFromCredentialRef(credentialRefId: string | undefined): Promise<string> {
  const ref = String(credentialRefId || '').trim();
  if (!ref) return '';
  try {
    return await credentialVault.getCredentialSecret(ref);
  } catch {
    return '';
  }
}

export function resolveRuntimeAiCall(input: {
  provider: string;
  modality: 'chat' | 'embedding' | 'stt' | 'tts' | 'image' | 'video';
  model?: string;
  localProviderEndpoint?: string;
  localProviderModel?: string;
  localOpenAiEndpoint?: string;
  providerHints?: LocalAiProviderHints;
}): RuntimeAiCallResolution {
  const plan = resolveProviderExecutionPlan({
    provider: input.provider,
    modality: input.modality,
    localProviderEndpoint: input.localProviderEndpoint,
    localProviderModel: input.localProviderModel,
    localOpenAiEndpoint: input.localOpenAiEndpoint,
    providerHints: input.providerHints,
  });

  if (plan.providerKind === 'FALLBACK') {
    throw new Error('LOCAL_AI_CAPABILITY_MISSING: fallback provider is not supported');
  }

  const source = inferRouteSourceFromEndpoint(plan.endpoint);
  const routePolicy = source === 'local-runtime'
    ? ROUTE_POLICY_LOCAL_RUNTIME
    : ROUTE_POLICY_TOKEN_API;

  const model = String(input.model || plan.model || input.localProviderModel || '').trim() || 'default';
  return {
    plan,
    source,
    routePolicy,
    fallbackPolicy: FALLBACK_POLICY_DENY,
    modelId: ensureRouteModelId(model, routePolicy),
  };
}

function resolveCaller(modId: string): {
  callerKind: 'desktop-core' | 'desktop-mod';
  callerId: string;
} {
  const normalized = String(modId || '').trim();
  if (normalized.startsWith('core.')) {
    return {
      callerKind: 'desktop-core',
      callerId: normalized,
    };
  }
  return {
    callerKind: 'desktop-mod',
    callerId: normalized ? `mod:${normalized}` : 'mod:unknown',
  };
}

async function resolveCredentialMetadata(input: {
  source: InferenceRouteSource;
  credentialRefId?: string;
  providerEndpoint?: string;
}): Promise<{
  credentialSource: 'runtime-config' | 'request-injected';
  providerEndpoint?: string;
  providerApiKey?: string;
}> {
  if (input.source !== 'token-api') {
    return {
      credentialSource: 'runtime-config',
    };
  }
  const providerApiKey = await resolveProviderApiKeyFromCredentialRef(input.credentialRefId);
  if (!providerApiKey) {
    return {
      credentialSource: 'runtime-config',
    };
  }
  return {
    credentialSource: 'request-injected',
    providerEndpoint: String(input.providerEndpoint || '').trim() || undefined,
    providerApiKey,
  };
}

export async function buildRuntimeRequestMetadata(input: {
  source: InferenceRouteSource;
  credentialRefId?: string;
  providerEndpoint?: string;
}): Promise<Record<string, string>> {
  const resolved = await resolveCredentialMetadata(input);
  const metadata: Record<string, string> = {
    credentialSource: resolved.credentialSource,
  };
  if (resolved.providerEndpoint) {
    metadata.providerEndpoint = resolved.providerEndpoint;
  }
  if (resolved.providerApiKey) {
    metadata.providerApiKey = resolved.providerApiKey;
  }
  return metadata;
}

export async function buildRuntimeCallOptions(input: {
  modId: string;
  timeoutMs: number;
  source: InferenceRouteSource;
  credentialRefId?: string;
  providerEndpoint?: string;
}): Promise<{
  timeoutMs: number;
  metadata: {
    callerKind: 'desktop-core' | 'desktop-mod';
    callerId: string;
    surfaceId: string;
    credentialSource: 'runtime-config' | 'request-injected';
    providerEndpoint?: string;
    providerApiKey?: string;
  };
}> {
  const caller = resolveCaller(input.modId);
  const credentialMetadata = await resolveCredentialMetadata({
    source: input.source,
    credentialRefId: input.credentialRefId,
    providerEndpoint: input.providerEndpoint,
  });
  return {
    timeoutMs: input.timeoutMs,
    metadata: {
      callerKind: caller.callerKind,
      callerId: caller.callerId,
      surfaceId: 'desktop.renderer',
      credentialSource: credentialMetadata.credentialSource,
      providerEndpoint: credentialMetadata.providerEndpoint,
      providerApiKey: credentialMetadata.providerApiKey,
    },
  };
}

export async function buildRuntimeStreamOptions(
  input: {
    modId: string;
    timeoutMs: number;
    signal?: AbortSignal;
    source: InferenceRouteSource;
    credentialRefId?: string;
    providerEndpoint?: string;
  },
): Promise<{
  timeoutMs: number;
  signal?: AbortSignal;
  metadata: {
    callerKind: 'desktop-core' | 'desktop-mod';
    callerId: string;
    surfaceId: string;
    credentialSource: 'runtime-config' | 'request-injected';
    providerEndpoint?: string;
    providerApiKey?: string;
  };
}> {
  const caller = resolveCaller(input.modId);
  const credentialMetadata = await resolveCredentialMetadata({
    source: input.source,
    credentialRefId: input.credentialRefId,
    providerEndpoint: input.providerEndpoint,
  });
  return {
    timeoutMs: input.timeoutMs,
    signal: input.signal,
    metadata: {
      callerKind: caller.callerKind,
      callerId: caller.callerId,
      surfaceId: 'desktop.renderer',
      credentialSource: credentialMetadata.credentialSource,
      providerEndpoint: credentialMetadata.providerEndpoint,
      providerApiKey: credentialMetadata.providerApiKey,
    },
  };
}

export function routeSourceFromDecision(
  routeDecision: unknown,
  fallback: InferenceRouteSource,
): InferenceRouteSource {
  if (routeDecision === ROUTE_POLICY_LOCAL_RUNTIME || routeDecision === 'ROUTE_POLICY_LOCAL_RUNTIME') {
    return 'local-runtime';
  }
  if (routeDecision === ROUTE_POLICY_TOKEN_API || routeDecision === 'ROUTE_POLICY_TOKEN_API') {
    return 'token-api';
  }
  return fallback;
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
        if (Number.isFinite(n)) {
          row.push(n);
        }
      }
    }
    return row;
  });
}

function toBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i] || 0);
  }
  if (typeof btoa === 'function') {
    return btoa(binary);
  }
  throw new Error('LOCAL_AI_PROVIDER_INTERNAL_ERROR: missing base64 encoder');
}

export function base64FromBytes(bytes: Uint8Array): string {
  return toBase64(bytes);
}

function fromBase64(value: string): Uint8Array {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return new Uint8Array(0);
  }
  if (typeof Buffer !== 'undefined') {
    return Uint8Array.from(Buffer.from(normalized, 'base64'));
  }
  if (typeof atob === 'function') {
    const binary = atob(normalized);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  }
  throw new Error('LOCAL_AI_PROVIDER_INTERNAL_ERROR: missing base64 decoder');
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, item) => sum + item.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export type RuntimeArtifact = {
  artifactId: string;
  mimeType: string;
  bytes: Uint8Array;
  source: InferenceRouteSource;
  traceId: string;
};

export async function collectRuntimeArtifacts(
  stream: AsyncIterable<unknown>,
  fallbackSource: InferenceRouteSource,
): Promise<RuntimeArtifact[]> {
  const order: string[] = [];
  const states = new Map<string, {
    artifactId: string;
    mimeType: string;
    chunks: Uint8Array[];
    source: InferenceRouteSource;
    traceId: string;
  }>();

  for await (const event of stream) {
    const record = asRecord(event);
    const artifactId = String(record.artifactId || '').trim() || `artifact-${order.length + 1}`;
    const entry = states.get(artifactId) || {
      artifactId,
      mimeType: '',
      chunks: [],
      source: fallbackSource,
      traceId: '',
    };
    if (!states.has(artifactId)) {
      states.set(artifactId, entry);
      order.push(artifactId);
    }

    const mimeType = String(record.mimeType || '').trim();
    if (mimeType) {
      entry.mimeType = mimeType;
    }
    entry.source = routeSourceFromDecision(record.routeDecision, entry.source);
    const traceId = String(record.traceId || '').trim();
    if (traceId) {
      entry.traceId = traceId;
    }
    const chunkValue = record.chunk;
    if (chunkValue instanceof Uint8Array) {
      entry.chunks.push(chunkValue);
    } else if (chunkValue instanceof ArrayBuffer) {
      entry.chunks.push(new Uint8Array(chunkValue));
    } else if (Array.isArray(chunkValue)) {
      entry.chunks.push(Uint8Array.from(chunkValue.map((value) => Number(value) || 0)));
    }
  }

  return order.map((artifactId) => {
    const entry = states.get(artifactId);
    if (!entry) {
      return {
        artifactId,
        mimeType: 'application/octet-stream',
        bytes: new Uint8Array(0),
        source: fallbackSource,
        traceId: '',
      };
    }
    return {
      artifactId: entry.artifactId,
      mimeType: entry.mimeType || 'application/octet-stream',
      bytes: concatChunks(entry.chunks),
      source: entry.source,
      traceId: entry.traceId,
    };
  });
}

function decodeBase64Payload(raw: string): Uint8Array {
  const normalized = String(raw || '').trim();
  if (!normalized) {
    return new Uint8Array(0);
  }
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
  if (!match) {
    return null;
  }
  const mimeType = String(match[1] || '').trim() || 'application/octet-stream';
  const isBase64 = Boolean(match[2]);
  const payload = String(match[3] || '');
  return {
    mimeType,
    payload,
    isBase64,
  };
}

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
        throw new Error('LOCAL_AI_CAPABILITY_MISSING: audio data url must be base64');
      }
      const decoded = decodeBase64Payload(parsed.payload);
      if (decoded.length === 0) {
        throw new Error('LOCAL_AI_CAPABILITY_MISSING: audio payload empty');
      }
      return {
        audioBytes: decoded,
        mimeType: explicitMimeType || parsed.mimeType,
      };
    }

    const decoded = decodeBase64Payload(rawBase64);
    if (decoded.length === 0) {
      throw new Error('LOCAL_AI_CAPABILITY_MISSING: audio payload empty');
    }
    return {
      audioBytes: decoded,
      mimeType: explicitMimeType || 'audio/wav',
    };
  }

  const audioUri = String(input.audioUri || '').trim();
  if (!audioUri) {
    throw new Error('LOCAL_AI_CAPABILITY_MISSING: audio source required');
  }

  const parsedDataUrl = parseDataUrl(audioUri);
  if (parsedDataUrl) {
    if (!parsedDataUrl.isBase64) {
      throw new Error('LOCAL_AI_CAPABILITY_MISSING: audio data url must be base64');
    }
    const decoded = decodeBase64Payload(parsedDataUrl.payload);
    if (decoded.length === 0) {
      throw new Error('LOCAL_AI_CAPABILITY_MISSING: audio payload empty');
    }
    return {
      audioBytes: decoded,
      mimeType: explicitMimeType || parsedDataUrl.mimeType,
    };
  }

  const fetchImpl = input.fetchImpl || fetch;
  const response = await fetchImpl(audioUri);
  if (!response.ok) {
    throw new Error(`LOCAL_AI_SERVICE_UNREACHABLE: fetch audio failed HTTP_${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const audioBytes = new Uint8Array(arrayBuffer);
  if (audioBytes.length === 0) {
    throw new Error('LOCAL_AI_CAPABILITY_MISSING: audio payload empty');
  }
  const responseMimeType = String(response.headers.get('content-type') || '').trim();
  return {
    audioBytes,
    mimeType: explicitMimeType || responseMimeType || 'audio/wav',
  };
}

function extractReasonCodeCandidate(value: unknown): string | null {
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) return null;
    if (/^\d+$/.test(normalized)) {
      const mapped = AI_REASON_CODE_NUMERIC[Number(normalized)];
      return mapped || null;
    }
    return normalized;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const mapped = AI_REASON_CODE_NUMERIC[value];
    return mapped || null;
  }
  return null;
}

export function extractRuntimeReasonCode(error: unknown): string | null {
  const record = asRecord(error);
  const direct = extractReasonCodeCandidate(record.reasonCode);
  if (direct) {
    return direct;
  }

  const message = String(record.message || (error instanceof Error ? error.message : '') || '').trim();
  if (!message) {
    return null;
  }

  const explicit = message.match(/\b(AI_[A-Z_]+)\b/);
  if (explicit?.[1]) {
    return explicit[1];
  }

  const numeric = message.match(/\b(20\d)\b/);
  if (numeric?.[1]) {
    const mapped = AI_REASON_CODE_NUMERIC[Number(numeric[1])];
    if (mapped) {
      return mapped;
    }
  }
  return null;
}

export function toLocalAiReasonCode(error: unknown): string | null {
  const runtimeCode = extractRuntimeReasonCode(error);
  if (!runtimeCode) {
    return null;
  }
  return RUNTIME_REASON_CODE_TO_LOCAL_AI[runtimeCode] || null;
}

import type {
  LanguageModelV3FinishReason,
  LanguageModelV3Prompt,
  LanguageModelV3Usage,
  SharedV3ProviderMetadata,
} from '@ai-sdk/provider';
import {
  createNimiError,
  Runtime,
  type RuntimeCallOptions,
  type RuntimeStreamCallOptions,
} from '../runtime/index.js';
import { Struct } from '../runtime/generated/google/protobuf/struct.js';
import { ChatContentPartType } from '../runtime/generated/runtime/v1/ai.js';
import { ReasonCode, type AiFallbackPolicy, type AiRoutePolicy } from '../types/index.js';
import {
  FALLBACK_POLICY_ALLOW,
  FALLBACK_POLICY_DENY,
  ROUTE_POLICY_LOCAL,
  ROUTE_POLICY_CLOUD,
  type NimiAiProviderConfig,
  type RuntimeDefaults,
  type RuntimeForAiProvider,
} from './types.js';
import { asRecord, normalizeText } from '../internal/utils.js';
export {
  collectArtifacts,
  executeScenarioJob,
  normalizeProviderError,
  toEmbeddingVectors,
  toEmbeddingVectorsFromScenarioOutput,
} from './helpers-scenario.js';
export { asRecord, normalizeText };

export function ensureText(value: unknown, fieldName: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw createNimiError({
      message: `${fieldName} is required`,
      reasonCode: ReasonCode.SDK_AI_PROVIDER_CONFIG_INVALID,
      actionHint: `set_${fieldName}`,
      source: 'sdk',
    });
  }
  return normalized;
}

export function parseCount(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  return undefined;
}

export function resolveRoutePolicy(value: AiRoutePolicy | undefined): number {
  return value === 'cloud'
    ? ROUTE_POLICY_CLOUD
    : ROUTE_POLICY_LOCAL;
}

export function resolveFallbackPolicy(value: AiFallbackPolicy | undefined): number {
  return value === 'allow'
    ? FALLBACK_POLICY_ALLOW
    : FALLBACK_POLICY_DENY;
}

export function fromRouteDecision(value: unknown): AiRoutePolicy {
  return Number(value) === ROUTE_POLICY_CLOUD ? 'cloud' : 'local';
}

export function toProviderMetadata(input: {
  traceId?: string;
  routeDecision?: unknown;
  modelResolved?: string;
}): SharedV3ProviderMetadata {
  return {
    nimi: {
      traceId: normalizeText(input.traceId) || undefined,
      routeDecision: fromRouteDecision(input.routeDecision),
      modelResolved: normalizeText(input.modelResolved) || undefined,
    },
  };
}

export function toUsage(value: unknown): LanguageModelV3Usage {
  const usage = (value && typeof value === 'object')
    ? value as { inputTokens?: unknown; outputTokens?: unknown }
    : {};
  const inputTokens = parseCount(usage.inputTokens);
  const outputTokens = parseCount(usage.outputTokens);
  return {
    inputTokens: {
      total: inputTokens,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: outputTokens,
      text: outputTokens,
      reasoning: undefined,
    },
  };
}

export function toFinishReason(value: unknown): LanguageModelV3FinishReason {
  const reason = Number(value);
  switch (reason) {
    case 1:
      return { unified: 'stop', raw: 'STOP' };
    case 2:
      return { unified: 'length', raw: 'LENGTH' };
    case 3:
      return { unified: 'tool-calls', raw: 'TOOL_CALL' };
    case 4:
      return { unified: 'content-filter', raw: 'CONTENT_FILTER' };
    case 5:
      return { unified: 'error', raw: 'ERROR' };
    default:
      return { unified: 'other', raw: undefined };
  }
}

export function extractTextValue(part: unknown): string {
  const record = asRecord(part);
  if (record.type === 'text') {
    return normalizeText(record.text);
  }
  if (record.type === 'reasoning') {
    return normalizeText(record.text);
  }
  if (record.type === 'tool-result') {
    return normalizeText(JSON.stringify(record.result || null));
  }
  return '';
}

export function toRuntimePrompt(prompt: LanguageModelV3Prompt): {
  systemPrompt: string;
  hasTextInput: boolean;
  input: Array<{
    role: string;
    content: string;
    name: string;
    parts: Array<{
      type: ChatContentPartType;
      text: string;
      imageUrl?: { url: string; detail: string };
      videoUrl: string;
    }>;
  }>;
} {
  const system: string[] = [];
  const input: Array<{
    role: string;
    content: string;
    name: string;
    parts: Array<{
      type: ChatContentPartType;
      text: string;
      imageUrl?: { url: string; detail: string };
      videoUrl: string;
    }>;
  }> = [];
  let hasTextInput = false;

  for (const message of prompt) {
    if (message.role === 'system') {
      const text = extractPromptText(message.content);
      if (text) {
        system.push(text);
      }
      continue;
    }

    const textContent = extractPromptText(message.content);
    const parts = Array.isArray(message.content)
      ? extractContentParts(message.content)
      : (textContent ? [createTextChatContentPart(textContent)] : []);

    if (!textContent && parts.length === 0) {
      continue;
    }
    if (textContent) {
      hasTextInput = true;
    }

    input.push({
      role: message.role,
      content: textContent,
      name: '',
      parts,
    });
  }

  return {
    systemPrompt: system.join('\n\n'),
    hasTextInput,
    input,
  };
}

function extractPromptText(content: unknown): string {
  if (Array.isArray(content)) {
    return content.map(extractTextValue).filter((text: string) => text.length > 0).join('\n');
  }
  return normalizeText(content);
}

function extractFileUrl(part: Record<string, unknown>): string | undefined {
  const data = part.data;
  if (data instanceof URL) {
    return data.toString();
  }
  if (typeof data === 'string') {
    const trimmed = data.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed;
    }
    // v1: skip non-URL strings (base64, data URIs) — URL-only policy
  }
  // v1: skip Uint8Array — URL-only policy
  return undefined;
}

function createTextChatContentPart(text: string): {
  type: ChatContentPartType;
  text: string;
  imageUrl?: { url: string; detail: string };
  videoUrl: string;
} {
  return {
    type: ChatContentPartType.TEXT,
    text,
    videoUrl: '',
  };
}

function extractContentParts(
  content: unknown[],
): Array<{
  type: ChatContentPartType;
  text: string;
  imageUrl?: { url: string; detail: string };
  videoUrl: string;
}> {
  const result: Array<{
    type: ChatContentPartType;
    text: string;
    imageUrl?: { url: string; detail: string };
    videoUrl: string;
  }> = [];

  for (const part of content) {
    const record = asRecord(part);
    if (record.type === 'text') {
      const text = normalizeText(record.text);
      if (text) {
        result.push(createTextChatContentPart(text));
      }
    } else if (record.type === 'reasoning') {
      const text = normalizeText(record.text);
      if (text) {
        result.push(createTextChatContentPart(text));
      }
    } else if (record.type === 'file') {
      const mediaType = normalizeText(record.mediaType);
      if (mediaType && mediaType.startsWith('image/')) {
        const url = extractFileUrl(record);
        if (url) {
          result.push({
            type: ChatContentPartType.IMAGE_URL,
            text: '',
            imageUrl: { url, detail: 'auto' },
            videoUrl: '',
          });
        }
      } else if (mediaType && mediaType.startsWith('video/')) {
        const url = extractFileUrl(record);
        if (url) {
          result.push({
            type: ChatContentPartType.VIDEO_URL,
            text: '',
            videoUrl: url,
          });
        }
      }
    }
  }

  return result;
}

export function extractGenerateText(output: unknown): string {
  const fields = asRecord(asRecord(output).fields);
  const text = asRecord(fields.text);
  const kind = asRecord(text.kind);

  if (kind.oneofKind === 'stringValue') {
    return normalizeText(kind.stringValue);
  }
  if (typeof text.stringValue === 'string') {
    return normalizeText(text.stringValue);
  }
  return '';
}

export function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((size, chunk) => size + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

export function toBase64(value: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value).toString('base64');
  }
  let output = '';
  for (let index = 0; index < value.length; index += 1) {
    output += String.fromCharCode(value[index] || 0);
  }
  if (typeof btoa === 'function') {
    return btoa(output);
  }
  throw createNimiError({
    message: 'base64 encoder unavailable',
    reasonCode: ReasonCode.SDK_AI_PROVIDER_BASE64_UNAVAILABLE,
    actionHint: 'use_node_or_tauri_runtime',
    source: 'sdk',
  });
}

function isDataURL(value: string): boolean {
  return /^data:[^,]+,/.test(value);
}

function toUint8Array(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return undefined;
}

export function toImageFileSource(value: unknown): string {
  if (typeof value === 'string') {
    return normalizeText(value);
  }
  const record = asRecord(value);
  const type = normalizeText(record.type).toLowerCase();
  if (type === 'url') {
    return normalizeText(record.url);
  }
  if (type !== 'file') {
    return '';
  }

  const mediaType = normalizeText(record.mediaType) || 'application/octet-stream';
  const data = record.data;
  if (typeof data === 'string') {
    const normalized = normalizeText(data);
    if (!normalized) {
      return '';
    }
    if (isDataURL(normalized)) {
      return normalized;
    }
    return `data:${mediaType};base64,${normalized}`;
  }

  const bytes = toUint8Array(data);
  if (!bytes || bytes.length === 0) {
    return '';
  }
  return `data:${mediaType};base64,${toBase64(bytes)}`;
}

export function toImageFileSources(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const sources: string[] = [];
  for (const item of value) {
    const source = toImageFileSource(item);
    if (!source) {
      continue;
    }
    sources.push(source);
  }
  return sources;
}

export function toUtf8(value: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value).toString('utf8');
  }
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(value);
  }
  let output = '';
  for (let index = 0; index < value.length; index += 1) {
    output += String.fromCharCode(value[index] || 0);
  }
  return output;
}

export function toProtoStruct(input: Record<string, unknown> | undefined): any {
  if (!input || Object.keys(input).length === 0) {
    return undefined;
  }
  try {
    return Struct.fromJson(input as never);
  } catch {
    return undefined;
  }
}

export function toLabels(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return undefined;
  }
  const labels: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const normalizedKey = normalizeText(key);
    if (!normalizedKey) {
      continue;
    }
    const normalizedValue = normalizeText(value);
    if (!normalizedValue) {
      continue;
    }
    labels[normalizedKey] = normalizedValue;
  }
  return Object.keys(labels).length > 0 ? labels : undefined;
}

export function ensureRuntime(config: NimiAiProviderConfig): {
  runtime: RuntimeForAiProvider;
  defaults: RuntimeDefaults;
} {
  if (!config.runtime) {
    throw createNimiError({
      message: 'createNimiAiProvider requires runtime instance',
      reasonCode: ReasonCode.SDK_AI_PROVIDER_RUNTIME_REQUIRED,
      actionHint: 'provide_runtime_instance',
      source: 'sdk',
    });
  }

  if (!(config.runtime instanceof Runtime)) {
    throw createNimiError({
      message: 'runtime must be Runtime class instance',
      reasonCode: ReasonCode.SDK_AI_PROVIDER_RUNTIME_REQUIRED,
      actionHint: 'construct_runtime_with_new_runtime',
      source: 'sdk',
    });
  }

  const subjectUserId = normalizeText(config.subjectUserId) || undefined;

  return {
    runtime: config.runtime,
    defaults: {
      appId: ensureText(config.appId || config.runtime.appId, 'appId'),
      subjectUserId,
      routePolicy: config.routePolicy || 'local',
      fallback: config.fallback || 'deny',
      timeoutMs: config.timeoutMs,
      metadata: config.metadata,
    },
  };
}

export function toCallOptions(
  defaults: RuntimeDefaults,
  input: {
    timeoutMs?: number;
    metadata?: RuntimeCallOptions['metadata'];
  },
): RuntimeCallOptions {
  const timeoutMs = typeof input.timeoutMs === 'number'
    ? input.timeoutMs
    : defaults.timeoutMs;
  const metadata = {
    ...(defaults.metadata || {}),
    ...(input.metadata || {}),
  };

  return {
    timeoutMs,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  };
}

export function toStreamOptions(
  defaults: RuntimeDefaults,
  input: {
    timeoutMs?: number;
    metadata?: RuntimeCallOptions['metadata'];
    signal?: AbortSignal;
  },
): RuntimeStreamCallOptions {
  return {
    ...toCallOptions(defaults, input),
    signal: input.signal,
  };
}

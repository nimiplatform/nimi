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
import {
  Struct,
} from '../runtime/generated/google/protobuf/struct.js';
import { ChatContentPartType, type ScenarioOutput } from '../runtime/generated/runtime/v1/ai.js';
import { ReasonCode, type AiRoutePolicy } from '../types/index.js';
import {
  ROUTE_POLICY_LOCAL,
  ROUTE_POLICY_CLOUD,
  type NimiAiProviderConfig,
  type RuntimeDefaults,
  type RuntimeForAiProvider,
} from './types.js';
import { asRecord, normalizeText } from '../internal/utils.js';
import {
  concatChunks,
  ensureSafeExternalMediaUrl,
  ensureText,
  fromRouteDecision,
  toCallOptions,
} from './helpers-shared.js';
export { ensureSafeExternalMediaUrl, ensureText, fromRouteDecision, toCallOptions };
export {
  collectArtifacts,
  executeScenarioJob,
  normalizeProviderError,
  toEmbeddingVectors,
  toEmbeddingVectorsFromScenarioOutput,
  toSpeechSynthesisArtifactsFromScenarioOutput,
  toSpeechTranscriptionFromScenarioOutput,
} from './helpers-scenario.js';
export { asRecord, normalizeText };

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
  const usage = asRecord(value);
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
  hasNonSystemInput: boolean;
  input: Array<{
    role: string;
    content: string;
    name: string;
    parts: Array<{
      type: ChatContentPartType;
      text: string;
      imageUrl?: { url: string; detail: string };
      videoUrl: string;
      audioUrl: string;
      artifactRef?: {
        artifactId: string;
        localArtifactId: string;
        mimeType: string;
        displayName: string;
      };
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
      audioUrl: string;
      artifactRef?: {
        artifactId: string;
        localArtifactId: string;
        mimeType: string;
        displayName: string;
      };
    }>;
  }> = [];
  let hasNonSystemInput = false;

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
    hasNonSystemInput = true;

    input.push({
      role: message.role,
      content: textContent,
      name: '',
      parts,
    });
  }

  return {
    systemPrompt: system.join('\n\n'),
    hasNonSystemInput,
    input,
  };
}

function createUnsupportedTextChatPartError() {
  return createNimiError({
    message: 'text chat multimodal requires text, image_url, video_url, audio_url, or artifact_ref content parts',
    reasonCode: ReasonCode.AI_MEDIA_OPTION_UNSUPPORTED,
    actionHint: 'use_supported_text_chat_media_parts',
    source: 'sdk',
  });
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
    return ensureSafeExternalMediaUrl(data.toString(), 'file.data');
  }
  if (typeof data === 'string') {
    const trimmed = data.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return ensureSafeExternalMediaUrl(trimmed, 'file.data');
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
  audioUrl: string;
  artifactRef?: {
    artifactId: string;
    localArtifactId: string;
    mimeType: string;
    displayName: string;
  };
} {
  return {
    type: ChatContentPartType.TEXT,
    text,
    videoUrl: '',
    audioUrl: '',
  };
}

function createArtifactRefPart(record: Record<string, unknown>) {
  const artifactId = normalizeText(record.artifactId ?? record.artifact_id);
  const localArtifactId = normalizeText(record.localArtifactId ?? record.local_artifact_id);
  if (!artifactId && !localArtifactId) {
    throw createNimiError({
      message: 'artifact_ref file part requires artifactId or localArtifactId',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'set_artifact_ref_id',
      source: 'sdk',
    });
  }
  return {
    type: ChatContentPartType.ARTIFACT_REF,
    text: '',
    imageUrl: undefined,
    videoUrl: '',
    audioUrl: '',
    artifactRef: {
      artifactId: artifactId || '',
      localArtifactId: localArtifactId || '',
      mimeType: normalizeText(record.mediaType ?? record.mimeType ?? record.mime_type),
      displayName: normalizeText(record.displayName ?? record.display_name),
    },
  };
}

function extractContentParts(
  content: unknown[],
): Array<{
  type: ChatContentPartType;
  text: string;
  imageUrl?: { url: string; detail: string };
  videoUrl: string;
  audioUrl: string;
  artifactRef?: {
    artifactId: string;
    localArtifactId: string;
    mimeType: string;
    displayName: string;
  };
}> {
  const result: Array<{
    type: ChatContentPartType;
    text: string;
    imageUrl?: { url: string; detail: string };
    videoUrl: string;
    audioUrl: string;
    artifactRef?: {
      artifactId: string;
      localArtifactId: string;
      mimeType: string;
      displayName: string;
    };
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
      if (record.artifactId || record.artifact_id || record.localArtifactId || record.local_artifact_id) {
        result.push(createArtifactRefPart(record));
        continue;
      }
      const mediaType = normalizeText(record.mediaType);
      if (mediaType && mediaType.startsWith('image/')) {
        const url = extractFileUrl(record);
        if (!url) {
          throw createNimiError({
            message: 'image file parts require a public https URL source',
            reasonCode: ReasonCode.AI_INPUT_INVALID,
            actionHint: 'set_image_file_https_url',
            source: 'sdk',
          });
        }
        result.push({
          type: ChatContentPartType.IMAGE_URL,
          text: '',
          imageUrl: { url, detail: 'auto' },
          videoUrl: '',
          audioUrl: '',
        });
      } else if (mediaType && mediaType.startsWith('video/')) {
        const url = extractFileUrl(record);
        if (!url) {
          throw createNimiError({
            message: 'video file parts require a public https URL source',
            reasonCode: ReasonCode.AI_INPUT_INVALID,
            actionHint: 'set_video_file_https_url',
            source: 'sdk',
          });
        }
        result.push({
          type: ChatContentPartType.VIDEO_URL,
          text: '',
          imageUrl: undefined,
          videoUrl: url,
          audioUrl: '',
        });
      } else if (mediaType && mediaType.startsWith('audio/')) {
        const url = extractFileUrl(record);
        if (!url) {
          throw createNimiError({
            message: 'audio file parts require a public https URL source',
            reasonCode: ReasonCode.AI_INPUT_INVALID,
            actionHint: 'set_audio_file_https_url',
            source: 'sdk',
          });
        }
        result.push({
          type: ChatContentPartType.AUDIO_URL,
          text: '',
          imageUrl: undefined,
          videoUrl: '',
          audioUrl: url,
        });
      } else if (mediaType) {
        throw createUnsupportedTextChatPartError();
      }
    }
  }

  return result;
}

export function extractGenerateText(output: unknown): string {
  const value = (output && typeof output === 'object')
    ? output as ScenarioOutput
    : undefined;
  const variant = value?.output;
  if (variant?.oneofKind === 'textGenerate') {
    return normalizeText(variant.textGenerate.text);
  }
  return '';
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

  const mediaType = normalizeText(record.mediaType);
  if (!mediaType) {
    throw createNimiError({
      message: 'image file mediaType is required',
      reasonCode: ReasonCode.SDK_AI_PROVIDER_CONFIG_INVALID,
      actionHint: 'set_file_media_type',
      source: 'sdk',
    });
  }
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
  throw createNimiError({
    message: 'utf-8 decoder unavailable',
    reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    actionHint: 'use_node_or_text_decoder_runtime',
    source: 'sdk',
  });
}

export function toProtoStruct(input: Record<string, unknown> | undefined): Struct | undefined {
  if (!input || Object.keys(input).length === 0) {
    return undefined;
  }
  try {
    return Struct.fromJson(input as never);
  } catch (error) {
    throw createNimiError({
      message: `failed to encode proto struct: ${error instanceof Error ? error.message : 'unknown error'}`,
      reasonCode: ReasonCode.SDK_AI_PROVIDER_CONFIG_INVALID,
      actionHint: 'remove_non_json_extension_values',
      source: 'sdk',
    });
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
      timeoutMs: config.timeoutMs,
      metadata: config.metadata,
    },
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

import { ReasonCode, type NimiError } from '../types/index.js';
import { createNimiError } from './errors.js';
import {
  ChatContentPartType,
  FallbackPolicy,
  FinishReason,
  ScenarioJobEventType,
  ScenarioJobStatus,
  RoutePolicy,
  type ScenarioArtifact,
  type ScenarioOutput,
  type ChatContentPart,
  type ChatMessage,
  type ScenarioJobEvent,
} from './generated/runtime/v1/ai';
import {
  WorkflowEventType,
  type WorkflowEvent,
} from './generated/runtime/v1/workflow';
import { RuntimeHealthStatus } from './generated/runtime/v1/audit';
import { Struct } from './generated/google/protobuf/struct.js';
import { asRecord, normalizeText, nowIso } from '../internal/utils.js';
import { extractGenerateText as extractGenerateTextShared } from '../internal/scenario-output.js';
import { RuntimeMethodIds, isRuntimeStreamMethod } from './method-ids.js';
import type {
  NimiFinishReason,
  NimiRoutePolicy,
  NimiTokenUsage,
  NimiTraceInfo,
  RuntimeHealth,
  TextMessage,
  TextMessageContentPart,
} from './types.js';

export type RuntimeMethodLookupEntry = {
  moduleKey: keyof typeof RuntimeMethodIds;
  methodKey: string;
  stream: boolean;
};

export const DEFAULT_WAIT_FOR_READY_TIMEOUT_MS = 10000;
export const DEFAULT_MEDIA_POLL_INTERVAL_MS = 250;
export const DEFAULT_MEDIA_TIMEOUT_MS = 120000;
export const DEFAULT_RETRY_MAX_ATTEMPTS = 3;
export const DEFAULT_RETRY_BACKOFF_MS = 200;
export const MAX_RETRY_BACKOFF_MS = 3000;

export const SDK_RUNTIME_MAJOR_VERSION = 0;

export const PHASE2_MODULE_KEYS: ReadonlySet<string> = new Set([
  'workflow',
  'model',
  'knowledge',
  'app',
]);

export const PHASE2_AUDIT_METHOD_IDS: ReadonlySet<string> = new Set([
  RuntimeMethodIds.audit.listAuditEvents,
  RuntimeMethodIds.audit.exportAuditEvents,
  RuntimeMethodIds.audit.listUsageStats,
]);

export function parseSemverMajor(version: string): number | null {
  const match = /^v?(\d+)/.exec(version);
  return match ? Number(match[1]) : null;
}

export const RETRYABLE_RUNTIME_REASON_CODES: ReadonlySet<string> = new Set([
  ReasonCode.RUNTIME_UNAVAILABLE,
  ReasonCode.RUNTIME_BRIDGE_DAEMON_UNAVAILABLE,
  ReasonCode.SDK_RUNTIME_NODE_GRPC_UNARY_FAILED,
  ReasonCode.SDK_RUNTIME_NODE_GRPC_STREAM_OPEN_FAILED,
  ReasonCode.SDK_RUNTIME_TAURI_UNARY_FAILED,
  ReasonCode.SDK_RUNTIME_TAURI_STREAM_OPEN_FAILED,
  ReasonCode.SDK_RUNTIME_TAURI_STREAM_FAILED,
  ReasonCode.SDK_RUNTIME_TAURI_INVOKE_MISSING,
  ReasonCode.SDK_RUNTIME_TAURI_LISTEN_MISSING,
]);

export const RUNTIME_METHOD_LOOKUP: Readonly<Record<string, RuntimeMethodLookupEntry>> = buildRuntimeMethodLookup();

function buildRuntimeMethodLookup(): Readonly<Record<string, RuntimeMethodLookupEntry>> {
  const lookup: Record<string, RuntimeMethodLookupEntry> = {};
  const groups = Object.entries(RuntimeMethodIds) as Array<
    [keyof typeof RuntimeMethodIds, Record<string, string>]
  >;

  for (const [moduleKey, methods] of groups) {
    for (const [methodKey, methodId] of Object.entries(methods)) {
      lookup[methodId] = {
        moduleKey,
        methodKey,
        stream: isRuntimeStreamMethod(methodId),
      };
    }
  }

  return Object.freeze(lookup);
}
export { asRecord, normalizeText, nowIso };
export const extractGenerateText = extractGenerateTextShared;

export function ensureText(value: unknown, fieldName: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw createNimiError({
      message: `${fieldName} is required`,
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: `set_${fieldName}`,
      source: 'sdk',
    });
  }
  return normalized;
}

export function toRoutePolicy(value: NimiRoutePolicy | undefined): RoutePolicy {
  return value === 'cloud' ? RoutePolicy.CLOUD : RoutePolicy.LOCAL;
}

export function fromRoutePolicy(value: RoutePolicy): NimiRoutePolicy {
  return value === RoutePolicy.CLOUD ? 'cloud' : 'local';
}

export function toFinishReason(value: FinishReason): NimiFinishReason {
  switch (value) {
    case FinishReason.LENGTH:
      return 'length';
    case FinishReason.CONTENT_FILTER:
      return 'content-filter';
    case FinishReason.TOOL_CALL:
      return 'tool-calls';
    case FinishReason.ERROR:
      return 'error';
    case FinishReason.STOP:
    default:
      return 'stop';
  }
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

export function toUsage(value: unknown): NimiTokenUsage {
  const usage = asRecord(value);
  const inputTokens = parseCount(usage.inputTokens);
  const outputTokens = parseCount(usage.outputTokens);
  const totalTokens = typeof inputTokens === 'number' && typeof outputTokens === 'number'
    ? inputTokens + outputTokens
    : undefined;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

export function toTraceInfo(input: {
  traceId?: unknown;
  modelResolved?: unknown;
  routeDecision?: unknown;
}): NimiTraceInfo {
  return {
    traceId: normalizeText(input.traceId) || undefined,
    modelResolved: normalizeText(input.modelResolved) || undefined,
    routeDecision: Number(input.routeDecision) === RoutePolicy.CLOUD ? 'cloud' : 'local',
  };
}

export function toRuntimeMessages(input: string | TextMessage[], system?: string): {
  systemPrompt: string;
  input: ChatMessage[];
} {
  if (typeof input === 'string') {
    const content = normalizeText(input);
    if (!content) {
      throw createNimiError({
        message: 'text input is required',
        reasonCode: ReasonCode.AI_INPUT_INVALID,
        actionHint: 'set_text_input',
        source: 'sdk',
      });
    }
    return {
      systemPrompt: normalizeText(system),
      input: [{ role: 'user', content, name: '', parts: [createTextChatContentPart(content)] }],
    };
  }

  const systemParts: string[] = [];
  const messages: ChatMessage[] = [];
  let hasNonSystemContent = false;

  if (Array.isArray(input)) {
    for (const message of input) {
      if (Array.isArray(message.content)) {
        // Multimodal content: build parts + dual-write text
        const protoParts = contentPartsToProto(message.content);
        const textContent = extractTextFromContentParts(message.content);

        if (message.role === 'system') {
          // System messages: extract text only, ignore media
          if (textContent) {
            systemParts.push(textContent);
          }
          continue;
        }

        if (protoParts.length === 0 && !textContent) {
          continue;
        }
        hasNonSystemContent = true;
        messages.push({
          role: message.role,
          content: textContent,
          name: normalizeText(message.name),
          parts: protoParts,
        });
        continue;
      }

      // String content: original path
      const content = normalizeText(message.content);
      if (!content) {
        continue;
      }
      if (message.role === 'system') {
        systemParts.push(content);
        continue;
      }
      hasNonSystemContent = true;
      messages.push({
        role: message.role,
        content,
        name: normalizeText(message.name),
        parts: [createTextChatContentPart(content)],
      });
    }
  }

  const explicitSystem = normalizeText(system);
  if (explicitSystem) {
    systemParts.push(explicitSystem);
  }

  if (messages.length === 0 || !hasNonSystemContent) {
    throw createNimiError({
      message: 'text input must include at least one non-system message with text or media content',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'add_user_or_assistant_content_message',
      source: 'sdk',
    });
  }

  return {
    systemPrompt: systemParts.join('\n\n'),
    input: messages,
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

function createTextChatContentPart(text: string): ChatContentPart {
  return {
    type: ChatContentPartType.TEXT,
    content: {
      oneofKind: 'text',
      text,
    },
  };
}

function createArtifactRefChatContentPart(part: Extract<TextMessageContentPart, { type: 'artifact_ref' }>): ChatContentPart {
  const artifactId = normalizeText(part.artifactId);
  const localArtifactId = normalizeText(part.localArtifactId);
  if (!artifactId && !localArtifactId) {
    throw createNimiError({
      message: 'artifact_ref requires artifactId or localArtifactId',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'set_artifact_ref_id',
      source: 'sdk',
    });
  }
  return {
    type: ChatContentPartType.ARTIFACT_REF,
    content: {
      oneofKind: 'artifactRef',
      artifactRef: {
        artifactId: artifactId || '',
        localArtifactId: localArtifactId || '',
        mimeType: normalizeText(part.mimeType),
        displayName: normalizeText(part.displayName),
      },
    },
  };
}

function contentPartsToProto(
  parts: TextMessageContentPart[],
): ChatContentPart[] {
  const result: ChatContentPart[] = [];
  for (const part of parts) {
    switch (part.type) {
      case 'text': {
        const text = normalizeText(part.text);
        if (text) {
          result.push(createTextChatContentPart(text));
        }
        break;
      }
      case 'image_url': {
        const url = normalizeText(part.imageUrl);
        if (url) {
          result.push({
            type: ChatContentPartType.IMAGE_URL,
            content: {
              oneofKind: 'imageUrl',
              imageUrl: { url, detail: part.detail || 'auto' },
            },
          });
        }
        break;
      }
      case 'video_url': {
        const url = normalizeText(part.videoUrl);
        if (url) {
          result.push({
            type: ChatContentPartType.VIDEO_URL,
            content: {
              oneofKind: 'videoUrl',
              videoUrl: url,
            },
          });
        }
        break;
      }
      case 'audio_url': {
        const url = normalizeText(part.audioUrl);
        if (url) {
          result.push({
            type: ChatContentPartType.AUDIO_URL,
            content: {
              oneofKind: 'audioUrl',
              audioUrl: url,
            },
          });
        }
        break;
      }
      case 'artifact_ref': {
        result.push(createArtifactRefChatContentPart(part));
        break;
      }
      default:
        throw createUnsupportedTextChatPartError();
    }
  }
  return result;
}

function extractTextFromContentParts(parts: TextMessageContentPart[]): string {
  const texts: string[] = [];
  for (const part of parts) {
    if (part.type === 'text') {
      const text = normalizeText(part.text);
      if (text) {
        texts.push(text);
      }
    }
  }
  return texts.join('\n');
}

export function toEmbeddingVectors(vectors: unknown): number[][] {
  const items = Array.isArray(vectors) ? vectors : [];
  return items.map((entry) => {
    const values = Array.isArray(asRecord(entry).values)
      ? asRecord(entry).values as unknown[]
      : [];
    return values
      .map((value) => {
        const kind = asRecord(asRecord(value).kind);
        if (kind.oneofKind === 'numberValue') {
          const parsed = Number(kind.numberValue);
          return Number.isFinite(parsed) ? parsed : null;
        }
        return null;
      })
      .filter((value): value is number => value !== null);
  });
}

export function extractEmbeddingVectors(output: unknown): number[][] {
  const value = output as ScenarioOutput | undefined;
  const variant = value?.output;
  if (variant?.oneofKind !== 'textEmbed') {
    throw createNimiError({
      message: 'runtime media output missing typed textEmbed result',
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'regenerate_runtime_proto_and_sdk',
      source: 'runtime',
    });
  }
  return variant.textEmbed.vectors.map((vector) => vector.values
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item)));
}

export function extractSpeechTranscription(output: unknown): {
  text: string;
  artifacts: ScenarioArtifact[];
} {
  const value = output as ScenarioOutput | undefined;
  const variant = value?.output;
  if (variant?.oneofKind !== 'speechTranscribe') {
    throw createNimiError({
      message: 'runtime media output missing typed speechTranscribe result',
      reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
      actionHint: 'regenerate_runtime_proto_and_sdk',
      source: 'runtime',
    });
  }
  return {
    text: normalizeText(variant.speechTranscribe.text),
    artifacts: Array.isArray(variant.speechTranscribe.artifacts)
      ? variant.speechTranscribe.artifacts
      : [],
  };
}

export function extractScenarioArtifacts(
  output: unknown,
  kind: 'imageGenerate' | 'videoGenerate' | 'musicGenerate' | 'speechSynthesize',
): ScenarioArtifact[] {
  const value = output as ScenarioOutput | undefined;
  const variant = value?.output;
  switch (kind) {
    case 'imageGenerate':
      return variant?.oneofKind === 'imageGenerate' && Array.isArray(variant.imageGenerate.artifacts)
        ? variant.imageGenerate.artifacts
        : [];
    case 'videoGenerate':
      return variant?.oneofKind === 'videoGenerate' && Array.isArray(variant.videoGenerate.artifacts)
        ? variant.videoGenerate.artifacts
        : [];
    case 'musicGenerate':
      return variant?.oneofKind === 'musicGenerate' && Array.isArray(variant.musicGenerate.artifacts)
        ? variant.musicGenerate.artifacts
        : [];
    case 'speechSynthesize':
      return variant?.oneofKind === 'speechSynthesize' && Array.isArray(variant.speechSynthesize.artifacts)
        ? variant.speechSynthesize.artifacts
        : [];
    default:
      return [];
  }
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
      reasonCode: ReasonCode.SDK_RUNTIME_REQUEST_ENCODE_FAILED,
      actionHint: 'remove_non_json_extension_values',
      source: 'sdk',
    });
  }
}

export function toLabels(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }

  const labels: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const normalizedKey = normalizeText(key);
    const normalizedValue = normalizeText(value);
    if (!normalizedKey || !normalizedValue) {
      continue;
    }
    labels[normalizedKey] = normalizedValue;
  }
  return labels;
}

export const MEDIA_JOB_TERMINAL_EVENT_TYPES: ReadonlySet<ScenarioJobEventType> = new Set([
  ScenarioJobEventType.SCENARIO_JOB_EVENT_COMPLETED,
  ScenarioJobEventType.SCENARIO_JOB_EVENT_FAILED,
  ScenarioJobEventType.SCENARIO_JOB_EVENT_CANCELED,
  ScenarioJobEventType.SCENARIO_JOB_EVENT_TIMEOUT,
]);

export const WORKFLOW_TERMINAL_EVENT_TYPES: ReadonlySet<WorkflowEventType> = new Set([
  WorkflowEventType.WORKFLOW_EVENT_COMPLETED,
  WorkflowEventType.WORKFLOW_EVENT_FAILED,
  WorkflowEventType.WORKFLOW_EVENT_CANCELED,
]);

export function wrapModeBMediaStream(source: AsyncIterable<ScenarioJobEvent>): AsyncIterable<ScenarioJobEvent> {
  return {
    async *[Symbol.asyncIterator]() {
      for await (const event of source) {
        yield event;
        if (MEDIA_JOB_TERMINAL_EVENT_TYPES.has(event.eventType)) {
          return;
        }
      }
    },
  };
}

export function wrapModeBWorkflowStream(source: AsyncIterable<WorkflowEvent>): AsyncIterable<WorkflowEvent> {
  return {
    async *[Symbol.asyncIterator]() {
      for await (const event of source) {
        yield event;
        if (WORKFLOW_TERMINAL_EVENT_TYPES.has(event.eventType)) {
          return;
        }
      }
    },
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function toIsoFromTimestamp(value: unknown): string | undefined {
  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    return undefined;
  }

  const secondsRaw = record.seconds;
  const nanosRaw = record.nanos;
  const seconds = Number(secondsRaw);
  const nanos = Number(nanosRaw);
  if (!Number.isFinite(seconds)) {
    return undefined;
  }

  const millis = (seconds * 1000) + (Number.isFinite(nanos) ? Math.floor(nanos / 1_000_000) : 0);
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function mediaStatusToString(status: ScenarioJobStatus): string {
  switch (status) {
    case ScenarioJobStatus.SUBMITTED:
      return 'SUBMITTED';
    case ScenarioJobStatus.QUEUED:
      return 'QUEUED';
    case ScenarioJobStatus.RUNNING:
      return 'RUNNING';
    case ScenarioJobStatus.COMPLETED:
      return 'COMPLETED';
    case ScenarioJobStatus.FAILED:
      return 'FAILED';
    case ScenarioJobStatus.CANCELED:
      return 'CANCELED';
    case ScenarioJobStatus.TIMEOUT:
      return 'TIMEOUT';
    default:
      return 'UNSPECIFIED';
  }
}

export function resolveHealthStatus(status: RuntimeHealthStatus): RuntimeHealth['status'] {
  if (status === RuntimeHealthStatus.READY) {
    return 'healthy';
  }
  if (status === RuntimeHealthStatus.DEGRADED) {
    return 'degraded';
  }
  return 'unavailable';
}

export function decodeUtf8(input: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input).toString('utf8');
  }
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder('utf-8').decode(input);
  }
  throw createNimiError({
    message: 'utf-8 decoder unavailable',
    reasonCode: ReasonCode.SDK_RUNTIME_RESPONSE_DECODE_FAILED,
    actionHint: 'use_node_or_text_decoder_runtime',
    source: 'sdk',
  });
}

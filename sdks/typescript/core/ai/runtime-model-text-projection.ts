import type { JsonValue as ProtoJsonValue } from '@protobuf-ts/runtime';
import {
  ChatContentPartType,
  TextSourceType,
  type ChatContentPart,
  type ChatMessage,
  type RawChunk as RuntimeRawChunk,
  type ReasoningContinuityCarrier as RuntimeReasoningContinuityCarrier,
  type TextOutputItem as RuntimeTextOutputItem,
  type TextSource as RuntimeTextSource,
  type ToolCall,
  type ToolResult as RuntimeToolResult,
  type ToolSpec,
} from '../../core-generated/runtime-protobuf/runtime/v1/ai';
import { ToolSpecKind } from '../../core-generated/runtime-protobuf/runtime/v1/common';
import type { Value as RuntimeValueMessage } from '../../core-generated/runtime-protobuf/google/protobuf/struct';
import { Value as RuntimeValue } from '../../core-generated/runtime-protobuf/google/protobuf/struct';
import { fromNimiRuntimeProtoStruct, toNimiRuntimeProtoStruct } from '../../runtime/runtime-agent-values';
import { ReasonCode, createNimiError } from '../../types';
import type {
  NimiJsonObject,
  NimiJsonValue,
  NimiMessage,
  NimiMessagePart,
  NimiRawChunk,
  NimiTextOutputItem,
  NimiTextTurnItem,
  NimiSource,
  NimiToolCall,
  NimiToolResult,
} from '../contracts';
import type { NimiGenerateTextRequest } from './index';

export function toRuntimeTools(tools: NimiGenerateTextRequest['tools']): ToolSpec[] {
  if (!tools || tools.length === 0) {
    return [];
  }
  return tools.map((tool) => {
    if (tool.type === 'provider') {
      return {
        name: tool.name,
        description: '',
        inputSchema: undefined,
        kind: ToolSpecKind.PROVIDER,
        providerToolId: tool.id,
        providerArgs: toRuntimeStruct(tool.args),
        providerMetadata: toOptionalRuntimeStruct(tool.providerMetadata),
      };
    }
    return {
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: toRuntimeStruct(tool.inputSchema),
      kind: ToolSpecKind.FUNCTION,
      providerToolId: '',
      providerArgs: undefined,
      providerMetadata: undefined,
    };
  });
}

export function toRuntimeMessages(messages: readonly NimiMessage[]): ChatMessage[] {
  if (messages.length === 0) {
    unsupportedRuntimeAI('messages', 'Runtime-backed text model requires at least one message');
  }
  let hasContent = false;
  const runtimeMessages = messages.map((message): ChatMessage => {
    if (message.toolCalls?.length || message.toolResults?.length || message.toolCallId
      || message.toolApprovalResponses?.length) {
      unsupportedRuntimeAI(
        'message legacy tool fields',
        'Runtime text continuation requires one canonical ordered turnItems sequence',
      );
    }
    if (message.turnItems?.length) {
      if (message.content.length > 0) {
        unsupportedRuntimeAI(
          'message.content with message.turnItems',
          'Runtime assistant/tool continuation accepts one ordered content truth',
        );
      }
      if (message.role !== 'assistant' && message.role !== 'tool') {
        unsupportedRuntimeAI('message.turnItems', 'only assistant or tool continuation messages may carry turnItems');
      }
      hasContent = true;
      return {
        role: message.role,
        content: '',
        name: normalizeText(message.name),
        parts: [],
        turnItems: message.turnItems.map(toRuntimeTurnItem),
      };
    }
    if (message.role === 'assistant' || message.role === 'tool') {
      unsupportedRuntimeAI(
        `message.role.${message.role}`,
        'Runtime assistant/tool continuation requires canonical turnItems',
      );
    }
    const text = message.content.map((part) => part.type === 'text' ? part.text : '').join('');
    const parts = toRuntimeContentParts(message.content);
    if (
      text.trim()
      || parts.some((part) => part.type !== ChatContentPartType.TEXT)
    ) {
      hasContent = true;
    }
    return {
      role: message.role,
      content: text,
      name: normalizeText(message.name),
      parts,
      turnItems: [],
    };
  });
  if (!hasContent) {
    throw createNimiError({
      message: 'Runtime-backed text model requires at least one non-empty text or file message part',
      code: ReasonCode.SDK_AI_INPUT_INVALID,
      reasonCode: ReasonCode.SDK_AI_INPUT_INVALID,
      actionHint: 'provide_text_message_content',
      source: 'sdk',
    });
  }
  return runtimeMessages;
}

export function toNimiToolCall(toolCall: ToolCall): NimiToolCall {
  const id = normalizeText(toolCall.id);
  const name = normalizeText(toolCall.name);
  if (!id || !name) {
    runtimeOutputInvalid('Runtime Scenario ToolCall omitted its stable id or name');
  }
  const providerMetadata = fromRuntimeStruct(toolCall.providerMetadata);
  return {
    id,
    name,
    arguments: parseToolArguments(toolCall.argumentsJson),
    ...(toolCall.dynamic ? { dynamic: true } : {}),
    ...(providerMetadata ? { providerMetadata } : {}),
  };
}

export function toNimiTextOutputItems(
  items: readonly RuntimeTextOutputItem[] | undefined,
): readonly NimiTextOutputItem[] {
  const seenToolCallIds = new Set<string>();
  return (items ?? []).map((item): NimiTextOutputItem => {
    if (item.item.oneofKind === 'text') {
      if (item.item.text.text.length === 0) {
        runtimeOutputInvalid('Runtime text output item contained empty text');
      }
      return { type: 'text', text: item.item.text.text };
    }
    if (item.item.oneofKind === 'reasoningSummary') {
      if (item.item.reasoningSummary.text.length === 0) {
        runtimeOutputInvalid('Runtime reasoning summary item was empty');
      }
      return { type: 'reasoning-summary', text: item.item.reasoningSummary.text };
    }
    if (item.item.oneofKind === 'toolCall') {
      const toolCall = toNimiToolCall(item.item.toolCall);
      if (seenToolCallIds.has(toolCall.id)) {
        runtimeOutputInvalid('Runtime text output contained a duplicate ToolCall id');
      }
      seenToolCallIds.add(toolCall.id);
      return { type: 'tool-call', toolCall };
    }
    if (item.item.oneofKind === 'reasoningContinuity') {
      return {
        type: 'reasoning-continuity',
        carrier: toNimiReasoningContinuityCarrier(item.item.reasoningContinuity),
      };
    }
    throw runtimeOutputInvalid('Runtime text output item omitted its typed item');
  });
}

const MAX_REASONING_CONTINUITY_KIND_BYTES = 128;
const MAX_REASONING_CONTINUITY_PAYLOAD_BYTES = 64 * 1024;

export function toNimiReasoningContinuityCarrier(
  carrier: RuntimeReasoningContinuityCarrier,
): Extract<NimiTextOutputItem, { readonly type: 'reasoning-continuity' }>['carrier'] {
  const kind = typeof carrier.kind === 'string' ? carrier.kind : '';
  const payload = carrier.payload;
  if (!kind || kind !== kind.trim()
    || new TextEncoder().encode(kind).byteLength > MAX_REASONING_CONTINUITY_KIND_BYTES
    || /[\u0000-\u001f\u007f]/u.test(kind)
    || !Number.isSafeInteger(carrier.version) || carrier.version < 1 || carrier.version > 0xffff_ffff
    || !(payload instanceof Uint8Array) || payload.byteLength === 0
    || payload.byteLength > MAX_REASONING_CONTINUITY_PAYLOAD_BYTES) {
    runtimeOutputInvalid('Runtime reasoning continuity carrier identity or bounded payload is invalid');
  }
  return {
    kind,
    version: carrier.version,
    payload: new Uint8Array(payload),
  };
}

export function toNimiSources(sources: readonly RuntimeTextSource[] | undefined): readonly NimiSource[] | undefined {
  if (!sources || sources.length === 0) {
    return undefined;
  }
  return sources.map(toNimiSource);
}

export function toNimiSource(source: RuntimeTextSource): NimiSource {
  const providerMetadata = fromRuntimeStruct(source.providerMetadata);
  if (source.sourceType === TextSourceType.URL) {
    return {
      type: 'source',
      sourceType: 'url',
      id: source.id,
      url: source.url,
      ...(source.title ? { title: source.title } : {}),
      ...(providerMetadata ? { providerMetadata } : {}),
    };
  }
  if (source.sourceType === TextSourceType.DOCUMENT) {
    return {
      type: 'source',
      sourceType: 'document',
      id: source.id,
      mediaType: source.mediaType,
      title: source.title,
      ...(source.filename ? { filename: source.filename } : {}),
      ...(providerMetadata ? { providerMetadata } : {}),
    };
  }
  throw createNimiError({
    message: 'Runtime Scenario source did not include a supported sourceType',
    code: ReasonCode.SDK_AI_RUNTIME_OUTPUT_INVALID,
    reasonCode: ReasonCode.SDK_AI_RUNTIME_OUTPUT_INVALID,
    actionHint: 'check_runtime_text_source_type',
    source: 'sdk',
  });
}

export function toNimiRawChunks(rawChunks: readonly RuntimeRawChunk[] | undefined): readonly NimiRawChunk[] | undefined {
  if (!rawChunks || rawChunks.length === 0) {
    return undefined;
  }
  return rawChunks.map(toNimiRawChunk);
}

export function toNimiRawChunk(rawChunk: RuntimeRawChunk): NimiRawChunk {
  return { type: 'raw', value: fromRuntimeValue(rawChunk.value) };
}

function toRuntimeContentParts(content: readonly NimiMessagePart[]): ChatContentPart[] {
  const parts: ChatContentPart[] = [];
  for (const part of content) {
    if (part.type === 'text') {
      if (part.text) {
        parts.push({ type: ChatContentPartType.TEXT, content: { oneofKind: 'text', text: part.text } });
      }
      continue;
    }
    if (part.type === 'file') {
      parts.push(toRuntimeFileContentPart(part.mediaType, part.data));
      continue;
    }
    if (part.type === 'artifact-ref') {
      const artifactId = normalizeText(part.artifactId);
      const localArtifactId = normalizeText(part.localArtifactId);
      if ((!artifactId && !localArtifactId) || (artifactId && localArtifactId)) {
        runtimeInputInvalid('Runtime artifact ref requires exactly one artifactId or localArtifactId');
      }
      parts.push({
        type: ChatContentPartType.ARTIFACT_REF,
        content: {
          oneofKind: 'artifactRef',
          artifactRef: {
            artifactId,
            localArtifactId,
            mimeType: normalizeText(part.mediaType),
            displayName: normalizeText(part.displayName),
          },
        },
      });
    }
  }
  return parts;
}

function toRuntimeFileContentPart(mediaType: string, data: string): ChatContentPart {
  const location = toRuntimeMediaLocation(mediaType, data);
  const normalizedType = mediaType.trim().toLowerCase();
  if (normalizedType.startsWith('image/')) {
    return {
      type: ChatContentPartType.IMAGE_URL,
      content: { oneofKind: 'imageUrl', imageUrl: { url: location, detail: '' } },
    };
  }
  if (normalizedType.startsWith('audio/')) {
    return { type: ChatContentPartType.AUDIO_URL, content: { oneofKind: 'audioUrl', audioUrl: location } };
  }
  if (normalizedType.startsWith('video/')) {
    return { type: ChatContentPartType.VIDEO_URL, content: { oneofKind: 'videoUrl', videoUrl: location } };
  }
  unsupportedRuntimeAI(
    'message.content.file.mediaType',
    `Runtime-backed text model does not accept file media type ${mediaType}`,
  );
}

function toRuntimeMediaLocation(mediaType: string, data: string): string {
  const trimmed = data.trim();
  if (trimmed === '') {
    unsupportedRuntimeAI('message.content.file.data', 'file message part requires non-empty data');
  }
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    return trimmed;
  }
  unsupportedRuntimeAI(
    'message.content.file.data',
    `Runtime-backed ${mediaType} input accepts only http(s) URLs; use artifact-ref for managed media`,
  );
}

function toRuntimeTurnItem(turnItem: NimiTextTurnItem) {
  if (turnItem.type === 'tool-result') {
    return {
      item: {
        oneofKind: 'toolResult' as const,
        toolResult: toRuntimeToolResult(turnItem.toolResult),
      },
    };
  }
  const output = turnItem.output;
  if (output.type === 'text') {
    return { item: { oneofKind: 'output' as const, output: { item: { oneofKind: 'text' as const, text: { text: output.text } } } } };
  }
  if (output.type === 'reasoning-summary') {
    return {
      item: {
        oneofKind: 'output' as const,
        output: { item: { oneofKind: 'reasoningSummary' as const, reasoningSummary: { text: output.text } } },
      },
    };
  }
  if (output.type === 'reasoning-continuity') {
    return {
      item: {
        oneofKind: 'output' as const,
        output: {
          item: {
            oneofKind: 'reasoningContinuity' as const,
            reasoningContinuity: {
              kind: output.carrier.kind,
              version: output.carrier.version,
              payload: output.carrier.payload,
            },
          },
        },
      },
    };
  }
  return {
    item: {
      oneofKind: 'output' as const,
      output: { item: { oneofKind: 'toolCall' as const, toolCall: toRuntimeToolCall(output.toolCall) } },
    },
  };
}

function toRuntimeToolCall(toolCall: NimiToolCall): ToolCall {
  if (toolCall.providerExecuted) {
    unsupportedRuntimeAI('toolCall.providerExecuted', 'the external AI host owns every tool execution');
  }
  const id = normalizeText(toolCall.id);
  const name = normalizeText(toolCall.name);
  if (!id || !name || !toolCall.arguments || typeof toolCall.arguments !== 'object'
    || Array.isArray(toolCall.arguments)) {
    runtimeInputInvalid('Runtime ToolCall round-trip requires stable id, name, and one JSON object arguments value');
  }
  return {
    id,
    name,
    argumentsJson: JSON.stringify(toolCall.arguments),
    dynamic: toolCall.dynamic ?? false,
    providerMetadata: toOptionalRuntimeStruct(toolCall.providerMetadata),
  };
}

function toRuntimeToolResult(toolResult: NimiToolResult): RuntimeToolResult {
  const toolCallId = normalizeText(toolResult.toolCallId);
  const toolName = normalizeText(toolResult.toolName);
  if (!toolCallId || !toolName) {
    runtimeInputInvalid('Runtime ToolResult round-trip requires toolCallId and toolName');
  }
  return {
    toolCallId,
    toolName,
    result: toRuntimeValue(toolResult.result),
    isError: toolResult.isError ?? false,
    preliminary: toolResult.preliminary ?? false,
    dynamic: toolResult.dynamic ?? false,
    providerMetadata: toOptionalRuntimeStruct(toolResult.providerMetadata),
  };
}

export function toRuntimeStruct(value: NimiJsonObject): ReturnType<typeof toNimiRuntimeProtoStruct> {
  return toNimiRuntimeProtoStruct(value as unknown as Parameters<typeof toNimiRuntimeProtoStruct>[0]);
}

function toOptionalRuntimeStruct(value: NimiJsonObject | undefined): ReturnType<typeof toNimiRuntimeProtoStruct> | undefined {
  return value ? toRuntimeStruct(value) : undefined;
}

function fromRuntimeStruct(value: Parameters<typeof fromNimiRuntimeProtoStruct>[0]): NimiJsonObject | undefined {
  const json = fromNimiRuntimeProtoStruct(value);
  return Object.keys(json).length > 0 ? json as NimiJsonObject : undefined;
}

function toRuntimeValue(value: NimiJsonValue): RuntimeValueMessage {
  return RuntimeValue.fromJson(value as ProtoJsonValue);
}

function fromRuntimeValue(value?: RuntimeValueMessage): NimiJsonValue {
  return value ? RuntimeValue.toJson(value) as NimiJsonValue : null;
}

function parseToolArguments(argumentsJson: string): NimiJsonValue {
  const trimmed = normalizeText(argumentsJson);
  if (!trimmed) {
    return {};
  }
  try {
    const parsed = JSON.parse(trimmed) as NimiJsonValue;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('tool arguments must be one JSON object');
    }
    return parsed;
  } catch (error) {
    throw createNimiError({
      message: 'Runtime Scenario tool call argumentsJson is not valid JSON',
      code: ReasonCode.SDK_AI_RUNTIME_OUTPUT_INVALID,
      reasonCode: ReasonCode.SDK_AI_RUNTIME_OUTPUT_INVALID,
      actionHint: 'check_runtime_tool_call_arguments_json',
      source: 'sdk',
      details: { cause: error instanceof Error ? error.message : String(error) },
    });
  }
}

function runtimeOutputInvalid(message: string): never {
  throw createNimiError({
    message,
    code: ReasonCode.SDK_AI_RUNTIME_OUTPUT_INVALID,
    reasonCode: ReasonCode.SDK_AI_RUNTIME_OUTPUT_INVALID,
    actionHint: 'check_runtime_text_output_items',
    source: 'sdk',
  });
}

function runtimeInputInvalid(message: string): never {
  throw createNimiError({
    message,
    code: ReasonCode.SDK_AI_INPUT_INVALID,
    reasonCode: ReasonCode.SDK_AI_INPUT_INVALID,
    actionHint: 'provide_canonical_runtime_text_input',
    source: 'sdk',
  });
}

function unsupportedRuntimeAI(feature: string, detail: string): never {
  throw createNimiError({
    message: `Runtime-backed Nimi AI does not support ${feature}: ${detail}`,
    code: ReasonCode.SDK_AI_RUNTIME_FEATURE_UNSUPPORTED,
    reasonCode: ReasonCode.SDK_AI_RUNTIME_FEATURE_UNSUPPORTED,
    actionHint: 'use_agent_or_feature_layer_for_unsupported_ai_semantics',
    source: 'sdk',
    details: { feature },
  });
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

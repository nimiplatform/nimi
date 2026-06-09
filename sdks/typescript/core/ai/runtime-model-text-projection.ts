import type { JsonValue as ProtoJsonValue } from '@protobuf-ts/runtime';
import {
  ChatContentPartType,
  TextSourceType,
  ToolSpecKind,
  type ChatContentPart,
  type ChatMessage,
  type RawChunk as RuntimeRawChunk,
  type TextSource as RuntimeTextSource,
  type ToolApprovalRequest as RuntimeToolApprovalRequest,
  type ToolApprovalResponse as RuntimeToolApprovalResponse,
  type ToolCall,
  type ToolResult as RuntimeToolResult,
  type ToolSpec,
} from '../../core-generated/runtime-protobuf/runtime/v1/ai';
import type { Value as RuntimeValueMessage } from '../../core-generated/runtime-protobuf/google/protobuf/struct';
import { Value as RuntimeValue } from '../../core-generated/runtime-protobuf/google/protobuf/struct';
import { fromNimiRuntimeProtoStruct, toNimiRuntimeProtoStruct } from '../../runtime/runtime-agent-values';
import { createNimiError } from '../../types';
import type {
  NimiJsonObject,
  NimiJsonValue,
  NimiMessage,
  NimiMessagePart,
  NimiRawChunk,
  NimiSource,
  NimiToolApprovalRequest,
  NimiToolApprovalResponse,
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
    const text = message.content.map((part) => part.type === 'text' ? part.text : '').join('');
    const parts = toRuntimeContentParts(message.content);
    const toolCalls = toRuntimeMessageToolCalls(message.toolCalls);
    const toolResults = toRuntimeMessageToolResults(message.toolResults);
    const toolApprovalResponses = toRuntimeMessageToolApprovalResponses(message.toolApprovalResponses);
    if (
      text.trim()
      || parts.some((part) => part.type !== ChatContentPartType.TEXT)
      || toolCalls.length > 0
      || toolResults.length > 0
      || toolApprovalResponses.length > 0
    ) {
      hasContent = true;
    }
    return {
      role: message.role,
      content: text,
      name: normalizeText(message.name),
      parts,
      toolCalls,
      toolCallId: normalizeText(message.toolCallId),
      toolResults,
      toolApprovalResponses,
    };
  });
  if (!hasContent) {
    throw createNimiError({
      message: 'Runtime-backed text model requires at least one non-empty text or file message part',
      code: 'SDK_AI_INPUT_INVALID',
      reasonCode: 'SDK_AI_INPUT_INVALID',
      actionHint: 'provide_text_message_content',
      source: 'sdk',
    });
  }
  return runtimeMessages;
}

export function toNimiToolCalls(toolCalls: readonly ToolCall[] | undefined): readonly NimiToolCall[] | undefined {
  if (!toolCalls || toolCalls.length === 0) {
    return undefined;
  }
  return toolCalls.map(toNimiToolCall);
}

export function toNimiToolCall(toolCall: ToolCall): NimiToolCall {
  const providerMetadata = fromRuntimeStruct(toolCall.providerMetadata);
  return {
    id: toolCall.id,
    name: toolCall.name,
    arguments: parseToolArguments(toolCall.argumentsJson),
    ...(toolCall.providerExecuted ? { providerExecuted: true } : {}),
    ...(toolCall.dynamic ? { dynamic: true } : {}),
    ...(providerMetadata ? { providerMetadata } : {}),
  };
}

export function toNimiToolResults(
  toolResults: readonly RuntimeToolResult[] | undefined,
): readonly NimiToolResult[] | undefined {
  if (!toolResults || toolResults.length === 0) {
    return undefined;
  }
  return toolResults.map(toNimiToolResult);
}

export function toNimiToolResult(toolResult: RuntimeToolResult): NimiToolResult {
  const providerMetadata = fromRuntimeStruct(toolResult.providerMetadata);
  return {
    toolCallId: toolResult.toolCallId,
    toolName: toolResult.toolName,
    result: fromRuntimeValue(toolResult.result),
    ...(toolResult.isError ? { isError: true } : {}),
    ...(toolResult.preliminary ? { preliminary: true } : {}),
    ...(toolResult.dynamic ? { dynamic: true } : {}),
    ...(providerMetadata ? { providerMetadata } : {}),
  };
}

export function toNimiToolApprovalRequests(
  approvalRequests: readonly RuntimeToolApprovalRequest[] | undefined,
): readonly NimiToolApprovalRequest[] | undefined {
  if (!approvalRequests || approvalRequests.length === 0) {
    return undefined;
  }
  return approvalRequests.map(toNimiToolApprovalRequest);
}

export function toNimiToolApprovalRequest(
  approvalRequest: RuntimeToolApprovalRequest,
): NimiToolApprovalRequest {
  const providerMetadata = fromRuntimeStruct(approvalRequest.providerMetadata);
  return {
    approvalId: approvalRequest.approvalId,
    toolCallId: approvalRequest.toolCallId,
    ...(providerMetadata ? { providerMetadata } : {}),
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
    code: 'SDK_AI_RUNTIME_OUTPUT_INVALID',
    reasonCode: 'SDK_AI_RUNTIME_OUTPUT_INVALID',
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
  if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('data:')) {
    return trimmed;
  }
  return `data:${mediaType};base64,${trimmed}`;
}

function toRuntimeMessageToolCalls(toolCalls: NimiMessage['toolCalls']): ToolCall[] {
  if (!toolCalls || toolCalls.length === 0) {
    return [];
  }
  return toolCalls.map((toolCall) => ({
    id: toolCall.id,
    name: toolCall.name,
    argumentsJson: JSON.stringify(toolCall.arguments),
    providerExecuted: toolCall.providerExecuted ?? false,
    dynamic: toolCall.dynamic ?? false,
    providerMetadata: toOptionalRuntimeStruct(toolCall.providerMetadata),
  }));
}

function toRuntimeMessageToolResults(toolResults: NimiMessage['toolResults']): RuntimeToolResult[] {
  if (!toolResults || toolResults.length === 0) {
    return [];
  }
  return toolResults.map((toolResult) => ({
    toolCallId: toolResult.toolCallId,
    toolName: toolResult.toolName,
    result: toRuntimeValue(toolResult.result),
    isError: toolResult.isError ?? false,
    preliminary: toolResult.preliminary ?? false,
    dynamic: toolResult.dynamic ?? false,
    providerMetadata: toOptionalRuntimeStruct(toolResult.providerMetadata),
  }));
}

function toRuntimeMessageToolApprovalResponses(
  approvalResponses: NimiMessage['toolApprovalResponses'],
): RuntimeToolApprovalResponse[] {
  if (!approvalResponses || approvalResponses.length === 0) {
    return [];
  }
  return approvalResponses.map((approvalResponse) => ({
    approvalId: approvalResponse.approvalId,
    approved: approvalResponse.approved,
    reason: approvalResponse.reason ?? '',
    providerMetadata: toOptionalRuntimeStruct(approvalResponse.providerMetadata),
  }));
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
    return JSON.parse(trimmed) as NimiJsonValue;
  } catch (error) {
    throw createNimiError({
      message: 'Runtime Scenario tool call argumentsJson is not valid JSON',
      code: 'SDK_AI_RUNTIME_OUTPUT_INVALID',
      reasonCode: 'SDK_AI_RUNTIME_OUTPUT_INVALID',
      actionHint: 'check_runtime_tool_call_arguments_json',
      source: 'sdk',
      details: { cause: error instanceof Error ? error.message : String(error) },
    });
  }
}

function unsupportedRuntimeAI(feature: string, detail: string): never {
  throw createNimiError({
    message: `Runtime-backed Nimi AI does not support ${feature}: ${detail}`,
    code: 'SDK_AI_RUNTIME_FEATURE_UNSUPPORTED',
    reasonCode: 'SDK_AI_RUNTIME_FEATURE_UNSUPPORTED',
    actionHint: 'use_agent_or_feature_layer_for_unsupported_ai_semantics',
    source: 'sdk',
    details: { feature },
  });
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

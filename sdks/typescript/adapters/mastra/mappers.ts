import type {
  LanguageModelV4CallOptions,
  LanguageModelV4Content,
  SharedV4FileData,
  LanguageModelV4FilePart,
  LanguageModelV4FinishReason,
  LanguageModelV4FunctionTool,
  LanguageModelV4Message,
  LanguageModelV4Prompt,
  LanguageModelV4ProviderTool,
  LanguageModelV4Reasoning,
  LanguageModelV4Source,
  LanguageModelV4StreamPart,
  LanguageModelV4TextPart,
  LanguageModelV4ToolApprovalResponsePart,
  LanguageModelV4ToolCall,
  LanguageModelV4ToolCallPart,
  LanguageModelV4ToolChoice,
  LanguageModelV4ToolResult,
  LanguageModelV4ToolApprovalRequest,
  LanguageModelV4ToolResultOutput,
  LanguageModelV4ToolResultPart,
  LanguageModelV4Usage,
  SharedV4ProviderMetadata,
  SharedV4ProviderOptions,
  SharedV4Warning,
} from '@ai-sdk/provider';
import type {
  NimiGenerateTextRequest,
  NimiGenerateTextResult,
  NimiResponseFormat,
} from '@nimiplatform/sdk/ai';
import { createNimiError } from '@nimiplatform/sdk';
import {
  filePart,
  textPart,
  type NimiFinishReason,
  type NimiJsonObject,
  type NimiJsonValue,
  type NimiMessage,
  type NimiMessagePart,
  type NimiRawChunk,
  type NimiRunEvent,
  type NimiSource,
  type NimiTool,
  type NimiToolApprovalRequest,
  type NimiToolApprovalResponse,
  type NimiToolCall,
  type NimiToolResult,
  type NimiUsage,
} from '@nimiplatform/sdk/contracts';

// Mastra's model boundary is the AI SDK provider `LanguageModelV4` accepted by
// `MastraModelConfig` (Mastra's `@ai-sdk/provider-v7` alias). This adapter owns
// its own Nimi <-> LanguageModelV4 mapping. The shared protocol shape overlaps
// the Vercel adapter today; extracting a common `ai-sdk-provider` bridge package is
// deliberately deferred until Vercel, Mastra, and a third consumer stabilize, so
// the logic is intentionally (and controllably) duplicated here, owned by Mastra.

export type NimiMastraUnsupportedFeatureThrower = (feature: string, detail?: string) => never;

const STREAM_TEXT_ID = 'text-1';
const STREAM_REASONING_ID = 'reasoning-1';
const MASTRA_METADATA_KEY = 'x-nimi-mastra-metadata';

// ---------------------------------------------------------------------------
// LanguageModelV4 call options -> Nimi generate-text request
// ---------------------------------------------------------------------------

export function toNimiGenerateTextRequest(
  options: LanguageModelV4CallOptions,
  throwUnsupported: NimiMastraUnsupportedFeatureThrower,
): NimiGenerateTextRequest {
  return {
    messages: toNimiMessages(options.prompt, throwUnsupported),
    tools: options.tools?.map((tool) => toNimiTool(tool, throwUnsupported)),
    toolChoice: toNimiToolChoice(options.toolChoice?.type === 'auto' && !options.tools?.length ? undefined : options.toolChoice, throwUnsupported),
    responseFormat: toNimiResponseFormat(options.responseFormat, throwUnsupported),
    parameters: {
      reasoning: toNimiReasoning(options.reasoning, throwUnsupported),
      temperature: options.temperature,
      topP: options.topP,
      maxTokens: options.maxOutputTokens,
      topK: options.topK,
      presencePenalty: options.presencePenalty,
      frequencyPenalty: options.frequencyPenalty,
      stop: options.stopSequences,
      seed: options.seed,
      metadata: toMastraCallMetadata(options, throwUnsupported),
      includeRawChunks: options.includeRawChunks,
    },
    signal: options.abortSignal,
  };
}

function toNimiReasoning(
  reasoning: LanguageModelV4CallOptions['reasoning'],
  throwUnsupported: NimiMastraUnsupportedFeatureThrower,
): NonNullable<NimiGenerateTextRequest['parameters']>['reasoning'] {
  if (reasoning === undefined || reasoning === 'provider-default') return undefined;
  if (reasoning === 'none') return { activation: 'disabled' };
  if (['minimal', 'low', 'medium', 'high', 'xhigh'].includes(reasoning)) {
    return { activation: 'required', effort: reasoning as 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' };
  }
  return throwUnsupported('reasoning', 'unknown reasoning effort');
}

function toNimiResponseFormat(
  responseFormat: LanguageModelV4CallOptions['responseFormat'],
  throwUnsupported: NimiMastraUnsupportedFeatureThrower,
): NimiResponseFormat | undefined {
  if (!responseFormat) {
    return undefined;
  }
  if (responseFormat.type === 'text') {
    return { type: 'text' };
  }
  if (responseFormat.type === 'json') {
    if (responseFormat.schema) {
      return {
        type: 'json-schema',
        schema: toNimiJsonObject(responseFormat.schema, throwUnsupported, 'responseFormat.schema'),
        name: responseFormat.name,
        description: responseFormat.description,
      };
    }
    return {
      type: 'json-object',
      name: responseFormat.name,
      description: responseFormat.description,
    };
  }
  throwUnsupported('responseFormat', `unknown response format ${String((responseFormat as { type?: unknown }).type)}`);
}

function toMastraCallMetadata(
  options: LanguageModelV4CallOptions,
  throwUnsupported: NimiMastraUnsupportedFeatureThrower,
): NimiJsonObject | undefined {
  const headers = Object.fromEntries(
    Object.entries(options.headers ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  const providerOptions = toNimiProviderOptions(options.providerOptions, throwUnsupported, 'providerOptions');
  const mastra: Record<string, NimiJsonValue> = {};
  if (Object.keys(headers).length > 0) {
    mastra.headers = headers;
  }
  if (providerOptions) {
    mastra.providerOptions = providerOptions;
  }
  if (Object.keys(mastra).length === 0) {
    return undefined;
  }
  return { [MASTRA_METADATA_KEY]: stableJsonStringify(mastra) };
}

function toNimiProviderOptions(
  providerOptions: SharedV4ProviderOptions | undefined,
  throwUnsupported: NimiMastraUnsupportedFeatureThrower,
  feature: string,
): NimiJsonObject | undefined {
  if (!providerOptions || Object.keys(providerOptions).length === 0) {
    return undefined;
  }
  // Provider options are projected into request metadata so they stay visible to
  // the Nimi backing model. They are passed through transparently and are not
  // claimed to be natively honoured by any provider.
  return toNimiJsonObject(providerOptions, throwUnsupported, feature);
}

function toNimiMessages(
  prompt: LanguageModelV4Prompt,
  throwUnsupported: NimiMastraUnsupportedFeatureThrower,
): readonly NimiMessage[] {
  return prompt.flatMap((message) => toNimiMessageList(message, throwUnsupported));
}

function toNimiMessageList(
  message: LanguageModelV4Message,
  throwUnsupported: NimiMastraUnsupportedFeatureThrower,
): readonly NimiMessage[] {
  if (message.role === 'system') {
    return [{ role: 'system', content: [textPart(message.content)] }];
  }
  if (message.role === 'tool') {
    // One Nimi tool message per tool-result / approval response so each provider
    // continuation id is preserved across Mastra-owned tool loops.
    return message.content.map((part) => {
      if (part.type === 'tool-approval-response') {
        const response = part as LanguageModelV4ToolApprovalResponsePart;
        return {
          role: 'tool',
          content: [],
          toolApprovalResponses: [toNimiToolApprovalResponseFromPrompt(response, throwUnsupported)],
        } satisfies NimiMessage;
      }
      const result = part as LanguageModelV4ToolResultPart;
      if (result.type !== 'tool-result') {
        throwUnsupported(`prompt.${part.type}`, 'only tool-result and tool-approval-response parts are supported in tool messages');
      }
      return {
        role: 'tool',
        content: [textPart(toolOutputText(result.output, throwUnsupported))],
        toolCallId: result.toolCallId,
        toolResults: [toNimiToolResultFromPrompt(result, throwUnsupported)],
      } satisfies NimiMessage;
    });
  }
  if (message.role === 'assistant') {
    const toolCalls = message.content.filter(
      (part): part is LanguageModelV4ToolCallPart => part.type === 'tool-call',
    );
    const toolResults = message.content.filter(
      (part): part is LanguageModelV4ToolResultPart => part.type === 'tool-result',
    );
    return [{
      role: 'assistant',
      content: toNimiContentParts(message.content, throwUnsupported),
      toolCalls: toolCalls.map((toolCall) => ({
        id: toolCall.toolCallId,
        name: toolCall.toolName,
        arguments: toNimiJsonValue(toolCall.input, throwUnsupported, 'prompt.toolCall.input'),
        ...(toolCall.providerExecuted ? { providerExecuted: true } : {}),
        ...(toolCall.providerOptions
          ? { providerMetadata: toNimiProviderOptions(toolCall.providerOptions, throwUnsupported, 'prompt.toolCall.providerOptions') }
          : {}),
      })),
      toolResults: toolResults.map((toolResult) => toNimiToolResultFromPrompt(toolResult, throwUnsupported)),
    }];
  }
  return [{
    role: 'user',
    content: toNimiContentParts(message.content, throwUnsupported),
  }];
}

function toNimiContentParts(
  parts: readonly { readonly type: string }[],
  throwUnsupported: NimiMastraUnsupportedFeatureThrower,
): readonly NimiMessagePart[] {
  return parts.flatMap((part) => {
    if (part.type === 'text') {
      return [textPart((part as LanguageModelV4TextPart).text)];
    }
    if (part.type === 'file') {
      return [toNimiFilePart(part as LanguageModelV4FilePart, throwUnsupported)];
    }
    // Tool calls, provider-executed tool results, and approval responses are
    // carried on structured Nimi message fields.
    if (part.type === 'tool-call' || part.type === 'tool-result' || part.type === 'tool-approval-response') {
      return [];
    }
    throwUnsupported(`prompt.${part.type}`);
  });
}

function toNimiFilePart(
  part: LanguageModelV4FilePart,
  throwUnsupported: NimiMastraUnsupportedFeatureThrower,
): NimiMessagePart {
  const mediaType = part.mediaType?.trim();
  if (!mediaType) {
    throwUnsupported('prompt.file.mediaType', 'file parts require an IANA media type');
  }
  return filePart(mediaType, toNimiFileData(part.data, throwUnsupported), part.filename);
}

// Provider V4 tags URLs, bytes/base64, inline text, and provider references.
// Runtime owns file interpretation; provider-owned references fail closed.
function toNimiFileData(
  data: SharedV4FileData,
  throwUnsupported: NimiMastraUnsupportedFeatureThrower,
): string {
  if (data.type === 'url') return data.url.href;
  if (data.type === 'data') {
    return typeof data.data === 'string' ? data.data : uint8ArrayToBase64(data.data);
  }
  if (data.type === 'text') return uint8ArrayToBase64(new TextEncoder().encode(data.text));
  return throwUnsupported('prompt.file.reference', 'provider file references are not admitted by the Nimi file contract');
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function stableJsonStringify(value: NimiJsonValue): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: NimiJsonValue): NimiJsonValue {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortJsonValue(nested)]),
    );
  }
  return value;
}

function toolOutputText(
  output: LanguageModelV4ToolResultOutput,
  throwUnsupported: NimiMastraUnsupportedFeatureThrower,
): string {
  if (output.type === 'text') {
    return output.value;
  }
  if (output.type === 'json') {
    return JSON.stringify(output.value);
  }
  if (output.type === 'error-text') {
    return output.value;
  }
  if (output.type === 'error-json') {
    return JSON.stringify(output.value);
  }
  if (output.type === 'execution-denied') {
    return output.reason ?? 'execution denied';
  }
  return JSON.stringify(toolOutputJson(output, throwUnsupported));
}

function toNimiToolResultFromPrompt(
  part: LanguageModelV4ToolResultPart,
  throwUnsupported: NimiMastraUnsupportedFeatureThrower,
): NimiToolResult {
  const providerOptions = mergeProviderOptions(part.providerOptions, getToolOutputProviderOptions(part.output));
  const providerMetadata = providerOptions
    ? toNimiProviderOptions(providerOptions, throwUnsupported, 'prompt.toolResult.providerOptions')
    : undefined;
  return {
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    result: toolOutputJson(part.output, throwUnsupported),
    ...(part.output.type === 'error-text' || part.output.type === 'error-json' ? { isError: true } : {}),
    ...(providerMetadata ? { providerMetadata } : {}),
  };
}

function toNimiToolApprovalResponseFromPrompt(
  part: LanguageModelV4ToolApprovalResponsePart,
  throwUnsupported: NimiMastraUnsupportedFeatureThrower,
): NimiToolApprovalResponse {
  const providerMetadata = toNimiProviderOptions(part.providerOptions, throwUnsupported, 'prompt.toolApprovalResponse.providerOptions');
  return {
    approvalId: part.approvalId,
    approved: part.approved,
    ...(part.reason ? { reason: part.reason } : {}),
    ...(providerMetadata ? { providerMetadata } : {}),
  };
}

function toolOutputJson(
  output: LanguageModelV4ToolResultOutput,
  throwUnsupported: NimiMastraUnsupportedFeatureThrower,
): NimiJsonValue {
  if (output.type === 'text' || output.type === 'error-text') {
    return { type: output.type, value: output.value };
  }
  if (output.type === 'json' || output.type === 'error-json') {
    return {
      type: output.type,
      value: toNimiJsonValue(output.value, throwUnsupported, `toolResult.output.${output.type}`),
    };
  }
  if (output.type === 'execution-denied') {
    return {
      type: output.type,
      ...(output.reason ? { reason: output.reason } : {}),
    };
  }
  return toNimiJsonValue(output, throwUnsupported, `toolResult.output.${output.type}`);
}

function getToolOutputProviderOptions(output: LanguageModelV4ToolResultOutput): SharedV4ProviderOptions | undefined {
  return 'providerOptions' in output ? output.providerOptions : undefined;
}

function mergeProviderOptions(
  left: SharedV4ProviderOptions | undefined,
  right: SharedV4ProviderOptions | undefined,
): SharedV4ProviderOptions | undefined {
  if (!left && !right) {
    return undefined;
  }
  return { ...(left ?? {}), ...(right ?? {}) };
}

function toNimiTool(
  tool: LanguageModelV4FunctionTool | LanguageModelV4ProviderTool,
  throwUnsupported: NimiMastraUnsupportedFeatureThrower,
): NimiTool {
  if (tool.type === 'provider') {
    return {
      type: 'provider',
      id: tool.id,
      name: tool.name,
      args: toNimiJsonObject(tool.args, throwUnsupported, `tools.${tool.name}.args`),
    };
  }
  const functionTool = tool as LanguageModelV4FunctionTool;
  return {
    type: 'function',
    name: functionTool.name,
    description: functionTool.description,
    inputSchema: toNimiJsonObject(functionTool.inputSchema, throwUnsupported, `tools.${functionTool.name}.inputSchema`),
    visibility: 'model',
    adapterMetadata: {
      kind: 'mastra.function',
      strict: functionTool.strict ?? false,
    },
  };
}

function toNimiToolChoice(
  toolChoice: LanguageModelV4ToolChoice | undefined,
  throwUnsupported: NimiMastraUnsupportedFeatureThrower,
): NimiGenerateTextRequest['toolChoice'] {
  if (!toolChoice) {
    return undefined;
  }
  if (toolChoice.type === 'none' || toolChoice.type === 'auto' || toolChoice.type === 'required') {
    return toolChoice.type;
  }
  if (toolChoice.type === 'tool') {
    return { type: 'tool', name: toolChoice.toolName };
  }
  throwUnsupported('toolChoice');
}

// ---------------------------------------------------------------------------
// Nimi generate-text result -> LanguageModelV4 content / stream parts
// ---------------------------------------------------------------------------

export function toV4GenerateContent(result: NimiGenerateTextResult): LanguageModelV4Content[] {
  if (result.content) {
    return result.content.flatMap((content) => toV4Content(content));
  }
  const content: LanguageModelV4Content[] = [];
  const reasoning = extractReasoningText(result.raw);
  if (reasoning) {
    content.push({ type: 'reasoning', text: reasoning } satisfies LanguageModelV4Reasoning);
  }
  if (result.text) {
    content.push({ type: 'text', text: result.text });
  }
  for (const source of result.sources ?? []) {
    content.push(toV4Source(source));
  }
  for (const toolCall of result.toolCalls ?? []) {
    content.push(toV4ToolCallOutput(toolCall));
  }
  for (const toolResult of result.toolResults ?? []) {
    content.push(toV4ToolResult(toolResult));
  }
  for (const approvalRequest of result.toolApprovalRequests ?? []) {
    content.push(toV4ToolApprovalRequest(approvalRequest));
  }
  return content;
}

function toV4Content(content: NonNullable<NimiGenerateTextResult['content']>[number]): LanguageModelV4Content[] {
  if (content.type === 'text') {
    return [{ type: 'text', text: content.text }];
  }
  if (content.type === 'reasoning') {
    return [{ type: 'reasoning', text: content.text } satisfies LanguageModelV4Reasoning];
  }
  if (content.type === 'source') {
    return [toV4Source(content)];
  }
  if (content.type === 'tool-call') {
    return [toV4ToolCallOutput(content.toolCall)];
  }
  if (content.type === 'tool-result') {
    return [toV4ToolResult(content.toolResult)];
  }
  if (content.type === 'tool-approval-request') {
    return [toV4ToolApprovalRequest(content.toolApprovalRequest)];
  }
  return [];
}

export function toV4ToolCallOutput(toolCall: NimiToolCall): LanguageModelV4ToolCall {
  return {
    type: 'tool-call',
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    input: JSON.stringify(toolCall.arguments),
    ...(toolCall.providerExecuted ? { providerExecuted: true } : {}),
    ...(toolCall.dynamic ? { dynamic: true } : {}),
    ...(toolCall.providerMetadata ? { providerMetadata: toV4ProviderMetadata(toolCall.providerMetadata) } : {}),
  };
}

function toV4ToolResult(toolResult: NimiToolResult): LanguageModelV4ToolResult {
  if (toolResult.result === null) {
    throw new Error('Nimi tool result cannot be null for LanguageModelV4 tool-result content');
  }
  return {
    type: 'tool-result',
    toolCallId: toolResult.toolCallId,
    toolName: toolResult.toolName,
    result: toolResult.result as LanguageModelV4ToolResult['result'],
    ...(toolResult.isError ? { isError: true } : {}),
    ...(toolResult.preliminary ? { preliminary: true } : {}),
    ...(toolResult.dynamic ? { dynamic: true } : {}),
    ...(toolResult.providerMetadata ? { providerMetadata: toV4ProviderMetadata(toolResult.providerMetadata) } : {}),
  };
}

function toV4ToolApprovalRequest(
  approvalRequest: NimiToolApprovalRequest,
): LanguageModelV4ToolApprovalRequest {
  return {
    type: 'tool-approval-request',
    approvalId: approvalRequest.approvalId,
    toolCallId: approvalRequest.toolCallId,
    ...(approvalRequest.providerMetadata ? { providerMetadata: toV4ProviderMetadata(approvalRequest.providerMetadata) } : {}),
  };
}

function toV4Source(source: NimiSource): LanguageModelV4Source {
  if (source.sourceType === 'url') {
    return {
      type: 'source',
      sourceType: 'url',
      id: source.id,
      url: source.url,
      ...(source.title ? { title: source.title } : {}),
      ...(source.providerMetadata ? { providerMetadata: toV4ProviderMetadata(source.providerMetadata) } : {}),
    };
  }
  return {
    type: 'source',
    sourceType: 'document',
    id: source.id,
    mediaType: source.mediaType,
    title: source.title,
    ...(source.filename ? { filename: source.filename } : {}),
    ...(source.providerMetadata ? { providerMetadata: toV4ProviderMetadata(source.providerMetadata) } : {}),
  };
}

function toV4ProviderMetadata(metadata: NimiJsonObject): SharedV4ProviderMetadata {
  return metadata as unknown as SharedV4ProviderMetadata;
}

export function toV4FinishReason(reason: NimiFinishReason): LanguageModelV4FinishReason {
  if (reason === 'tool-calls') {
    return { unified: 'tool-calls', raw: reason };
  }
  if (reason === 'content-filter') {
    return { unified: 'content-filter', raw: reason };
  }
  if (reason === 'stop' || reason === 'length' || reason === 'error') {
    return { unified: reason, raw: reason };
  }
  throw createNimiError({
    message: `Unsupported Nimi finish reason for Mastra adapter: ${String(reason || 'unknown')}`,
    code: 'SDK_AI_STREAM_FINISH_REASON_UNKNOWN',
    reasonCode: 'SDK_AI_STREAM_FINISH_REASON_UNKNOWN',
    actionHint: 'check_ai_stream_finish_reason',
    source: 'sdk',
  });
}

export function toV4Usage(usage: NimiUsage | undefined): LanguageModelV4Usage {
  const cacheRead = usage?.cachedInputTokens;
  const reasoning = usage?.reasoningOutputTokens;
  const noCache = usage?.promptTokens !== undefined && cacheRead !== undefined
    ? Math.max(0, usage.promptTokens - cacheRead)
    : usage?.promptTokens;
  const text = usage?.completionTokens !== undefined && reasoning !== undefined
    ? Math.max(0, usage.completionTokens - reasoning)
    : usage?.completionTokens;
  return {
    inputTokens: {
      total: usage?.promptTokens,
      noCache,
      cacheRead,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: usage?.completionTokens,
      text,
      reasoning,
    },
  };
}

export function toV4ReadableStream(
  events: AsyncIterable<NimiRunEvent>,
): ReadableStream<LanguageModelV4StreamPart> {
  return new ReadableStream<LanguageModelV4StreamPart>({
    async start(controller) {
      let textStarted = false;
      let reasoningStarted = false;
      let sawTerminal = false;
      controller.enqueue({ type: 'stream-start', warnings: [] });
      try {
        for await (const event of events) {
          if (event.type === 'start') {
            const modelId = event.model?.modelId;
            if (event.traceId || modelId) {
              controller.enqueue({
                type: 'response-metadata',
                ...(event.traceId ? { id: event.traceId } : {}),
                ...(modelId ? { modelId } : {}),
              });
            }
          } else if (event.type === 'text-delta') {
            if (!textStarted) {
              textStarted = true;
              controller.enqueue({ type: 'text-start', id: STREAM_TEXT_ID });
            }
            controller.enqueue({ type: 'text-delta', id: STREAM_TEXT_ID, delta: event.text });
          } else if (event.type === 'reasoning-delta') {
            if (!reasoningStarted) {
              reasoningStarted = true;
              controller.enqueue({ type: 'reasoning-start', id: STREAM_REASONING_ID });
            }
            controller.enqueue({ type: 'reasoning-delta', id: STREAM_REASONING_ID, delta: event.text });
          } else if (event.type === 'artifact') {
            controller.enqueue({ type: 'file', mediaType: event.mimeType, data: { type: 'data', data: event.chunk } });
          } else if (event.type === 'source') {
            controller.enqueue(toV4Source(event));
          } else if (event.type === 'tool-call') {
            enqueueToolCall(controller, event.toolCall);
          } else if (event.type === 'tool-result') {
            controller.enqueue(toV4ToolResult(event.toolResult));
          } else if (event.type === 'tool-approval-request') {
            controller.enqueue(toV4ToolApprovalRequest(event.toolApprovalRequest));
          } else if (event.type === 'raw') {
            controller.enqueue(toV4RawChunk(event));
          } else if (event.type === 'done') {
            sawTerminal = true;
            if (textStarted) {
              controller.enqueue({ type: 'text-end', id: STREAM_TEXT_ID });
            }
            if (reasoningStarted) {
              controller.enqueue({ type: 'reasoning-end', id: STREAM_REASONING_ID });
            }
            controller.enqueue({
              type: 'finish',
              usage: toV4Usage(event.usage),
              finishReason: toV4FinishReason(event.finishReason),
            });
          } else if (event.type === 'error') {
            sawTerminal = true;
            controller.enqueue({
              type: 'error',
              error: createNimiError({
                message: event.message,
                code: event.code,
                reasonCode: event.code,
                actionHint: 'check_ai_stream_event',
                source: 'sdk',
              }),
            });
          }
        }
        if (!sawTerminal) {
          throw createNimiError({
            message: 'Nimi stream ended without done or error',
            code: 'SDK_AI_STREAM_TERMINAL_EVIDENCE_MISSING',
            reasonCode: 'SDK_AI_STREAM_TERMINAL_EVIDENCE_MISSING',
            actionHint: 'check_ai_stream_terminal_evidence',
            source: 'sdk',
          });
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

function enqueueToolCall(
  controller: ReadableStreamDefaultController<LanguageModelV4StreamPart>,
  toolCall: NimiToolCall,
): void {
  const input = JSON.stringify(toolCall.arguments);
  const providerMetadata = toolCall.providerMetadata ? toV4ProviderMetadata(toolCall.providerMetadata) : undefined;
  controller.enqueue({
    type: 'tool-input-start',
    id: toolCall.id,
    toolName: toolCall.name,
    ...(toolCall.providerExecuted ? { providerExecuted: true } : {}),
    ...(toolCall.dynamic ? { dynamic: true } : {}),
    ...(providerMetadata ? { providerMetadata } : {}),
  });
  controller.enqueue({ type: 'tool-input-delta', id: toolCall.id, delta: input, ...(providerMetadata ? { providerMetadata } : {}) });
  controller.enqueue({ type: 'tool-input-end', id: toolCall.id, ...(providerMetadata ? { providerMetadata } : {}) });
  controller.enqueue(toV4ToolCallOutput(toolCall));
}

function toV4RawChunk(rawChunk: NimiRawChunk): Extract<LanguageModelV4StreamPart, { type: 'raw' }> {
  return { type: 'raw', rawValue: rawChunk.value };
}

export function toV4Warnings(
  warnings: readonly { readonly code: string; readonly message: string }[] | undefined,
): SharedV4Warning[] {
  return warnings?.map((warning) => toV4Warning(warning.code, warning.message)) ?? [];
}

function toV4Warning(code: string, message: string): SharedV4Warning {
  return { type: 'other', message: `${code}: ${message}` };
}

function extractReasoningText(raw: NimiJsonValue | undefined): string | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const reasoning = (raw as { readonly [key: string]: NimiJsonValue }).reasoning;
  return typeof reasoning === 'string' && reasoning.length > 0 ? reasoning : undefined;
}

function toNimiJsonObject(
  input: unknown,
  throwUnsupported: NimiMastraUnsupportedFeatureThrower,
  feature: string,
): NimiJsonObject {
  const value = toNimiJsonValue(input, throwUnsupported, feature);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throwUnsupported(feature, 'expected JSON object');
  }
  return value as NimiJsonObject;
}

function toNimiJsonValue(
  input: unknown,
  throwUnsupported: NimiMastraUnsupportedFeatureThrower,
  feature: string,
): NimiJsonValue {
  if (input === null || typeof input === 'string' || typeof input === 'number' || typeof input === 'boolean') {
    return input;
  }
  if (Array.isArray(input)) {
    return input.map((item) => toNimiJsonValue(item, throwUnsupported, feature));
  }
  if (input && typeof input === 'object') {
    const output: Record<string, NimiJsonValue> = {};
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined) {
        continue;
      }
      output[key] = toNimiJsonValue(value, throwUnsupported, feature);
    }
    return output;
  }
  throwUnsupported(feature, 'value must be JSON-serializable');
}

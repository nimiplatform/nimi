import type {
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3DataContent,
  LanguageModelV3FilePart,
  LanguageModelV3FinishReason,
  LanguageModelV3FunctionTool,
  LanguageModelV3Message,
  LanguageModelV3Prompt,
  LanguageModelV3ProviderTool,
  LanguageModelV3Reasoning,
  LanguageModelV3Source,
  LanguageModelV3StreamPart,
  LanguageModelV3TextPart,
  LanguageModelV3ToolApprovalRequest,
  LanguageModelV3ToolApprovalResponsePart,
  LanguageModelV3ToolCall,
  LanguageModelV3ToolCallPart,
  LanguageModelV3ToolChoice,
  LanguageModelV3ToolResult,
  LanguageModelV3ToolResultOutput,
  LanguageModelV3ToolResultPart,
  LanguageModelV3Usage,
  SharedV3ProviderMetadata,
  SharedV3ProviderOptions,
  SharedV3Warning,
} from '@ai-sdk/provider';
import type {
  NimiAiModel,
  NimiGenerateTextRequest,
  NimiGenerateTextResult,
  NimiResponseFormat,
} from '@nimiplatform/sdk/ai';
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

export type NimiVercelUnsupportedFeatureThrower = (feature: string, detail?: string) => never;

const STREAM_TEXT_ID = 'text-1';
const STREAM_REASONING_ID = 'reasoning-1';
const VERCEL_AI_METADATA_KEY = 'x-nimi-vercel-ai-metadata';

// ---------------------------------------------------------------------------
// Vercel LanguageModelV3 call options -> Nimi generate-text request
// ---------------------------------------------------------------------------

export function toNimiGenerateTextRequest(
  model: NimiAiModel,
  options: LanguageModelV3CallOptions,
  throwUnsupported: NimiVercelUnsupportedFeatureThrower,
): NimiGenerateTextRequest {
  assertSupportedCallOptions(options, throwUnsupported);
  return {
    model: model.model,
    messages: toNimiMessages(options.prompt, throwUnsupported),
    tools: options.tools?.map((tool) => toNimiTool(tool, throwUnsupported)),
    toolChoice: toNimiToolChoice(options.toolChoice, throwUnsupported),
    responseFormat: toNimiResponseFormat(options.responseFormat, throwUnsupported),
    parameters: {
      temperature: options.temperature,
      topP: options.topP,
      maxTokens: options.maxOutputTokens,
      topK: options.topK,
      presencePenalty: options.presencePenalty,
      frequencyPenalty: options.frequencyPenalty,
      stop: options.stopSequences,
      seed: options.seed,
      metadata: toVercelCallMetadata(options, throwUnsupported),
      includeRawChunks: options.includeRawChunks,
    },
    signal: options.abortSignal,
  };
}

function assertSupportedCallOptions(
  options: LanguageModelV3CallOptions,
  throwUnsupported: NimiVercelUnsupportedFeatureThrower,
): void {
  void options;
  void throwUnsupported;
}

function toNimiResponseFormat(
  responseFormat: LanguageModelV3CallOptions['responseFormat'],
  throwUnsupported: NimiVercelUnsupportedFeatureThrower,
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

function toVercelCallMetadata(
  options: LanguageModelV3CallOptions,
  throwUnsupported: NimiVercelUnsupportedFeatureThrower,
): NimiJsonObject | undefined {
  const headers = Object.fromEntries(
    Object.entries(options.headers ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  const providerOptions = toNimiProviderOptions(options.providerOptions, throwUnsupported, 'providerOptions');
  const vercelAi: Record<string, NimiJsonValue> = {};
  if (Object.keys(headers).length > 0) {
    vercelAi.headers = headers;
  }
  if (providerOptions) {
    vercelAi.providerOptions = providerOptions;
  }
  if (Object.keys(vercelAi).length === 0) {
    return undefined;
  }
  return { [VERCEL_AI_METADATA_KEY]: stableJsonStringify(vercelAi) };
}

function toNimiProviderOptions(
  providerOptions: SharedV3ProviderOptions | undefined,
  throwUnsupported: NimiVercelUnsupportedFeatureThrower,
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
  prompt: LanguageModelV3Prompt,
  throwUnsupported: NimiVercelUnsupportedFeatureThrower,
): readonly NimiMessage[] {
  return prompt.flatMap((message) => toNimiMessageList(message, throwUnsupported));
}

function toNimiMessageList(
  message: LanguageModelV3Message,
  throwUnsupported: NimiVercelUnsupportedFeatureThrower,
): readonly NimiMessage[] {
  if (message.role === 'system') {
    return [{ role: 'system', content: [textPart(message.content)] }];
  }
  if (message.role === 'tool') {
    // One Nimi tool message per tool-result / approval response so each provider
    // continuation id is preserved across Vercel-owned tool loops.
    return message.content.map((part) => {
      if (part.type === 'tool-approval-response') {
        const response = part as LanguageModelV3ToolApprovalResponsePart;
        return {
          role: 'tool',
          content: [],
          toolApprovalResponses: [toNimiToolApprovalResponseFromPrompt(response, throwUnsupported)],
        } satisfies NimiMessage;
      }
      const result = part as LanguageModelV3ToolResultPart;
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
      (part): part is LanguageModelV3ToolCallPart => part.type === 'tool-call',
    );
    const toolResults = message.content.filter(
      (part): part is LanguageModelV3ToolResultPart => part.type === 'tool-result',
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
  throwUnsupported: NimiVercelUnsupportedFeatureThrower,
): readonly NimiMessagePart[] {
  return parts.flatMap((part) => {
    if (part.type === 'text') {
      return [textPart((part as LanguageModelV3TextPart).text)];
    }
    if (part.type === 'file') {
      return [toNimiFilePart(part as LanguageModelV3FilePart, throwUnsupported)];
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
  part: LanguageModelV3FilePart,
  throwUnsupported: NimiVercelUnsupportedFeatureThrower,
): NimiMessagePart {
  const mediaType = part.mediaType?.trim();
  if (!mediaType) {
    throwUnsupported('prompt.file.mediaType', 'file parts require an IANA media type');
  }
  return filePart(mediaType, toNimiFileData(part.data, throwUnsupported), part.filename);
}

// Vercel file data is a `Uint8Array`, a base64 string, or a `URL`. URLs and
// strings pass through; binary payloads are base64-encoded so the Runtime
// receives a `data:` URI it can decode (S-AIP-001 keeps decode Runtime-owned).
function toNimiFileData(
  data: LanguageModelV3DataContent,
  throwUnsupported: NimiVercelUnsupportedFeatureThrower,
): string {
  if (typeof data === 'string') {
    return data;
  }
  if (data instanceof URL) {
    return data.href;
  }
  if (data instanceof Uint8Array) {
    return uint8ArrayToBase64(data);
  }
  throwUnsupported('prompt.file.data', 'unsupported file data payload');
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
  output: LanguageModelV3ToolResultOutput,
  throwUnsupported: NimiVercelUnsupportedFeatureThrower,
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
  part: LanguageModelV3ToolResultPart,
  throwUnsupported: NimiVercelUnsupportedFeatureThrower,
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
  part: LanguageModelV3ToolApprovalResponsePart,
  throwUnsupported: NimiVercelUnsupportedFeatureThrower,
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
  output: LanguageModelV3ToolResultOutput,
  throwUnsupported: NimiVercelUnsupportedFeatureThrower,
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

function getToolOutputProviderOptions(output: LanguageModelV3ToolResultOutput): SharedV3ProviderOptions | undefined {
  return 'providerOptions' in output ? output.providerOptions : undefined;
}

function mergeProviderOptions(
  left: SharedV3ProviderOptions | undefined,
  right: SharedV3ProviderOptions | undefined,
): SharedV3ProviderOptions | undefined {
  if (!left && !right) {
    return undefined;
  }
  return { ...(left ?? {}), ...(right ?? {}) };
}

function toNimiTool(
  tool: LanguageModelV3FunctionTool | LanguageModelV3ProviderTool,
  throwUnsupported: NimiVercelUnsupportedFeatureThrower,
): NimiTool {
  if (tool.type === 'provider') {
    return {
      type: 'provider',
      id: tool.id,
      name: tool.name,
      args: toNimiJsonObject(tool.args, throwUnsupported, `tools.${tool.name}.args`),
    };
  }
  const functionTool = tool as LanguageModelV3FunctionTool;
  return {
    type: 'function',
    name: functionTool.name,
    description: functionTool.description,
    inputSchema: toNimiJsonObject(functionTool.inputSchema, throwUnsupported, `tools.${functionTool.name}.inputSchema`),
    visibility: 'model',
    adapterMetadata: {
      kind: 'vercel-ai.function',
      strict: functionTool.strict ?? false,
    },
  };
}

function toNimiToolChoice(
  toolChoice: LanguageModelV3ToolChoice | undefined,
  throwUnsupported: NimiVercelUnsupportedFeatureThrower,
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
// Nimi generate-text result -> Vercel LanguageModelV3 content / stream parts
// ---------------------------------------------------------------------------

export function toVercelGenerateContent(result: NimiGenerateTextResult): LanguageModelV3Content[] {
  if (result.content) {
    return result.content.flatMap((content) => toVercelContent(content));
  }
  const content: LanguageModelV3Content[] = [];
  const reasoning = extractReasoningText(result.raw);
  if (reasoning) {
    content.push({ type: 'reasoning', text: reasoning } satisfies LanguageModelV3Reasoning);
  }
  if (result.text) {
    content.push({ type: 'text', text: result.text });
  }
  for (const source of result.sources ?? []) {
    content.push(toVercelSource(source));
  }
  for (const toolCall of result.toolCalls ?? []) {
    content.push(toVercelToolCallOutput(toolCall));
  }
  for (const toolResult of result.toolResults ?? []) {
    content.push(toVercelToolResult(toolResult));
  }
  for (const approvalRequest of result.toolApprovalRequests ?? []) {
    content.push(toVercelToolApprovalRequest(approvalRequest));
  }
  return content;
}

function toVercelContent(content: NonNullable<NimiGenerateTextResult['content']>[number]): LanguageModelV3Content[] {
  if (content.type === 'text') {
    return [{ type: 'text', text: content.text }];
  }
  if (content.type === 'reasoning') {
    return [{ type: 'reasoning', text: content.text } satisfies LanguageModelV3Reasoning];
  }
  if (content.type === 'source') {
    return [toVercelSource(content)];
  }
  if (content.type === 'tool-call') {
    return [toVercelToolCallOutput(content.toolCall)];
  }
  if (content.type === 'tool-result') {
    return [toVercelToolResult(content.toolResult)];
  }
  if (content.type === 'tool-approval-request') {
    return [toVercelToolApprovalRequest(content.toolApprovalRequest)];
  }
  return [];
}

export function toVercelToolCallOutput(toolCall: NimiToolCall): LanguageModelV3ToolCall {
  return {
    type: 'tool-call',
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    input: JSON.stringify(toolCall.arguments),
    ...(toolCall.providerExecuted ? { providerExecuted: true } : {}),
    ...(toolCall.dynamic ? { dynamic: true } : {}),
    ...(toolCall.providerMetadata ? { providerMetadata: toVercelProviderMetadata(toolCall.providerMetadata) } : {}),
  };
}

function toVercelToolResult(toolResult: NimiToolResult): LanguageModelV3ToolResult {
  if (toolResult.result === null) {
    throw new Error('Nimi tool result cannot be null for Vercel LanguageModelV3 tool-result content');
  }
  return {
    type: 'tool-result',
    toolCallId: toolResult.toolCallId,
    toolName: toolResult.toolName,
    result: toolResult.result as LanguageModelV3ToolResult['result'],
    ...(toolResult.isError ? { isError: true } : {}),
    ...(toolResult.preliminary ? { preliminary: true } : {}),
    ...(toolResult.dynamic ? { dynamic: true } : {}),
    ...(toolResult.providerMetadata ? { providerMetadata: toVercelProviderMetadata(toolResult.providerMetadata) } : {}),
  };
}

function toVercelToolApprovalRequest(
  approvalRequest: NimiToolApprovalRequest,
): LanguageModelV3ToolApprovalRequest {
  return {
    type: 'tool-approval-request',
    approvalId: approvalRequest.approvalId,
    toolCallId: approvalRequest.toolCallId,
    ...(approvalRequest.providerMetadata ? { providerMetadata: toVercelProviderMetadata(approvalRequest.providerMetadata) } : {}),
  };
}

function toVercelSource(source: NimiSource): LanguageModelV3Source {
  if (source.sourceType === 'url') {
    return {
      type: 'source',
      sourceType: 'url',
      id: source.id,
      url: source.url,
      ...(source.title ? { title: source.title } : {}),
      ...(source.providerMetadata ? { providerMetadata: toVercelProviderMetadata(source.providerMetadata) } : {}),
    };
  }
  return {
    type: 'source',
    sourceType: 'document',
    id: source.id,
    mediaType: source.mediaType,
    title: source.title,
    ...(source.filename ? { filename: source.filename } : {}),
    ...(source.providerMetadata ? { providerMetadata: toVercelProviderMetadata(source.providerMetadata) } : {}),
  };
}

function toVercelProviderMetadata(metadata: NimiJsonObject): SharedV3ProviderMetadata {
  return metadata as unknown as SharedV3ProviderMetadata;
}

export function toVercelFinishReason(reason: NimiFinishReason): LanguageModelV3FinishReason {
  if (reason === 'tool-calls') {
    return { unified: 'tool-calls', raw: reason };
  }
  if (reason === 'content-filter') {
    return { unified: 'content-filter', raw: reason };
  }
  if (reason === 'stop' || reason === 'length' || reason === 'error') {
    return { unified: reason, raw: reason };
  }
  return { unified: 'other', raw: reason };
}

export function toVercelUsage(usage: NimiUsage | undefined): LanguageModelV3Usage {
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

export function toVercelReadableStream(
  events: AsyncIterable<NimiRunEvent>,
): ReadableStream<LanguageModelV3StreamPart> {
  return new ReadableStream<LanguageModelV3StreamPart>({
    async start(controller) {
      let textStarted = false;
      let reasoningStarted = false;
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
            controller.enqueue({ type: 'file', mediaType: event.mimeType, data: event.chunk });
          } else if (event.type === 'source') {
            controller.enqueue(toVercelSource(event));
          } else if (event.type === 'tool-call') {
            enqueueToolCall(controller, event.toolCall);
          } else if (event.type === 'tool-result') {
            controller.enqueue(toVercelToolResult(event.toolResult));
          } else if (event.type === 'tool-approval-request') {
            controller.enqueue(toVercelToolApprovalRequest(event.toolApprovalRequest));
          } else if (event.type === 'raw') {
            controller.enqueue(toVercelRawChunk(event));
          } else if (event.type === 'done') {
            if (textStarted) {
              controller.enqueue({ type: 'text-end', id: STREAM_TEXT_ID });
            }
            if (reasoningStarted) {
              controller.enqueue({ type: 'reasoning-end', id: STREAM_REASONING_ID });
            }
            controller.enqueue({
              type: 'finish',
              usage: toVercelUsage(event.usage),
              finishReason: toVercelFinishReason(event.finishReason),
            });
          } else if (event.type === 'error') {
            controller.enqueue({ type: 'error', error: new Error(`${event.code}: ${event.message}`) });
          }
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

function enqueueToolCall(
  controller: ReadableStreamDefaultController<LanguageModelV3StreamPart>,
  toolCall: NimiToolCall,
): void {
  const input = JSON.stringify(toolCall.arguments);
  const providerMetadata = toolCall.providerMetadata ? toVercelProviderMetadata(toolCall.providerMetadata) : undefined;
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
  controller.enqueue(toVercelToolCallOutput(toolCall));
}

function toVercelRawChunk(rawChunk: NimiRawChunk): Extract<LanguageModelV3StreamPart, { type: 'raw' }> {
  return { type: 'raw', rawValue: rawChunk.value };
}

export function toVercelWarnings(
  warnings: readonly { readonly code: string; readonly message: string }[] | undefined,
): SharedV3Warning[] {
  return warnings?.map((warning) => toVercelWarning(warning.code, warning.message)) ?? [];
}

function toVercelWarning(code: string, message: string): SharedV3Warning {
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
  throwUnsupported: NimiVercelUnsupportedFeatureThrower,
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
  throwUnsupported: NimiVercelUnsupportedFeatureThrower,
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

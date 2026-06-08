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
  LanguageModelV3StreamPart,
  LanguageModelV3TextPart,
  LanguageModelV3ToolCall,
  LanguageModelV3ToolCallPart,
  LanguageModelV3ToolChoice,
  LanguageModelV3ToolResultOutput,
  LanguageModelV3ToolResultPart,
  LanguageModelV3Usage,
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
  type NimiRunEvent,
  type NimiTool,
  type NimiToolCall,
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
    },
    signal: options.abortSignal,
  };
}

function assertSupportedCallOptions(
  options: LanguageModelV3CallOptions,
  throwUnsupported: NimiVercelUnsupportedFeatureThrower,
): void {
  if (options.includeRawChunks) {
    throwUnsupported('stream.includeRawChunks', 'Nimi run events do not carry provider raw chunks');
  }
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
    // One Nimi tool message per tool-result so each tool-call id is preserved.
    return message.content.map((part) => {
      if (part.type !== 'tool-result') {
        throwUnsupported(`prompt.${part.type}`, 'only tool-result parts are supported in tool messages');
      }
      const result = part as LanguageModelV3ToolResultPart;
      return {
        role: 'tool',
        content: [textPart(toolOutputText(result.output, throwUnsupported))],
        toolCallId: result.toolCallId,
      } satisfies NimiMessage;
    });
  }
  if (message.role === 'assistant') {
    const toolCalls = message.content.filter(
      (part): part is LanguageModelV3ToolCallPart => part.type === 'tool-call',
    );
    return [{
      role: 'assistant',
      content: toNimiContentParts(message.content, throwUnsupported),
      toolCalls: toolCalls.map((toolCall) => ({
        id: toolCall.toolCallId,
        name: toolCall.toolName,
        arguments: toNimiJsonValue(toolCall.input, throwUnsupported, 'prompt.toolCall.input'),
      })),
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
    // Tool calls are carried on the assistant message `toolCalls` field; assistant
    // tool-result parts only appear for provider-executed tools, which this adapter
    // does not support.
    if (part.type === 'tool-call' || part.type === 'tool-result') {
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
  // `content` (multimodal tool output) cannot be projected onto a text part.
  throwUnsupported('toolResult.output', `unsupported tool result output ${output.type}`);
}

function toNimiTool(
  tool: LanguageModelV3FunctionTool | LanguageModelV3ProviderTool,
  throwUnsupported: NimiVercelUnsupportedFeatureThrower,
): NimiTool {
  if (tool.type !== 'function') {
    throwUnsupported('tools.provider-defined', `provider tool ${String((tool as { id?: unknown }).id ?? '')} requires Runtime-owned execution`);
  }
  const functionTool = tool as LanguageModelV3FunctionTool;
  return {
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
  const content: LanguageModelV3Content[] = [];
  const reasoning = extractReasoningText(result.raw);
  if (reasoning) {
    content.push({ type: 'reasoning', text: reasoning } satisfies LanguageModelV3Reasoning);
  }
  if (result.text) {
    content.push({ type: 'text', text: result.text });
  }
  for (const toolCall of result.toolCalls ?? []) {
    content.push(toVercelToolCallOutput(toolCall));
  }
  return content;
}

export function toVercelToolCallOutput(toolCall: NimiToolCall): LanguageModelV3ToolCall {
  return {
    type: 'tool-call',
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    input: JSON.stringify(toolCall.arguments),
  };
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
          } else if (event.type === 'tool-call') {
            enqueueToolCall(controller, event.toolCall);
          } else if (event.type === 'warning') {
            controller.enqueue({
              type: 'raw',
              rawValue: { warning: toVercelWarning(event.code, event.message) },
            });
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
  controller.enqueue({ type: 'tool-input-start', id: toolCall.id, toolName: toolCall.name });
  controller.enqueue({ type: 'tool-input-delta', id: toolCall.id, delta: input });
  controller.enqueue({ type: 'tool-input-end', id: toolCall.id });
  controller.enqueue({
    type: 'tool-call',
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    input,
  });
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

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
  LanguageModelV3Source,
  LanguageModelV3StreamPart,
  LanguageModelV3TextPart,
  LanguageModelV3ToolChoice,
  LanguageModelV3ToolResultOutput,
  LanguageModelV3ToolResultPart,
  LanguageModelV3Usage,
  SharedV3ProviderMetadata,
  SharedV3ProviderOptions,
  SharedV3Warning,
} from '@ai-sdk/provider';
import type {
  NimiGenerateTextRequest,
  NimiGenerateTextResult,
  NimiResponseFormat,
} from '@nimiplatform/sdk/ai';
import { createNimiError } from '@nimiplatform/sdk';
import { collectNimiTextStream } from '@nimiplatform/sdk/ai';
import { canonicalVercelContent, withContinuity, withoutCallContinuity } from './transcript';
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
  type NimiToolResult,
  type NimiTextTurnItem,
  type NimiTextOutputItem,
  type NimiUsage,
} from '@nimiplatform/sdk/contracts';

export type NimiVercelUnsupportedFeatureThrower = (feature: string, detail?: string) => never;

const STREAM_TEXT_ID = 'text-1';
const VERCEL_AI_METADATA_KEY = 'x-nimi-vercel-ai-metadata';

// ---------------------------------------------------------------------------
// Vercel LanguageModelV3 call options -> Nimi generate-text request
// ---------------------------------------------------------------------------

export function toNimiGenerateTextRequest(
  options: LanguageModelV3CallOptions,
  throwUnsupported: NimiVercelUnsupportedFeatureThrower,
): NimiGenerateTextRequest {
  assertSupportedCallOptions(options, throwUnsupported);
  const metadata = toVercelCallMetadata(options, throwUnsupported);
  return {
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
      ...(metadata ? { metadata } : {}),
      ...(options.includeRawChunks ? { includeRawChunks: true } : {}),
    },
    signal: options.abortSignal,
  };
}

function assertSupportedCallOptions(
  options: LanguageModelV3CallOptions,
  throwUnsupported: NimiVercelUnsupportedFeatureThrower,
): void {
  if (Object.keys(options.providerOptions ?? {}).length) throwUnsupported('providerOptions', 'configure provider behavior through the admitted Nimi surface');
  if (Object.entries(options.headers ?? {}).some(([name, value]) => value !== undefined && name.toLowerCase() !== 'user-agent')) throwUnsupported('headers', 'the Nimi adapter does not own provider HTTP headers');
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
    // The framework's HTTP user-agent is not a Runtime generation parameter.
    Object.entries(options.headers ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[0].toLowerCase() !== 'user-agent'),
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
        return throwUnsupported('prompt.tool-approval-response', 'provider approval transcripts are not admitted by the Nimi text contract');
      }
      const result = part as LanguageModelV3ToolResultPart;
      if (result.type !== 'tool-result') {
        throwUnsupported(`prompt.${part.type}`, 'only tool-result and tool-approval-response parts are supported in tool messages');
      }
      return {
        role: 'tool',
        content: [],
        turnItems: [{ type: 'tool-result', toolResult: toNimiToolResultFromPrompt(result, throwUnsupported) }],
      } satisfies NimiMessage;
    });
  }
  if (message.role === 'assistant') {
    const turnItems = message.content.flatMap((part): NimiTextTurnItem[] => {
      if (part.type === 'text') return withContinuity({ type: 'text', text: part.text }, part.providerOptions);
      if (part.type === 'reasoning') return withContinuity({ type: 'reasoning-summary', text: part.text }, part.providerOptions);
      if (part.type === 'tool-call' && !part.providerExecuted) return withContinuity({ type: 'tool-call', toolCall: {
        id: part.toolCallId, name: part.toolName, arguments: toNimiJsonValue(part.input, throwUnsupported, 'prompt.toolCall.input'),
      } }, part.providerOptions);
      return throwUnsupported(`prompt.assistant.${part.type}`, 'only ordered text, reasoning summary and caller-owned function calls are admitted');
    });
    return [{ role: 'assistant', content: [], turnItems }];
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

function toNimiToolResultFromPrompt(
  part: LanguageModelV3ToolResultPart,
  throwUnsupported: NimiVercelUnsupportedFeatureThrower,
): NimiToolResult {
  const providerOptions = withoutCallContinuity(mergeProviderOptions(part.providerOptions, getToolOutputProviderOptions(part.output)));
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

function toolOutputJson(
  output: LanguageModelV3ToolResultOutput,
  throwUnsupported: NimiVercelUnsupportedFeatureThrower,
): NimiJsonValue {
  if (output.type === 'text' || output.type === 'error-text') {
    return output.value;
  }
  if (output.type === 'json' || output.type === 'error-json') {
    return toNimiJsonValue(output.value, throwUnsupported, `toolResult.output.${output.type}`);
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
    return throwUnsupported('tools.provider', 'provider-defined tools are not admitted by the current Nimi text contract');
  }
  const functionTool = tool as LanguageModelV3FunctionTool;
  if (functionTool.strict) throwUnsupported('tools.strict', 'Nimi validates tool arguments but does not expose a provider strict-mode switch');
  return {
    type: 'function',
    name: functionTool.name,
    description: functionTool.description,
    inputSchema: toNimiJsonObject(functionTool.inputSchema, throwUnsupported, `tools.${functionTool.name}.inputSchema`),
    visibility: 'model',
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
  if (result.toolResults?.length || result.toolApprovalRequests?.length
    || result.toolCalls?.some((call) => call.providerExecuted || call.dynamic)
    || result.outputItems?.some((item) => item.type === 'tool-call' && (item.toolCall.providerExecuted || item.toolCall.dynamic))
    || result.content?.some((item) => item.type === 'tool-result' || item.type === 'tool-approval-request' || item.type === 'reasoning' || (item.type === 'tool-call' && (item.toolCall.providerExecuted || item.toolCall.dynamic)))) {
    throw createNimiError({ code: 'SDK_ADAPTER_FEATURE_UNSUPPORTED', reasonCode: 'SDK_ADAPTER_FEATURE_UNSUPPORTED', message: 'Provider-executed tools, approval output and raw reasoning are not admitted.', source: 'sdk' });
  }
  const sources = (result.sources ?? result.content?.filter((item): item is NimiSource => item.type === 'source') ?? []).map(toVercelSource);
  if (result.outputItems?.length) return [...canonicalVercelContent(result.outputItems), ...sources];
  if (result.content?.length) {
    const items = result.content.filter((item): item is NimiTextOutputItem => item.type === 'text' || item.type === 'reasoning-summary' || item.type === 'reasoning-continuity' || item.type === 'tool-call');
    return [...canonicalVercelContent(items), ...sources];
  }
  if (result.text && result.toolCalls?.length) throw createNimiError({ code: 'SDK_ADAPTER_TRANSCRIPT_INVALID', reasonCode: 'SDK_ADAPTER_TRANSCRIPT_INVALID', message: 'Mixed model output requires its ordered items.', source: 'sdk' });
  const items: NimiTextOutputItem[] = result.text ? [{ type: 'text', text: result.text }] : (result.toolCalls ?? []).map((toolCall) => ({ type: 'tool-call', toolCall }));
  return [...canonicalVercelContent(items), ...sources];
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
  throw createNimiError({
    message: `Unsupported Nimi finish reason for Vercel adapter: ${String(reason || 'unknown')}`,
    code: 'SDK_AI_STREAM_FINISH_REASON_UNKNOWN',
    reasonCode: 'SDK_AI_STREAM_FINISH_REASON_UNKNOWN',
    actionHint: 'check_ai_stream_finish_reason',
    source: 'sdk',
  });
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
  abort: () => void = () => {},
): ReadableStream<LanguageModelV3StreamPart> {
  let canceled = false;
  const iterator = events[Symbol.asyncIterator]();
  return new ReadableStream<LanguageModelV3StreamPart>({
    async start(controller) {
      let prefix = '';
      let prefixIndex: number | undefined;
      let buffered = false;
      let terminal = false;
      let explicitModelError = false;
      controller.enqueue({ type: 'stream-start', warnings: [] });
      async function* observed(): AsyncGenerator<NimiRunEvent> {
        while (!canceled) {
          const next = await iterator.next();
          if (next.done) break;
          const event = next.value;
          if (terminal) throw createNimiError({ code: 'SDK_ADAPTER_TRANSCRIPT_INVALID', reasonCode: 'SDK_ADAPTER_TRANSCRIPT_INVALID', message: 'Nimi output followed terminal evidence.', source: 'sdk' });
          if (event.type === 'done') terminal = true;
          if (event.type === 'error') explicitModelError = true;
          if (event.type === 'start' && !canceled && (event.traceId || event.model?.modelId)) controller.enqueue({ type: 'response-metadata', ...(event.traceId ? { id: event.traceId } : {}), ...(event.model?.modelId ? { modelId: event.model.modelId } : {}) });
          if (event.type === 'tool-call' && (event.toolCall.providerExecuted || event.toolCall.dynamic)) throw createNimiError({ code: 'SDK_ADAPTER_FEATURE_UNSUPPORTED', reasonCode: 'SDK_ADAPTER_FEATURE_UNSUPPORTED', message: 'Provider-executed tool output is not admitted.', source: 'sdk' });
          if (event.type === 'artifact' || event.type === 'tool-result' || event.type === 'tool-approval-request' || event.type === 'reasoning-delta') {
            throw createNimiError({ code: 'SDK_ADAPTER_FEATURE_UNSUPPORTED', reasonCode: 'SDK_ADAPTER_FEATURE_UNSUPPORTED', message: `Nimi text adapter cannot expose ${event.type}.`, source: 'sdk' });
          }
          if (event.type === 'text-delta' && !buffered && !canceled) {
            if (prefix && event.itemIndex !== prefixIndex) buffered = true;
            else if (event.text) {
              if (!prefix) { prefixIndex = event.itemIndex; controller.enqueue({ type: 'text-start', id: STREAM_TEXT_ID }); }
              prefix += event.text;
              controller.enqueue({ type: 'text-delta', id: STREAM_TEXT_ID, delta: event.text });
            }
          } else if (event.type === 'tool-call' || event.type === 'reasoning-summary-delta' || (event.type === 'reasoning-continuity' && prefix)) {
            buffered = true;
          }
          yield event;
        }
      }
      try {
        // Vercel can execute a tool as soon as it sees tool-call. Hold tool
        // output until the Nimi model step has completed successfully.
        const result = await collectNimiTextStream(observed());
        if (canceled) return;
        if (result.finishReason === 'error') throw createNimiError({ code: 'SDK_ADAPTER_TRANSCRIPT_INVALID', reasonCode: 'SDK_ADAPTER_TRANSCRIPT_INVALID', message: 'Nimi model step failed.', source: 'sdk' });
        const content = toVercelGenerateContent(result);
        for (let index = 0; index < content.length; index++) {
          const part = content[index]!;
          if (part.type === 'text') {
            const streamed = index === 0 && prefix.length > 0;
            if (streamed && part.text !== prefix) throw createNimiError({ code: 'SDK_ADAPTER_TRANSCRIPT_INVALID', reasonCode: 'SDK_ADAPTER_TRANSCRIPT_INVALID', message: 'Nimi text item order changed.', source: 'sdk' });
            const id = streamed ? STREAM_TEXT_ID : `text-${index + 1}`;
            if (!streamed) {
              controller.enqueue({ type: 'text-start', id });
              controller.enqueue({ type: 'text-delta', id, delta: part.text });
            }
            controller.enqueue({ type: 'text-end', id, ...(part.providerMetadata ? { providerMetadata: part.providerMetadata } : {}) });
          } else if (part.type === 'reasoning') {
            const id = `reasoning-${index + 1}`;
            controller.enqueue({ type: 'reasoning-start', id });
            controller.enqueue({ type: 'reasoning-delta', id, delta: part.text });
            controller.enqueue({ type: 'reasoning-end', id, ...(part.providerMetadata ? { providerMetadata: part.providerMetadata } : {}) });
          } else if (part.type === 'tool-call') {
            controller.enqueue({ type: 'tool-input-start', id: part.toolCallId, toolName: part.toolName, ...(part.providerMetadata ? { providerMetadata: part.providerMetadata } : {}) });
            controller.enqueue({ type: 'tool-input-delta', id: part.toolCallId, delta: part.input });
            controller.enqueue({ type: 'tool-input-end', id: part.toolCallId });
            controller.enqueue(part);
          } else if (part.type === 'source') controller.enqueue(part);
          else throw createNimiError({ code: 'SDK_ADAPTER_FEATURE_UNSUPPORTED', reasonCode: 'SDK_ADAPTER_FEATURE_UNSUPPORTED', message: `Unsupported text output ${part.type}.`, source: 'sdk' });
        }
        for (const chunk of result.rawChunks ?? []) controller.enqueue(toVercelRawChunk(chunk));
        controller.enqueue({ type: 'finish', usage: toVercelUsage(result.usage), finishReason: toVercelFinishReason(result.finishReason) });
        controller.close();
      } catch (error) {
        if (!canceled && explicitModelError) { controller.enqueue({ type: 'error', error }); controller.close(); }
        else if (!canceled) controller.error(error);
      } finally {
        await iterator.return?.();
      }
    },
    async cancel() { canceled = true; abort(); await iterator.return?.(); },
  });
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

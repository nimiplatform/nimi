import type {
  LanguageModelV3CallOptions,
  LanguageModelV3FinishReason,
  LanguageModelV3FunctionTool,
  LanguageModelV3Message,
  LanguageModelV3Prompt,
  LanguageModelV3ProviderTool,
  LanguageModelV3StreamPart,
  LanguageModelV3TextPart,
  LanguageModelV3ToolCall,
  LanguageModelV3ToolCallPart,
  LanguageModelV3ToolChoice,
  LanguageModelV3ToolResultOutput,
  LanguageModelV3ToolResultPart,
  LanguageModelV3Usage,
  SharedV3Warning,
} from '@ai-sdk/provider';
import type { NimiAiModel, NimiGenerateTextRequest } from '@nimiplatform/sdk/ai';
import {
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
    responseFormat: options.responseFormat
      ? options.responseFormat.type === 'json'
        ? {
            type: 'json-schema',
            schema: options.responseFormat.schema
              ? toNimiJsonObject(options.responseFormat.schema, throwUnsupported, 'responseFormat.schema')
              : undefined,
            name: options.responseFormat.name,
            description: options.responseFormat.description,
          }
        : { type: 'text' }
      : undefined,
    parameters: {
      temperature: options.temperature,
      topP: options.topP,
      maxTokens: options.maxOutputTokens,
      presencePenalty: options.presencePenalty,
      frequencyPenalty: options.frequencyPenalty,
      stop: options.stopSequences,
      seed: options.seed,
      metadata: toVercelCallMetadata(options),
    },
    signal: options.abortSignal,
  };
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
  return {
    inputTokens: {
      total: usage?.promptTokens,
      noCache: usage?.promptTokens,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: usage?.completionTokens,
      text: usage?.completionTokens,
      reasoning: undefined,
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
          if (event.type === 'text-delta') {
            if (!textStarted) {
              textStarted = true;
              controller.enqueue({ type: 'text-start', id: 'text-1' });
            }
            controller.enqueue({ type: 'text-delta', id: 'text-1', delta: event.text });
          } else if (event.type === 'reasoning-delta') {
            if (!reasoningStarted) {
              reasoningStarted = true;
              controller.enqueue({ type: 'reasoning-start', id: 'reasoning-1' });
            }
            controller.enqueue({ type: 'reasoning-delta', id: 'reasoning-1', delta: event.text });
          } else if (event.type === 'artifact') {
            controller.enqueue({ type: 'file', mediaType: event.mimeType, data: event.chunk });
          } else if (event.type === 'tool-call') {
            controller.enqueue(toVercelToolCallOutput(event.toolCall));
          } else if (event.type === 'warning') {
            controller.enqueue({
              type: 'raw',
              rawValue: {
                warning: toVercelWarning(event.code, event.message),
              },
            });
          } else if (event.type === 'done') {
            if (textStarted) {
              controller.enqueue({ type: 'text-end', id: 'text-1' });
            }
            if (reasoningStarted) {
              controller.enqueue({ type: 'reasoning-end', id: 'reasoning-1' });
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

export function toVercelWarnings(
  warnings: readonly { readonly code: string; readonly message: string }[] | undefined,
): SharedV3Warning[] {
  return warnings?.map((warning) => toVercelWarning(warning.code, warning.message)) ?? [];
}

function assertSupportedCallOptions(
  options: LanguageModelV3CallOptions,
  throwUnsupported: NimiVercelUnsupportedFeatureThrower,
): void {
  if (options.topK !== undefined) {
    throwUnsupported('settings.topK');
  }
  if (options.includeRawChunks) {
    throwUnsupported('stream.includeRawChunks');
  }
}

function toVercelCallMetadata(options: LanguageModelV3CallOptions): NimiJsonObject | undefined {
  const headers = Object.fromEntries(
    Object.entries(options.headers ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
  if (Object.keys(headers).length === 0) {
    return undefined;
  }
  return {
    vercelAi: {
      headers,
    },
  };
}

function toNimiMessages(
  prompt: LanguageModelV3Prompt,
  throwUnsupported: NimiVercelUnsupportedFeatureThrower,
): readonly NimiMessage[] {
  return prompt.map((message) => toNimiMessage(message, throwUnsupported));
}

function toNimiMessage(
  message: LanguageModelV3Message,
  throwUnsupported: NimiVercelUnsupportedFeatureThrower,
): NimiMessage {
  if (message.role === 'system') {
    return {
      role: 'system',
      content: [textPart(message.content)],
    };
  }
  if (message.role === 'tool') {
    const firstToolResult = message.content.find((part): part is LanguageModelV3ToolResultPart => part.type === 'tool-result');
    return {
      role: 'tool',
      content: message.content.map((part) => textPart(toolResultText(part, throwUnsupported))),
      toolCallId: firstToolResult?.toolCallId,
    };
  }
  if (message.role === 'assistant') {
    const toolCalls = message.content.filter((part): part is LanguageModelV3ToolCallPart => part.type === 'tool-call');
    return {
      role: 'assistant',
      content: toNimiTextParts(message.content, throwUnsupported),
      toolCalls: toolCalls.map((toolCall) => ({
        id: toolCall.toolCallId,
        name: toolCall.toolName,
        arguments: toNimiJsonValue(toolCall.input, throwUnsupported, 'prompt.toolCall.input'),
      })),
    };
  }
  return {
    role: 'user',
    content: toNimiTextParts(message.content, throwUnsupported),
  };
}

function toNimiTextParts(
  parts: readonly (LanguageModelV3TextPart | { readonly type: string })[],
  throwUnsupported: NimiVercelUnsupportedFeatureThrower,
): readonly NimiMessagePart[] {
  return parts.flatMap((part) => {
    if (part.type === 'text') {
      return [textPart((part as LanguageModelV3TextPart).text)];
    }
    if (part.type === 'tool-call' || part.type === 'tool-result') {
      return [];
    }
    throwUnsupported(`prompt.${part.type}`);
  });
}

function toolResultText(
  part: LanguageModelV3ToolResultPart | { readonly type: string },
  throwUnsupported: NimiVercelUnsupportedFeatureThrower,
): string {
  if (part.type !== 'tool-result') {
    throwUnsupported(`prompt.${part.type}`);
  }
  return toolOutputText((part as LanguageModelV3ToolResultPart).output, throwUnsupported);
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
  throwUnsupported('toolResult.output');
}

function toNimiTool(
  tool: LanguageModelV3FunctionTool | LanguageModelV3ProviderTool,
  throwUnsupported: NimiVercelUnsupportedFeatureThrower,
): NimiTool {
  if (tool.type !== 'function') {
    throwUnsupported('tools.provider-defined');
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
    return {
      type: 'tool',
      name: toolChoice.toolName,
    };
  }
  throwUnsupported('toolChoice');
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

function toVercelWarning(code: string, message: string): SharedV3Warning {
  return { type: 'other', message: `${code}: ${message}` };
}

import type {
  NimiGenerateTextRequest,
  NimiGenerateTextResult,
  NimiAiModel,
  NimiResponseFormat,
} from '../../core/ai';
import type {
  NimiCapabilityManifest,
  NimiJsonObject,
  NimiJsonValue,
  NimiMessage,
  NimiMessagePart,
  NimiRunEvent,
  NimiTool,
  NimiToolCall,
  NimiUsage,
} from '../../core/contracts';
import { textPart } from '../../core/contracts';
import { createNimiError } from '../../types';

export const NIMI_OPENAI_COMPATIBLE_ADAPTER_ID = 'openai-compatible' as const;
export const NIMI_OPENAI_COMPATIBLE_UNSUPPORTED_FEATURE_CODE = 'SDK_ADAPTER_FEATURE_UNSUPPORTED' as const;

// @nimi-authority: rule.nimi.sdks.feature-clients.r099
export const NIMI_OPENAI_COMPATIBLE_ADAPTER_MANIFEST = {
  adapterId: NIMI_OPENAI_COMPATIBLE_ADAPTER_ID,
  targetLibrary: 'OpenAI-compatible Chat Completions',
  targetVersionRange: 'strict-chat-completions-v1',
  capabilityLevel: 'L2',
  capabilities: {
    'chat.completions.create': { support: 'supported', mode: 'adapter-mapped' },
    'chat.completions.stream': { support: 'supported', mode: 'adapter-mapped' },
    'chat.messages.system': { support: 'supported', mode: 'adapter-mapped' },
    'chat.messages.developer': { support: 'supported', mode: 'adapter-mapped' },
    'chat.messages.user': { support: 'supported', mode: 'adapter-mapped' },
    'chat.messages.assistant': { support: 'supported', mode: 'adapter-mapped' },
    'chat.messages.tool': { support: 'supported', mode: 'adapter-mapped' },
    'tools.function.definitions': { support: 'supported', mode: 'adapter-mapped' },
    'tools.function.tool_choice': { support: 'supported', mode: 'adapter-mapped' },
    'tools.function.return_tool_calls': { support: 'supported', mode: 'adapter-mapped' },
    'tools.execute': {
      support: 'not-applicable',
      mode: 'out-of-domain',
      note: 'OpenAI-compatible Chat Completions returns tool calls; caller execution is outside the protocol.',
    },
    responseFormat: { support: 'supported', mode: 'adapter-mapped' },
    logprobs: { support: 'unsupported', mode: 'adapter-mapped' },
    multiChoice: { support: 'unsupported', mode: 'adapter-mapped' },
    storedChatCrud: { support: 'unsupported', mode: 'out-of-domain' },
    responsesApi: { support: 'unsupported', mode: 'out-of-domain' },
    completionsApi: { support: 'unsupported', mode: 'out-of-domain' },
    embeddingsApi: { support: 'unsupported', mode: 'out-of-domain' },
    builtInTools: { support: 'unsupported', mode: 'runtime-owned' },
    runtimeRestBypass: {
      support: 'unsupported',
      mode: 'owner-gated',
      note: 'Adapters must not bypass Runtime ownership through app-level REST.',
    },
  },
  unsupportedBehavior: 'throw',
} as const satisfies NimiCapabilityManifest;

export type OpenAICompatibleChatRole = 'system' | 'developer' | 'user' | 'assistant' | 'tool';
export type OpenAICompatibleFinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error' | null;

export interface OpenAICompatibleChatCompletionRequest {
  readonly model: string;
  readonly messages: readonly OpenAICompatibleChatMessage[];
  readonly stream?: boolean;
  readonly temperature?: number;
  readonly top_p?: number;
  readonly max_tokens?: number;
  readonly max_completion_tokens?: number;
  readonly presence_penalty?: number;
  readonly frequency_penalty?: number;
  readonly stop?: string | readonly string[];
  readonly seed?: number;
  readonly user?: string;
  readonly metadata?: NimiJsonObject;
  readonly tools?: readonly OpenAICompatibleTool[];
  readonly tool_choice?: OpenAICompatibleToolChoice;
  readonly response_format?: OpenAICompatibleResponseFormat;
  readonly n?: number;
  readonly logprobs?: boolean;
  readonly top_logprobs?: number;
}

export type OpenAICompatibleChatMessage =
  | OpenAICompatibleSystemMessage
  | OpenAICompatibleDeveloperMessage
  | OpenAICompatibleUserMessage
  | OpenAICompatibleAssistantMessage
  | OpenAICompatibleToolMessage;

export interface OpenAICompatibleSystemMessage {
  readonly role: 'system';
  readonly content: string;
  readonly name?: string;
}

export interface OpenAICompatibleDeveloperMessage {
  readonly role: 'developer';
  readonly content: string;
  readonly name?: string;
}

export interface OpenAICompatibleUserMessage {
  readonly role: 'user';
  readonly content: string;
  readonly name?: string;
}

export interface OpenAICompatibleAssistantMessage {
  readonly role: 'assistant';
  readonly content?: string | null;
  readonly name?: string;
  readonly tool_calls?: readonly OpenAICompatibleToolCall[];
}

export interface OpenAICompatibleToolMessage {
  readonly role: 'tool';
  readonly content: string;
  readonly tool_call_id: string;
}

export interface OpenAICompatibleTool {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description?: string;
    readonly parameters?: NimiJsonObject;
    readonly strict?: boolean;
  };
}

export type OpenAICompatibleToolChoice =
  | 'none'
  | 'auto'
  | 'required'
  | {
      readonly type: 'function';
      readonly function: {
        readonly name: string;
      };
    };

export type OpenAICompatibleResponseFormat =
  | { readonly type: 'text' }
  | { readonly type: 'json_object' }
  | {
      readonly type: 'json_schema';
      readonly json_schema: {
        readonly name: string;
        readonly description?: string;
        readonly schema: NimiJsonObject;
        readonly strict?: boolean;
      };
    };

export interface OpenAICompatibleToolCall {
  readonly id: string;
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
}

export interface OpenAICompatibleChatCompletion {
  readonly id: string;
  readonly object: 'chat.completion';
  readonly created: number;
  readonly model: string;
  readonly choices: readonly [
    {
      readonly index: 0;
      readonly message: {
        readonly role: 'assistant';
        readonly content: string | null;
        readonly refusal: null;
        readonly tool_calls?: readonly OpenAICompatibleToolCall[];
      };
      readonly finish_reason: Exclude<OpenAICompatibleFinishReason, null>;
      readonly logprobs: null;
    },
  ];
  readonly usage?: OpenAICompatibleUsage;
}

export interface OpenAICompatibleChatCompletionChunk {
  readonly id: string;
  readonly object: 'chat.completion.chunk';
  readonly created: number;
  readonly model: string;
  readonly choices: readonly [
    {
      readonly index: 0;
      readonly delta: {
        readonly role?: 'assistant';
        readonly content?: string | null;
        readonly tool_calls?: readonly (OpenAICompatibleToolCall & { readonly index: number })[];
      };
      readonly finish_reason: OpenAICompatibleFinishReason;
    },
  ];
}

export interface OpenAICompatibleUsage {
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
  readonly total_tokens: number;
}

export interface NimiOpenAICompatibleAdapterOptions {
  readonly model: NimiAiModel;
  readonly idGenerator?: () => string;
  readonly createdUnixSeconds?: () => number;
}

let generatedIdCounter = 0;

export class NimiOpenAICompatibleUnsupportedFeatureError extends Error {
  readonly code = NIMI_OPENAI_COMPATIBLE_UNSUPPORTED_FEATURE_CODE;
  readonly status = 400;
  readonly feature: string;

  constructor(feature: string, detail?: string) {
    super(detail ? `${feature}: ${detail}` : feature);
    this.name = 'NimiOpenAICompatibleUnsupportedFeatureError';
    this.feature = feature;
  }
}

export function throwUnsupportedOpenAICompatibleFeature(feature: string, detail?: string): never {
  throw new NimiOpenAICompatibleUnsupportedFeatureError(feature, detail);
}

export class NimiOpenAICompatibleAdapter {
  readonly manifest = NIMI_OPENAI_COMPATIBLE_ADAPTER_MANIFEST;
  readonly chat: {
    readonly completions: NimiOpenAICompatibleChatCompletions;
  };

  constructor(options: NimiOpenAICompatibleAdapterOptions) {
    this.chat = {
      completions: new NimiOpenAICompatibleChatCompletions(options),
    };
  }
}

export function createNimiOpenAICompatibleAdapter(
  options: NimiOpenAICompatibleAdapterOptions,
): NimiOpenAICompatibleAdapter {
  return new NimiOpenAICompatibleAdapter(options);
}

export class NimiOpenAICompatibleChatCompletions {
  readonly #model: NimiAiModel;
  readonly #idGenerator: () => string;
  readonly #createdUnixSeconds: () => number;

  constructor(options: NimiOpenAICompatibleAdapterOptions) {
    this.#model = options.model;
    this.#idGenerator =
      options.idGenerator ??
      (() => {
        generatedIdCounter += 1;
        return `chatcmpl-nimi-${generatedIdCounter}`;
      });
    this.#createdUnixSeconds = options.createdUnixSeconds ?? (() => Math.floor(Date.now() / 1000));
  }

  create(request: OpenAICompatibleChatCompletionRequest & { readonly stream: true }): AsyncIterable<OpenAICompatibleChatCompletionChunk>;
  create(request: OpenAICompatibleChatCompletionRequest & { readonly stream?: false | undefined }): Promise<OpenAICompatibleChatCompletion>;
  create(
    request: OpenAICompatibleChatCompletionRequest,
  ): Promise<OpenAICompatibleChatCompletion> | AsyncIterable<OpenAICompatibleChatCompletionChunk> {
    const normalized = normalizeOpenAICompatibleChatRequest(request);
    const id = this.#idGenerator();
    const created = this.#createdUnixSeconds();

    if (request.stream === true) {
      return this.#stream(normalized, id, created);
    }

    return this.#complete(normalized, id, created);
  }

  async #complete(
    request: NormalizedOpenAICompatibleChatRequest,
    id: string,
    created: number,
  ): Promise<OpenAICompatibleChatCompletion> {
    const result = await this.#model.generateText(request.nimiRequest);
    const toolCalls = result.toolCalls?.map(toOpenAIToolCall);
    const hasToolCalls = Boolean(toolCalls && toolCalls.length > 0);

    return {
      id,
      object: 'chat.completion',
      created,
      model: request.modelName,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: hasToolCalls && result.text.length === 0 ? null : result.text,
            refusal: null,
            tool_calls: hasToolCalls ? toolCalls : undefined,
          },
          finish_reason: hasToolCalls ? 'tool_calls' : mapFinishReason(result.finishReason),
          logprobs: null,
        },
      ],
      usage: toOpenAIUsage(result.usage),
    };
  }

  async *#stream(
    request: NormalizedOpenAICompatibleChatRequest,
    id: string,
    created: number,
  ): AsyncIterable<OpenAICompatibleChatCompletionChunk> {
    if (!this.#model.streamText) {
      throwUnsupportedOpenAICompatibleFeature('chat.completions.stream', 'model does not expose Nimi streaming');
    }

    const events = await this.#model.streamText(request.nimiRequest);
    let toolCallIndex = 0;
    let sawDone = false;

    yield toChunk(id, created, request.modelName, { role: 'assistant' }, null);

    for await (const event of events) {
      if (event.type === 'text-delta') {
        yield toChunk(id, created, request.modelName, { content: event.text }, null);
      } else if (event.type === 'tool-call') {
        yield toChunk(
          id,
          created,
          request.modelName,
          { tool_calls: [{ ...toOpenAIToolCall(event.toolCall), index: toolCallIndex }] },
          null,
        );
        toolCallIndex += 1;
      } else if (event.type === 'done') {
        sawDone = true;
        yield toChunk(id, created, request.modelName, {}, mapFinishReason(event.finishReason));
      } else if (event.type === 'error') {
        throw createNimiError({
          message: event.message,
          code: event.code,
          reasonCode: event.code,
          actionHint: 'check_ai_stream_event',
          source: 'sdk',
        });
      }
    }

    if (!sawDone) {
      throw createNimiError({
        message: 'OpenAI-compatible stream ended before a Nimi done event',
        code: 'SDK_AI_STREAM_TERMINAL_EVIDENCE_MISSING',
        reasonCode: 'SDK_AI_STREAM_TERMINAL_EVIDENCE_MISSING',
        actionHint: 'check_ai_stream_terminal_evidence',
        source: 'sdk',
      });
    }
  }
}

interface NormalizedOpenAICompatibleChatRequest {
  readonly modelName: string;
  readonly nimiRequest: NimiGenerateTextRequest;
}

const SUPPORTED_REQUEST_KEYS = new Set([
  'model',
  'messages',
  'stream',
  'temperature',
  'top_p',
  'max_tokens',
  'max_completion_tokens',
  'presence_penalty',
  'frequency_penalty',
  'stop',
  'seed',
  'user',
  'metadata',
  'tools',
  'tool_choice',
  'response_format',
  'n',
  'logprobs',
  'top_logprobs',
]);

const SUPPORTED_MESSAGE_KEYS = new Set(['role', 'content', 'name', 'tool_call_id', 'tool_calls']);
const SUPPORTED_TOOL_KEYS = new Set(['type', 'function']);
const SUPPORTED_TOOL_FUNCTION_KEYS = new Set(['name', 'description', 'parameters', 'strict']);
const SUPPORTED_RESPONSE_FORMAT_KEYS = new Set(['type', 'json_schema']);
const SUPPORTED_JSON_SCHEMA_KEYS = new Set(['name', 'description', 'schema', 'strict']);

export function normalizeOpenAICompatibleChatRequest(
  request: OpenAICompatibleChatCompletionRequest,
): NormalizedOpenAICompatibleChatRequest {
  validateAllowedKeys(request, SUPPORTED_REQUEST_KEYS, 'chat.completions.create.request');

  if (request.n !== undefined && request.n !== 1) {
    throwUnsupportedOpenAICompatibleFeature('n', 'only n=1 is supported');
  }
  if (request.logprobs !== undefined || request.top_logprobs !== undefined) {
    throwUnsupportedOpenAICompatibleFeature('logprobs');
  }
  if (!request.model || typeof request.model !== 'string') {
    throwUnsupportedOpenAICompatibleFeature('model', 'model must be a string');
  }
  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    throwUnsupportedOpenAICompatibleFeature('messages', 'at least one message is required');
  }

  return {
    modelName: request.model,
    nimiRequest: {
      messages: request.messages.map(toNimiMessage),
      tools: request.tools?.map(toNimiTool),
      toolChoice: toNimiToolChoice(request.tool_choice),
      responseFormat: toNimiResponseFormat(request.response_format),
      parameters: {
        temperature: request.temperature,
        topP: request.top_p,
        maxTokens: request.max_completion_tokens ?? request.max_tokens,
        presencePenalty: request.presence_penalty,
        frequencyPenalty: request.frequency_penalty,
        stop: request.stop,
        seed: request.seed,
        user: request.user,
        metadata: request.metadata ? toJsonObject(request.metadata, 'metadata') : undefined,
      },
    },
  };
}

function toNimiMessage(message: OpenAICompatibleChatMessage): NimiMessage {
  validateAllowedKeys(message, SUPPORTED_MESSAGE_KEYS, `messages.${message.role}`);

  if ('function_call' in message) {
    throwUnsupportedOpenAICompatibleFeature('messages.function_call', 'deprecated function_call is not supported');
  }

  if (message.role === 'assistant') {
    const content = message.content ?? '';
    if (typeof content !== 'string') {
      throwUnsupportedOpenAICompatibleFeature('messages.assistant.content', 'only string or null content is supported');
    }
    return {
      role: 'assistant',
      name: message.name,
      content: content.length > 0 ? [textPart(content)] : [],
      toolCalls: message.tool_calls?.map(toNimiToolCall),
    };
  }

  if (message.role === 'tool') {
    if (!message.tool_call_id) {
      throwUnsupportedOpenAICompatibleFeature('messages.tool.tool_call_id', 'tool messages require tool_call_id');
    }
    return {
      role: 'tool',
      content: [textPart(assertStringContent(message.content, 'messages.tool.content'))],
      toolCallId: message.tool_call_id,
    };
  }

  return {
    role: message.role,
    name: message.name,
    content: [textPart(assertStringContent(message.content, `messages.${message.role}.content`))],
  };
}

function assertStringContent(content: unknown, feature: string): string {
  if (typeof content !== 'string') {
    throwUnsupportedOpenAICompatibleFeature(feature, 'only string content is supported');
  }
  return content;
}

function toNimiTool(tool: OpenAICompatibleTool): NimiTool {
  validateAllowedKeys(tool, SUPPORTED_TOOL_KEYS, 'tools[]');
  if (tool.type !== 'function') {
    throwUnsupportedOpenAICompatibleFeature(`tools.${String((tool as { type?: unknown }).type)}`);
  }

  validateAllowedKeys(tool.function, SUPPORTED_TOOL_FUNCTION_KEYS, `tools.${tool.function?.name ?? '<unknown>'}.function`);
  if (!tool.function?.name || typeof tool.function.name !== 'string') {
    throwUnsupportedOpenAICompatibleFeature('tools.function.name', 'function tool name must be a string');
  }

  return {
    name: tool.function.name,
    description: tool.function.description,
    inputSchema: toJsonObject(tool.function.parameters ?? {}, `tools.${tool.function.name}.function.parameters`),
    visibility: 'model',
    adapterMetadata: {
      kind: 'openai-compatible.function',
      strict: tool.function.strict ?? false,
    },
  };
}

function toNimiToolChoice(
  toolChoice: OpenAICompatibleToolChoice | undefined,
): NimiGenerateTextRequest['toolChoice'] {
  if (toolChoice === undefined) {
    return undefined;
  }
  if (toolChoice === 'none' || toolChoice === 'auto' || toolChoice === 'required') {
    return toolChoice;
  }
  validateAllowedKeys(toolChoice, new Set(['type', 'function']), 'tool_choice');
  if (toolChoice.type !== 'function' || !toolChoice.function?.name) {
    throwUnsupportedOpenAICompatibleFeature('tool_choice');
  }
  return {
    type: 'tool',
    name: toolChoice.function.name,
  };
}

function toNimiResponseFormat(format: OpenAICompatibleResponseFormat | undefined): NimiResponseFormat | undefined {
  if (!format) {
    return undefined;
  }
  validateAllowedKeys(format, SUPPORTED_RESPONSE_FORMAT_KEYS, 'response_format');
  if (format.type === 'text') {
    return { type: 'text' };
  }
  if (format.type === 'json_object') {
    return { type: 'json-object' };
  }
  if (format.type === 'json_schema') {
    validateAllowedKeys(format.json_schema, SUPPORTED_JSON_SCHEMA_KEYS, 'response_format.json_schema');
    return {
      type: 'json-schema',
      name: format.json_schema.name,
      description: format.json_schema.description,
      schema: toJsonObject(format.json_schema.schema, 'response_format.json_schema.schema'),
      strict: format.json_schema.strict,
    };
  }
  throwUnsupportedOpenAICompatibleFeature(`response_format.${String((format as { type?: unknown }).type)}`);
}

function toNimiToolCall(toolCall: OpenAICompatibleToolCall): NimiToolCall {
  validateAllowedKeys(toolCall, new Set(['id', 'type', 'function']), 'messages.assistant.tool_calls[]');
  if (toolCall.type !== 'function') {
    throwUnsupportedOpenAICompatibleFeature('messages.assistant.tool_calls.type');
  }
  const parsedArguments = parseJsonString(toolCall.function.arguments, 'messages.assistant.tool_calls.function.arguments');
  return {
    id: toolCall.id,
    name: toolCall.function.name,
    arguments: parsedArguments,
  };
}

function toOpenAIToolCall(toolCall: NimiToolCall): OpenAICompatibleToolCall {
  return {
    id: toolCall.id,
    type: 'function',
    function: {
      name: toolCall.name,
      arguments: JSON.stringify(toolCall.arguments),
    },
  };
}

function mapFinishReason(reason: NimiGenerateTextResult['finishReason']): Exclude<OpenAICompatibleFinishReason, null> {
  if (reason === 'tool-calls') {
    return 'tool_calls';
  }
  if (reason === 'content-filter') {
    return 'content_filter';
  }
  if (reason === 'length' || reason === 'error' || reason === 'stop') {
    return reason;
  }
  throwUnsupportedOpenAICompatibleFeature(
    'finishReason',
    `unsupported Nimi finish reason: ${String(reason || 'unknown')}`,
  );
}

function toOpenAIUsage(usage: NimiUsage | undefined): OpenAICompatibleUsage | undefined {
  if (!usage) {
    return undefined;
  }
  const promptTokens = usage.promptTokens ?? 0;
  const completionTokens = usage.completionTokens ?? 0;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: usage.totalTokens ?? promptTokens + completionTokens,
  };
}

function toChunk(
  id: string,
  created: number,
  model: string,
  delta: OpenAICompatibleChatCompletionChunk['choices'][0]['delta'],
  finishReason: OpenAICompatibleFinishReason,
): OpenAICompatibleChatCompletionChunk {
  return {
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
  };
}

function validateAllowedKeys(value: unknown, keys: ReadonlySet<string>, path: string): void {
  if (!isRecord(value)) {
    throwUnsupportedOpenAICompatibleFeature(path, 'expected object');
  }
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) {
      throwUnsupportedOpenAICompatibleFeature(`${path}.${key}`);
    }
  }
}

function toJsonObject(value: NimiJsonObject, feature: string): NimiJsonObject {
  if (!isRecord(value)) {
    throwUnsupportedOpenAICompatibleFeature(feature, 'expected object');
  }
  assertJsonValue(value, feature);
  return value as NimiJsonObject;
}

function parseJsonString(value: string, feature: string): NimiJsonValue {
  if (typeof value !== 'string') {
    throwUnsupportedOpenAICompatibleFeature(feature, 'expected JSON string');
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    assertJsonValue(parsed, feature);
    return parsed as NimiJsonValue;
  } catch (error) {
    if (error instanceof NimiOpenAICompatibleUnsupportedFeatureError) {
      throw error;
    }
    throwUnsupportedOpenAICompatibleFeature(feature, 'expected valid JSON string');
  }
}

function assertJsonValue(value: unknown, feature: string): void {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${feature}[${index}]`));
    return;
  }
  if (isRecord(value)) {
    for (const [key, nestedValue] of Object.entries(value)) {
      if (nestedValue === undefined) {
        throwUnsupportedOpenAICompatibleFeature(`${feature}.${key}`, 'undefined is not JSON');
      }
      assertJsonValue(nestedValue, `${feature}.${key}`);
    }
    return;
  }
  throwUnsupportedOpenAICompatibleFeature(feature, 'expected JSON-compatible value');
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function openAICompatibleTextMessage(role: OpenAICompatibleChatRole, content: string): OpenAICompatibleChatMessage {
  if (role === 'assistant') {
    return { role, content };
  }
  if (role === 'tool') {
    throwUnsupportedOpenAICompatibleFeature('openAICompatibleTextMessage.tool', 'tool messages require tool_call_id');
  }
  return { role, content };
}

export function nimiMessagesFromOpenAICompatibleChat(
  messages: readonly OpenAICompatibleChatMessage[],
): readonly NimiMessage[] {
  return messages.map(toNimiMessage);
}

export function openAICompatibleMessagesFromTextParts(messages: readonly NimiMessage[]): readonly OpenAICompatibleChatMessage[] {
  return messages.map((message) => {
    const content = textFromParts(message.content);
    if (message.role === 'tool') {
      if (!message.toolCallId) {
        throwUnsupportedOpenAICompatibleFeature('nimi.tool.toolCallId');
      }
      return {
        role: 'tool',
        content,
        tool_call_id: message.toolCallId,
      };
    }
    if (message.role === 'assistant') {
      return {
        role: 'assistant',
        content,
        tool_calls: message.toolCalls?.map(toOpenAIToolCall),
      };
    }
    return {
      role: message.role,
      content,
      name: message.name,
    };
  });
}

function textFromParts(parts: readonly NimiMessagePart[]): string {
  return parts
    .map((part) => {
      if (part.type !== 'text') {
        throwUnsupportedOpenAICompatibleFeature('nimi.message.data_part');
      }
      return part.text;
    })
    .join('');
}

import type {
  NimiFinishReason,
  NimiJsonObject,
  NimiJsonValue,
  NimiMessage,
  NimiModelRef,
  NimiRunEvent,
  NimiTool,
  NimiToolCall,
  NimiUsage,
} from '../contracts';

export interface NimiAiRequestParameters {
  readonly temperature?: number;
  readonly topP?: number;
  readonly maxTokens?: number;
  readonly presencePenalty?: number;
  readonly frequencyPenalty?: number;
  readonly stop?: string | readonly string[];
  readonly seed?: number;
  readonly user?: string;
  readonly metadata?: NimiJsonObject;
}

export interface NimiResponseFormat {
  readonly type: 'text' | 'json-object' | 'json-schema';
  readonly schema?: NimiJsonObject;
  readonly name?: string;
  readonly description?: string;
  readonly strict?: boolean;
}

export interface NimiGenerateTextRequest {
  readonly model: NimiModelRef;
  readonly messages: readonly NimiMessage[];
  readonly tools?: readonly NimiTool[];
  readonly toolChoice?: 'none' | 'auto' | 'required' | { readonly type: 'tool'; readonly name: string };
  readonly responseFormat?: NimiResponseFormat;
  readonly parameters?: NimiAiRequestParameters;
  readonly signal?: AbortSignal;
}

export interface NimiGenerateTextResult {
  readonly text: string;
  readonly finishReason: NimiFinishReason;
  readonly usage?: NimiUsage;
  readonly toolCalls?: readonly NimiToolCall[];
  readonly warnings?: readonly { readonly code: string; readonly message: string }[];
  readonly raw?: NimiJsonValue;
}

export interface NimiAiModel {
  readonly model: NimiModelRef;
  generateText(request: NimiGenerateTextRequest): Promise<NimiGenerateTextResult>;
  streamText?(request: NimiGenerateTextRequest): AsyncIterable<NimiRunEvent> | Promise<AsyncIterable<NimiRunEvent>>;
}

export async function collectNimiTextStream(events: AsyncIterable<NimiRunEvent>): Promise<NimiGenerateTextResult> {
  let text = '';
  let reasoning = '';
  let finishReason: NimiFinishReason = 'unknown';
  let usage: NimiUsage | undefined;
  const toolCalls: NimiToolCall[] = [];
  const warnings: { code: string; message: string }[] = [];
  const artifacts: { mimeType: string; sizeBytes: number }[] = [];

  for await (const event of events) {
    if (event.type === 'text-delta') {
      text += event.text;
    } else if (event.type === 'reasoning-delta') {
      reasoning += event.text;
    } else if (event.type === 'artifact') {
      artifacts.push({ mimeType: event.mimeType, sizeBytes: event.chunk.byteLength });
    } else if (event.type === 'tool-call') {
      toolCalls.push(event.toolCall);
    } else if (event.type === 'warning') {
      warnings.push({ code: event.code, message: event.message });
    } else if (event.type === 'done') {
      finishReason = event.finishReason;
      usage = event.usage;
    } else if (event.type === 'error') {
      throw new Error(`${event.code}: ${event.message}`);
    }
  }

  const raw: NimiJsonValue | undefined = reasoning || artifacts.length > 0
    ? {
      ...(reasoning ? { reasoning } : {}),
      ...(artifacts.length > 0 ? { artifacts } : {}),
    }
    : undefined;

  return {
    text,
    finishReason,
    usage,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
    ...(raw ? { raw } : {}),
  };
}

export * from './config';
export * from './embeddings';
export * from './runtime-model';
export * from './scheduling';
export * from './text-runner';

import type {
  NimiFinishReason,
  NimiJsonObject,
  NimiJsonValue,
  NimiMessage,
  NimiRawChunk,
  NimiRunEvent,
  NimiSource,
  NimiTool,
  NimiToolApprovalRequest,
  NimiToolCall,
  NimiToolResult,
  NimiUsage,
} from '../contracts';
import { createNimiError } from '../../types';

export interface NimiAiRequestParameters {
  readonly temperature?: number;
  readonly topP?: number;
  readonly topK?: number;
  readonly maxTokens?: number;
  readonly presencePenalty?: number;
  readonly frequencyPenalty?: number;
  readonly stop?: string | readonly string[];
  readonly seed?: number;
  readonly user?: string;
  readonly metadata?: NimiJsonObject;
  readonly includeRawChunks?: boolean;
}

export type NimiGenerateTextContent =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'reasoning'; readonly text: string }
  | NimiSource
  | { readonly type: 'tool-call'; readonly toolCall: NimiToolCall }
  | { readonly type: 'tool-result'; readonly toolResult: NimiToolResult }
  | { readonly type: 'tool-approval-request'; readonly toolApprovalRequest: NimiToolApprovalRequest }
  | NimiRawChunk;

export interface NimiResponseFormat {
  readonly type: 'text' | 'json-object' | 'json-schema';
  readonly schema?: NimiJsonObject;
  readonly name?: string;
  readonly description?: string;
  readonly strict?: boolean;
}

export interface NimiGenerateTextRequest {
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
  readonly toolResults?: readonly NimiToolResult[];
  readonly toolApprovalRequests?: readonly NimiToolApprovalRequest[];
  readonly sources?: readonly NimiSource[];
  readonly rawChunks?: readonly NimiRawChunk[];
  readonly content?: readonly NimiGenerateTextContent[];
  readonly warnings?: readonly { readonly code: string; readonly message: string }[];
  readonly raw?: NimiJsonValue;
}

export interface NimiTextGenerationCapabilityRef {
  readonly modelId: 'text.generate';
}

export interface NimiAiModel {
  readonly model: NimiTextGenerationCapabilityRef;
  generateText(request: NimiGenerateTextRequest): Promise<NimiGenerateTextResult>;
  streamText?(request: NimiGenerateTextRequest): AsyncIterable<NimiRunEvent> | Promise<AsyncIterable<NimiRunEvent>>;
}

export async function collectNimiTextStream(events: AsyncIterable<NimiRunEvent>): Promise<NimiGenerateTextResult> {
  let text = '';
  let reasoning = '';
  let finishReason: NimiFinishReason = 'unknown';
  let usage: NimiUsage | undefined;
  const toolCalls: NimiToolCall[] = [];
  const toolResults: NimiToolResult[] = [];
  const toolApprovalRequests: NimiToolApprovalRequest[] = [];
  const sources: NimiSource[] = [];
  const rawChunks: NimiRawChunk[] = [];
  const warnings: { code: string; message: string }[] = [];
  const artifacts: { mimeType: string; sizeBytes: number }[] = [];
  let observedTerminal = false;

  for await (const event of events) {
    if (event.type === 'text-delta') {
      text += event.text;
    } else if (event.type === 'reasoning-delta') {
      reasoning += event.text;
    } else if (event.type === 'artifact') {
      artifacts.push({ mimeType: event.mimeType, sizeBytes: event.chunk.byteLength });
    } else if (event.type === 'tool-call') {
      toolCalls.push(event.toolCall);
    } else if (event.type === 'tool-result') {
      toolResults.push(event.toolResult);
    } else if (event.type === 'tool-approval-request') {
      toolApprovalRequests.push(event.toolApprovalRequest);
    } else if (event.type === 'source') {
      sources.push(event);
    } else if (event.type === 'raw') {
      rawChunks.push(event);
    } else if (event.type === 'warning') {
      warnings.push({ code: event.code, message: event.message });
    } else if (event.type === 'done') {
      observedTerminal = true;
      finishReason = event.finishReason;
      usage = event.usage;
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

  const raw: NimiJsonValue | undefined = reasoning || artifacts.length > 0
    ? {
      ...(reasoning ? { reasoning } : {}),
      ...(artifacts.length > 0 ? { artifacts } : {}),
    }
    : undefined;

  if (!observedTerminal) {
    throw createNimiError({
      message: 'Nimi stream ended without done evidence',
      code: 'SDK_AI_STREAM_TERMINAL_EVIDENCE_MISSING',
      reasonCode: 'SDK_AI_STREAM_TERMINAL_EVIDENCE_MISSING',
      actionHint: 'check_ai_stream_terminal_evidence',
      source: 'sdk',
    });
  }
  if (finishReason === 'unknown') {
    throw createNimiError({
      message: 'Nimi stream terminal evidence used an unknown finish reason',
      code: 'SDK_AI_STREAM_FINISH_REASON_UNKNOWN',
      reasonCode: 'SDK_AI_STREAM_FINISH_REASON_UNKNOWN',
      actionHint: 'check_ai_stream_finish_reason',
      source: 'sdk',
    });
  }

  return {
    text,
    finishReason,
    usage,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    toolResults: toolResults.length > 0 ? toolResults : undefined,
    toolApprovalRequests: toolApprovalRequests.length > 0 ? toolApprovalRequests : undefined,
    sources: sources.length > 0 ? sources : undefined,
    rawChunks: rawChunks.length > 0 ? rawChunks : undefined,
    content: [
      ...(reasoning ? [{ type: 'reasoning' as const, text: reasoning }] : []),
      ...(text ? [{ type: 'text' as const, text }] : []),
      ...sources,
      ...toolCalls.map((toolCall) => ({ type: 'tool-call' as const, toolCall })),
      ...toolResults.map((toolResult) => ({ type: 'tool-result' as const, toolResult })),
      ...toolApprovalRequests.map((toolApprovalRequest) => ({
        type: 'tool-approval-request' as const,
        toolApprovalRequest,
      })),
      ...rawChunks,
    ],
    warnings: warnings.length > 0 ? warnings : undefined,
    ...(raw ? { raw } : {}),
  };
}

export * from './config';
export * from './embeddings';
export * from './runtime-model';
export * from './text-runner';

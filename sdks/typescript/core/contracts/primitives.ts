export type NimiJsonPrimitive = string | number | boolean | null;
export type NimiJsonValue = NimiJsonPrimitive | readonly NimiJsonValue[] | { readonly [key: string]: NimiJsonValue };
export type NimiJsonObject = { readonly [key: string]: NimiJsonValue };

export type NimiMessageRole = 'system' | 'developer' | 'user' | 'assistant' | 'tool';

export interface NimiModelRef {
  readonly providerId?: string;
  readonly modelId: string;
  readonly displayName?: string;
}

export interface NimiTextPart {
  readonly type: 'text';
  readonly text: string;
}

export interface NimiDataPart {
  readonly type: 'data';
  readonly data: NimiJsonValue;
}

export interface NimiFilePart {
  readonly type: 'file';
  // IANA media type of the file (e.g. `image/png`, `audio/wav`). Routing onto a
  // Runtime multimodal channel is decided from this prefix.
  readonly mediaType: string;
  // File payload as a string: an `http(s)://` URL, a `data:` URI, or raw base64.
  // Raw base64 is wrapped into a `data:<mediaType>;base64,<data>` URI when the
  // request is projected onto the Runtime chat content protocol.
  readonly data: string;
  readonly filename?: string;
}

export type NimiMessagePart = NimiTextPart | NimiDataPart | NimiFilePart;

export interface NimiToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: NimiJsonValue;
  readonly providerExecuted?: boolean;
  readonly dynamic?: boolean;
  readonly providerMetadata?: NimiJsonObject;
}

export interface NimiToolResult {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly result: NimiJsonValue;
  readonly isError?: boolean;
  readonly preliminary?: boolean;
  readonly dynamic?: boolean;
  readonly providerMetadata?: NimiJsonObject;
}

export interface NimiToolApprovalRequest {
  readonly approvalId: string;
  readonly toolCallId: string;
  readonly providerMetadata?: NimiJsonObject;
}

export interface NimiToolApprovalResponse {
  readonly approvalId: string;
  readonly approved: boolean;
  readonly reason?: string;
  readonly providerMetadata?: NimiJsonObject;
}

export type NimiSource =
  | {
      readonly type: 'source';
      readonly sourceType: 'url';
      readonly id: string;
      readonly url: string;
      readonly title?: string;
      readonly providerMetadata?: NimiJsonObject;
    }
  | {
      readonly type: 'source';
      readonly sourceType: 'document';
      readonly id: string;
      readonly mediaType: string;
      readonly title: string;
      readonly filename?: string;
      readonly providerMetadata?: NimiJsonObject;
    };

export interface NimiRawChunk {
  readonly type: 'raw';
  readonly value: NimiJsonValue;
}

export interface NimiMessage {
  readonly role: NimiMessageRole;
  readonly content: readonly NimiMessagePart[];
  readonly name?: string;
  readonly toolCallId?: string;
  readonly toolCalls?: readonly NimiToolCall[];
  readonly toolResults?: readonly NimiToolResult[];
  readonly toolApprovalResponses?: readonly NimiToolApprovalResponse[];
  readonly metadata?: NimiJsonObject;
}

export interface NimiFunctionTool {
  readonly type?: 'function';
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: NimiJsonObject;
  readonly visibility?: 'model' | 'internal';
  readonly policy?: 'auto' | 'approval-required' | 'external-execution';
  readonly adapterMetadata?: NimiJsonObject;
  readonly execute?: (input: NimiJsonValue) => Promise<NimiJsonValue> | NimiJsonValue;
}

export interface NimiProviderTool {
  readonly type: 'provider';
  readonly id: string;
  readonly name: string;
  readonly args: NimiJsonObject;
  readonly providerMetadata?: NimiJsonObject;
}

export type NimiTool = NimiFunctionTool | NimiProviderTool;

export type NimiFinishReason = 'stop' | 'length' | 'tool-calls' | 'content-filter' | 'error' | 'unknown';

export interface NimiUsage {
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
  readonly cachedInputTokens?: number;
  readonly reasoningOutputTokens?: number;
}

export type NimiRunEvent =
  | {
      readonly type: 'start';
      readonly traceId?: string;
      readonly model?: NimiModelRef;
    }
  | {
      readonly type: 'text-delta';
      readonly text: string;
    }
  | {
      readonly type: 'reasoning-delta';
      readonly text: string;
    }
  | {
      readonly type: 'artifact';
      readonly chunk: Uint8Array;
      readonly mimeType: string;
    }
  | {
      readonly type: 'tool-call';
      readonly toolCall: NimiToolCall;
    }
  | {
      readonly type: 'tool-result';
      readonly toolResult: NimiToolResult;
    }
  | {
      readonly type: 'tool-approval-request';
      readonly toolApprovalRequest: NimiToolApprovalRequest;
    }
  | NimiSource
  | NimiRawChunk
  | {
      readonly type: 'warning';
      readonly code: string;
      readonly message: string;
    }
  | {
      readonly type: 'trace';
      readonly trace: NimiAiTrace;
    }
  | {
      readonly type: 'done';
      readonly finishReason: NimiFinishReason;
      readonly usage?: NimiUsage;
    }
  | {
      readonly type: 'error';
      readonly code: string;
      readonly message: string;
      readonly cause?: unknown;
    };

export interface NimiAiTraceStep {
  readonly id: string;
  readonly kind: 'model' | 'tool' | 'approval' | 'external-execution' | 'workflow';
  readonly status: 'started' | 'completed' | 'failed';
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly input?: NimiJsonValue;
  readonly output?: NimiJsonValue;
  readonly error?: string;
}

export interface NimiAiTrace {
  readonly traceId: string;
  readonly events: readonly NimiRunEvent[];
  readonly steps: readonly NimiAiTraceStep[];
}

export function textPart(text: string): NimiTextPart {
  return { type: 'text', text };
}

export function dataPart(data: NimiJsonValue): NimiDataPart {
  return { type: 'data', data };
}

export function filePart(mediaType: string, data: string, filename?: string): NimiFilePart {
  return filename === undefined
    ? { type: 'file', mediaType, data }
    : { type: 'file', mediaType, data, filename };
}

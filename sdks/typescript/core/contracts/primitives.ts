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

export type NimiMessagePart = NimiTextPart | NimiDataPart;

export interface NimiToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: NimiJsonValue;
}

export interface NimiMessage {
  readonly role: NimiMessageRole;
  readonly content: readonly NimiMessagePart[];
  readonly name?: string;
  readonly toolCallId?: string;
  readonly toolCalls?: readonly NimiToolCall[];
  readonly metadata?: NimiJsonObject;
}

export interface NimiTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: NimiJsonObject;
  readonly visibility?: 'model' | 'internal';
  readonly policy?: 'auto' | 'approval-required' | 'external-execution';
  readonly adapterMetadata?: NimiJsonObject;
  readonly execute?: (input: NimiJsonValue) => Promise<NimiJsonValue> | NimiJsonValue;
}

export type NimiFinishReason = 'stop' | 'length' | 'tool-calls' | 'content-filter' | 'error' | 'unknown';

export interface NimiUsage {
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
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
      readonly type: 'warning';
      readonly code: string;
      readonly message: string;
    }
  | {
      readonly type: 'trace';
      readonly trace: NimiAgentTrace;
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

export interface NimiAgentTraceStep {
  readonly id: string;
  readonly kind: 'model' | 'tool' | 'approval' | 'external-execution' | 'workflow';
  readonly status: 'started' | 'completed' | 'failed';
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly input?: NimiJsonValue;
  readonly output?: NimiJsonValue;
  readonly error?: string;
}

export interface NimiAgentTrace {
  readonly traceId: string;
  readonly events: readonly NimiRunEvent[];
  readonly steps: readonly NimiAgentTraceStep[];
}

export function textPart(text: string): NimiTextPart {
  return { type: 'text', text };
}

export function dataPart(data: NimiJsonValue): NimiDataPart {
  return { type: 'data', data };
}

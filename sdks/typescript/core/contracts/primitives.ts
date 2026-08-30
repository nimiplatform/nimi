import type { NimiExecutionInterruption } from '../../types/errors';
export type { NimiExecutionInterruption } from '../../types/errors';

export type NimiJsonPrimitive = string | number | boolean | null;
export type NimiJsonValue = NimiJsonPrimitive | readonly NimiJsonValue[] | { readonly [key: string]: NimiJsonValue };
export type NimiJsonObject = { readonly [key: string]: NimiJsonValue };

export type NimiMessageRole = 'system' | 'developer' | 'user' | 'assistant' | 'tool';

export interface NimiModelRef {
  readonly modelId: 'text.generate';
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
  // Adapter-specific file payload. Runtime text.generate admits only http(s)
  // media URLs here; managed media uses NimiArtifactRefPart.
  readonly data: string;
  readonly filename?: string;
}

export interface NimiArtifactRefPart {
  readonly type: 'artifact-ref';
  readonly artifactId?: string;
  readonly localArtifactId?: string;
  readonly mediaType: string;
  readonly displayName?: string;
}

export type NimiMessagePart = NimiTextPart | NimiDataPart | NimiFilePart | NimiArtifactRefPart;

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

export interface NimiReasoningContinuityCarrier {
  readonly kind: string;
  readonly version: number;
  readonly payload: Uint8Array;
}

export type NimiTextOutputItem =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'reasoning-summary'; readonly text: string }
  | { readonly type: 'tool-call'; readonly toolCall: NimiToolCall }
  | { readonly type: 'reasoning-continuity'; readonly carrier: NimiReasoningContinuityCarrier };

export type NimiTextTurnItem =
  | { readonly type: 'output'; readonly output: NimiTextOutputItem }
  | { readonly type: 'tool-result'; readonly toolResult: NimiToolResult };

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
  /** Canonical ordered assistant output and external-host ToolResult round-trip. */
  readonly turnItems?: readonly NimiTextTurnItem[];
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

export type NimiTextBehaviorKind = 'tool-use' | 'reasoning' | 'structured-output';

export interface NimiAIExecutionAdmission {
  readonly loadoutId: string;
  readonly capabilityContract: string;
  readonly implementation: {
    readonly implementationId: string;
    readonly driverId: string;
    readonly driverDialect: string;
  };
  readonly recipeId: string;
  readonly recipeRevision: string;
  readonly admittedFeatures: readonly string[];
  readonly admittedTextBehaviors: readonly NimiTextBehaviorKind[];
}

export type NimiRunEvent =
  | {
      readonly type: 'start';
      readonly traceId?: string;
      readonly model?: NimiModelRef;
      readonly admission?: NimiAIExecutionAdmission;
    }
  | {
      readonly type: 'text-delta';
      readonly text: string;
      readonly itemIndex?: number;
      readonly itemCompleted?: boolean;
    }
  | {
      readonly type: 'reasoning-delta';
      readonly text: string;
    }
  | {
      readonly type: 'reasoning-summary-delta';
      readonly text: string;
      readonly itemIndex: number;
      readonly itemCompleted: boolean;
    }
  | {
      readonly type: 'artifact';
      readonly chunk: Uint8Array;
      readonly mimeType: string;
    }
  | {
      readonly type: 'tool-call';
      readonly toolCall: NimiToolCall;
      readonly itemIndex?: number;
      readonly itemCompleted?: boolean;
    }
  | {
      readonly type: 'reasoning-continuity';
      readonly carrier: NimiReasoningContinuityCarrier;
      readonly itemIndex: number;
      readonly itemCompleted: true;
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
      readonly interruption?: NimiExecutionInterruption;
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

export function artifactRefPart(input: Omit<NimiArtifactRefPart, 'type'>): NimiArtifactRefPart {
  return { type: 'artifact-ref', ...input };
}

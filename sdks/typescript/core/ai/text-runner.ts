import type {
  NimiRunEvent,
  NimiUsage,
} from '../contracts';
import {
  appendNimiConversationReasoningDelta,
  appendNimiConversationTextDelta,
  completeNimiConversationText,
  createNimiConversationTextAccumulator,
  failNimiConversationText,
  type NimiConversationTextAccumulatorSnapshot,
} from '../../features/conversation';
import {
  buildNimiStructuredOutputRepairRequest,
  parseNimiStructuredJson,
  type NimiStructuredJsonParseInput,
  type NimiStructuredOutputParseFailure,
  type NimiStructuredOutputParseSuccess,
  type NimiStructuredOutputRepairRequest,
} from '../../features/evaluation';
import { createNimiError } from '../../types';
import type { NimiAiModel, NimiGenerateTextRequest, NimiGenerateTextResult } from './index';

export interface NimiTextRuntime {
  readonly model: NimiAiModel;
}

export interface NimiTextStructuredOutputOptions<TValue>
  extends Omit<NimiStructuredJsonParseInput<TValue>, 'raw'> {
  readonly required?: boolean;
  readonly repairInstruction?: string;
}

export interface NimiTextGenerateInput<TStructured = unknown> {
  readonly runtime: NimiTextRuntime;
  readonly request: NimiGenerateTextRequest;
  readonly structuredOutput?: NimiTextStructuredOutputOptions<TStructured>;
}

export interface NimiTextGenerateSuccess<TStructured = unknown> {
  readonly ok: true;
  readonly text: string;
  readonly result: NimiGenerateTextResult;
  readonly structuredOutput?: NimiStructuredOutputParseSuccess<TStructured>;
  readonly structuredOutputFailure?: NimiStructuredOutputParseFailure;
  readonly repairRequest?: NimiStructuredOutputRepairRequest;
}

export interface NimiTextGenerateFailure {
  readonly ok: false;
  readonly error: NimiTextError;
  readonly result?: NimiGenerateTextResult;
  readonly structuredOutputFailure?: NimiStructuredOutputParseFailure;
  readonly repairRequest?: NimiStructuredOutputRepairRequest;
  readonly canceled?: boolean;
}

export type NimiTextGenerateResult<TStructured = unknown> =
  | NimiTextGenerateSuccess<TStructured>
  | NimiTextGenerateFailure;

export interface NimiTextTurnInput<TStructured = unknown>
  extends NimiTextGenerateInput<TStructured> {
  readonly turnId?: string;
  readonly threadId?: string;
  readonly signal?: AbortSignal;
}

export interface NimiTextError {
  readonly code: string;
  readonly message: string;
  readonly cause?: unknown;
}

export type NimiTextTurnEvent<TStructured = unknown> =
  | { readonly type: 'turn-started'; readonly turnId?: string; readonly threadId?: string }
  | {
    readonly type: 'reasoning-delta';
    readonly turnId?: string;
    readonly textDelta: string;
    readonly snapshot: NimiConversationTextAccumulatorSnapshot;
    readonly runEvent: Extract<NimiRunEvent, { readonly type: 'reasoning-delta' | 'reasoning-summary-delta' }>;
  }
  | {
    readonly type: 'reasoning-continuity';
    readonly turnId?: string;
    readonly snapshot: NimiConversationTextAccumulatorSnapshot;
    readonly runEvent: Extract<NimiRunEvent, { readonly type: 'reasoning-continuity' }>;
  }
  | {
    readonly type: 'text-delta';
    readonly turnId?: string;
    readonly textDelta: string;
    readonly snapshot: NimiConversationTextAccumulatorSnapshot;
    readonly runEvent: Extract<NimiRunEvent, { readonly type: 'text-delta' }>;
  }
  | {
    readonly type: 'tool-call';
    readonly turnId?: string;
    readonly snapshot: NimiConversationTextAccumulatorSnapshot;
    readonly runEvent: Extract<NimiRunEvent, { readonly type: 'tool-call' }>;
  }
  | {
    readonly type: 'tool-result';
    readonly turnId?: string;
    readonly snapshot: NimiConversationTextAccumulatorSnapshot;
    readonly runEvent: Extract<NimiRunEvent, { readonly type: 'tool-result' }>;
  }
  | {
    readonly type: 'tool-approval-request';
    readonly turnId?: string;
    readonly snapshot: NimiConversationTextAccumulatorSnapshot;
    readonly runEvent: Extract<NimiRunEvent, { readonly type: 'tool-approval-request' }>;
  }
  | {
    readonly type: 'source';
    readonly turnId?: string;
    readonly snapshot: NimiConversationTextAccumulatorSnapshot;
    readonly runEvent: Extract<NimiRunEvent, { readonly type: 'source' }>;
  }
  | {
    readonly type: 'raw';
    readonly turnId?: string;
    readonly snapshot: NimiConversationTextAccumulatorSnapshot;
    readonly runEvent: Extract<NimiRunEvent, { readonly type: 'raw' }>;
  }
  | {
    readonly type: 'warning';
    readonly turnId?: string;
    readonly snapshot: NimiConversationTextAccumulatorSnapshot;
    readonly runEvent: Extract<NimiRunEvent, { readonly type: 'warning' }>;
  }
  | {
    readonly type: 'artifact';
    readonly turnId?: string;
    readonly snapshot: NimiConversationTextAccumulatorSnapshot;
    readonly runEvent: Extract<NimiRunEvent, { readonly type: 'artifact' }>;
  }
  | {
    readonly type: 'trace';
    readonly turnId?: string;
    readonly snapshot: NimiConversationTextAccumulatorSnapshot;
    readonly runEvent: Extract<NimiRunEvent, { readonly type: 'trace' }>;
  }
  | {
    readonly type: 'structured-output-parsed';
    readonly turnId?: string;
    readonly output: NimiStructuredOutputParseSuccess<TStructured>;
    readonly snapshot: NimiConversationTextAccumulatorSnapshot;
  }
  | {
    readonly type: 'structured-output-repair-required';
    readonly turnId?: string;
    readonly failure: NimiStructuredOutputParseFailure;
    readonly repairRequest: NimiStructuredOutputRepairRequest;
    readonly snapshot: NimiConversationTextAccumulatorSnapshot;
  }
  | {
    readonly type: 'turn-completed';
    readonly turnId?: string;
    readonly snapshot: NimiConversationTextAccumulatorSnapshot;
    readonly structuredOutput?: NimiStructuredOutputParseSuccess<TStructured>;
  }
  | {
    readonly type: 'turn-failed';
    readonly turnId?: string;
    readonly error: NimiTextError;
    readonly snapshot: NimiConversationTextAccumulatorSnapshot;
    readonly structuredOutputFailure?: NimiStructuredOutputParseFailure;
    readonly repairRequest?: NimiStructuredOutputRepairRequest;
  }
  | { readonly type: 'turn-canceled'; readonly turnId?: string; readonly snapshot: NimiConversationTextAccumulatorSnapshot };

export interface NimiTextStreamResponseResult {
  readonly text: string;
  readonly finishReason?: string;
  readonly usage?: NimiUsage;
  readonly traceId?: string;
}

export interface NimiTextStreamHandlers {
  readonly onDelta?: (text: string, event: Extract<NimiTextTurnEvent, { readonly type: 'text-delta' }>) => void | Promise<void>;
  readonly onSnapshot?: (snapshot: NimiConversationTextAccumulatorSnapshot) => void | Promise<void>;
  readonly onFinish?: (result: NimiTextStreamResponseResult) => void | Promise<void>;
  readonly onError?: (error: NimiTextError) => void | Promise<void>;
}

export async function runNimiTextGenerate<TStructured = unknown>(
  input: NimiTextGenerateInput<TStructured>,
): Promise<NimiTextGenerateResult<TStructured>> {
  let result: NimiGenerateTextResult;
  try {
    result = await input.runtime.model.generateText(input.request);
  } catch (error) {
    if (isAbortLikeError(error)) {
      return {
        ok: false,
        canceled: true,
        error: {
          code: 'OPERATION_ABORTED',
          message: 'Nimi text generation was canceled before completion.',
          cause: error,
        },
      };
    }
    return {
      ok: false,
      error: toNimiTextError(error),
    };
  }

  return finalizeStructuredGenerateResult(result, input.structuredOutput);
}

export async function* runNimiTextTurn<TStructured = unknown>(
  input: NimiTextTurnInput<TStructured>,
): AsyncIterable<NimiTextTurnEvent<TStructured>> {
  let snapshot = createNimiConversationTextAccumulator();
  yield { type: 'turn-started', turnId: input.turnId, threadId: input.threadId };

  if (input.signal?.aborted) {
    yield { type: 'turn-canceled', turnId: input.turnId, snapshot };
    return;
  }

  if (!input.runtime.model.streamText) {
    yield {
      type: 'turn-failed',
      turnId: input.turnId,
      error: {
        code: 'STREAM_UNSUPPORTED',
        message: `model ${input.runtime.model.model.modelId} does not support streaming`,
      },
      snapshot,
    };
    return;
  }

  try {
    const events = await input.runtime.model.streamText(input.request);
    for await (const event of events) {
      if (input.signal?.aborted) {
        yield { type: 'turn-canceled', turnId: input.turnId, snapshot };
        return;
      }
      if (event.type === 'start') {
        snapshot = { ...snapshot, traceId: event.traceId ?? snapshot.traceId };
      } else if (event.type === 'reasoning-delta') {
        snapshot = appendNimiConversationReasoningDelta(snapshot, event.text);
        yield { type: 'reasoning-delta', turnId: input.turnId, textDelta: event.text, snapshot, runEvent: event };
      } else if (event.type === 'reasoning-summary-delta') {
        snapshot = appendNimiConversationReasoningDelta(snapshot, event.text);
        yield { type: 'reasoning-delta', turnId: input.turnId, textDelta: event.text, snapshot, runEvent: event };
      } else if (event.type === 'text-delta') {
        snapshot = appendNimiConversationTextDelta(snapshot, event.text);
        yield { type: 'text-delta', turnId: input.turnId, textDelta: event.text, snapshot, runEvent: event };
      } else if (event.type === 'tool-call') {
        yield { type: 'tool-call', turnId: input.turnId, snapshot, runEvent: event };
      } else if (event.type === 'reasoning-continuity') {
        yield { type: 'reasoning-continuity', turnId: input.turnId, snapshot, runEvent: event };
      } else if (event.type === 'tool-result') {
        yield { type: 'tool-result', turnId: input.turnId, snapshot, runEvent: event };
      } else if (event.type === 'tool-approval-request') {
        yield { type: 'tool-approval-request', turnId: input.turnId, snapshot, runEvent: event };
      } else if (event.type === 'source') {
        yield { type: 'source', turnId: input.turnId, snapshot, runEvent: event };
      } else if (event.type === 'raw') {
        yield { type: 'raw', turnId: input.turnId, snapshot, runEvent: event };
      } else if (event.type === 'warning') {
        yield { type: 'warning', turnId: input.turnId, snapshot, runEvent: event };
      } else if (event.type === 'artifact') {
        yield { type: 'artifact', turnId: input.turnId, snapshot, runEvent: event };
      } else if (event.type === 'trace') {
        yield { type: 'trace', turnId: input.turnId, snapshot, runEvent: event };
      } else if (event.type === 'done') {
        snapshot = completeNimiConversationText(snapshot, {
          finishReason: event.finishReason,
          usage: event.usage,
        });
      } else if (event.type === 'error') {
        snapshot = failNimiConversationText(snapshot, { error: event });
        yield {
          type: 'turn-failed',
          turnId: input.turnId,
          error: { code: event.code, message: event.message, cause: event.cause },
          snapshot,
        };
        return;
      } else {
        assertNever(event);
      }
    }
  } catch (error) {
    if (isAbortLikeError(error) || input.signal?.aborted) {
      yield { type: 'turn-canceled', turnId: input.turnId, snapshot };
      return;
    }
    snapshot = failNimiConversationText(snapshot, { error });
    yield { type: 'turn-failed', turnId: input.turnId, error: toNimiTextError(error), snapshot };
    return;
  }

  if (snapshot.terminal !== 'completed') {
    const error = {
      code: 'STREAM_TERMINATED_WITHOUT_TERMINAL_EVENT',
      message: 'Nimi text stream ended without a terminal finish event.',
    };
    snapshot = failNimiConversationText(snapshot, { error });
    yield { type: 'turn-failed', turnId: input.turnId, error, snapshot };
    return;
  }

  yield* emitStructuredTurnCompletion(input, snapshot);
}

export async function streamNimiTextResponse(
  input: NimiTextTurnInput,
  handlers: NimiTextStreamHandlers = {},
): Promise<NimiTextStreamResponseResult> {
  for await (const event of runNimiTextTurn(input)) {
    if (event.type === 'text-delta') {
      await handlers.onDelta?.(event.textDelta, event);
      await handlers.onSnapshot?.(event.snapshot);
    } else if (event.type === 'turn-completed') {
      const result = {
        text: event.snapshot.text,
        finishReason: event.snapshot.finishReason,
        usage: event.snapshot.usage,
        traceId: event.snapshot.traceId,
      };
      await handlers.onFinish?.(result);
      return result;
    } else if (event.type === 'turn-failed') {
      await handlers.onError?.(event.error);
      throw toError(event.error);
    } else if (event.type === 'turn-canceled') {
      const error = new Error('Aborted');
      error.name = 'AbortError';
      throw error;
    }
  }
  throw new Error('Nimi text stream ended without a terminal event');
}

function finalizeStructuredGenerateResult<TStructured>(
  result: NimiGenerateTextResult,
  structuredOutput: NimiTextStructuredOutputOptions<TStructured> | undefined,
): NimiTextGenerateResult<TStructured> {
  if (!structuredOutput) {
    return { ok: true, text: result.text, result };
  }
  const parsed = parseNimiStructuredJson<TStructured>({
    raw: result.text,
    validate: structuredOutput.validate,
    expect: structuredOutput.expect,
  });
  if (parsed.ok) {
    return { ok: true, text: result.text, result, structuredOutput: parsed };
  }
  const repairRequest = buildNimiStructuredOutputRepairRequest({
    failure: parsed,
    originalText: result.text,
    instruction: structuredOutput.repairInstruction,
  });
  if (structuredOutput.required === false) {
    return {
      ok: true,
      text: result.text,
      result,
      structuredOutputFailure: parsed,
      repairRequest,
    };
  }
  return {
    ok: false,
    result,
    structuredOutputFailure: parsed,
    repairRequest,
    error: {
      code: 'STRUCTURED_OUTPUT_VALIDATION_FAILED',
      message: parsed.message,
      cause: parsed.error,
    },
  };
}

async function* emitStructuredTurnCompletion<TStructured>(
  input: NimiTextTurnInput<TStructured>,
  snapshot: NimiConversationTextAccumulatorSnapshot,
): AsyncIterable<NimiTextTurnEvent<TStructured>> {
  if (!input.structuredOutput) {
    yield { type: 'turn-completed', turnId: input.turnId, snapshot };
    return;
  }
  const parsed = parseNimiStructuredJson<TStructured>({
    raw: snapshot.text,
    validate: input.structuredOutput.validate,
    expect: input.structuredOutput.expect,
  });
  if (parsed.ok) {
    yield { type: 'structured-output-parsed', turnId: input.turnId, output: parsed, snapshot };
    yield { type: 'turn-completed', turnId: input.turnId, snapshot, structuredOutput: parsed };
    return;
  }
  const repairRequest = buildNimiStructuredOutputRepairRequest({
    failure: parsed,
    originalText: snapshot.text,
    instruction: input.structuredOutput.repairInstruction,
  });
  yield {
    type: 'structured-output-repair-required',
    turnId: input.turnId,
    failure: parsed,
    repairRequest,
    snapshot,
  };
  if (input.structuredOutput.required === false) {
    yield { type: 'turn-completed', turnId: input.turnId, snapshot };
    return;
  }
  const error = {
    code: 'STRUCTURED_OUTPUT_VALIDATION_FAILED',
    message: parsed.message,
    cause: parsed.error,
  };
  yield {
    type: 'turn-failed',
    turnId: input.turnId,
    error,
    snapshot: failNimiConversationText(snapshot, { error }),
    structuredOutputFailure: parsed,
    repairRequest,
  };
}

function toNimiTextError(error: unknown): NimiTextError {
  if (isNimiTextErrorLike(error)) {
    const code = normalizeText(error.code) || normalizeText(error.reasonCode);
    const message = normalizeText(error.message);
    if (code || message) {
      return {
        code: code || 'MODEL_CALL_FAILED',
        message: message || 'Nimi text generation failed.',
        cause: error,
      };
    }
  }
  if (error instanceof Error) {
    return {
      code: error.name || 'MODEL_CALL_FAILED',
      message: error.message || 'Nimi text generation failed.',
      cause: error,
    };
  }
  return {
    code: 'MODEL_CALL_FAILED',
    message: String(error || 'Nimi text generation failed.'),
    cause: error,
  };
}

interface NimiTextErrorLike {
  readonly code?: unknown;
  readonly reasonCode?: unknown;
  readonly message?: unknown;
}

function isNimiTextErrorLike(value: unknown): value is NimiTextErrorLike {
  return Boolean(value) && typeof value === 'object';
}

function toError(error: NimiTextError): Error {
  return createNimiError({
    message: error.message,
    code: error.code,
    reasonCode: error.code,
    actionHint: 'check_ai_text_error',
    source: 'sdk',
  });
}

function isAbortLikeError(error: unknown): boolean {
  if (!error) {
    return false;
  }
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return error.name === 'AbortError';
  }
  if (error instanceof Error) {
    return error.name === 'AbortError' || error.message === 'Aborted';
  }
  return false;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Nimi text stream event: ${JSON.stringify(value)}`);
}

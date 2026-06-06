import type { NimiAiModel, NimiGenerateTextResult } from '../ai';
import {
  type NimiMessage,
  type NimiRunEvent,
  type NimiUsage,
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
import type { NimiAgentSpec } from './index';
import { buildNimiAgentModelRequest } from './runner';

export interface NimiAgentTextRuntime {
  readonly model: NimiAiModel;
}

export interface NimiAgentStructuredOutputOptions<TValue>
  extends Omit<NimiStructuredJsonParseInput<TValue>, 'raw'> {
  readonly required?: boolean;
  readonly repairInstruction?: string;
}

export interface NimiAgentTextGenerateInput<TStructured = unknown> {
  readonly agent: NimiAgentSpec;
  readonly runtime: NimiAgentTextRuntime;
  readonly messages: readonly NimiMessage[];
  readonly structuredOutput?: NimiAgentStructuredOutputOptions<TStructured>;
}

export interface NimiAgentTextGenerateSuccess<TStructured = unknown> {
  readonly ok: true;
  readonly text: string;
  readonly result: NimiGenerateTextResult;
  readonly structuredOutput?: NimiStructuredOutputParseSuccess<TStructured>;
  readonly structuredOutputFailure?: NimiStructuredOutputParseFailure;
  readonly repairRequest?: NimiStructuredOutputRepairRequest;
}

export interface NimiAgentTextGenerateFailure {
  readonly ok: false;
  readonly error: NimiAgentTextError;
  readonly result?: NimiGenerateTextResult;
  readonly structuredOutputFailure?: NimiStructuredOutputParseFailure;
  readonly repairRequest?: NimiStructuredOutputRepairRequest;
  readonly canceled?: boolean;
}

export type NimiAgentTextGenerateResult<TStructured = unknown> =
  | NimiAgentTextGenerateSuccess<TStructured>
  | NimiAgentTextGenerateFailure;

export interface NimiAgentTextTurnInput<TStructured = unknown>
  extends NimiAgentTextGenerateInput<TStructured> {
  readonly turnId?: string;
  readonly threadId?: string;
  readonly signal?: AbortSignal;
}

export interface NimiAgentTextError {
  readonly code: string;
  readonly message: string;
  readonly cause?: unknown;
}

export type NimiAgentTextTurnEvent<TStructured = unknown> =
  | { readonly type: 'turn-started'; readonly turnId?: string; readonly threadId?: string }
  | {
    readonly type: 'reasoning-delta';
    readonly turnId?: string;
    readonly textDelta: string;
    readonly snapshot: NimiConversationTextAccumulatorSnapshot;
    readonly runEvent: Extract<NimiRunEvent, { readonly type: 'reasoning-delta' }>;
  }
  | {
    readonly type: 'text-delta';
    readonly turnId?: string;
    readonly textDelta: string;
    readonly snapshot: NimiConversationTextAccumulatorSnapshot;
    readonly runEvent: Extract<NimiRunEvent, { readonly type: 'text-delta' }>;
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
    readonly error: NimiAgentTextError;
    readonly snapshot: NimiConversationTextAccumulatorSnapshot;
    readonly structuredOutputFailure?: NimiStructuredOutputParseFailure;
    readonly repairRequest?: NimiStructuredOutputRepairRequest;
  }
  | { readonly type: 'turn-canceled'; readonly turnId?: string; readonly snapshot: NimiConversationTextAccumulatorSnapshot };

export interface NimiAgentTextStreamResponseResult {
  readonly text: string;
  readonly finishReason?: string;
  readonly usage?: NimiUsage;
}

export interface NimiAgentTextStreamHandlers {
  readonly onDelta?: (text: string, event: Extract<NimiAgentTextTurnEvent, { readonly type: 'text-delta' }>) => void | Promise<void>;
  readonly onSnapshot?: (snapshot: NimiConversationTextAccumulatorSnapshot) => void | Promise<void>;
  readonly onFinish?: (result: NimiAgentTextStreamResponseResult) => void | Promise<void>;
  readonly onError?: (error: NimiAgentTextError) => void | Promise<void>;
}

export async function runNimiAgentTextGenerate<TStructured = unknown>(
  input: NimiAgentTextGenerateInput<TStructured>,
): Promise<NimiAgentTextGenerateResult<TStructured>> {
  let result: NimiGenerateTextResult;
  try {
    const request = await buildNimiAgentModelRequest(input.agent, input.runtime.model, input.messages);
    result = await input.runtime.model.generateText(request);
  } catch (error) {
    if (isAbortLikeError(error)) {
      return {
        ok: false,
        canceled: true,
        error: {
          code: 'OPERATION_ABORTED',
          message: 'Agent text generation was canceled before completion.',
          cause: error,
        },
      };
    }
    return {
      ok: false,
      error: toNimiAgentTextError(error),
    };
  }

  return finalizeStructuredGenerateResult(result, input.structuredOutput);
}

export async function* runNimiAgentTextTurn<TStructured = unknown>(
  input: NimiAgentTextTurnInput<TStructured>,
): AsyncIterable<NimiAgentTextTurnEvent<TStructured>> {
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
        message: `agent ${input.agent.id} model does not support streaming`,
      },
      snapshot,
    };
    return;
  }

  try {
    const request = await buildNimiAgentModelRequest(input.agent, input.runtime.model, input.messages);
    const events = await input.runtime.model.streamText(request);
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
      } else if (event.type === 'text-delta') {
        snapshot = appendNimiConversationTextDelta(snapshot, event.text);
        yield { type: 'text-delta', turnId: input.turnId, textDelta: event.text, snapshot, runEvent: event };
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
      }
    }
  } catch (error) {
    if (isAbortLikeError(error) || input.signal?.aborted) {
      yield { type: 'turn-canceled', turnId: input.turnId, snapshot };
      return;
    }
    snapshot = failNimiConversationText(snapshot, { error });
    yield { type: 'turn-failed', turnId: input.turnId, error: toNimiAgentTextError(error), snapshot };
    return;
  }

  if (snapshot.terminal !== 'completed') {
    const error = {
      code: 'STREAM_TERMINATED_WITHOUT_TERMINAL_EVENT',
      message: 'Agent text stream ended without a terminal finish event.',
    };
    snapshot = failNimiConversationText(snapshot, { error });
    yield { type: 'turn-failed', turnId: input.turnId, error, snapshot };
    return;
  }

  yield* emitStructuredTurnCompletion(input, snapshot);
}

export async function streamNimiAgentTextResponse(
  input: NimiAgentTextTurnInput,
  handlers: NimiAgentTextStreamHandlers = {},
): Promise<NimiAgentTextStreamResponseResult> {
  for await (const event of runNimiAgentTextTurn(input)) {
    if (event.type === 'text-delta') {
      await handlers.onDelta?.(event.textDelta, event);
      await handlers.onSnapshot?.(event.snapshot);
    } else if (event.type === 'turn-completed') {
      const result = {
        text: event.snapshot.text,
        finishReason: event.snapshot.finishReason,
        usage: event.snapshot.usage,
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
  throw new Error('Agent text stream ended without a terminal event');
}

function finalizeStructuredGenerateResult<TStructured>(
  result: NimiGenerateTextResult,
  structuredOutput: NimiAgentStructuredOutputOptions<TStructured> | undefined,
): NimiAgentTextGenerateResult<TStructured> {
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
  input: NimiAgentTextTurnInput<TStructured>,
  snapshot: NimiConversationTextAccumulatorSnapshot,
): AsyncIterable<NimiAgentTextTurnEvent<TStructured>> {
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

function toNimiAgentTextError(error: unknown): NimiAgentTextError {
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const code = normalizeText(record.code) || normalizeText(record.reasonCode);
    const message = normalizeText(record.message);
    if (code || message) {
      return {
        code: code || 'AGENT_TEXT_FAILED',
        message: message || 'Agent text generation failed.',
        cause: error,
      };
    }
  }
  if (error instanceof Error) {
    return {
      code: error.name || 'AGENT_TEXT_FAILED',
      message: error.message || 'Agent text generation failed.',
      cause: error,
    };
  }
  return {
    code: 'AGENT_TEXT_FAILED',
    message: String(error || 'Agent text generation failed.'),
    cause: error,
  };
}

function isAbortLikeError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message === 'Aborted');
}

function toError(error: NimiAgentTextError): Error {
  const next = new Error(error.message);
  next.name = error.code;
  return next;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

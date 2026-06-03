import type {
  NimiFinishReason,
  NimiTokenUsage,
  NimiTraceInfo,
  TextStreamInput,
  TextStreamOutput,
  TextStreamPart,
} from '../runtime/index.js';
import {
  appendAppAiSessionReasoningDelta,
  appendAppAiSessionTextDelta,
  completeAppAiSessionText,
  createAppAiSessionTextAccumulator,
  failAppAiSessionText,
  type AppAiSessionTextAccumulatorSnapshot,
} from './session-loop.js';
import {
  buildAppAiStructuredOutputRepairRequest,
  parseAppAiStructuredJson,
  type AppAiStructuredJsonParseInput,
  type AppAiStructuredOutputParseFailure,
  type AppAiStructuredOutputRepairRequest,
  type AppAiStructuredOutputParseResult,
  type AppAiStructuredOutputParseSuccess,
} from './structured-output.js';

type AppAiTextTurnReasoningPart = Extract<TextStreamPart, { type: 'reasoning-delta' }>;
type AppAiTextTurnDeltaPart = Extract<TextStreamPart, { type: 'delta' }>;
type AppAiTextTurnFinishPart = Extract<TextStreamPart, { type: 'finish' }>;
type AppAiTextTurnErrorPart = Extract<TextStreamPart, { type: 'error' }>;

export type AppAiTextTurnRuntime = {
  streamText: (request: TextStreamInput) => Promise<TextStreamOutput>;
};

export type AppAiTextTurnStructuredOutput<TValue> = Omit<
  AppAiStructuredJsonParseInput<TValue>,
  'raw'
> & {
  required?: boolean;
  repairInstruction?: string;
};

export type AppAiTextTurnInput<TStructured = unknown> = {
  runtime: AppAiTextTurnRuntime;
  request: TextStreamInput;
  turnId?: string;
  threadId?: string;
  structuredOutput?: AppAiTextTurnStructuredOutput<TStructured>;
};

export type AppAiTextTurnError = {
  code: string;
  message: string;
  cause?: unknown;
};

export type AppAiTextTurnEvent<TStructured = unknown> =
  | {
    type: 'turn-started';
    turnId?: string;
    threadId?: string;
  }
  | {
    type: 'reasoning-delta';
    turnId?: string;
    textDelta: string;
    snapshot: AppAiSessionTextAccumulatorSnapshot;
    runtimePart: AppAiTextTurnReasoningPart;
  }
  | {
    type: 'text-delta';
    turnId?: string;
    textDelta: string;
    snapshot: AppAiSessionTextAccumulatorSnapshot;
    runtimePart: AppAiTextTurnDeltaPart;
  }
  | {
    type: 'structured-output-parsed';
    turnId?: string;
    output: AppAiStructuredOutputParseSuccess<TStructured>;
    snapshot: AppAiSessionTextAccumulatorSnapshot;
  }
  | {
    type: 'structured-output-repair-required';
    turnId?: string;
    failure: AppAiStructuredOutputParseFailure;
    repairRequest: AppAiStructuredOutputRepairRequest;
    snapshot: AppAiSessionTextAccumulatorSnapshot;
  }
  | {
    type: 'turn-completed';
    turnId?: string;
    snapshot: AppAiSessionTextAccumulatorSnapshot;
    structuredOutput?: AppAiStructuredOutputParseSuccess<TStructured>;
    runtimePart?: AppAiTextTurnFinishPart;
  }
  | {
    type: 'turn-failed';
    turnId?: string;
    error: AppAiTextTurnError;
    snapshot: AppAiSessionTextAccumulatorSnapshot;
    structuredOutputFailure?: AppAiStructuredOutputParseFailure;
    repairRequest?: AppAiStructuredOutputRepairRequest;
    runtimePart?: AppAiTextTurnErrorPart;
  }
  | {
    type: 'turn-canceled';
    turnId?: string;
    snapshot: AppAiSessionTextAccumulatorSnapshot;
  };

export async function* runAppAiTextTurn<TStructured = unknown>(
  input: AppAiTextTurnInput<TStructured>,
): AsyncIterable<AppAiTextTurnEvent<TStructured>> {
  let snapshot = createAppAiSessionTextAccumulator();
  let finishPart: AppAiTextTurnFinishPart | undefined;
  yield {
    type: 'turn-started',
    turnId: input.turnId,
    threadId: input.threadId,
  };

  try {
    const opened = await input.runtime.streamText(input.request);
    for await (const part of opened.stream) {
      switch (part.type) {
        case 'start':
          continue;
        case 'reasoning-delta':
          snapshot = appendAppAiSessionReasoningDelta(snapshot, part.text);
          yield {
            type: 'reasoning-delta',
            turnId: input.turnId,
            textDelta: part.text,
            snapshot,
            runtimePart: part,
          };
          continue;
        case 'delta':
          snapshot = appendAppAiSessionTextDelta(snapshot, part.text);
          yield {
            type: 'text-delta',
            turnId: input.turnId,
            textDelta: part.text,
            snapshot,
            runtimePart: part,
          };
          continue;
        case 'finish':
          finishPart = part;
          snapshot = completeAppAiSessionText(snapshot, {
            finishReason: part.finishReason,
            usage: part.usage,
            trace: part.trace,
          });
          break;
        case 'error':
          snapshot = failAppAiSessionText(snapshot, { error: part.error });
          yield {
            type: 'turn-failed',
            turnId: input.turnId,
            error: toAppAiTextTurnError(part.error),
            snapshot,
            runtimePart: part,
          };
          return;
        default:
          assertNever(part);
      }
    }
  } catch (error) {
    if (isAbortLikeError(error) || input.request.signal?.aborted) {
      yield {
        type: 'turn-canceled',
        turnId: input.turnId,
        snapshot,
      };
      return;
    }
    snapshot = failAppAiSessionText(snapshot, { error });
    yield {
      type: 'turn-failed',
      turnId: input.turnId,
      error: toAppAiTextTurnError(error),
      snapshot,
    };
    return;
  }

  if (snapshot.terminal !== 'completed') {
    const error = {
      code: 'STREAM_TERMINATED_WITHOUT_TERMINAL_EVENT',
      message: 'Runtime text stream ended without a terminal finish event.',
    };
    snapshot = failAppAiSessionText(snapshot, { error });
    yield {
      type: 'turn-failed',
      turnId: input.turnId,
      error,
      snapshot,
    };
    return;
  }

  const structuredOutput = input.structuredOutput;
  if (structuredOutput) {
    const structured = parseAppAiStructuredJson<TStructured>({
      raw: snapshot.text,
      validate: structuredOutput.validate,
      expect: structuredOutput.expect,
    });
    if (structured.ok) {
      yield {
        type: 'structured-output-parsed',
        turnId: input.turnId,
        output: structured,
        snapshot,
      };
      yield {
        type: 'turn-completed',
        turnId: input.turnId,
        snapshot,
        structuredOutput: structured,
        runtimePart: finishPart,
      };
      return;
    }

    const repairRequest = buildAppAiStructuredOutputRepairRequest({
      failure: structured,
      originalText: snapshot.text,
      instruction: structuredOutput.repairInstruction,
    });
    yield {
      type: 'structured-output-repair-required',
      turnId: input.turnId,
      failure: structured,
      repairRequest,
      snapshot,
    };
    if (structuredOutput.required !== false) {
      const error = {
        code: 'STRUCTURED_OUTPUT_VALIDATION_FAILED',
        message: structured.message,
        cause: structured.error,
      };
      snapshot = failAppAiSessionText(snapshot, {
        error,
        finishReason: snapshot.finishReason as NimiFinishReason | string | undefined,
        usage: snapshot.usage as NimiTokenUsage | undefined,
        trace: snapshot.trace as NimiTraceInfo | undefined,
      });
      yield {
        type: 'turn-failed',
        turnId: input.turnId,
        error,
        snapshot,
        structuredOutputFailure: structured,
        repairRequest,
      };
      return;
    }
  }

  yield {
    type: 'turn-completed',
    turnId: input.turnId,
    snapshot,
    runtimePart: finishPart,
  };
}

function toAppAiTextTurnError(error: unknown): AppAiTextTurnError {
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const code = normalizeText(record.code) || normalizeText(record.reasonCode);
    const message = normalizeText(record.message);
    if (code || message) {
      return {
        code: code || 'RUNTIME_CALL_FAILED',
        message: message || 'Runtime text stream failed.',
        cause: error,
      };
    }
  }
  if (error instanceof Error) {
    return {
      code: error.name || 'RUNTIME_CALL_FAILED',
      message: error.message || 'Runtime text stream failed.',
      cause: error,
    };
  }
  return {
    code: 'RUNTIME_CALL_FAILED',
    message: String(error || 'Runtime text stream failed.'),
    cause: error,
  };
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
  throw new Error(`Unhandled app AI text turn stream part: ${JSON.stringify(value)}`);
}

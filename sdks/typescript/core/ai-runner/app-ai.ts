import type { NimiAiModel, NimiGenerateTextResult } from '../ai';
import {
  type NimiMessage,
  type NimiRunEvent,
  type NimiUsage,
} from '../contracts';
import {
  createNimiConversationTextAccumulator,
  failNimiConversationText,
  type NimiConversationTextAccumulatorSnapshot,
} from '../../features/conversation';
import {
  type NimiStructuredJsonParseInput,
  type NimiStructuredOutputParseFailure,
  type NimiStructuredOutputParseSuccess,
  type NimiStructuredOutputRepairRequest,
} from '../../features/evaluation';
import type { NimiAiRunnerSpec } from './index';

export interface NimiAiTextRuntime {
  readonly model: NimiAiModel;
}

export interface NimiAiStructuredOutputOptions<TValue>
  extends Omit<NimiStructuredJsonParseInput<TValue>, 'raw'> {
  readonly required?: boolean;
  readonly repairInstruction?: string;
}

export interface NimiAiTextGenerateInput<TStructured = unknown> {
  readonly runner: NimiAiRunnerSpec;
  readonly runtime: NimiAiTextRuntime;
  readonly messages: readonly NimiMessage[];
  readonly structuredOutput?: NimiAiStructuredOutputOptions<TStructured>;
}

export interface NimiAiTextGenerateSuccess<TStructured = unknown> {
  readonly ok: true;
  readonly text: string;
  readonly result: NimiGenerateTextResult;
  readonly structuredOutput?: NimiStructuredOutputParseSuccess<TStructured>;
  readonly structuredOutputFailure?: NimiStructuredOutputParseFailure;
  readonly repairRequest?: NimiStructuredOutputRepairRequest;
}

export interface NimiAiTextGenerateFailure {
  readonly ok: false;
  readonly error: NimiAiTextError;
  readonly result?: NimiGenerateTextResult;
  readonly structuredOutputFailure?: NimiStructuredOutputParseFailure;
  readonly repairRequest?: NimiStructuredOutputRepairRequest;
  readonly canceled?: boolean;
}

export type NimiAiTextGenerateResult<TStructured = unknown> =
  | NimiAiTextGenerateSuccess<TStructured>
  | NimiAiTextGenerateFailure;

export interface NimiAiTextTurnInput<TStructured = unknown>
  extends NimiAiTextGenerateInput<TStructured> {
  readonly turnId?: string;
  readonly threadId?: string;
  readonly signal?: AbortSignal;
}

export interface NimiAiTextError {
  readonly code: string;
  readonly message: string;
  readonly cause?: unknown;
}

export type NimiAiTextTurnEvent<TStructured = unknown> =
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
    readonly error: NimiAiTextError;
    readonly snapshot: NimiConversationTextAccumulatorSnapshot;
    readonly structuredOutputFailure?: NimiStructuredOutputParseFailure;
    readonly repairRequest?: NimiStructuredOutputRepairRequest;
  }
  | { readonly type: 'turn-canceled'; readonly turnId?: string; readonly snapshot: NimiConversationTextAccumulatorSnapshot };

export interface NimiAiTextStreamResponseResult {
  readonly text: string;
  readonly finishReason?: string;
  readonly usage?: NimiUsage;
}

export interface NimiAiTextStreamHandlers {
  readonly onDelta?: (text: string, event: Extract<NimiAiTextTurnEvent, { readonly type: 'text-delta' }>) => void | Promise<void>;
  readonly onSnapshot?: (snapshot: NimiConversationTextAccumulatorSnapshot) => void | Promise<void>;
  readonly onFinish?: (result: NimiAiTextStreamResponseResult) => void | Promise<void>;
  readonly onError?: (error: NimiAiTextError) => void | Promise<void>;
}

export async function runNimiAiTextGenerate<TStructured = unknown>(
  _input: NimiAiTextGenerateInput<TStructured>,
): Promise<NimiAiTextGenerateResult<TStructured>> {
  return {
    ok: false,
    error: runtimeParticipationRequiredError(),
  };
}

export async function* runNimiAiTextTurn<TStructured = unknown>(
  input: NimiAiTextTurnInput<TStructured>,
): AsyncIterable<NimiAiTextTurnEvent<TStructured>> {
  let snapshot = createNimiConversationTextAccumulator();
  yield { type: 'turn-started', turnId: input.turnId, threadId: input.threadId };

  if (input.signal?.aborted) {
    yield { type: 'turn-canceled', turnId: input.turnId, snapshot };
    return;
  }
  const error = runtimeParticipationRequiredError();
  snapshot = failNimiConversationText(snapshot, { error });
  yield { type: 'turn-failed', turnId: input.turnId, error, snapshot };
}

export async function streamNimiAiTextResponse(
  input: NimiAiTextTurnInput,
  handlers: NimiAiTextStreamHandlers = {},
): Promise<NimiAiTextStreamResponseResult> {
  for await (const event of runNimiAiTextTurn(input)) {
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
  throw new Error('AI runner text stream ended without a terminal event');
}

function toError(error: NimiAiTextError): Error {
  const next = new Error(error.message);
  next.name = error.code;
  return next;
}

function runtimeParticipationRequiredError(): NimiAiTextError {
  return {
    code: 'SDK_RUNTIME_AGENT_PARTICIPATION_REQUIRED',
    message: 'AI runner text execution must run through Runtime Agent participation authority.',
  };
}

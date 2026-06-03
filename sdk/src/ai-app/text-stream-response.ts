import type {
  Runtime,
  TextStreamInput,
  TextStreamPart,
} from '../runtime/index.js';
import {
  runAppAiTextTurn,
  type AppAiTextTurnRuntime,
} from './text-turn.js';

export type AppAiTextStreamDeltaPart = Extract<TextStreamPart, { type: 'delta' }>;
export type AppAiTextStreamFinishPart = Extract<TextStreamPart, { type: 'finish' }>;
export type AppAiTextStreamErrorPart = Extract<TextStreamPart, { type: 'error' }>;

export type AppAiTextStreamResponseRuntime =
  | Runtime
  | AppAiTextTurnRuntime;

export type AppAiTextStreamResponseResult = {
  text: string;
  finish: AppAiTextStreamFinishPart | null;
};

export type AppAiTextStreamResponseSnapshot = AppAiTextStreamResponseResult;

export type AppAiTextStreamResponseHandlers = {
  onDelta?: (text: string, part: AppAiTextStreamDeltaPart) => void;
  onSnapshot?: (
    snapshot: AppAiTextStreamResponseSnapshot,
    part: AppAiTextStreamDeltaPart,
  ) => void;
  onFinish?: (
    result: AppAiTextStreamResponseResult,
    part: AppAiTextStreamFinishPart | null,
  ) => void;
  onError?: (error: Error, part: AppAiTextStreamErrorPart | null) => void;
};

export async function streamAppAiTextResponse(
  runtime: AppAiTextStreamResponseRuntime,
  request: TextStreamInput,
  handlers: AppAiTextStreamResponseHandlers = {},
): Promise<AppAiTextStreamResponseResult> {
  for await (const event of runAppAiTextTurn({
    runtime: toAppAiTextTurnRuntime(runtime),
    request,
  })) {
    switch (event.type) {
      case 'turn-started':
      case 'reasoning-delta':
      case 'structured-output-parsed':
      case 'structured-output-repair-required':
        break;
      case 'text-delta':
        handlers.onDelta?.(event.textDelta, event.runtimePart);
        handlers.onSnapshot?.({
          text: event.snapshot.text,
          finish: null,
        }, event.runtimePart);
        break;
      case 'turn-completed': {
        if (!event.runtimePart) {
          throw new Error('app AI text stream completed without a Runtime finish part');
        }
        const result = {
          text: event.snapshot.text,
          finish: event.runtimePart,
        };
        handlers.onFinish?.(result, event.runtimePart);
        return result;
      }
      case 'turn-failed': {
        const error = toAppAiTextStreamResponseError(
          event.runtimePart?.error
            || (event.error.cause instanceof Error ? event.error.cause : event.error.message),
        );
        handlers.onError?.(error, event.runtimePart ?? null);
        throw error;
      }
      case 'turn-canceled':
        throw createAbortError();
      default:
        assertNever(event);
    }
  }
  throw new Error('app AI text stream ended without a terminal event');
}

function toAppAiTextTurnRuntime(
  runtime: AppAiTextStreamResponseRuntime,
): AppAiTextTurnRuntime {
  if (isAppAiTextTurnRuntime(runtime)) {
    return runtime;
  }
  return {
    streamText: (request) => runtime.ai.text.stream(request),
  };
}

function isAppAiTextTurnRuntime(
  runtime: AppAiTextStreamResponseRuntime,
): runtime is AppAiTextTurnRuntime {
  return 'streamText' in runtime && typeof runtime.streamText === 'function';
}

function toAppAiTextStreamResponseError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error || 'app AI text stream failed'));
}

function createAbortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled app AI text stream event: ${JSON.stringify(value)}`);
}

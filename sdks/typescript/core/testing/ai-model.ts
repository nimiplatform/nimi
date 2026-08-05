import type {
  NimiAiModel,
  NimiGenerateTextRequest,
  NimiGenerateTextResult,
} from '../ai/index.js';
import type { NimiRunEvent } from '../contracts/index.js';
import { ReasonCode, createNimiError } from '../../types/index.js';
import type {
  NimiTestingHarness,
  NimiTestingHostFailure,
  NimiTestingHostStream,
  NimiTestingStreamMethod,
  NimiTestingUnaryMethod,
} from './host-types.js';

export const NIMI_TESTING_AI_GENERATE_TEXT_METHOD = 'nimi.ai.generateText' as const;
export const NIMI_TESTING_AI_STREAM_TEXT_METHOD = 'nimi.ai.streamText' as const;
export const NIMI_TESTING_STREAM_MAX_BUFFERED_ITEMS = 1024;

export interface NimiTestingAiMethodMap {
  readonly [NIMI_TESTING_AI_GENERATE_TEXT_METHOD]: NimiTestingUnaryMethod<
    NimiGenerateTextRequest,
    NimiGenerateTextResult
  >;
  readonly [NIMI_TESTING_AI_STREAM_TEXT_METHOD]: NimiTestingStreamMethod<
    NimiGenerateTextRequest,
    NimiRunEvent
  >;
}

export const NIMI_TESTING_AI_METHODS = Object.freeze([
  Object.freeze({ id: NIMI_TESTING_AI_GENERATE_TEXT_METHOD, kind: 'unary' as const }),
  Object.freeze({ id: NIMI_TESTING_AI_STREAM_TEXT_METHOD, kind: 'stream' as const }),
]);

export interface CreateNimiTestingAiModelInput {
  readonly harness: NimiTestingHarness<NimiTestingAiMethodMap>;
}

const TESTING_TEXT_GENERATION_CAPABILITY = Object.freeze({
  modelId: 'text.generate' as const,
});

export function createNimiTestingAiModel(input: CreateNimiTestingAiModelInput): NimiAiModel {
  const model = TESTING_TEXT_GENERATION_CAPABILITY;
  return Object.freeze({
    model,
    async generateText(request: NimiGenerateTextRequest): Promise<NimiGenerateTextResult> {
      assertNoRequestExecutionSelection(request);
      const result = await input.harness.invoke(
        NIMI_TESTING_AI_GENERATE_TEXT_METHOD,
        request,
        { signal: request.signal },
      );
      if (!result.ok) throw input.harness.projectFailure(
        NIMI_TESTING_AI_GENERATE_TEXT_METHOD,
        result.error,
      );
      return result.value;
    },
    async streamText(request: NimiGenerateTextRequest): Promise<AsyncIterable<NimiRunEvent>> {
      assertNoRequestExecutionSelection(request);
      const result = await input.harness.openStream(
        NIMI_TESTING_AI_STREAM_TEXT_METHOD,
        request,
        { signal: request.signal },
      );
      if (!result.ok) throw input.harness.projectFailure(
        NIMI_TESTING_AI_STREAM_TEXT_METHOD,
        result.error,
      );
      return iterateHostStream(input.harness, result.value);
    },
  });
}

async function* iterateHostStream(
  harness: NimiTestingHarness<NimiTestingAiMethodMap>,
  stream: NimiTestingHostStream<NimiRunEvent>,
): AsyncIterable<NimiRunEvent> {
  const items: NimiRunEvent[] = [];
  let wake: (() => void) | null = null;
  let terminal: 'pending' | 'completed' | 'cancelled' | 'failed' = 'pending';
  let failure: NimiTestingHostFailure | null = null;
  let naturalTerminal = false;
  const readTerminal = (): typeof terminal => terminal;

  const attached = stream.attach((item) => {
    if (terminal !== 'pending') return;
    if (items.length >= NIMI_TESTING_STREAM_MAX_BUFFERED_ITEMS) {
      terminal = 'failed';
      failure = { disposition: 'resource-exhausted' };
      void stream.cancel('caller');
    } else {
      items.push(item);
    }
    wake?.();
  });
  if (!attached.ok) throw harness.projectFailure(NIMI_TESTING_AI_STREAM_TEXT_METHOD, attached.error);

  void stream.completion.then((result) => {
    if (terminal !== 'pending') return;
    if (!result.ok) {
      terminal = 'failed';
      failure = result.error;
    } else if (result.value.state === 'completed') {
      terminal = 'completed';
    } else if (result.value.reason === 'abort') {
      terminal = 'failed';
      failure = { disposition: 'aborted' };
    } else {
      terminal = 'cancelled';
    }
    wake?.();
  });

  try {
    while (true) {
      while (items.length > 0) yield items.shift() as NimiRunEvent;
      const currentTerminal = readTerminal();
      if (currentTerminal === 'failed') {
        throw harness.projectFailure(
          NIMI_TESTING_AI_STREAM_TEXT_METHOD,
          failure ?? { disposition: 'internal' },
        );
      }
      if (currentTerminal === 'completed' || currentTerminal === 'cancelled') {
        naturalTerminal = true;
        return;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = null;
    }
  } finally {
    wake = null;
    if (!naturalTerminal && readTerminal() === 'pending') {
      const cancelled = await stream.cancel('caller');
      if (!cancelled.ok) {
        throw harness.projectFailure(NIMI_TESTING_AI_STREAM_TEXT_METHOD, cancelled.error);
      }
    }
  }
}

function assertNoRequestExecutionSelection(request: NimiGenerateTextRequest): void {
  for (const field of ['model', 'modelId', 'route', 'routePolicy', 'connectorId', 'targetRef', 'fallbackPolicy']) {
    if (Object.hasOwn(request, field)) {
      throwAiInputError(`Testing AI request cannot provide ${field}`);
    }
  }
}

function throwAiInputError(message: string): never {
  throw createNimiError({
    message,
    code: ReasonCode.SDK_AI_INPUT_INVALID,
    reasonCode: ReasonCode.SDK_AI_INPUT_INVALID,
    actionHint: 'use_the_model_bound_to_the_sdk_facade',
    source: 'sdk',
  });
}


import { vi } from 'vitest';
import type {
  NimiGenerateTextResult,
  NimiRunEvent,
  Runtime,
} from '@nimiplatform/kit/core/sdk-contract';

type RuntimeAI = Runtime['ai'];
type ExecuteScenarioRequest = Parameters<RuntimeAI['executeScenario']>[0];
type ExecuteScenarioOptions = Parameters<RuntimeAI['executeScenario']>[1];
type ExecuteScenarioResponse = Awaited<ReturnType<RuntimeAI['executeScenario']>>;
type StreamScenarioRequest = Parameters<RuntimeAI['streamScenario']>[0];
type StreamScenarioOptions = Parameters<RuntimeAI['streamScenario']>[1];
type AsyncIterableValue<T> = T extends AsyncIterable<infer TValue> ? TValue : never;
type NimiUsage = Extract<NimiRunEvent, { readonly type: 'done' }>['usage'];
type NimiFinishReason = Extract<NimiRunEvent, { readonly type: 'done' }>['finishReason'];
export type RuntimeScenarioStreamEvent = AsyncIterableValue<ReturnType<RuntimeAI['streamScenario']>>;

const ROUTE_POLICY = {
  UNSPECIFIED: 0,
  LOCAL: 1,
  CLOUD: 2,
} as const;

const FINISH_REASON = {
  STOP: 1,
  LENGTH: 2,
  ERROR: 5,
} as const;

const STREAM_EVENT = {
  STARTED: 1,
  DELTA: 2,
  USAGE: 5,
  COMPLETED: 6,
  FAILED: 7,
} as const;

export type RuntimeAiTestRuntimeOptions = {
  readonly generate?: Partial<NimiGenerateTextResult>;
  readonly streamEvents?: readonly NimiRunEvent[];
  readonly streamScenario?: (request: StreamScenarioRequest) => AsyncIterable<RuntimeScenarioStreamEvent>;
};

export function createRuntimeAiTestRuntime(options: RuntimeAiTestRuntimeOptions = {}) {
  const executeScenario = vi.fn(async (
    _request: ExecuteScenarioRequest,
    _options?: ExecuteScenarioOptions,
  ): Promise<ExecuteScenarioResponse> => {
    const result = options.generate ?? {};
    return {
      output: {
        output: {
          oneofKind: 'textGenerate',
          textGenerate: {
            text: result.text ?? 'Generated reply',
            toolCalls: [],
            toolResults: [],
            toolApprovalRequests: [],
            sources: [],
            rawChunks: [],
          },
        },
      },
      finishReason: toRuntimeFinishReason(result.finishReason),
      usage: toRuntimeUsage(result.usage ?? { promptTokens: 1, completionTokens: 2, totalTokens: 3 }),
      routeDecision: ROUTE_POLICY.CLOUD,
      modelResolved: 'openai/gpt-4.1',
      traceId: 'trace-1',
      ignoredExtensions: [],
    };
  });
  const streamScenario = vi.fn((
    request: StreamScenarioRequest,
    _options?: StreamScenarioOptions,
  ): AsyncIterable<RuntimeScenarioStreamEvent> => {
    if (options.streamScenario) {
      return options.streamScenario(request);
    }
    return runtimeScenarioStreamFromNimiEvents(options.streamEvents ?? []);
  });
  const runtime = {
    ai: {
      executeScenario,
      streamScenario,
    },
  } as unknown as Runtime;

  return {
    runtime,
    executeScenario,
    streamScenario,
  };
}

export async function* runtimeScenarioStreamFromNimiEvents(
  events: readonly NimiRunEvent[],
): AsyncIterable<RuntimeScenarioStreamEvent> {
  let sequence = 1;
  for (const event of events) {
    yield toRuntimeScenarioStreamEvent(event, sequence);
    sequence += 1;
  }
}

export function runtimeTextDeltaEvent(text: string, sequence = 1): RuntimeScenarioStreamEvent {
  return toRuntimeScenarioStreamEvent({ type: 'text-delta', text }, sequence);
}

export function runtimeDoneEvent(
  input: {
    readonly finishReason?: NimiFinishReason;
    readonly usage?: NimiUsage;
  } = {},
  sequence = 1,
): RuntimeScenarioStreamEvent {
  return toRuntimeScenarioStreamEvent({
    type: 'done',
    finishReason: input.finishReason ?? 'stop',
    usage: input.usage,
  }, sequence);
}

function toRuntimeScenarioStreamEvent(event: NimiRunEvent, sequence: number): RuntimeScenarioStreamEvent {
  switch (event.type) {
    case 'start':
      return {
        eventType: STREAM_EVENT.STARTED,
        sequence: String(sequence),
        traceId: event.traceId ?? '',
        payload: {
          oneofKind: 'started',
          started: {
            modelResolved: event.model?.modelId ?? '',
            routeDecision: ROUTE_POLICY.CLOUD,
          },
        },
      };
    case 'reasoning-delta':
      return {
        eventType: STREAM_EVENT.DELTA,
        sequence: String(sequence),
        traceId: '',
        payload: {
          oneofKind: 'delta',
          delta: {
            delta: {
              oneofKind: 'reasoning',
              reasoning: { text: event.text },
            },
          },
        },
      };
    case 'text-delta':
      return {
        eventType: STREAM_EVENT.DELTA,
        sequence: String(sequence),
        traceId: '',
        payload: {
          oneofKind: 'delta',
          delta: {
            delta: {
              oneofKind: 'text',
              text: { text: event.text },
            },
          },
        },
      };
    case 'artifact':
      return {
        eventType: STREAM_EVENT.DELTA,
        sequence: String(sequence),
        traceId: '',
        payload: {
          oneofKind: 'delta',
          delta: {
            delta: {
              oneofKind: 'artifact',
              artifact: { chunk: event.chunk, mimeType: event.mimeType },
            },
          },
        },
      };
    case 'done':
      return {
        eventType: STREAM_EVENT.COMPLETED,
        sequence: String(sequence),
        traceId: '',
        payload: {
          oneofKind: 'completed',
          completed: {
            finishReason: toRuntimeFinishReason(event.finishReason),
            usage: toRuntimeUsage(event.usage),
            streamSimulated: false,
          },
        },
      };
    case 'error':
      return {
        eventType: STREAM_EVENT.FAILED,
        sequence: String(sequence),
        traceId: '',
        payload: {
          oneofKind: 'failed',
          failed: {
            reasonCode: 0,
            actionHint: event.message,
          },
        },
      };
    case 'tool-call':
    case 'tool-result':
    case 'tool-approval-request':
    case 'source':
    case 'raw':
    case 'trace':
    case 'warning':
      throw new Error(`Runtime AI test helper does not project ${event.type} events yet.`);
  }
}

function toRuntimeFinishReason(reason: NimiGenerateTextResult['finishReason'] | undefined): number {
  switch (reason) {
    case 'length':
      return FINISH_REASON.LENGTH;
    case 'error':
      return FINISH_REASON.ERROR;
    case 'stop':
    case 'tool-calls':
    case 'content-filter':
    case 'unknown':
    case undefined:
      return FINISH_REASON.STOP;
  }
}

function toRuntimeUsage(usage: NimiUsage | undefined) {
  return {
    inputTokens: String(usage?.promptTokens ?? 0),
    outputTokens: String(usage?.completionTokens ?? 0),
    computeMs: '0',
    cachedInputTokens: String(usage?.cachedInputTokens ?? 0),
    reasoningOutputTokens: String(usage?.reasoningOutputTokens ?? 0),
  };
}

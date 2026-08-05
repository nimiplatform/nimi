import { collectNimiTextStream, type NimiAiModel, type NimiGenerateTextRequest, type NimiGenerateTextResult } from '../ai';
import {
  assertNimiCapability,
  textPart,
  type NimiCapabilityManifest,
  type NimiCapabilitySupport,
  type NimiFinishReason,
  type NimiJsonObject,
  type NimiJsonValue,
  type NimiRunEvent,
  type NimiToolCall,
  type NimiUsage,
} from '../contracts';

export { createNimiTestingAiModel } from './ai-model.js';
export {
  NIMI_TESTING_AI_GENERATE_TEXT_METHOD,
  NIMI_TESTING_AI_METHODS,
  NIMI_TESTING_AI_STREAM_TEXT_METHOD,
  NIMI_TESTING_STREAM_MAX_BUFFERED_ITEMS,
} from './ai-model.js';
export type {
  CreateNimiTestingAiModelInput,
  NimiTestingAiMethodMap,
} from './ai-model.js';
export { createNimiTestingHarness } from './host-harness.js';
export { createNimiTestingHostError } from './host-errors.js';
export { NIMI_TESTING_HOST_FAILURE_DISPOSITIONS } from './host-types.js';
export type {
  CreateNimiTestingHarnessInput,
  NimiTestingCallControl,
  NimiTestingHarness,
  NimiTestingHostFailure,
  NimiTestingHostFailureDisposition,
  NimiTestingHostPort,
  NimiTestingHostResult,
  NimiTestingHostStream,
  NimiTestingHostStreamTerminal,
  NimiTestingMethodDeclaration,
  NimiTestingMethodItem,
  NimiTestingMethodRequest,
  NimiTestingMethodResult,
  NimiTestingStreamCancelReason,
  NimiTestingStreamMethod,
  NimiTestingStreamMethodId,
  NimiTestingUnaryMethod,
  NimiTestingUnaryMethodId,
} from './host-types.js';

export interface NimiMockModelOptions {
  readonly text?: string;
  readonly finishReason?: NimiFinishReason;
  readonly usage?: NimiUsage;
  readonly toolCalls?: readonly NimiToolCall[];
  readonly warnings?: readonly { readonly code: string; readonly message: string }[];
  readonly raw?: NimiJsonValue;
  readonly streamEvents?: readonly NimiRunEvent[];
  readonly onGenerateText?: (request: NimiGenerateTextRequest) => NimiGenerateTextResult | Promise<NimiGenerateTextResult>;
}

export interface NimiMockRuntimeCall {
  readonly operation: string;
  readonly input: NimiJsonValue;
}

export interface NimiMockRuntime {
  readonly calls: readonly NimiMockRuntimeCall[];
  invoke(operation: string, input: NimiJsonValue): Promise<NimiJsonValue>;
}

export function createNimiToolCall(
  name: string,
  args: NimiJsonValue,
  id = `toolcall_${name}`,
): NimiToolCall {
  return {
    id,
    name,
    arguments: args,
  };
}

export async function* createNimiStreamSimulator(events: readonly NimiRunEvent[]): AsyncIterable<NimiRunEvent> {
  for (const event of events) {
    yield event;
  }
}

export function createNimiMockModel(options: NimiMockModelOptions = {}): NimiAiModel {
  const model = Object.freeze({ modelId: 'text.generate' as const });
  const finishReason = options.finishReason ?? (options.toolCalls && options.toolCalls.length > 0 ? 'tool-calls' : 'stop');

  return {
    model,
    async generateText(request) {
      if (options.onGenerateText) {
        return options.onGenerateText(request);
      }
      return {
        text: options.text ?? '',
        finishReason,
        usage: options.usage,
        toolCalls: options.toolCalls,
        warnings: options.warnings,
        raw: options.raw,
      };
    },
    streamText() {
      const events =
        options.streamEvents ??
        ([
          { type: 'start', model },
          ...(options.text ? [{ type: 'text-delta', text: options.text } as const] : []),
          ...(options.toolCalls ?? []).map((toolCall) => ({ type: 'tool-call', toolCall }) as const),
          { type: 'done', finishReason, usage: options.usage },
        ] satisfies readonly NimiRunEvent[]);
      return createNimiStreamSimulator(events);
    },
  };
}

export function createNimiMockRuntime(handler?: (operation: string, input: NimiJsonValue) => NimiJsonValue | Promise<NimiJsonValue>): NimiMockRuntime {
  const calls: NimiMockRuntimeCall[] = [];
  return {
    calls,
    async invoke(operation, input) {
      calls.push({ operation, input });
      return handler ? handler(operation, input) : { operation, input };
    },
  };
}

export async function collectMockModelStream(model: NimiAiModel, request: NimiGenerateTextRequest): Promise<NimiGenerateTextResult> {
  if (!model.streamText) {
    throw new Error(`mock model ${model.model.modelId} does not support streaming`);
  }
  return collectNimiTextStream(await model.streamText(request));
}

export function assertNimiEventOrder(events: readonly NimiRunEvent[], expectedTypes: readonly NimiRunEvent['type'][]): void {
  const actual = events.map((event) => event.type);
  if (actual.length !== expectedTypes.length
    || actual.some((type, index) => type !== expectedTypes[index])) {
    throw new Error(`Nimi event order mismatch: expected ${JSON.stringify(expectedTypes)}, got ${JSON.stringify(actual)}`);
  }
}

export function assertNimiCapabilitySupported(
  manifest: NimiCapabilityManifest,
  capability: string,
  expected: NimiCapabilitySupport = 'supported',
): void {
  assertNimiCapability(manifest, capability, expected);
}

export function assertNimiOutputSchema(value: NimiJsonValue, schema: NimiJsonObject): void {
  const expectedType = schema.type;
  if (typeof expectedType === 'string') {
    assertJsonType(value, expectedType);
  }

  const required = schema.required;
  if (Array.isArray(required)) {
    assertCondition(isJsonObject(value), 'required fields need an object output');
    for (const field of required) {
      assertCondition(typeof field === 'string', 'required field names must be strings');
      assertCondition(Object.hasOwn(value as Record<string, unknown>, field), `missing required output field ${field}`);
    }
  }
}

export function userTextMessage(text: string) {
  return {
    role: 'user' as const,
    content: [textPart(text)],
  };
}

function assertJsonType(value: NimiJsonValue, expectedType: string): void {
  if (expectedType === 'array') {
    assertCondition(Array.isArray(value), 'expected array output');
    return;
  }
  if (expectedType === 'object') {
    assertCondition(isJsonObject(value), 'expected object output');
    return;
  }
  assertCondition(typeof value === expectedType, `expected ${expectedType} output`);
}

function assertCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isJsonObject(value: NimiJsonValue): value is NimiJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

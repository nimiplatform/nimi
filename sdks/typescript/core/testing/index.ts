import assert from 'node:assert/strict';

import { collectNimiTextStream, type NimiAiModel, type NimiGenerateTextRequest, type NimiGenerateTextResult } from '../ai';
import {
  assertNimiCapability,
  textPart,
  type NimiCapabilityManifest,
  type NimiCapabilityStatus,
  type NimiFinishReason,
  type NimiJsonObject,
  type NimiJsonValue,
  type NimiModelRef,
  type NimiRunEvent,
  type NimiToolCall,
  type NimiUsage,
} from '../contracts';

export interface NimiMockModelOptions {
  readonly model?: NimiModelRef;
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
  const model = options.model ?? { providerId: 'test', modelId: 'nimi-mock-model' };
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
  assert.deepEqual(
    events.map((event) => event.type),
    expectedTypes,
  );
}

export function assertNimiCapabilitySupported(
  manifest: NimiCapabilityManifest,
  capability: string,
  expected: NimiCapabilityStatus = 'supported',
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
    assert.equal(isJsonObject(value), true, 'required fields need an object output');
    for (const field of required) {
      assert.equal(typeof field, 'string', 'required field names must be strings');
      assert.equal(Object.hasOwn(value as Record<string, unknown>, field), true, `missing required output field ${field}`);
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
    assert.equal(Array.isArray(value), true, 'expected array output');
    return;
  }
  if (expectedType === 'object') {
    assert.equal(isJsonObject(value), true, 'expected object output');
    return;
  }
  assert.equal(typeof value, expectedType, `expected ${expectedType} output`);
}

function isJsonObject(value: NimiJsonValue): value is NimiJsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { collectNimiTextStream, type NimiAiModel } from '../ai';
import type { NimiGenerateTextRequest } from '../ai';
import {
  NIMI_TESTING_AI_METHODS,
  NIMI_TESTING_HOST_FAILURE_DISPOSITIONS,
  NIMI_TESTING_STREAM_MAX_BUFFERED_ITEMS,
  createNimiTestingAiModel,
  createNimiTestingHarness,
  type NimiTestingAiMethodMap,
  type NimiTestingHostFailureDisposition,
  type NimiTestingHostPort,
  type NimiTestingHostResult,
  type NimiTestingHostStream,
} from '.';
import type { NimiRunEvent } from '../contracts';

const MODEL = Object.freeze({ providerId: 'fixture', modelId: 'fixture-model' });
const REQUEST: NimiGenerateTextRequest = Object.freeze({ model: MODEL, messages: [] });

test('testing harness creates the existing NimiAiModel facade with per-instance isolation', async () => {
  const callsA: string[] = [];
  const callsB: string[] = [];
  const modelA: NimiAiModel = createNimiTestingAiModel({
    model: MODEL,
    harness: createHarness(successPort('A', callsA), 'a'.repeat(64)),
  });
  const modelB: NimiAiModel = createNimiTestingAiModel({
    model: MODEL,
    harness: createHarness(successPort('B', callsB), 'b'.repeat(64)),
  });

  assert.equal((await modelA.generateText(REQUEST)).text, 'A');
  assert.equal((await modelB.generateText(REQUEST)).text, 'B');
  assert.deepEqual(callsA, ['nimi.ai.generateText']);
  assert.deepEqual(callsB, ['nimi.ai.generateText']);

  const streamed = await collectNimiTextStream(await modelA.streamText?.(REQUEST) as AsyncIterable<never>);
  assert.equal(streamed.text, 'A-stream');
  assert.deepEqual(callsA, ['nimi.ai.generateText', 'nimi.ai.streamText']);
  assert.deepEqual(callsB, ['nimi.ai.generateText']);
});

test('every host disposition maps to a fixed host-neutral NimiError', () => {
  const expectedCodes: Record<NimiTestingHostFailureDisposition, string> = {
    unsupported: 'SDK_HOST_UNSUPPORTED',
    'capability-denied': 'SDK_HOST_CAPABILITY_DENIED',
    'resource-exhausted': 'SDK_HOST_RESOURCE_EXHAUSTED',
    'invalid-input': 'SDK_INVALID_INPUT',
    'host-unavailable': 'SDK_HOST_UNAVAILABLE',
    'effect-forbidden': 'SDK_HOST_EFFECT_FORBIDDEN',
    internal: 'SDK_HOST_INTERNAL',
    aborted: 'OPERATION_ABORTED',
  };
  for (const disposition of NIMI_TESTING_HOST_FAILURE_DISPOSITIONS) {
    const harness = createHarness(successPort('unused', []), 'c'.repeat(64));
    const error = harness.projectFailure('nimi.ai.generateText', { disposition });
    assert.equal(error.code, expectedCodes[disposition]);
    assert.equal(error.reasonCode, expectedCodes[disposition]);
    assert.equal(error.source, 'sdk');
    assert.equal(error.retryable, false);
    assert.deepEqual(error.details, { methodId: 'nimi.ai.generateText', disposition });
    assert.match(error.traceId, /^sdk_host_[a-f0-9]{32}$/u);
    assert.equal(JSON.stringify(error.details).includes('instance'), false);
  }

  const first = createHarness(successPort('unused', []), 'd'.repeat(64));
  const second = createHarness(successPort('unused', []), 'd'.repeat(64));
  assert.equal(
    first.projectFailure('nimi.ai.generateText', { disposition: 'unsupported' }).traceId,
    second.projectFailure('nimi.ai.generateText', { disposition: 'unsupported' }).traceId,
  );
  assert.notEqual(
    first.projectFailure('nimi.ai.generateText', { disposition: 'unsupported' }).traceId,
    second.projectFailure('nimi.ai.streamText', { disposition: 'unsupported' }).traceId,
  );
});

test('provider rejection and rejected stream completion fail closed without raw error leakage', async () => {
  const rejectingPort: NimiTestingHostPort<NimiTestingAiMethodMap> = {
    async invoke() {
      throw new Error('private provider detail');
    },
    async openStream() {
      return ok({
        attach: () => ok({ attached: true }),
        completion: Promise.reject(new Error('private stream detail')),
        cancel: async () => ok({ cancelled: true }),
      });
    },
  };
  const model = createNimiTestingAiModel({
    model: MODEL,
    harness: createHarness(rejectingPort, 'e'.repeat(64)),
  });

  await assert.rejects(
    model.generateText(REQUEST),
    (error: unknown) => assertHostError(error, 'SDK_HOST_INTERNAL', 'private provider detail'),
  );
  const stream = await model.streamText?.(REQUEST);
  await assert.rejects(
    collectNimiTextStream(stream as AsyncIterable<never>),
    (error: unknown) => assertHostError(error, 'SDK_HOST_INTERNAL', 'private stream detail'),
  );
});

test('pre-aborted calls never enter the host port', async () => {
  const calls: string[] = [];
  const model = createNimiTestingAiModel({
    model: MODEL,
    harness: createHarness(successPort('unused', calls), 'f'.repeat(64)),
  });
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    model.generateText({ ...REQUEST, signal: controller.signal }),
    (error: unknown) => assertHostError(error, 'OPERATION_ABORTED', ''),
  );
  assert.deepEqual(calls, []);
});

test('host result, stream, and call-control envelopes are exact and fail closed', async () => {
  const extendedResultPort: NimiTestingHostPort<NimiTestingAiMethodMap> = {
    async invoke() {
      return {
        ok: true,
        value: { text: 'not admitted', finishReason: 'stop' },
        extension: true,
      } as unknown as NimiTestingHostResult<{ readonly text: string; readonly finishReason: 'stop' }>;
    },
    async openStream() {
      return ok({
        ...completedStream<NimiRunEvent>([]),
        extension: true,
      } as unknown as NimiTestingHostStream<NimiRunEvent>);
    },
  };
  const harness = createHarness(extendedResultPort, '1'.repeat(64));

  assert.deepEqual(
    await harness.invoke('nimi.ai.generateText', REQUEST),
    { ok: false, error: { disposition: 'internal' } },
  );
  assert.deepEqual(
    await harness.openStream('nimi.ai.streamText', REQUEST),
    { ok: false, error: { disposition: 'internal' } },
  );
  assert.deepEqual(
    await harness.invoke('nimi.ai.generateText', REQUEST, null as never),
    { ok: false, error: { disposition: 'invalid-input' } },
  );
});

test('stream wrapper owns single attach, single cancellation, terminal order, and item cutoff', async () => {
  let observer: ((item: NimiRunEvent) => void) | null = null;
  let resolveCompletion: (
    result: NimiTestingHostResult<{ readonly state: 'cancelled'; readonly reason: 'caller' }>,
  ) => void = () => undefined;
  const completion = new Promise<
    NimiTestingHostResult<{ readonly state: 'cancelled'; readonly reason: 'caller' }>
  >((resolve) => {
    resolveCompletion = resolve;
  });
  const cancelReasons: string[] = [];
  const source: NimiTestingHostStream<NimiRunEvent> = {
    attach(next) {
      observer = next;
      return ok({ attached: true });
    },
    completion,
    async cancel(reason) {
      cancelReasons.push(reason);
      return ok({ cancelled: true });
    },
  };
  const harness = createHarness(streamPort(source), '2'.repeat(64));
  const opened = await harness.openStream('nimi.ai.streamText', REQUEST);
  assert.equal(opened.ok, true);
  if (!opened.ok) return;

  const items: NimiRunEvent[] = [];
  assert.deepEqual(opened.value.attach((item) => items.push(item)), {
    ok: true,
    value: { attached: true },
  });
  assert.deepEqual(opened.value.attach(() => undefined), {
    ok: false,
    error: { disposition: 'internal' },
  });
  observer?.({ type: 'text-delta', text: 'before-terminal' });
  assert.deepEqual(await opened.value.cancel('caller'), {
    ok: true,
    value: { cancelled: true },
  });
  assert.deepEqual(await opened.value.cancel('caller'), {
    ok: true,
    value: { cancelled: false },
  });
  assert.deepEqual(cancelReasons, ['caller']);

  resolveCompletion(ok({ state: 'cancelled', reason: 'caller' }));
  assert.deepEqual(await opened.value.completion, {
    ok: true,
    value: { state: 'cancelled', reason: 'caller' },
  });
  observer?.({ type: 'text-delta', text: 'after-terminal' });
  assert.deepEqual(items, [{ type: 'text-delta', text: 'before-terminal' }]);
});

test('post-open abort cancels the owned stream once and settles through the host terminal', async () => {
  const controller = new AbortController();
  let resolveCompletion: (
    result: NimiTestingHostResult<{ readonly state: 'cancelled'; readonly reason: 'abort' }>,
  ) => void = () => undefined;
  const completion = new Promise<
    NimiTestingHostResult<{ readonly state: 'cancelled'; readonly reason: 'abort' }>
  >((resolve) => {
    resolveCompletion = resolve;
  });
  const cancelReasons: string[] = [];
  const source: NimiTestingHostStream<NimiRunEvent> = {
    attach: () => ok({ attached: true }),
    completion,
    async cancel(reason) {
      cancelReasons.push(reason);
      resolveCompletion(ok({ state: 'cancelled', reason: 'abort' }));
      return ok({ cancelled: true });
    },
  };
  const harness = createHarness(streamPort(source), '3'.repeat(64));
  const opened = await harness.openStream(
    'nimi.ai.streamText',
    REQUEST,
    { signal: controller.signal },
  );
  assert.equal(opened.ok, true);
  if (!opened.ok) return;

  assert.deepEqual(opened.value.attach(() => undefined), {
    ok: true,
    value: { attached: true },
  });
  controller.abort();
  assert.deepEqual(await opened.value.completion, {
    ok: true,
    value: { state: 'cancelled', reason: 'abort' },
  });
  assert.deepEqual(cancelReasons, ['abort']);
  assert.deepEqual(await opened.value.cancel('caller'), {
    ok: true,
    value: { cancelled: false },
  });
});

test('malformed stream terminal and bounded-buffer overflow become fixed SDK host failures', async () => {
  const malformedTerminal = completedStream<NimiRunEvent>([]);
  Object.defineProperty(malformedTerminal, 'completion', {
    configurable: true,
    enumerable: true,
    value: Promise.resolve(ok({ state: 'completed', extension: true } as never)),
  });
  const malformedHarness = createHarness(streamPort(malformedTerminal), '4'.repeat(64));
  const malformedOpened = await malformedHarness.openStream('nimi.ai.streamText', REQUEST);
  assert.equal(malformedOpened.ok, true);
  if (!malformedOpened.ok) return;
  assert.deepEqual(await malformedOpened.value.completion, {
    ok: false,
    error: { disposition: 'internal' },
  });

  let overflowCancelCount = 0;
  let resolveOverflowCompletion: (
    result: NimiTestingHostResult<{ readonly state: 'cancelled'; readonly reason: 'caller' }>,
  ) => void = () => undefined;
  const overflowCompletion = new Promise<
    NimiTestingHostResult<{ readonly state: 'cancelled'; readonly reason: 'caller' }>
  >((resolve) => {
    resolveOverflowCompletion = resolve;
  });
  const overflowSource: NimiTestingHostStream<NimiRunEvent> = {
    attach(next) {
      for (let index = 0; index <= NIMI_TESTING_STREAM_MAX_BUFFERED_ITEMS; index += 1) {
        next({ type: 'text-delta', text: String(index) });
      }
      return ok({ attached: true });
    },
    completion: overflowCompletion,
    async cancel() {
      overflowCancelCount += 1;
      resolveOverflowCompletion(ok({ state: 'cancelled', reason: 'caller' }));
      return ok({ cancelled: true });
    },
  };
  const model = createNimiTestingAiModel({
    model: MODEL,
    harness: createHarness(streamPort(overflowSource), '5'.repeat(64)),
  });
  const stream = await model.streamText?.(REQUEST);
  await assert.rejects(
    collectNimiTextStream(stream as AsyncIterable<never>),
    (error: unknown) => assertHostError(error, 'SDK_HOST_RESOURCE_EXHAUSTED', ''),
  );
  assert.equal(overflowCancelCount, 1);
});

test('testing host source imports no production carrier and reads no ambient host state', async () => {
  const files = ['host-types.ts', 'host-harness.ts', 'host-errors.ts', 'ai-model.ts'];
  const source = (await Promise.all(files.map((file) => (
    readFile(new URL(file, import.meta.url), 'utf8')
  )))).join('\n');
  for (const forbidden of [
    '../core-client', 'node-grpc', 'tauri-ipc', 'electron-ipc',
    'protected-local-host', 'globalThis', 'process.env', 'fetch(', 'WebSocket',
    'endpoint', 'credential', 'principal', 'instanceId',
  ]) {
    assert.equal(source.includes(forbidden), false, `testing host source contains ${forbidden}`);
  }
});

function createHarness(
  port: NimiTestingHostPort<NimiTestingAiMethodMap>,
  opaqueTraceSeed: string,
) {
  return createNimiTestingHarness<NimiTestingAiMethodMap>({
    opaqueTraceSeed,
    methods: NIMI_TESTING_AI_METHODS,
    port,
  });
}

function successPort(
  label: string,
  calls: string[],
): NimiTestingHostPort<NimiTestingAiMethodMap> {
  return {
    async invoke(methodId) {
      calls.push(methodId);
      return ok({ text: label, finishReason: 'stop' });
    },
    async openStream(methodId) {
      calls.push(methodId);
      return ok(completedStream([
        { type: 'start', model: MODEL },
        { type: 'text-delta', text: `${label}-stream` },
        { type: 'done', finishReason: 'stop' },
      ]));
    },
  };
}

function streamPort(
  stream: NimiTestingHostStream<NimiRunEvent>,
): NimiTestingHostPort<NimiTestingAiMethodMap> {
  return {
    async invoke() {
      return ok({ text: 'unused', finishReason: 'stop' });
    },
    async openStream() {
      return ok(stream);
    },
  };
}

function completedStream<TItem>(items: readonly TItem[]): NimiTestingHostStream<TItem> {
  let attached = false;
  let settled = false;
  let resolveCompletion: (result: NimiTestingHostResult<{ readonly state: 'completed' }>) => void;
  const completion = new Promise<NimiTestingHostResult<{ readonly state: 'completed' }>>((resolve) => {
    resolveCompletion = resolve;
  });
  return {
    attach(observer) {
      if (attached) return ok({ attached: false });
      attached = true;
      queueMicrotask(() => {
        for (const item of items) observer(item);
        settled = true;
        resolveCompletion(ok({ state: 'completed' }));
      });
      return ok({ attached: true });
    },
    completion,
    async cancel(reason) {
      if (settled) return ok({ cancelled: false });
      settled = true;
      resolveCompletion(ok({ state: 'completed' }));
      return ok({ cancelled: reason === 'caller' || reason === 'abort' });
    },
  };
}

function ok<TValue>(value: TValue): NimiTestingHostResult<TValue> {
  return { ok: true, value };
}

function assertHostError(error: unknown, code: string, forbiddenText: string): boolean {
  const candidate = error as { readonly code?: string; readonly message?: string };
  assert.equal(candidate.code, code);
  if (forbiddenText) assert.equal(candidate.message?.includes(forbiddenText), false);
  return true;
}

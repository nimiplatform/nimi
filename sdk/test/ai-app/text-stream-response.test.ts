import assert from 'node:assert/strict';
import test from 'node:test';

import {
  streamAppAiTextResponse,
} from '../../src/ai-app/index.js';
import type {
  Runtime,
  TextStreamPart,
} from '../../src/runtime/index.js';

async function* streamParts(parts: readonly TextStreamPart[]): AsyncIterable<TextStreamPart> {
  for (const part of parts) {
    yield part;
  }
}

function runtimeFromParts(parts: readonly TextStreamPart[]): Runtime {
  return {
    ai: {
      text: {
        async stream() {
          return {
            stream: streamParts(parts),
          };
        },
      },
    },
  } as unknown as Runtime;
}

test('app AI text response collects stream deltas into a final text result', async () => {
  const runtime = runtimeFromParts([
    { type: 'start' },
    { type: 'delta', text: 'Hello ' },
    { type: 'delta', text: 'world' },
    {
      type: 'finish',
      finishReason: 'stop',
      usage: { inputTokens: 1, outputTokens: 2 },
      trace: { traceId: 'trace-2' },
    },
  ]);
  const deltas: Array<[string, TextStreamPart]> = [];

  const result = await streamAppAiTextResponse(runtime, {
    model: 'runtime-selected-chat',
    input: 'Hi',
    route: 'cloud',
  }, {
    onDelta: (text, part) => {
      deltas.push([text, part]);
    },
  });

  assert.deepEqual(deltas, [
    ['Hello ', { type: 'delta', text: 'Hello ' }],
    ['world', { type: 'delta', text: 'world' }],
  ]);
  assert.equal(result.text, 'Hello world');
  assert.equal(result.finish?.type, 'finish');
});

test('app AI text response projects accumulated stream snapshots for app UI consumers', async () => {
  const runtime = runtimeFromParts([
    { type: 'start' },
    { type: 'delta', text: 'Hello ' },
    { type: 'delta', text: 'world' },
    {
      type: 'finish',
      finishReason: 'stop',
      usage: { inputTokens: 1, outputTokens: 2 },
      trace: { traceId: 'trace-2' },
    },
  ]);
  const snapshots: unknown[] = [];

  const result = await streamAppAiTextResponse(runtime, {
    model: 'runtime-selected-chat',
    input: 'Hi',
    route: 'cloud',
  }, {
    onSnapshot: (snapshot, part) => {
      snapshots.push([snapshot, part]);
    },
  });

  assert.deepEqual(snapshots, [
    [
      { text: 'Hello ', finish: null },
      { type: 'delta', text: 'Hello ' },
    ],
    [
      { text: 'Hello world', finish: null },
      { type: 'delta', text: 'world' },
    ],
  ]);
  assert.equal(result.text, 'Hello world');
});

test('app AI text response fails closed when Runtime stream ends without finish', async () => {
  const runtime = runtimeFromParts([
    { type: 'start' },
    { type: 'delta', text: 'partial' },
  ]);
  let finished = false;

  await assert.rejects(
    streamAppAiTextResponse(runtime, {
      model: 'runtime-selected-chat',
      input: 'Hi',
      route: 'cloud',
    }, {
      onFinish: () => {
        finished = true;
      },
    }),
    /Runtime text stream ended without a terminal finish event/u,
  );
  assert.equal(finished, false);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { projectAppMessageStream, mergeNimiRuntimeAgentStreams } from './runtime-agent-consume-streams.js';
import type { AppMessageEvent } from '../core-generated/runtime-typed-client.js';
import type { NimiRuntimeAgentConsumeEvent } from './runtime-agent-consume-types.js';

test('projection rejection closes upstream once and keeps the decoder error', async () => {
  let returned = 0;
  const source: AsyncIterable<AppMessageEvent> = { [Symbol.asyncIterator]: () => ({
    next: async () => ({ done: false, value: { messageType: 'runtime.agent.turn.text_delta', payload: {} } as AppMessageEvent }),
    return: async () => { returned++; throw new Error('cleanup must not hide decoder'); },
  }) };
  const stream = projectAppMessageStream(source, {})[Symbol.asyncIterator]();
  await assert.rejects(stream.next(), error => (error as Error).message !== 'cleanup must not hide decoder');
  assert.equal(returned, 1);
  await stream.return?.();
  assert.equal(returned, 1);
  assert.equal((await stream.next()).done, true);
});

test('merged failure releases both rejected and pending sources, preserving even an undefined rejection', async () => {
  const returned = [0, 0];
  let releasePending!: (value: IteratorResult<NimiRuntimeAgentConsumeEvent>) => void;
  const sources = [0, 1].map(index => ({ [Symbol.asyncIterator]: () => ({
    next: () => index === 0 ? Promise.reject(undefined) : new Promise<IteratorResult<NimiRuntimeAgentConsumeEvent>>(resolve => { releasePending = resolve; }),
    return: async () => { returned[index]++; if (index === 1) releasePending({ done: true, value: undefined }); return { done: true as const, value: undefined }; },
  }) }));
  const stream = mergeNimiRuntimeAgentStreams(sources)[Symbol.asyncIterator]();
  let rejected = false;
  try { await stream.next(); } catch (error) { rejected = true; assert.equal(error, undefined); }
  assert.equal(rejected, true);
  assert.deepEqual(returned, [1, 1]);
  await stream.return?.();
  assert.deepEqual(returned, [1, 1]);
  assert.equal((await stream.next()).done, true);
});

test('normal source completion and explicit detach do not repeat cleanup', async () => {
  let ended = 0;
  async function* source(): AsyncGenerator<NimiRuntimeAgentConsumeEvent> { try { return; } finally { ended++; } }
  const stream = mergeNimiRuntimeAgentStreams([source()])[Symbol.asyncIterator]();
  assert.equal((await stream.next()).done, true);
  await stream.return?.();
  assert.equal(ended, 1);
});

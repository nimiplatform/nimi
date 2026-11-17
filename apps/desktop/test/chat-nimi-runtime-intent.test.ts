import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDesktopNimiTextCapabilityRequest, runDesktopNimiTextCapability } from '../src/shell/renderer/features/chat/chat-nimi-shell-runtime-adapter.js';

test('Nimi Chat execution request carries CapabilityContract intent without App target authority', () => {
  const built = buildDesktopNimiTextCapabilityRequest({
    prompt: 'Hello Runtime',
  });
  assert.deepEqual(built, {
    messages: [{ role: 'user', text: 'Hello Runtime' }],
  });
  assert.doesNotMatch(
    JSON.stringify(built),
    /model|binding|target|implementation|readiness|fallback|llama/i,
  );
});

test('Nimi sends confirmed paired history and rejects a stream with no terminal result', async () => {
  const message = (id: string, role: 'user' | 'assistant', text: string, parentMessageId: string | null) => ({
    id, threadId: 'thread', role, status: 'complete' as const, contentText: text,
    content: { parts: [], toolCalls: [], attachments: [], metadata: {} }, error: null,
    traceId: null, parentMessageId, createdAtMs: 1, updatedAtMs: 1,
  });
  const history = [message('u', 'user', 'Remember river-32', null), message('a', 'assistant', 'I will.', 'u'), message('orphan', 'user', 'No reply', null)];
  assert.deepEqual(buildDesktopNimiTextCapabilityRequest({ prompt: 'What was the phrase?', history }).messages, [
    { role: 'user', text: 'Remember river-32' }, { role: 'assistant', text: 'I will.' }, { role: 'user', text: 'What was the phrase?' },
  ]);
  let cancelled = 0;
  const client = { ai: { text: { streamTurn: async () => ({
    async *[Symbol.asyncIterator]() { yield { type: 'delta', text: 'partial' }; },
    async cancel() { cancelled++; },
  }) } } } as unknown as Parameters<typeof runDesktopNimiTextCapability>[0]['client'];
  await assert.rejects(runDesktopNimiTextCapability({ client, prompt: 'hello' }), /without a confirmed result/);
  assert.equal(cancelled, 1);
});

test('Nimi execution cancels the opened SDK stream when its current scope ends', async () => {
  const controller = new AbortController();
  let ready!: () => void;
  const opened = new Promise<void>(resolve => { ready = resolve; });
  let finish!: (result: IteratorResult<never>) => void;
  const pending = new Promise<IteratorResult<never>>(resolve => { finish = resolve; });
  let cancellations = 0;
  const client = { ai: { text: { streamTurn: async () => ({
    [Symbol.asyncIterator]() {
      ready();
      return { next: () => pending };
    },
    async cancel() { cancellations++; finish({ done: true, value: undefined }); },
  }) } } } as unknown as Parameters<typeof runDesktopNimiTextCapability>[0]['client'];
  const result = runDesktopNimiTextCapability({ client, prompt: 'hello', signal: controller.signal });
  await opened;
  controller.abort();
  await assert.rejects(result);
  assert.ok(cancellations >= 1);
});

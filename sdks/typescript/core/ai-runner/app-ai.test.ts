import assert from 'node:assert/strict';
import test from 'node:test';

import { createNimiMockModel, userTextMessage } from '../testing';
import {
  runNimiAiTextGenerate,
  runNimiAiTextTurn,
  streamNimiAiTextResponse,
} from './app-ai';

test('AI text generate fails closed instead of locally executing model turns', async () => {
  let generateCalls = 0;
  const model = createNimiMockModel({
    async onGenerateText() {
      generateCalls += 1;
      return { text: '{"answer":"yes"}', finishReason: 'stop' };
    },
  });

  const result = await runNimiAiTextGenerate<{ answer: string }>({
    runner: { id: 'runner', name: 'Runner', instructions: 'Return JSON.' },
    runtime: { model },
    messages: [userTextMessage('answer')],
    structuredOutput: { expect: 'object' },
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok ? '' : result.error.code, 'SDK_RUNTIME_AGENT_PARTICIPATION_REQUIRED');
  assert.equal(generateCalls, 0);
});

test('AI text turn fails closed instead of locally streaming model turns', async () => {
  const model = createNimiMockModel({
    streamEvents: [
      { type: 'text-delta', text: 'local bypass' },
      { type: 'done', finishReason: 'stop' },
    ],
  });

  const events = [];
  for await (const event of runNimiAiTextTurn({
    runner: { id: 'runner', name: 'Runner' },
    runtime: { model },
    messages: [userTextMessage('stream')],
    turnId: 'turn-1',
  })) {
    events.push(event);
  }

  assert.deepEqual(events.map((event) => event.type), ['turn-started', 'turn-failed']);
  const failed = events.at(-1);
  assert.equal(failed?.type, 'turn-failed');
  assert.equal(failed?.type === 'turn-failed' ? failed.error.code : '', 'SDK_RUNTIME_AGENT_PARTICIPATION_REQUIRED');
});

test('AI text response rejects Runtime participation bypass attempts', async () => {
  const model = createNimiMockModel({ text: 'local bypass' });

  await assert.rejects(
    () => streamNimiAiTextResponse({
      runner: { id: 'runner', name: 'Runner' },
      runtime: { model },
      messages: [userTextMessage('stream')],
    }),
    /Runtime Agent participation authority/,
  );
});

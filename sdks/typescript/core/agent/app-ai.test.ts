import assert from 'node:assert/strict';
import test from 'node:test';

import { createNimiMockModel, userTextMessage } from '../testing';
import {
  runNimiAgentTextGenerate,
  runNimiAgentTextTurn,
  streamNimiAgentTextResponse,
} from './app-ai';

test('agent text generate preserves structured output success and repair failure', async () => {
  const model = createNimiMockModel({
    text: '{"answer":"yes"}',
    finishReason: 'stop',
  });

  const success = await runNimiAgentTextGenerate<{ answer: string }>({
    agent: { id: 'agent', name: 'Agent', instructions: 'Return JSON.' },
    runtime: { model },
    messages: [userTextMessage('answer')],
    structuredOutput: {
      expect: 'object',
      validate: (value): value is { answer: string } => {
        return typeof value === 'object'
          && value !== null
          && !Array.isArray(value)
          && typeof (value as { answer?: unknown }).answer === 'string';
      },
    },
  });

  assert.equal(success.ok, true);
  assert.equal(success.ok ? success.structuredOutput?.value.answer : '', 'yes');

  const failure = await runNimiAgentTextGenerate({
    agent: { id: 'agent', name: 'Agent' },
    runtime: { model: createNimiMockModel({ text: 'not-json', finishReason: 'stop' }) },
    messages: [userTextMessage('answer')],
    structuredOutput: { expect: 'object' },
  });

  assert.equal(failure.ok, false);
  assert.equal(failure.ok ? '' : failure.error.code, 'STRUCTURED_OUTPUT_VALIDATION_FAILED');
  assert.equal(failure.ok ? '' : failure.repairRequest?.failureReason, 'invalid-json');
});

test('agent text turn streams reasoning text and terminal snapshots', async () => {
  const model = createNimiMockModel({
    streamEvents: [
      { type: 'start', traceId: 'trace-turn' },
      { type: 'reasoning-delta', text: 'think ' },
      { type: 'text-delta', text: '{"ok":true}' },
      { type: 'done', finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 } },
    ],
  });

  const events = [];
  for await (const event of runNimiAgentTextTurn<{ ok: boolean }>({
    agent: { id: 'agent', name: 'Agent' },
    runtime: { model },
    messages: [userTextMessage('stream')],
    structuredOutput: { expect: 'object' },
    turnId: 'turn-1',
  })) {
    events.push(event);
  }

  assert.deepEqual(events.map((event) => event.type), [
    'turn-started',
    'reasoning-delta',
    'text-delta',
    'structured-output-parsed',
    'turn-completed',
  ]);
  const completed = events.at(-1);
  assert.equal(completed?.type, 'turn-completed');
  assert.equal(completed?.type === 'turn-completed' ? completed.snapshot.reasoningText : '', 'think ');
});

test('agent text response reports stream failures without pseudo-success', async () => {
  const model = createNimiMockModel({
    streamEvents: [
      { type: 'start' },
      { type: 'text-delta', text: 'partial' },
      { type: 'error', code: 'RUNTIME_FAILED', message: 'runtime failed' },
    ],
  });

  await assert.rejects(
    () => streamNimiAgentTextResponse({
      agent: { id: 'agent', name: 'Agent' },
      runtime: { model },
      messages: [userTextMessage('stream')],
    }),
    /runtime failed/,
  );
});

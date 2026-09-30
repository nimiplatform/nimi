import assert from 'node:assert/strict';
import test from 'node:test';

import { textPart } from '../contracts';
import { createNimiMockModel, userTextMessage } from '../testing';
import { createNimiError, isNimiError } from '../../types';
import type { NimiAiModel } from './index';
import {
  runNimiTextGenerate,
  runNimiTextTurn,
  streamNimiTextResponse,
} from './text-runner';

test('Nimi text generate preserves structured output success and required failure', async () => {
  const model = createNimiMockModel({
    text: '{"answer":"yes"}',
    finishReason: 'stop',
  });

  const success = await runNimiTextGenerate<{ answer: string }>({
    runtime: { model },
    request: {
      messages: [userTextMessage('answer')],
    },
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

  const failure = await runNimiTextGenerate({
    runtime: { model: createNimiMockModel({ text: 'not-json', finishReason: 'stop' }) },
    request: {
      messages: [userTextMessage('answer')],
    },
    structuredOutput: { expect: 'object' },
  });

  assert.equal(failure.ok, false);
  assert.equal(failure.ok ? '' : failure.error.code, 'STRUCTURED_OUTPUT_VALIDATION_FAILED');
  assert.equal(failure.ok ? '' : failure.repairRequest?.failureReason, 'invalid-json');
});

test('Nimi text turn preserves stream events and terminal snapshots', async () => {
  const model = createNimiMockModel({
    streamEvents: [
      { type: 'start', traceId: 'trace-turn' },
      { type: 'reasoning-delta', text: 'think ' },
      { type: 'text-delta', text: '{"ok":true}' },
      { type: 'warning', code: 'WARN', message: 'visible warning' },
      { type: 'tool-call', toolCall: { id: 'call-1', name: 'lookup', arguments: { q: 'n' } } },
      { type: 'artifact', chunk: new Uint8Array([1, 2]), mimeType: 'application/octet-stream' },
      { type: 'trace', trace: { traceId: 'trace-2', events: [], steps: [] } },
      { type: 'done', finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 } },
    ],
  });

  const events = [];
  for await (const event of runNimiTextTurn<{ ok: boolean }>({
    runtime: { model },
    request: {
      messages: [{ role: 'user', content: [textPart('stream')] }],
    },
    structuredOutput: { expect: 'object' },
    turnId: 'turn-1',
  })) {
    events.push(event);
  }

  assert.deepEqual(events.map((event) => event.type), [
    'turn-started',
    'reasoning-delta',
    'text-delta',
    'warning',
    'tool-call',
    'artifact',
    'trace',
    'structured-output-parsed',
    'turn-completed',
  ]);
  const completed = events.at(-1);
  assert.equal(completed?.type, 'turn-completed');
  assert.equal(completed?.type === 'turn-completed' ? completed.snapshot.traceId : '', 'trace-turn');
  assert.equal(completed?.type === 'turn-completed' ? completed.snapshot.reasoningText : '', 'think ');
});

test('Nimi text response reports stream failures without pseudo-success', async () => {
  const model = createNimiMockModel({
    streamEvents: [
      { type: 'start' },
      { type: 'text-delta', text: 'partial' },
      { type: 'error', code: 'RUNTIME_FAILED', message: 'runtime failed' },
    ],
  });

  await assert.rejects(
    () => streamNimiTextResponse({
      runtime: { model },
      request: {
        messages: [userTextMessage('stream')],
      },
    }),
    (error: unknown) => {
      assert.equal(isNimiError(error), true);
      assert.equal(error.code, 'RUNTIME_FAILED');
      assert.equal(error.reasonCode, 'RUNTIME_FAILED');
      assert.equal(error.actionHint, 'check_ai_text_error');
      return true;
    },
  );
});

function failingModel(error: unknown): NimiAiModel {
  return {
    model: { modelId: 'text.generate' },
    generateText: async () => { throw error; },
    streamText: async () => { throw error; },
  };
}

test('Nimi text response keeps the owner reason a carrier reports under its transport category', async () => {
  // The Electron carrier reports its own category as code and the Runtime's
  // typed reason as reasonCode.
  const carrierError = Object.assign(new Error('ai-text-behavior-unsupported'), {
    code: 'runtime-permission-denied',
    reasonCode: 'ai-text-behavior-unsupported',
    actionHint: 'switch_text_route_or_start_new_conversation',
    source: 'runtime',
  });
  const request = { messages: [userTextMessage('continue')] };

  const events = [];
  for await (const event of runNimiTextTurn({ runtime: { model: failingModel(carrierError) }, request })) {
    events.push(event);
  }
  const failed = events.at(-1);
  assert.equal(failed?.type, 'turn-failed');
  assert.equal(failed?.type === 'turn-failed' ? failed.error.code : '', 'ai-text-behavior-unsupported');

  await assert.rejects(
    () => streamNimiTextResponse({ runtime: { model: failingModel(carrierError) }, request }),
    (error: unknown) => {
      assert.equal(isNimiError(error), true);
      assert.equal(error.code, 'ai-text-behavior-unsupported');
      assert.equal(error.reasonCode, 'ai-text-behavior-unsupported');
      assert.equal(error.actionHint, 'switch_text_route_or_start_new_conversation');
      assert.equal(error.source, 'runtime');
      return true;
    },
  );
});

test('Nimi text response rethrows the owner NimiError it received', async () => {
  const owner = createNimiError({
    message: 'Nimi text generation failed: AI_PROVIDER_TIMEOUT.',
    code: 'AI_PROVIDER_TIMEOUT',
    reasonCode: 'AI_PROVIDER_TIMEOUT',
    actionHint: 'retry_after_provider_recovers',
    traceId: 'trace-timeout',
    retryable: true,
    source: 'runtime',
  });

  await assert.rejects(
    () => streamNimiTextResponse({ runtime: { model: failingModel(owner) }, request: { messages: [userTextMessage('hi')] } }),
    (error: unknown) => {
      assert.equal(error, owner);
      return true;
    },
  );
});

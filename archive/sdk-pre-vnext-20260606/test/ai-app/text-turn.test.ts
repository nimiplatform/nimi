import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runAppAiTextTurn,
  type AppAiTextTurnEvent,
  type AppAiTextTurnRuntime,
} from '../../src/ai-app/index.js';
import type { TextStreamPart } from '../../src/runtime/index.js';
import { ReasonCode } from '../../src/types/index.js';

type MingScore = {
  stability: number;
  treasury: number;
};

async function* streamParts(parts: readonly TextStreamPart[]): AsyncIterable<TextStreamPart> {
  for (const part of parts) {
    yield part;
  }
}

function runtimeFromParts(parts: readonly TextStreamPart[]): AppAiTextTurnRuntime {
  return {
    async streamText() {
      return {
        stream: streamParts(parts),
      };
    },
  };
}

function validateMingScore(value: unknown): MingScore {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('score must be an object');
  }
  const record = value as Record<string, unknown>;
  if (typeof record.stability !== 'number') {
    throw new Error('stability must be a number');
  }
  if (typeof record.treasury !== 'number') {
    throw new Error('treasury must be a number');
  }
  return {
    stability: record.stability,
    treasury: record.treasury,
  };
}

test('app AI text turn streams deltas and validates structured output before completing', async () => {
  const events: AppAiTextTurnEvent<MingScore>[] = [];
  for await (const event of runAppAiTextTurn<MingScore>({
    runtime: runtimeFromParts([
      { type: 'start' },
      { type: 'reasoning-delta', text: 'inspect ' },
      { type: 'delta', text: '{"stability":72,' },
      { type: 'delta', text: '"treasury":41}' },
      {
        type: 'finish',
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 },
        trace: { traceId: 'trace-ming', modelResolved: 'model-a', routeDecision: 'local' },
      },
    ]),
    request: {
      model: 'model-a',
      input: [{ role: 'user', content: 'score the turn' }],
      route: 'local',
    },
    turnId: 'turn-1',
    structuredOutput: {
      validate: validateMingScore,
    },
  })) {
    events.push(event);
  }

  assert.deepEqual(events.map((event) => event.type), [
    'turn-started',
    'reasoning-delta',
    'text-delta',
    'text-delta',
    'structured-output-parsed',
    'turn-completed',
  ]);
  const completed = events.at(-1);
  assert.equal(completed?.type, 'turn-completed');
  if (!completed || completed.type !== 'turn-completed') {
    throw new Error('expected turn-completed');
  }
  assert.equal(completed.snapshot.text, '{"stability":72,"treasury":41}');
  assert.equal(completed.snapshot.reasoningText, 'inspect ');
  assert.deepEqual(completed.structuredOutput?.value, { stability: 72, treasury: 41 });
  assert.equal(completed.snapshot.trace?.traceId, 'trace-ming');
  assert.equal(completed.runtimePart?.type, 'finish');
  assert.equal(completed.runtimePart?.trace.traceId, 'trace-ming');
  const textDelta = events.find((event) => event.type === 'text-delta');
  assert.equal(textDelta?.type, 'text-delta');
  if (!textDelta || textDelta.type !== 'text-delta') {
    throw new Error('expected text-delta');
  }
  assert.equal(textDelta.runtimePart.type, 'delta');
  assert.equal(textDelta.runtimePart.text, '{"stability":72,');
});

test('app AI text turn fails closed and emits a visible repair request for required structured output', async () => {
  const events: AppAiTextTurnEvent<MingScore>[] = [];
  for await (const event of runAppAiTextTurn<MingScore>({
    runtime: runtimeFromParts([
      { type: 'delta', text: '{"stability":"stable","treasury":41}' },
      {
        type: 'finish',
        finishReason: 'stop',
        usage: {},
        trace: {},
      },
    ]),
    request: {
      model: 'model-a',
      input: 'score the turn',
    },
    structuredOutput: {
      validate: validateMingScore,
      repairInstruction: 'Return the Ming score as numeric JSON only.',
    },
  })) {
    events.push(event);
  }

  assert.deepEqual(events.map((event) => event.type), [
    'turn-started',
    'text-delta',
    'structured-output-repair-required',
    'turn-failed',
  ]);
  const repair = events.find((event) => event.type === 'structured-output-repair-required');
  assert.equal(repair?.type, 'structured-output-repair-required');
  if (!repair || repair.type !== 'structured-output-repair-required') {
    throw new Error('expected repair request');
  }
  assert.equal(repair.failure.reason, 'validation-failed');
  assert.equal(repair.repairRequest.instruction, 'Return the Ming score as numeric JSON only.');

  const failed = events.at(-1);
  assert.equal(failed?.type, 'turn-failed');
  if (!failed || failed.type !== 'turn-failed') {
    throw new Error('expected turn-failed');
  }
  assert.equal(failed.error.code, 'STRUCTURED_OUTPUT_VALIDATION_FAILED');
  assert.equal(failed.snapshot.terminal, 'failed');
});

test('app AI text turn preserves runtime errors and partial text', async () => {
  const error = Object.assign(new Error('provider denied'), {
    reasonCode: ReasonCode.PRINCIPAL_UNAUTHORIZED,
    traceId: 'trace-denied',
  });
  const events: AppAiTextTurnEvent[] = [];
  for await (const event of runAppAiTextTurn({
    runtime: runtimeFromParts([
      { type: 'delta', text: 'partial' },
      { type: 'error', error },
    ]),
    request: {
      model: 'model-a',
      input: 'hello',
    },
  })) {
    events.push(event);
  }

  const failed = events.at(-1);
  assert.equal(failed?.type, 'turn-failed');
  if (!failed || failed.type !== 'turn-failed') {
    throw new Error('expected turn-failed');
  }
  assert.equal(failed.error.code, ReasonCode.PRINCIPAL_UNAUTHORIZED);
  assert.equal(failed.snapshot.text, 'partial');
  assert.equal(failed.runtimePart?.type, 'error');
  assert.equal(failed.runtimePart?.error, error);
});

test('app AI text turn fails when stream ends without finish', async () => {
  const events: AppAiTextTurnEvent[] = [];
  for await (const event of runAppAiTextTurn({
    runtime: runtimeFromParts([{ type: 'delta', text: 'orphan' }]),
    request: {
      model: 'model-a',
      input: 'hello',
    },
  })) {
    events.push(event);
  }

  const failed = events.at(-1);
  assert.equal(failed?.type, 'turn-failed');
  if (!failed || failed.type !== 'turn-failed') {
    throw new Error('expected turn-failed');
  }
  assert.equal(failed.error.code, 'STREAM_TERMINATED_WITHOUT_TERMINAL_EVENT');
  assert.equal(failed.snapshot.text, 'orphan');
});

test('app AI text turn reports cancellation without fabricating completion', async () => {
  const runtime: AppAiTextTurnRuntime = {
    async streamText() {
      throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
    },
  };
  const events: AppAiTextTurnEvent[] = [];
  for await (const event of runAppAiTextTurn({
    runtime,
    request: {
      model: 'model-a',
      input: 'hello',
    },
  })) {
    events.push(event);
  }

  assert.deepEqual(events.map((event) => event.type), ['turn-started', 'turn-canceled']);
});

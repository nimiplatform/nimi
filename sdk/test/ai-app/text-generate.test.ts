import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runAppAiTextGenerate,
  type AppAiTextGenerateRuntime,
} from '../../src/ai-app/index.js';
import type { TextGenerateOutput } from '../../src/runtime/index.js';

type MingScore = {
  stability: number;
  treasury: number;
};

function output(text: string): TextGenerateOutput {
  return {
    text,
    finishReason: 'stop',
    usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10 },
    trace: { traceId: 'trace-text-generate', modelResolved: 'model-a', routeDecision: 'local' },
  };
}

function runtimeWithOutput(next: TextGenerateOutput): AppAiTextGenerateRuntime {
  return {
    async generateText() {
      return next;
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

test('app AI text generate delegates to Runtime and preserves the typed output', async () => {
  const result = await runAppAiTextGenerate({
    runtime: runtimeWithOutput(output('plain answer')),
    request: {
      model: 'model-a',
      input: 'hello',
      route: 'local',
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  assert.equal(result.text, 'plain answer');
  assert.equal(result.output.trace.traceId, 'trace-text-generate');
});

test('app AI text generate parses required structured output before success', async () => {
  const result = await runAppAiTextGenerate<MingScore>({
    runtime: runtimeWithOutput(output('Summary. {"stability":72,"treasury":41}')),
    request: {
      model: 'model-a',
      input: 'score the turn',
    },
    structuredOutput: {
      validate: validateMingScore,
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  assert.deepEqual(result.structuredOutput?.value, { stability: 72, treasury: 41 });
});

test('app AI text generate fails closed for required structured output mismatch', async () => {
  const result = await runAppAiTextGenerate<MingScore>({
    runtime: runtimeWithOutput(output('{"stability":"stable","treasury":41}')),
    request: {
      model: 'model-a',
      input: 'score the turn',
    },
    structuredOutput: {
      validate: validateMingScore,
      repairInstruction: 'Return numeric JSON only.',
    },
  });

  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error('expected failure');
  }
  assert.equal(result.error.code, 'STRUCTURED_OUTPUT_VALIDATION_FAILED');
  assert.equal(result.structuredOutputFailure?.reason, 'validation-failed');
  assert.equal(result.repairRequest?.instruction, 'Return numeric JSON only.');
  assert.equal(result.output?.text, '{"stability":"stable","treasury":41}');
});

test('app AI text generate can surface optional structured output repair without failing the turn', async () => {
  const result = await runAppAiTextGenerate<MingScore>({
    runtime: runtimeWithOutput(output('not json')),
    request: {
      model: 'model-a',
      input: 'score the turn',
    },
    structuredOutput: {
      validate: validateMingScore,
      required: false,
    },
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  assert.equal(result.text, 'not json');
  assert.equal(result.structuredOutputFailure?.reason, 'json-missing');
  assert.equal(result.repairRequest?.reason, 'json-missing');
});

test('app AI text generate preserves Runtime typed errors', async () => {
  const error = Object.assign(new Error('provider denied'), {
    reasonCode: 'PRINCIPAL_UNAUTHORIZED',
  });
  const runtime: AppAiTextGenerateRuntime = {
    async generateText() {
      throw error;
    },
  };

  const result = await runAppAiTextGenerate({
    runtime,
    request: {
      model: 'model-a',
      input: 'hello',
    },
  });

  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error('expected failure');
  }
  assert.equal(result.error.code, 'PRINCIPAL_UNAUTHORIZED');
  assert.equal(result.error.cause, error);
});

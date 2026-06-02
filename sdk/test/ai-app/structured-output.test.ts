import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseAppAiStructuredJson,
} from '../../src/ai-app/index.js';

type MingTurnScore = {
  stability: number;
  treasury: number;
  rationale: string;
};

function validateMingTurnScore(value: unknown): MingTurnScore {
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
  if (typeof record.rationale !== 'string' || !record.rationale.trim()) {
    throw new Error('rationale must be non-empty text');
  }
  return {
    stability: record.stability,
    treasury: record.treasury,
    rationale: record.rationale,
  };
}

test('app AI structured output parser extracts fenced JSON and validates domain shape', () => {
  const parsed = parseAppAiStructuredJson({
    raw: '```json\n{"stability":72,"treasury":41,"rationale":"grain reserve held"}\n```',
    validate: validateMingTurnScore,
  });

  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }
  assert.deepEqual(parsed.value, {
    stability: 72,
    treasury: 41,
    rationale: 'grain reserve held',
  });
});

test('app AI structured output parser extracts the first balanced JSON payload from prose', () => {
  const parsed = parseAppAiStructuredJson({
    raw: 'Summary follows. {"stability":65,"treasury":39,"rationale":"bandit pressure"} Use this only after review.',
    validate: validateMingTurnScore,
  });

  assert.equal(parsed.ok, true);
  if (!parsed.ok) {
    throw new Error(parsed.message);
  }
  assert.equal(parsed.value.stability, 65);
  assert.equal(parsed.jsonText, '{"stability":65,"treasury":39,"rationale":"bandit pressure"}');
});

test('app AI structured output parser fails visibly on missing, invalid, and schema-invalid JSON', () => {
  const missing = parseAppAiStructuredJson({ raw: 'no structured score here' });
  assert.equal(missing.ok, false);
  if (missing.ok) {
    throw new Error('expected missing JSON to fail');
  }
  assert.equal(missing.reason, 'json-missing');

  const invalid = parseAppAiStructuredJson({ raw: '{"stability":72,,}' });
  assert.equal(invalid.ok, false);
  if (invalid.ok) {
    throw new Error('expected invalid JSON to fail');
  }
  assert.equal(invalid.reason, 'json-invalid');

  const schemaInvalid = parseAppAiStructuredJson({
    raw: '{"stability":"stable","treasury":41,"rationale":"bad type"}',
    validate: validateMingTurnScore,
  });
  assert.equal(schemaInvalid.ok, false);
  if (schemaInvalid.ok) {
    throw new Error('expected schema-invalid JSON to fail');
  }
  assert.equal(schemaInvalid.reason, 'validation-failed');
  assert.match(schemaInvalid.message, /stability/);
});

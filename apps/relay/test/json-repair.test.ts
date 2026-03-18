// Unit tests for JSON repair utilities

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseJsonObject,
  extractJsonFromText,
  repairJson,
  balanceJsonContainers,
  sanitizeJsonStringLiterals,
  quoteBareJsonKeys,
  quoteBareJsonValues,
} from '../src/main/chat-pipeline/json-repair.js';

// ─── parseJsonObject ────────────────────────────────────────────────────

describe('parseJsonObject — valid JSON', () => {
  it('passes through valid JSON object', () => {
    const result = parseJsonObject('{"key":"value","num":42}');
    assert.equal(result.key, 'value');
    assert.equal(result.num, 42);
  });

  it('handles nested objects', () => {
    const result = parseJsonObject('{"beats":[{"text":"hello","intent":"answer"}]}');
    assert.ok(Array.isArray(result.beats));
    assert.equal((result.beats as Array<{ text: string }>)[0]?.text, 'hello');
  });
});

describe('parseJsonObject — markdown code block extraction', () => {
  it('extracts JSON from markdown code block', () => {
    const input = '```json\n{"key":"value"}\n```';
    const result = parseJsonObject(input);
    assert.equal(result.key, 'value');
  });

  it('extracts JSON from code block without language tag', () => {
    const input = '```\n{"key":"value"}\n```';
    const result = parseJsonObject(input);
    assert.equal(result.key, 'value');
  });

  it('extracts JSON from code block with surrounding text', () => {
    const input = 'Here is the result:\n```json\n{"key":"value"}\n```\nDone.';
    const result = parseJsonObject(input);
    assert.equal(result.key, 'value');
  });
});

describe('parseJsonObject — truncated JSON repair', () => {
  it('repairs truncated JSON with unclosed brace', () => {
    const result = parseJsonObject('{"beats":[{"text":"hello"}]');
    assert.ok(result.beats);
  });

  it('repairs truncated JSON with unclosed array and brace', () => {
    const result = parseJsonObject('{"beats":[{"text":"hello"}');
    assert.ok(result.beats);
    assert.ok(Array.isArray(result.beats));
  });
});

describe('parseJsonObject — non-JSON returns error', () => {
  it('throws for empty text', () => {
    assert.throws(
      () => parseJsonObject(''),
      { message: 'RELAY_AI_GENERATE_OBJECT_EMPTY_TEXT' },
    );
  });

  it('throws for plain text without any JSON structure', () => {
    assert.throws(
      () => parseJsonObject('hello world no json here'),
    );
  });
});

// ─── extractJsonFromText ────────────────────────────────────────────────

describe('extractJsonFromText', () => {
  it('extracts from fenced code block', () => {
    const result = extractJsonFromText('```json\n{"a":1}\n```');
    assert.equal(result, '{"a":1}');
  });

  it('extracts first brace to last brace when no code fence', () => {
    const result = extractJsonFromText('some text {"a":1} more text');
    assert.equal(result, '{"a":1}');
  });

  it('returns trimmed input when no braces found', () => {
    const result = extractJsonFromText('  no braces  ');
    assert.equal(result, 'no braces');
  });

  it('handles truncated JSON (open brace only)', () => {
    const result = extractJsonFromText('prefix {"a":1');
    assert.equal(result, '{"a":1');
  });
});

// ─── repairJson ─────────────────────────────────────────────────────────

describe('repairJson', () => {
  it('removes trailing commas before closing brace', () => {
    const result = repairJson('{"a":1,}');
    const parsed = JSON.parse(result);
    assert.equal(parsed.a, 1);
  });

  it('removes trailing commas before closing bracket', () => {
    const result = repairJson('[1,2,3,]');
    const parsed = JSON.parse(result);
    assert.deepEqual(parsed, [1, 2, 3]);
  });

  it('passes through valid JSON unchanged', () => {
    const input = '{"key":"value","num":42}';
    const result = repairJson(input);
    assert.deepEqual(JSON.parse(result), { key: 'value', num: 42 });
  });
});

// ─── balanceJsonContainers ──────────────────────────────────────────────

describe('balanceJsonContainers', () => {
  it('closes unclosed braces', () => {
    const result = balanceJsonContainers('{"a":1');
    assert.ok(result.endsWith('}'));
    assert.deepEqual(JSON.parse(result), { a: 1 });
  });

  it('closes unclosed brackets', () => {
    const result = balanceJsonContainers('[1,2,3');
    assert.ok(result.endsWith(']'));
    assert.deepEqual(JSON.parse(result), [1, 2, 3]);
  });

  it('closes mixed unclosed containers', () => {
    const result = balanceJsonContainers('{"a":[1,2');
    assert.ok(result.endsWith(']}'));
  });

  it('does not modify already balanced JSON', () => {
    const input = '{"a":[1,2]}';
    assert.equal(balanceJsonContainers(input), input);
  });

  it('ignores braces inside strings', () => {
    const input = '{"a":"value with { and ["}';
    assert.equal(balanceJsonContainers(input), input);
  });
});

// ─── sanitizeJsonStringLiterals ─────────────────────────────────────────

describe('sanitizeJsonStringLiterals', () => {
  it('escapes raw newlines inside strings', () => {
    const result = sanitizeJsonStringLiterals('{"a":"line1\nline2"}');
    const parsed = JSON.parse(result);
    assert.equal(parsed.a, 'line1\nline2');
  });

  it('escapes raw tabs inside strings', () => {
    const result = sanitizeJsonStringLiterals('{"a":"col1\tcol2"}');
    const parsed = JSON.parse(result);
    assert.equal(parsed.a, 'col1\tcol2');
  });

  it('closes unterminated strings', () => {
    const result = sanitizeJsonStringLiterals('{"a":"unterminated');
    assert.ok(result.endsWith('"'));
  });

  it('preserves already escaped sequences', () => {
    const input = '{"a":"line1\\nline2"}';
    assert.equal(sanitizeJsonStringLiterals(input), input);
  });
});

// ─── quoteBareJsonKeys ──────────────────────────────────────────────────

describe('quoteBareJsonKeys', () => {
  it('quotes unquoted object keys', () => {
    const result = quoteBareJsonKeys('{key: "value"}');
    assert.ok(result.includes('"key"'));
  });
});

// ─── quoteBareJsonValues ────────────────────────────────────────────────

describe('quoteBareJsonValues', () => {
  it('preserves boolean and null literals', () => {
    const result = quoteBareJsonValues('{"a": true, "b": false, "c": null}');
    const parsed = JSON.parse(result);
    assert.equal(parsed.a, true);
    assert.equal(parsed.b, false);
    assert.equal(parsed.c, null);
  });

  it('preserves numeric values', () => {
    const result = quoteBareJsonValues('{"a": 42, "b": 3.14}');
    const parsed = JSON.parse(result);
    assert.equal(parsed.a, 42);
    assert.equal(parsed.b, 3.14);
  });
});

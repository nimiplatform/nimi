import { describe, expect, it } from 'vitest';
import { jsonValuesEqual } from '../src/json-value.js';

describe('jsonValuesEqual', () => {
  it('compares JSON objects independent of key order', () => {
    expect(jsonValuesEqual({ nested: { b: 2, a: [1, null] } }, { nested: { a: [1, null], b: 2 } })).toBe(true);
  });

  it('rejects changed arrays and scalar types', () => {
    expect(jsonValuesEqual([1, 2], [2, 1])).toBe(false);
    expect(jsonValuesEqual('1', 1)).toBe(false);
  });
});

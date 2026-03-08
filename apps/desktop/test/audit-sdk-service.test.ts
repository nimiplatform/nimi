import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  dateToTimestamp,
} from '../src/shell/renderer/features/runtime-config/runtime-config-audit-sdk-service';

// ---------------------------------------------------------------------------
// dateToTimestamp
// ---------------------------------------------------------------------------

describe('dateToTimestamp', () => {
  test('epoch zero → seconds "0", nanos 0', () => {
    const result = dateToTimestamp(new Date(0));
    assert.equal(result.seconds, '0');
    assert.equal(result.nanos, 0);
  });

  test('known date → correct seconds', () => {
    // 2024-03-02T00:00:00.000Z = 1709337600000ms
    const result = dateToTimestamp(new Date('2024-03-02T00:00:00.000Z'));
    assert.equal(result.seconds, '1709337600');
    assert.equal(result.nanos, 0);
  });

  test('date with milliseconds → nanos reflect ms', () => {
    const result = dateToTimestamp(new Date('2024-03-02T00:00:00.500Z'));
    assert.equal(result.seconds, '1709337600');
    assert.equal(result.nanos, 500_000_000);
  });

  test('date with 123ms → nanos = 123_000_000', () => {
    const result = dateToTimestamp(new Date('2024-01-01T00:00:00.123Z'));
    assert.equal(result.nanos, 123_000_000);
  });

  test('seconds is always a string', () => {
    const result = dateToTimestamp(new Date());
    assert.equal(typeof result.seconds, 'string');
  });

  test('nanos is always a number', () => {
    const result = dateToTimestamp(new Date());
    assert.equal(typeof result.nanos, 'number');
  });

  test('round-trip: timestampToIso(dateToTimestamp(date)) ≈ date.toISOString()', () => {
    const date = new Date('2026-03-02T12:30:45.000Z');
    const ts = dateToTimestamp(date);
    const ms = Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1_000_000);
    const roundTrip = new Date(ms).toISOString();
    assert.equal(roundTrip, date.toISOString());
  });
});

import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  dateToTimestamp,
  resolveDesktopAuditTimeRange,
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

  test('pre-epoch milliseconds use normalized non-negative nanos', () => {
    const result = dateToTimestamp(new Date(-1));
    assert.equal(result.seconds, '-1');
    assert.equal(result.nanos, 999_000_000);
  });

  test('invalid dates fail closed', () => {
    assert.throws(() => dateToTimestamp(new Date(Number.NaN)), /valid date/u);
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

describe('resolveDesktopAuditTimeRange', () => {
  const now = new Date('2026-07-17T12:00:00.000Z');

  test('defaults to an exact 24-hour window ending at the supplied clock', () => {
    const result = resolveDesktopAuditTimeRange({}, now);
    assert.deepEqual(result, {
      fromTime: dateToTimestamp(new Date('2026-07-16T12:00:00.000Z')),
      toTime: dateToTimestamp(now),
    });
  });

  test('bounds a one-sided from filter to 24 hours', () => {
    const from = new Date('2026-07-10T01:00:00.000Z');
    const result = resolveDesktopAuditTimeRange({ from }, now);
    assert.deepEqual(result, {
      fromTime: dateToTimestamp(from),
      toTime: dateToTimestamp(new Date('2026-07-11T01:00:00.000Z')),
    });
  });

  test('bounds a one-sided to filter to 24 hours', () => {
    const to = new Date('2026-07-10T01:00:00.000Z');
    const result = resolveDesktopAuditTimeRange({ to }, now);
    assert.deepEqual(result, {
      fromTime: dateToTimestamp(new Date('2026-07-09T01:00:00.000Z')),
      toTime: dateToTimestamp(to),
    });
  });

  test('rejects reversed and longer-than-seven-day windows', () => {
    assert.throws(
      () => resolveDesktopAuditTimeRange({
        from: new Date('2026-07-11T00:00:00.000Z'),
        to: new Date('2026-07-10T00:00:00.000Z'),
      }, now),
      /ordered/u,
    );
    assert.throws(
      () => resolveDesktopAuditTimeRange({
        from: new Date('2026-07-01T00:00:00.000Z'),
        to: new Date('2026-07-09T00:00:00.000Z'),
      }, now),
      /seven days/u,
    );
  });
});

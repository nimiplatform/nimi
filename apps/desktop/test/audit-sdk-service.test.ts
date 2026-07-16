import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

describe('Desktop audit projection source boundary', () => {
  const serviceSource = readFileSync(new URL(
    '../src/shell/renderer/features/runtime-config/runtime-config-audit-sdk-service.ts',
    import.meta.url,
  ), 'utf8');
  const hookSource = readFileSync(new URL(
    '../src/shell/renderer/features/runtime-config/runtime-config-use-global-audit-data.ts',
    import.meta.url,
  ), 'utf8');
  const sectionSource = readFileSync(new URL(
    '../src/shell/renderer/features/runtime-config/runtime-config-global-audit-section.tsx',
    import.meta.url,
  ), 'utf8');

  test('uses only the exact Desktop projection method and has no raw export fallback', () => {
    const source = `${serviceSource}\n${hookSource}`;
    assert.match(source, /createNimiDesktopAuditProjectionClient/u);
    assert.doesNotMatch(source, /\.listAuditEvents\s*\(/u);
    assert.doesNotMatch(source, /\.exportAuditEvents\s*\(/u);
    assert.doesNotMatch(source, /startAuditExport/u);
    assert.doesNotMatch(source, /methodId|requestBytes/u);
  });

  test('renders no raw or credential-adjacent audit fields', () => {
    for (const field of [
      'payload',
      'capability',
      'callerId',
      'subjectUserId',
      'surfaceId',
      'principalId',
      'principalType',
      'externalPrincipalType',
      'tokenId',
      'parentTokenId',
      'consentId',
      'consentVersion',
      'policyVersion',
      'resourceSelectorHash',
      'scopeCatalogVersion',
    ]) {
      assert.doesNotMatch(sectionSource, new RegExp(`event\\.${field}\\b`, 'u'));
    }
  });

  test('labels the caller filter and presents typed failures with localized guidance', () => {
    assert.match(sectionSource, /ariaLabel=\{t\('runtimeConfig\.runtime\.filterCallerKind'/u);
    assert.match(sectionSource, /role="alert"/u);
    assert.match(sectionSource, /runtimeConfig\.runtime\.auditReadFailed/u);
  });
});

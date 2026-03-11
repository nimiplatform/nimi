import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  runtimeHealthStatusLabel,
  runtimeHealthStatusColor,
  providerStateColor,
  formatBytes,
  formatCpuMilli,
  callerKindLabel,
  usageWindowLabel,
  formatTokenCount,
  timestampToIso,
  structToRecord,
  relativeTimeShort,
  formatComputeMs,
  formatNumber,
} from '../src/shell/renderer/features/runtime-config/runtime-config-global-audit-view-model';

// ---------------------------------------------------------------------------
// runtimeHealthStatusLabel
// ---------------------------------------------------------------------------

describe('runtimeHealthStatusLabel', () => {
  test('0 → Unspecified', () => {
    assert.equal(runtimeHealthStatusLabel(0), 'Unspecified');
  });

  test('1 → Stopped', () => {
    assert.equal(runtimeHealthStatusLabel(1), 'Stopped');
  });

  test('2 → Starting', () => {
    assert.equal(runtimeHealthStatusLabel(2), 'Starting');
  });

  test('3 → Ready', () => {
    assert.equal(runtimeHealthStatusLabel(3), 'Ready');
  });

  test('4 → Degraded', () => {
    assert.equal(runtimeHealthStatusLabel(4), 'Degraded');
  });

  test('5 → Stopping', () => {
    assert.equal(runtimeHealthStatusLabel(5), 'Stopping');
  });

  test('unknown value → Unspecified', () => {
    assert.equal(runtimeHealthStatusLabel(99), 'Unspecified');
  });
});

// ---------------------------------------------------------------------------
// runtimeHealthStatusColor
// ---------------------------------------------------------------------------

describe('runtimeHealthStatusColor', () => {
  test('READY (3) → green', () => {
    assert.ok(runtimeHealthStatusColor(3).includes('green'));
  });

  test('DEGRADED (4) → yellow', () => {
    assert.ok(runtimeHealthStatusColor(4).includes('yellow'));
  });

  test('STOPPED (1) → red', () => {
    assert.ok(runtimeHealthStatusColor(1).includes('red'));
  });

  test('STARTING (2) → blue', () => {
    assert.ok(runtimeHealthStatusColor(2).includes('blue'));
  });

  test('STOPPING (5) → blue', () => {
    assert.ok(runtimeHealthStatusColor(5).includes('blue'));
  });

  test('UNSPECIFIED (0) → gray', () => {
    assert.ok(runtimeHealthStatusColor(0).includes('gray'));
  });
});

// ---------------------------------------------------------------------------
// providerStateColor
// ---------------------------------------------------------------------------

describe('providerStateColor', () => {
  test('healthy → green', () => {
    assert.ok(providerStateColor('healthy').includes('green'));
  });

  test('unhealthy → red', () => {
    assert.ok(providerStateColor('unhealthy').includes('red'));
  });

  test('degraded → red', () => {
    assert.ok(providerStateColor('degraded').includes('red'));
  });

  test('unknown → gray', () => {
    assert.ok(providerStateColor('unknown').includes('gray'));
  });

  test('case insensitive - Healthy → green', () => {
    assert.ok(providerStateColor('Healthy').includes('green'));
  });
});

// ---------------------------------------------------------------------------
// formatBytes
// ---------------------------------------------------------------------------

describe('formatBytes', () => {
  test('0 → "0 B"', () => {
    assert.equal(formatBytes('0'), '0 B');
  });

  test('1024 → "1.0 KB"', () => {
    assert.equal(formatBytes('1024'), '1.0 KB');
  });

  test('1048576 → "1.0 MB"', () => {
    assert.equal(formatBytes('1048576'), '1.0 MB');
  });

  test('4831838208 → ~4.5 GB', () => {
    const result = formatBytes('4831838208');
    assert.ok(result.includes('GB'));
    assert.ok(result.startsWith('4.5'));
  });

  test('NaN string → "0 B"', () => {
    assert.equal(formatBytes('notanumber'), '0 B');
  });

  test('empty string → "0 B"', () => {
    assert.equal(formatBytes(''), '0 B');
  });
});

// ---------------------------------------------------------------------------
// formatCpuMilli
// ---------------------------------------------------------------------------

describe('formatCpuMilli', () => {
  test('0 → "0 cores"', () => {
    assert.equal(formatCpuMilli('0'), '0 cores');
  });

  test('1000 → "1.0 cores"', () => {
    assert.equal(formatCpuMilli('1000'), '1.0 cores');
  });

  test('1500 → "1.5 cores"', () => {
    assert.equal(formatCpuMilli('1500'), '1.5 cores');
  });

  test('500 → "0.50 cores"', () => {
    assert.equal(formatCpuMilli('500'), '0.50 cores');
  });

  test('NaN → "0 cores"', () => {
    assert.equal(formatCpuMilli('abc'), '0 cores');
  });
});

// ---------------------------------------------------------------------------
// callerKindLabel
// ---------------------------------------------------------------------------

describe('callerKindLabel', () => {
  test('0 (UNSPECIFIED) → "-"', () => {
    assert.equal(callerKindLabel(0), '-');
  });

  test('1 → Desktop Core', () => {
    assert.equal(callerKindLabel(1), 'Desktop Core');
  });

  test('2 → Desktop Mod', () => {
    assert.equal(callerKindLabel(2), 'Desktop Mod');
  });

  test('3 → Third-Party App', () => {
    assert.equal(callerKindLabel(3), 'Third-Party App');
  });

  test('4 → Third-Party Service', () => {
    assert.equal(callerKindLabel(4), 'Third-Party Service');
  });

  test('unknown → "-"', () => {
    assert.equal(callerKindLabel(99), '-');
  });
});

// ---------------------------------------------------------------------------
// usageWindowLabel
// ---------------------------------------------------------------------------

describe('usageWindowLabel', () => {
  test('1 → Minute', () => {
    assert.equal(usageWindowLabel(1), 'Minute');
  });

  test('2 → Hour', () => {
    assert.equal(usageWindowLabel(2), 'Hour');
  });

  test('3 → Day', () => {
    assert.equal(usageWindowLabel(3), 'Day');
  });

  test('0 → "-"', () => {
    assert.equal(usageWindowLabel(0), '-');
  });
});

// ---------------------------------------------------------------------------
// formatTokenCount
// ---------------------------------------------------------------------------

describe('formatTokenCount', () => {
  test('0 → "0"', () => {
    assert.equal(formatTokenCount('0'), '0');
  });

  test('500 → "500"', () => {
    assert.equal(formatTokenCount('500'), '500');
  });

  test('5200 → "5.2K"', () => {
    assert.equal(formatTokenCount('5200'), '5.2K');
  });

  test('5200000 → "5.2M"', () => {
    assert.equal(formatTokenCount('5200000'), '5.2M');
  });

  test('5200000000 → "5.2B"', () => {
    assert.equal(formatTokenCount('5200000000'), '5.2B');
  });

  test('NaN → "0"', () => {
    assert.equal(formatTokenCount('abc'), '0');
  });
});

// ---------------------------------------------------------------------------
// timestampToIso
// ---------------------------------------------------------------------------

describe('timestampToIso', () => {
  test('undefined → "-"', () => {
    assert.equal(timestampToIso(undefined), '-');
  });

  test('valid timestamp → ISO string', () => {
    const ts = { seconds: '1709337600', nanos: 0 };
    const result = timestampToIso(ts);
    assert.ok(result.includes('2024-03-02'));
    assert.ok(result.endsWith('Z'));
  });

  test('with nanos → includes milliseconds', () => {
    const ts = { seconds: '1709337600', nanos: 500_000_000 };
    const result = timestampToIso(ts);
    assert.ok(result.includes('.500'));
  });

  test('NaN seconds → "-"', () => {
    assert.equal(timestampToIso({ seconds: 'abc', nanos: 0 }), '-');
  });
});

// ---------------------------------------------------------------------------
// structToRecord
// ---------------------------------------------------------------------------

describe('structToRecord', () => {
  test('undefined → empty object', () => {
    assert.deepEqual(structToRecord(undefined), {});
  });

  test('null fields → empty object', () => {
    assert.deepEqual(structToRecord({ fields: undefined as unknown as Record<string, unknown> }), {});
  });

  test('valid struct → returns fields', () => {
    const struct = { fields: { key: 'value', count: 42 } };
    assert.deepEqual(structToRecord(struct), { key: 'value', count: 42 });
  });
});

// ---------------------------------------------------------------------------
// relativeTimeShort
// ---------------------------------------------------------------------------

describe('relativeTimeShort', () => {
  test('just now for future time', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    assert.equal(relativeTimeShort(future), 'just now');
  });

  test('Xs ago for recent time', () => {
    const recent = new Date(Date.now() - 30_000).toISOString();
    assert.equal(relativeTimeShort(recent), '30s ago');
  });

  test('Xm ago for minutes', () => {
    const minutes = new Date(Date.now() - 5 * 60_000).toISOString();
    assert.equal(relativeTimeShort(minutes), '5m ago');
  });

  test('Xh ago for hours', () => {
    const hours = new Date(Date.now() - 3 * 3600_000).toISOString();
    assert.equal(relativeTimeShort(hours), '3h ago');
  });

  test('Xd ago for days', () => {
    const days = new Date(Date.now() - 2 * 86400_000).toISOString();
    assert.equal(relativeTimeShort(days), '2d ago');
  });

  test('invalid string → returns as-is', () => {
    assert.equal(relativeTimeShort('not-a-date'), 'not-a-date');
  });
});

// ---------------------------------------------------------------------------
// formatComputeMs
// ---------------------------------------------------------------------------

describe('formatComputeMs', () => {
  test('0 → "0s"', () => {
    assert.equal(formatComputeMs('0'), '0s');
  });

  test('500 → "500ms"', () => {
    assert.equal(formatComputeMs('500'), '500ms');
  });

  test('1500 → "1.5s"', () => {
    assert.equal(formatComputeMs('1500'), '1.5s');
  });

  test('45000 → "45.0s"', () => {
    assert.equal(formatComputeMs('45000'), '45.0s');
  });

  test('NaN → "0s"', () => {
    assert.equal(formatComputeMs('abc'), '0s');
  });
});

// ---------------------------------------------------------------------------
// formatNumber
// ---------------------------------------------------------------------------

describe('formatNumber', () => {
  test('simple number', () => {
    const result = formatNumber('1234');
    assert.ok(result.includes('1') && result.includes('234'));
  });

  test('zero', () => {
    assert.equal(formatNumber('0'), '0');
  });

  test('NaN → returns original string', () => {
    assert.equal(formatNumber('abc'), 'abc');
  });
});

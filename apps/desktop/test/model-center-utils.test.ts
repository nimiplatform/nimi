import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  filterInstalledModels,
  formatBytes,
  formatEta,
  formatSpeed,
  HIGHLIGHT_CLEAR_MS,
  parseTimestamp,
  PROGRESS_RETENTION_MS,
  PROGRESS_SESSION_LIMIT,
  pruneProgressSessions,
  statusLabel,
} from '../src/shell/renderer/features/runtime-config/panels/setup/model-center-utils';

// ---------------------------------------------------------------------------
// statusLabel
// ---------------------------------------------------------------------------

describe('statusLabel', () => {
  test('active → healthy', () => {
    assert.equal(statusLabel('active'), 'healthy');
  });

  test('unhealthy → degraded', () => {
    assert.equal(statusLabel('unhealthy'), 'degraded');
  });

  test('installed → idle', () => {
    assert.equal(statusLabel('installed'), 'idle');
  });

  test('removed → unreachable', () => {
    assert.equal(statusLabel('removed'), 'unreachable');
  });

  test('unknown string → unreachable', () => {
    assert.equal(statusLabel('something-else'), 'unreachable');
  });

  test('empty string → unreachable', () => {
    assert.equal(statusLabel(''), 'unreachable');
  });
});

// ---------------------------------------------------------------------------
// formatBytes
// ---------------------------------------------------------------------------

describe('formatBytes', () => {
  test('0 → "0 B"', () => {
    assert.equal(formatBytes(0), '0 B');
  });

  test('undefined → "0 B"', () => {
    assert.equal(formatBytes(undefined), '0 B');
  });

  test('negative → "0 B"', () => {
    assert.equal(formatBytes(-100), '0 B');
  });

  test('NaN → "0 B"', () => {
    assert.equal(formatBytes(NaN), '0 B');
  });

  test('512 → "512 B"', () => {
    assert.equal(formatBytes(512), '512 B');
  });

  test('1024 → "1.0 KB"', () => {
    assert.equal(formatBytes(1024), '1.0 KB');
  });

  test('1536 → "1.5 KB"', () => {
    assert.equal(formatBytes(1536), '1.5 KB');
  });

  test('1048576 → "1.0 MB"', () => {
    assert.equal(formatBytes(1048576), '1.0 MB');
  });

  test('1073741824 → "1.0 GB"', () => {
    assert.equal(formatBytes(1073741824), '1.0 GB');
  });

  test('1099511627776 → "1.0 TB"', () => {
    assert.equal(formatBytes(1099511627776), '1.0 TB');
  });

  test('beyond TB stays in TB', () => {
    const result = formatBytes(2 * 1099511627776);
    assert.equal(result, '2.0 TB');
  });
});

// ---------------------------------------------------------------------------
// formatSpeed
// ---------------------------------------------------------------------------

describe('formatSpeed', () => {
  test('undefined → "-"', () => {
    assert.equal(formatSpeed(undefined), '-');
  });

  test('0 → "-"', () => {
    assert.equal(formatSpeed(0), '-');
  });

  test('negative → "-"', () => {
    assert.equal(formatSpeed(-500), '-');
  });

  test('NaN → "-"', () => {
    assert.equal(formatSpeed(NaN), '-');
  });

  test('1048576 → "1.0 MB/s"', () => {
    assert.equal(formatSpeed(1048576), '1.0 MB/s');
  });

  test('512 → "512 B/s"', () => {
    assert.equal(formatSpeed(512), '512 B/s');
  });
});

// ---------------------------------------------------------------------------
// formatEta
// ---------------------------------------------------------------------------

describe('formatEta', () => {
  test('undefined → "-"', () => {
    assert.equal(formatEta(undefined), '-');
  });

  test('negative → "-"', () => {
    assert.equal(formatEta(-1), '-');
  });

  test('NaN → "-"', () => {
    assert.equal(formatEta(NaN), '-');
  });

  test('0 → "0s" (ceil of 0 is 0)', () => {
    assert.equal(formatEta(0), '0s');
  });

  test('30 → "30s"', () => {
    assert.equal(formatEta(30), '30s');
  });

  test('59.1 → "60s"', () => {
    assert.equal(formatEta(59.1), '60s');
  });

  test('60 → "1m 0s"', () => {
    assert.equal(formatEta(60), '1m 0s');
  });

  test('90 → "1m 30s"', () => {
    assert.equal(formatEta(90), '1m 30s');
  });

  test('125.3 → "2m 6s"', () => {
    assert.equal(formatEta(125.3), '2m 6s');
  });
});

// ---------------------------------------------------------------------------
// parseTimestamp
// ---------------------------------------------------------------------------

describe('parseTimestamp', () => {
  test('undefined → 0', () => {
    assert.equal(parseTimestamp(undefined), 0);
  });

  test('empty string → 0', () => {
    assert.equal(parseTimestamp(''), 0);
  });

  test('whitespace only → 0', () => {
    assert.equal(parseTimestamp('   '), 0);
  });

  test('invalid date string → 0', () => {
    assert.equal(parseTimestamp('not-a-date'), 0);
  });

  test('valid ISO date → correct ms', () => {
    const ms = parseTimestamp('2025-01-15T10:30:00.000Z');
    assert.equal(ms, Date.parse('2025-01-15T10:30:00.000Z'));
    assert.ok(ms > 0);
  });

  test('valid date string → positive ms', () => {
    const ms = parseTimestamp('2024-06-01');
    assert.ok(ms > 0);
  });
});

// ---------------------------------------------------------------------------
// pruneProgressSessions
// ---------------------------------------------------------------------------

describe('pruneProgressSessions', () => {
  const makeSession = (done: boolean, updatedAtMs: number) => ({
    event: {
      installSessionId: `session-${updatedAtMs}`,
      modelId: 'test-model',
      phase: 'download' as const,
      done,
      success: done,
      bytesReceived: 100,
      bytesTotal: 200,
      speedBytesPerSec: 50,
      etaSeconds: 2,
      message: '',
    },
    updatedAtMs,
  });

  test('empty sessions → same reference returned', () => {
    const sessions = {};
    const result = pruneProgressSessions(sessions, Date.now());
    assert.equal(result, sessions);
  });

  test('non-done sessions → not pruned, same reference', () => {
    const sessions = {
      s1: makeSession(false, Date.now() - PROGRESS_RETENTION_MS - 10000),
    };
    const result = pruneProgressSessions(sessions, Date.now());
    assert.equal(result, sessions);
  });

  test('done but within retention → not pruned, same reference', () => {
    const now = Date.now();
    const sessions = {
      s1: makeSession(true, now - 1000),
    };
    const result = pruneProgressSessions(sessions, now);
    assert.equal(result, sessions);
  });

  test('done and past retention → pruned, new object', () => {
    const now = Date.now();
    const sessions = {
      s1: makeSession(true, now - PROGRESS_RETENTION_MS - 1),
      s2: makeSession(false, now - 5000),
    };
    const result = pruneProgressSessions(sessions, now);
    assert.notEqual(result, sessions);
    assert.equal(Object.keys(result).length, 1);
    assert.ok(result['s2']);
    assert.equal(result['s1'], undefined);
  });

  test('all done and expired → empty object', () => {
    const now = Date.now();
    const sessions = {
      s1: makeSession(true, now - PROGRESS_RETENTION_MS - 100),
      s2: makeSession(true, now - PROGRESS_RETENTION_MS - 200),
    };
    const result = pruneProgressSessions(sessions, now);
    assert.equal(Object.keys(result).length, 0);
  });
});

// ---------------------------------------------------------------------------
// filterInstalledModels
// ---------------------------------------------------------------------------

describe('filterInstalledModels', () => {
  const models = [
    { model: 'Qwen2.5-7B-Instruct', localModelId: 'local-qwen-001', capabilities: ['chat', 'embedding'], engine: 'localai' },
    { model: 'Stable-Diffusion-XL', localModelId: 'local-sd-002', capabilities: ['image'], engine: 'localai' },
    { model: 'Whisper-Large-V3', localModelId: 'local-whisper-003', capabilities: ['stt'], engine: 'nexa' },
    { model: 'XTTS-v2', localModelId: 'local-xtts-004', capabilities: ['tts'], engine: 'localai' },
  ];

  test('empty query → returns all models', () => {
    const result = filterInstalledModels(models, '');
    assert.equal(result, models);
  });

  test('whitespace-only query → returns all models', () => {
    const result = filterInstalledModels(models, '   ');
    assert.equal(result, models);
  });

  test('match by model name', () => {
    const result = filterInstalledModels(models, 'qwen');
    assert.equal(result.length, 1);
    assert.equal(result[0]!.model, 'Qwen2.5-7B-Instruct');
  });

  test('match by localModelId', () => {
    const result = filterInstalledModels(models, 'local-sd');
    assert.equal(result.length, 1);
    assert.equal(result[0]!.model, 'Stable-Diffusion-XL');
  });

  test('match by capability', () => {
    const result = filterInstalledModels(models, 'stt');
    assert.equal(result.length, 1);
    assert.equal(result[0]!.model, 'Whisper-Large-V3');
  });

  test('match by engine', () => {
    const result = filterInstalledModels(models, 'nexa');
    assert.equal(result.length, 1);
    assert.equal(result[0]!.model, 'Whisper-Large-V3');
  });

  test('case insensitive', () => {
    const result = filterInstalledModels(models, 'STABLE');
    assert.equal(result.length, 1);
    assert.equal(result[0]!.model, 'Stable-Diffusion-XL');
  });

  test('multiple matches', () => {
    const result = filterInstalledModels(models, 'localai');
    assert.equal(result.length, 3);
  });

  test('no match → empty array', () => {
    const result = filterInstalledModels(models, 'nonexistent');
    assert.equal(result.length, 0);
  });

  test('empty models array → empty result', () => {
    const result = filterInstalledModels([], 'anything');
    assert.equal(result.length, 0);
  });

  test('partial model fields (missing capabilities/engine)', () => {
    const sparse = [
      { model: 'bare-model', localModelId: 'id-1' },
      { model: 'another', localModelId: 'id-2', capabilities: ['chat'] },
    ];
    const result = filterInstalledModels(sparse, 'bare');
    assert.equal(result.length, 1);
    assert.equal(result[0]!.model, 'bare-model');
  });

  test('match across capability join (multi-word)', () => {
    const result = filterInstalledModels(models, 'embedding');
    assert.equal(result.length, 1);
    assert.equal(result[0]!.model, 'Qwen2.5-7B-Instruct');
  });
});

// ---------------------------------------------------------------------------
// Constants sanity checks
// ---------------------------------------------------------------------------

describe('constants', () => {
  test('PROGRESS_SESSION_LIMIT is positive integer', () => {
    assert.ok(PROGRESS_SESSION_LIMIT > 0);
    assert.equal(PROGRESS_SESSION_LIMIT, Math.floor(PROGRESS_SESSION_LIMIT));
  });

  test('PROGRESS_RETENTION_MS is 15 minutes', () => {
    assert.equal(PROGRESS_RETENTION_MS, 15 * 60 * 1000);
  });

  test('HIGHLIGHT_CLEAR_MS is 8 seconds', () => {
    assert.equal(HIGHLIGHT_CLEAR_MS, 8000);
  });
});

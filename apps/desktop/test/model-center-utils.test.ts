import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import type { TFunction } from 'i18next';

import {
  assetUnhealthyReasonSummary,
  formatBytes,
  formatCompactCount,
  formatDownloadPhaseLabel,
  formatEta,
  formatKnownDownloadSize,
  formatSpeed,
  isRuntimeInstallCancellation,
  localSpeechReasonSummary,
  partitionTransferSessionsByDisplayState,
  parseTimestamp,
  PROGRESS_RETENTION_MS,
  PROGRESS_SESSION_LIMIT,
  pruneProgressSessions,
  sortProgressSessions,
  type ProgressSessionState,
} from '../src/shell/renderer/features/runtime-config/runtime-config-model-center-utils';
import { createNimiError, ReasonCode } from '@nimiplatform/sdk/types';
import { NIMI_RUNTIME_REASON_CODES } from '@nimiplatform/sdk/runtime';

const testTranslate = ((_: string, options?: { defaultValue?: string }) => (
  options?.defaultValue ?? ''
)) as TFunction;

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

  test('1073741824 → "1.00 GB"', () => {
    assert.equal(formatBytes(1073741824), '1.00 GB');
  });

  test('1536 MB worth of bytes keeps two decimals in GB', () => {
    assert.equal(formatBytes(1610612736), '1.50 GB');
  });

  test('1099511627776 → "1.00 TB"', () => {
    assert.equal(formatBytes(1099511627776), '1.00 TB');
  });

  test('beyond TB stays in TB', () => {
    const result = formatBytes(2 * 1099511627776);
    assert.equal(result, '2.00 TB');
  });
});

// ---------------------------------------------------------------------------
// formatCompactCount
// ---------------------------------------------------------------------------

describe('formatCompactCount', () => {
  test('undefined / 0 / negative / NaN → ""', () => {
    assert.equal(formatCompactCount(undefined), '');
    assert.equal(formatCompactCount(0), '');
    assert.equal(formatCompactCount(-5), '');
    assert.equal(formatCompactCount(NaN), '');
  });

  test('below 1000 stays raw', () => {
    assert.equal(formatCompactCount(951), '951');
  });

  test('thousands use k with up to 3 significant digits', () => {
    assert.equal(formatCompactCount(1630), '1.63k');
    assert.equal(formatCompactCount(13900), '13.9k');
    assert.equal(formatCompactCount(151000), '151k');
  });

  test('millions use M with up to 3 significant digits', () => {
    assert.equal(formatCompactCount(5250000), '5.25M');
    assert.equal(formatCompactCount(12331673), '12.3M');
    assert.equal(formatCompactCount(246000000), '246M');
  });

  test('billions use B', () => {
    assert.equal(formatCompactCount(1200000000), '1.20B');
  });
});

describe('formatKnownDownloadSize', () => {
  test('formats a positive Runtime-projected total', () => {
    assert.equal(formatKnownDownloadSize(1610612736, 'size unknown'), '1.50 GB');
  });

  test('does not present an absent total as zero bytes', () => {
    assert.equal(formatKnownDownloadSize(undefined, 'size unknown'), 'size unknown');
    assert.equal(formatKnownDownloadSize(0, 'size unknown'), 'size unknown');
  });
});

test('recognizes typed Runtime install cancellation without parsing copy', () => {
  const error = createNimiError({
    code: 'REQUEST_CANCELED',
    message: 'localized text may change',
    source: 'runtime',
    reasonCode: NIMI_RUNTIME_REASON_CODES.AI_LOCAL_EXECUTION_CANCELED,
    retryable: false,
  });
  assert.equal(isRuntimeInstallCancellation(error), true);
  assert.equal(isRuntimeInstallCancellation(new Error('AI_LOCAL_EXECUTION_CANCELED')), false);
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
// localSpeechReasonSummary
// ---------------------------------------------------------------------------

describe('speech blocking summaries', () => {
  test('maps speech download confirmation reason to user-facing summary', () => {
    assert.equal(
      localSpeechReasonSummary(ReasonCode.AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED),
      'Explicit download confirmation is required before Local Speech setup can continue.',
    );
  });

});

describe('assetUnhealthyReasonSummary', () => {
  test('prefers the speech-specific summary for a speech reason code', () => {
    assert.equal(
      assetUnhealthyReasonSummary(ReasonCode.AI_LOCAL_SPEECH_BUNDLE_DEGRADED),
      'The Runtime local speech bundle is unavailable.',
    );
  });

  test('falls back to the canonical reason-code catalog for non-speech codes', () => {
    assert.equal(
      assetUnhealthyReasonSummary(ReasonCode.AI_LOCAL_MODEL_UNAVAILABLE),
      'Runtime local execution is unavailable.',
    );
  });

  test('returns empty string for an unmapped code so the caller renders generic copy, never the raw code', () => {
    assert.equal(assetUnhealthyReasonSummary('SOME_UNMAPPED_INTERNAL_CODE'), '');
    assert.equal(assetUnhealthyReasonSummary(undefined), '');
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
// formatDownloadPhaseLabel
// ---------------------------------------------------------------------------

describe('formatDownloadPhaseLabel', () => {
  test('download → Downloading', () => {
    assert.equal(formatDownloadPhaseLabel('download', testTranslate), 'Downloading');
  });

  test('verify → Verifying', () => {
    assert.equal(formatDownloadPhaseLabel('verify', testTranslate), 'Verifying');
  });

  test('upsert → Finalizing', () => {
    assert.equal(formatDownloadPhaseLabel('upsert', testTranslate), 'Finalizing');
  });

  test('unknown phase falls back to normalized text', () => {
    assert.equal(formatDownloadPhaseLabel('queued', testTranslate), 'queued');
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
  const makeSession = (done: boolean, updatedAtMs: number): ProgressSessionState => ({
    event: {
      installSessionId: `session-${updatedAtMs}`,
      modelId: 'test-model',
      sessionKind: 'download',
      phase: 'download' as const,
      state: done ? 'completed' : 'running',
      reasonCode: undefined,
      retryable: done ? false : true,
      done,
      success: done,
      bytesReceived: 100,
      bytesTotal: 200,
      speedBytesPerSec: 50,
      etaSeconds: 2,
      message: '',
    },
    updatedAtMs,
    createdAtMs: updatedAtMs - 1000,
  });

  test('empty sessions → same reference returned', () => {
    const sessions = {};
    const result = pruneProgressSessions(sessions, Date.now());
    assert.equal(result, sessions);
  });

  test('non-done sessions → not pruned, same reference', () => {
    const sessions: Record<string, ReturnType<typeof makeSession>> = {
      s1: makeSession(false, Date.now() - PROGRESS_RETENTION_MS - 10000),
    };
    const result = pruneProgressSessions(sessions, Date.now());
    assert.equal(result, sessions);
  });

  test('done but within retention → not pruned, same reference', () => {
    const now = Date.now();
    const sessions: Record<string, ReturnType<typeof makeSession>> = {
      s1: makeSession(true, now - 1000),
    };
    const result = pruneProgressSessions(sessions, now);
    assert.equal(result, sessions);
  });

  test('done and past retention → pruned, new object', () => {
    const now = Date.now();
    const sessions: Record<string, ReturnType<typeof makeSession>> = {
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
    const sessions: Record<string, ReturnType<typeof makeSession>> = {
      s1: makeSession(true, now - PROGRESS_RETENTION_MS - 100),
      s2: makeSession(true, now - PROGRESS_RETENTION_MS - 200),
    };
    const result = pruneProgressSessions(sessions, now);
    assert.equal(Object.keys(result).length, 0);
  });
});

// ---------------------------------------------------------------------------
// sortProgressSessions
// ---------------------------------------------------------------------------

describe('sortProgressSessions', () => {
  const makeState = (
    installSessionId: string,
    state: 'queued' | 'running' | 'paused' | 'failed' | 'completed' | 'cancelled',
    createdAtMs: number,
    updatedAtMs: number,
  ): ProgressSessionState => ({
    event: {
      installSessionId,
      modelId: installSessionId,
      sessionKind: 'download',
      phase: 'download' as const,
      state,
      reasonCode: undefined,
      retryable: state === 'failed',
      done: state === 'completed' || state === 'failed' || state === 'cancelled',
      success: state === 'completed',
      bytesReceived: 100,
      bytesTotal: 200,
      speedBytesPerSec: 50,
      etaSeconds: 2,
      message: '',
    },
    createdAtMs,
    updatedAtMs,
  });

  test('keeps active sessions in stable created order even when updatedAt changes', () => {
    const sessions = {
      newer: makeState('newer', 'running', 2000, 9000),
      older: makeState('older', 'running', 1000, 10000),
    };

    const result = sortProgressSessions(sessions).map((item) => item.event.installSessionId);

    assert.deepEqual(result, ['older', 'newer']);
  });

  test('keeps interactive sessions ahead of completed history', () => {
    const sessions = {
      completed: makeState('completed', 'completed', 1000, 10000),
      running: makeState('running', 'running', 2000, 2000),
      failed: makeState('failed', 'failed', 3000, 3000),
    };

    const result = sortProgressSessions(sessions).map((item) => item.event.installSessionId);

    assert.deepEqual(result, ['running', 'failed', 'completed']);
  });

  test('orders terminal history by latest update descending', () => {
    const sessions = {
      older: makeState('older', 'completed', 1000, 3000),
      newer: makeState('newer', 'completed', 2000, 5000),
    };

    const result = sortProgressSessions(sessions).map((item) => item.event.installSessionId);

    assert.deepEqual(result, ['newer', 'older']);
  });
});

// ---------------------------------------------------------------------------
// partitionTransferSessionsByDisplayState
// ---------------------------------------------------------------------------

describe('partitionTransferSessionsByDisplayState', () => {
  const makeState = (
    installSessionId: string,
    sessionKind: 'download' | 'import',
    state: 'queued' | 'running' | 'paused' | 'failed' | 'completed' | 'cancelled',
    createdAtMs: number,
    updatedAtMs: number,
  ): ProgressSessionState => ({
    event: {
      installSessionId,
      modelId: installSessionId,
      sessionKind,
      phase: 'download' as const,
      state,
      reasonCode: undefined,
      retryable: state === 'failed',
      done: state === 'completed' || state === 'failed' || state === 'cancelled',
      success: state === 'completed',
      bytesReceived: 100,
      bytesTotal: 200,
      speedBytesPerSec: 50,
      etaSeconds: 2,
      message: '',
    },
    createdAtMs,
    updatedAtMs,
  });

  test('splits active and terminal sessions for the requested kind only', () => {
    const sessions = {
      dRun: makeState('d-run', 'download', 'running', 1000, 5000),
      dFail: makeState('d-fail', 'download', 'failed', 2000, 6000),
      iRun: makeState('i-run', 'import', 'running', 3000, 7000),
      iCancel: makeState('i-cancel', 'import', 'cancelled', 4000, 8000),
    };

    const downloads = partitionTransferSessionsByDisplayState(sessions, 'download');
    assert.deepEqual(downloads.active.map((event) => event.installSessionId), ['d-run']);
    assert.deepEqual(downloads.terminal.map((event) => event.installSessionId), ['d-fail']);

    const imports = partitionTransferSessionsByDisplayState(sessions, 'import');
    assert.deepEqual(imports.active.map((event) => event.installSessionId), ['i-run']);
    assert.deepEqual(imports.terminal.map((event) => event.installSessionId), ['i-cancel']);
  });

  test('terminal history never squeezes active sessions out of the limit', () => {
    const sessions: Record<string, ProgressSessionState> = {};
    for (let index = 0; index < PROGRESS_SESSION_LIMIT + 2; index += 1) {
      const id = `active-${index}`;
      sessions[id] = makeState(id, 'download', 'running', 1000 + index, 1000 + index);
    }
    for (let index = 0; index < PROGRESS_SESSION_LIMIT + 4; index += 1) {
      const id = `failed-${index}`;
      sessions[id] = makeState(id, 'download', 'failed', 5000 + index, 5000 + index);
    }

    const result = partitionTransferSessionsByDisplayState(sessions, 'download');

    assert.equal(result.active.length, PROGRESS_SESSION_LIMIT);
    assert.ok(result.active.every((event) => event.state === 'running'));
    assert.equal(result.terminal.length, PROGRESS_SESSION_LIMIT + 4);
    assert.ok(result.terminal.every((event) => event.state === 'failed'));
  });

  test('orders terminal history by latest update descending', () => {
    const sessions = {
      older: makeState('older', 'download', 'failed', 1000, 3000),
      newer: makeState('newer', 'download', 'cancelled', 2000, 9000),
      middle: makeState('middle', 'download', 'failed', 3000, 6000),
    };

    const result = partitionTransferSessionsByDisplayState(sessions, 'download');

    assert.deepEqual(result.terminal.map((event) => event.installSessionId), ['newer', 'middle', 'older']);
  });

  test('completed sessions are excluded from both buckets', () => {
    const sessions = {
      done: makeState('done', 'download', 'completed', 1000, 9000),
      running: makeState('running', 'download', 'running', 2000, 2000),
    };

    const result = partitionTransferSessionsByDisplayState(sessions, 'download');

    assert.deepEqual(result.active.map((event) => event.installSessionId), ['running']);
    assert.deepEqual(result.terminal, []);
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

});

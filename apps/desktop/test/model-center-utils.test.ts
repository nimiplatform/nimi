import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  assetUnhealthyReasonSummary,
  CAPABILITY_OPTIONS,
  formatBytes,
  formatDownloadPhaseLabel,
  formatEta,
  formatSpeed,
  localSpeechReasonSummary,
  planBlockingHint,
  normalizeCapabilityOption,
  HIGHLIGHT_CLEAR_MS,
  parseTimestamp,
  PROGRESS_RETENTION_MS,
  PROGRESS_SESSION_LIMIT,
  pruneProgressSessions,
  sortProgressSessions,
  type ProgressSessionState,
} from '../src/shell/renderer/features/runtime-config/runtime-config-model-center-utils';
import { ReasonCode } from '@nimiplatform/sdk/types';

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
// localSpeechReasonSummary / planBlockingHint
// ---------------------------------------------------------------------------

describe('speech blocking summaries', () => {
  test('maps speech download confirmation reason to user-facing summary', () => {
    assert.equal(
      localSpeechReasonSummary(ReasonCode.AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED),
      'Explicit download confirmation is required before Local Speech setup can continue.',
    );
  });

  test('planBlockingHint prefers speech reason summary over generic host fallback', () => {
    const plan = {
      installAvailable: false,
      warnings: [],
      reasonCode: ReasonCode.AI_LOCAL_SPEECH_HOST_INIT_FAILED,
      engineRuntimeMode: 'supervised',
      engine: 'speech',
    } as unknown as NonNullable<Parameters<typeof planBlockingHint>[0]>;
    assert.equal(
      planBlockingHint(plan),
      'Runtime could not start the local speech capability.',
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
    assert.equal(formatDownloadPhaseLabel('download'), 'Downloading');
  });

  test('verify → Verifying', () => {
    assert.equal(formatDownloadPhaseLabel('verify'), 'Verifying');
  });

  test('upsert → Finalizing', () => {
    assert.equal(formatDownloadPhaseLabel('upsert'), 'Finalizing');
  });

  test('unknown phase falls back to normalized text', () => {
    assert.equal(formatDownloadPhaseLabel('queued'), 'queued');
  });
});

// ---------------------------------------------------------------------------
// capability / engine normalization
// ---------------------------------------------------------------------------

describe('normalizeCapabilityOption', () => {
  test('keeps supported capability', () => {
    assert.equal(normalizeCapabilityOption('tts'), 'tts');
  });

  test('normalizes case and whitespace', () => {
    assert.equal(normalizeCapabilityOption('  STT '), 'stt');
  });

  test('falls back to chat for unknown values', () => {
    assert.equal(normalizeCapabilityOption('rerank'), 'chat');
  });

  test('does not expose deferred runtime-only music capability in desktop local catalog filters', () => {
    assert.equal(CAPABILITY_OPTIONS.includes('music' as never), false);
    assert.equal(normalizeCapabilityOption('music'), 'chat');
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

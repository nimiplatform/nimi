import assert from 'node:assert/strict';
import test from 'node:test';
import { ReasonCode } from '@nimiplatform/sdk/types';

// Stub browser globals for Node.js test environment
if (typeof globalThis.window === 'undefined') {
  (globalThis as Record<string, unknown>).window = {};
}
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  };
}
if (typeof globalThis.sessionStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).sessionStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  };
}

import {
  JOB_POLL_INTERVAL_MS,
  JOB_POLL_MAX_RETRIES,
  isTerminalStatus,
  getJobState,
  startJobTracking,
  feedJobEvent,
  startPollingRecovery,
  requestCancel,
  clearJobTracking,
  subscribeJobEvents,
  type JobControllerDeps,
  type JobPollResult,
  type JobStatus,
  type ScenarioJobState,
} from '../src/shell/renderer/features/turns/scenario-job-controller';

const TEST_JOB = 'test-job-001';

test.afterEach(() => {
  clearJobTracking(TEST_JOB);
});

// ---------------------------------------------------------------------------
// D-STRM-010: Spec constants
// ---------------------------------------------------------------------------

test('D-STRM-010: polling interval is 2000ms per spec', () => {
  assert.equal(JOB_POLL_INTERVAL_MS, 2000);
});

test('D-STRM-010: max poll retries is 30 per spec', () => {
  assert.equal(JOB_POLL_MAX_RETRIES, 30);
});

// ---------------------------------------------------------------------------
// D-STRM-010: Basic lifecycle
// ---------------------------------------------------------------------------

test('D-STRM-010: idle state for unknown jobId', () => {
  const state = getJobState('nonexistent');
  assert.equal(state.phase, 'idle');
  assert.equal(state.jobStatus, null);
});

test('D-STRM-010: startJobTracking sets phase to subscribing', () => {
  startJobTracking(TEST_JOB);
  const state = getJobState(TEST_JOB);
  assert.equal(state.phase, 'subscribing');
  assert.ok(state.startedAt > 0);
});

test('D-STRM-010: feedJobEvent with non-terminal updates jobStatus', () => {
  startJobTracking(TEST_JOB);
  feedJobEvent(TEST_JOB, { status: 'SUBMITTED' });
  assert.equal(getJobState(TEST_JOB).jobStatus, 'SUBMITTED');

  feedJobEvent(TEST_JOB, { status: 'QUEUED' });
  assert.equal(getJobState(TEST_JOB).jobStatus, 'QUEUED');

  feedJobEvent(TEST_JOB, { status: 'RUNNING', progress: 50 });
  const state = getJobState(TEST_JOB);
  assert.equal(state.jobStatus, 'RUNNING');
  assert.equal(state.progress, 50);
  assert.equal(state.phase, 'subscribing');
});

test('D-STRM-010: feedJobEvent with COMPLETED transitions to terminal', () => {
  startJobTracking(TEST_JOB);
  feedJobEvent(TEST_JOB, { status: 'COMPLETED', traceId: 'trace-1' });
  const state = getJobState(TEST_JOB);
  assert.equal(state.phase, 'terminal');
  assert.equal(state.jobStatus, 'COMPLETED');
  assert.equal(state.traceId, 'trace-1');
  assert.ok(state.terminalAt! > 0);
});

test('D-STRM-010: feedJobEvent with FAILED transitions to terminal', () => {
  startJobTracking(TEST_JOB);
  feedJobEvent(TEST_JOB, { status: 'FAILED', reasonCode: ReasonCode.AI_PROVIDER_AUTH_FAILED, reasonDetail: 'Auth expired' });
  const state = getJobState(TEST_JOB);
  assert.equal(state.phase, 'terminal');
  assert.equal(state.jobStatus, 'FAILED');
  assert.equal(state.reasonCode, ReasonCode.AI_PROVIDER_AUTH_FAILED);
  assert.equal(state.errorMessage, 'Auth expired');
});

test('D-STRM-010: events after terminal are ignored', () => {
  startJobTracking(TEST_JOB);
  feedJobEvent(TEST_JOB, { status: 'COMPLETED' });
  feedJobEvent(TEST_JOB, { status: 'RUNNING' });
  assert.equal(getJobState(TEST_JOB).phase, 'terminal');
  assert.equal(getJobState(TEST_JOB).jobStatus, 'COMPLETED');
});

// ---------------------------------------------------------------------------
// D-STRM-010: Terminal status detection
// ---------------------------------------------------------------------------

test('D-STRM-010: isTerminalStatus returns true for all 4 terminal statuses', () => {
  assert.equal(isTerminalStatus('COMPLETED'), true);
  assert.equal(isTerminalStatus('FAILED'), true);
  assert.equal(isTerminalStatus('CANCELED'), true);
  assert.equal(isTerminalStatus('TIMEOUT'), true);
});

test('D-STRM-010: isTerminalStatus returns false for non-terminal statuses', () => {
  assert.equal(isTerminalStatus('SUBMITTED'), false);
  assert.equal(isTerminalStatus('QUEUED'), false);
  assert.equal(isTerminalStatus('RUNNING'), false);
});

// ---------------------------------------------------------------------------
// D-STRM-010: Polling recovery
// ---------------------------------------------------------------------------

test('D-STRM-010: startPollingRecovery enters recovering phase', () => {
  startJobTracking(TEST_JOB);
  const deps = makeDeps({ pollResponses: [{ status: 'RUNNING' }] });
  const ac = startPollingRecovery(TEST_JOB, deps, { pollIntervalMs: 5 });
  assert.equal(getJobState(TEST_JOB).phase, 'recovering');
  ac.abort();
});

test('D-STRM-010: polling detects terminal COMPLETED and stops', async () => {
  startJobTracking(TEST_JOB);
  const deps = makeDeps({
    pollResponses: [
      { status: 'RUNNING', progress: 60 },
      { status: 'COMPLETED', traceId: 'trace-poll' },
    ],
    artifacts: [{ url: 'https://example.com/img.png', mimeType: 'image/png' }],
    pollDelayMs: 5,
  });

  startPollingRecovery(TEST_JOB, deps, { pollIntervalMs: 5 });

  // Wait for polling to complete (2 polls * 5ms + margin)
  await sleep(100);

  const state = getJobState(TEST_JOB);
  assert.equal(state.phase, 'terminal');
  assert.equal(state.jobStatus, 'COMPLETED');
  assert.equal(state.traceId, 'trace-poll');
  assert.ok(state.artifacts);
  assert.equal(state.artifacts!.length, 1);
  assert.equal(state.pollRetryCount, 2);
});

test('D-STRM-010: polling detects terminal FAILED and stops', async () => {
  startJobTracking(TEST_JOB);
  const deps = makeDeps({
    pollResponses: [
      { status: 'RUNNING' },
      { status: 'FAILED', reasonCode: ReasonCode.AI_PROVIDER_ERROR, reasonDetail: 'GPU OOM' },
    ],
    pollDelayMs: 5,
  });

  startPollingRecovery(TEST_JOB, deps, { pollIntervalMs: 5 });
  await sleep(100);

  const state = getJobState(TEST_JOB);
  assert.equal(state.phase, 'terminal');
  assert.equal(state.jobStatus, 'FAILED');
  assert.equal(state.artifacts, null);
});

test('D-STRM-010: polling recovery timeout after max retries', async () => {
  startJobTracking(TEST_JOB);
  // Always return RUNNING — will exhaust retries
  const deps = makeDeps({
    pollResponses: Array.from({ length: JOB_POLL_MAX_RETRIES }, () => ({ status: 'RUNNING' as JobStatus })),
    pollDelayMs: 0,
  });

  startPollingRecovery(TEST_JOB, deps, { pollIntervalMs: 5 });
  await waitFor(() => getJobState(TEST_JOB).phase === 'recovery_timeout', 500);

  const state = getJobState(TEST_JOB);
  assert.equal(state.phase, 'recovery_timeout');
  assert.equal(state.pollRetryCount, JOB_POLL_MAX_RETRIES);
});

test('D-STRM-010: recovery abort controller stops polling', async () => {
  startJobTracking(TEST_JOB);
  let pollCount = 0;
  const deps: JobControllerDeps = {
    pollJob: async () => {
      pollCount++;
      return { status: 'RUNNING' };
    },
    cancelJob: async () => ({ status: 'RUNNING' }),
    fetchArtifacts: async () => [],
  };

  const ac = startPollingRecovery(TEST_JOB, deps, { pollIntervalMs: 5 });

  // Let a few polls run then abort
  await sleep(50);
  ac.abort();
  const countAtAbort = pollCount;
  await sleep(100);

  // No additional polls after abort
  assert.ok(pollCount <= countAtAbort + 1, `Expected no more polls after abort, got ${pollCount} vs ${countAtAbort}`);
});

test('D-STRM-010: starting recovery twice aborts the previous poller for the same job', async () => {
  startJobTracking(TEST_JOB);
  let firstPollCount = 0;
  let secondPollCount = 0;

  const firstDeps: JobControllerDeps = {
    pollJob: async () => {
      firstPollCount++;
      return { status: 'RUNNING' };
    },
    cancelJob: async () => ({ status: 'RUNNING' }),
    fetchArtifacts: async () => [],
  };
  const secondDeps: JobControllerDeps = {
    pollJob: async () => {
      secondPollCount++;
      return { status: 'RUNNING' };
    },
    cancelJob: async () => ({ status: 'RUNNING' }),
    fetchArtifacts: async () => [],
  };

  startPollingRecovery(TEST_JOB, firstDeps, { pollIntervalMs: 5 });
  await sleep(20);
  const firstCountBeforeRestart = firstPollCount;

  startPollingRecovery(TEST_JOB, secondDeps, { pollIntervalMs: 5 });
  await sleep(60);

  assert.equal(secondPollCount > 0, true);
  assert.ok(
    firstPollCount <= firstCountBeforeRestart + 1,
    `Expected prior poller to stop after restart, got ${firstPollCount} vs ${firstCountBeforeRestart}`,
  );
});

test('D-STRM-010: terminal jobs do not restart recovery polling', async () => {
  startJobTracking(TEST_JOB);
  feedJobEvent(TEST_JOB, { status: 'COMPLETED' });

  let pollCount = 0;
  const deps: JobControllerDeps = {
    pollJob: async () => {
      pollCount++;
      return { status: 'RUNNING' };
    },
    cancelJob: async () => ({ status: 'RUNNING' }),
    fetchArtifacts: async () => [],
  };

  const ac = startPollingRecovery(TEST_JOB, deps, { pollIntervalMs: 5 });
  await sleep(20);

  assert.equal(ac.signal.aborted, true);
  assert.equal(getJobState(TEST_JOB).phase, 'terminal');
  assert.equal(pollCount, 0);
});

// ---------------------------------------------------------------------------
// D-STRM-010: Cancel with async-ACK
// ---------------------------------------------------------------------------

test('D-STRM-010: requestCancel with async ACK enters recovery polling', async () => {
  startJobTracking(TEST_JOB);
  feedJobEvent(TEST_JOB, { status: 'RUNNING' });

  const deps = makeDeps({
    cancelResult: { status: 'RUNNING' },
    pollResponses: [{ status: 'RUNNING' }],
    pollDelayMs: 5,
  });

  const promise = requestCancel(TEST_JOB, deps);
  assert.equal(getJobState(TEST_JOB).phase, 'cancelling');
  assert.equal(getJobState(TEST_JOB).cancelRequested, true);
  await promise;
  assert.equal(getJobState(TEST_JOB).phase, 'recovering');
});

test('D-STRM-010: requestCancel with terminal cancel result transitions to terminal', async () => {
  startJobTracking(TEST_JOB);
  feedJobEvent(TEST_JOB, { status: 'RUNNING' });

  const deps = makeDeps({
    cancelResult: { status: 'CANCELED' },
  });

  await requestCancel(TEST_JOB, deps);
  assert.equal(getJobState(TEST_JOB).phase, 'terminal');
  assert.equal(getJobState(TEST_JOB).jobStatus, 'CANCELED');
});

test('D-STRM-010: requestCancel with AI_MEDIA_JOB_NOT_CANCELLABLE polls for final status', async () => {
  startJobTracking(TEST_JOB);
  feedJobEvent(TEST_JOB, { status: 'RUNNING' });

  const deps: JobControllerDeps = {
    pollJob: async () => ({ status: 'COMPLETED', traceId: 'final-trace' }),
    cancelJob: async () => { throw new Error('AI_MEDIA_JOB_NOT_CANCELLABLE'); },
    fetchArtifacts: async () => [],
  };

  await requestCancel(TEST_JOB, deps);
  const state = getJobState(TEST_JOB);
  assert.equal(state.phase, 'terminal');
  assert.equal(state.jobStatus, 'COMPLETED');
});

test('D-STRM-010: requestCancel with AI_MEDIA_JOB_NOT_CANCELLABLE enters recovery when polled status is non-terminal', async () => {
  startJobTracking(TEST_JOB);
  feedJobEvent(TEST_JOB, { status: 'RUNNING' });

  const deps: JobControllerDeps = {
    pollJob: async () => ({ status: 'RUNNING' }),
    cancelJob: async () => { throw new Error('AI_MEDIA_JOB_NOT_CANCELLABLE'); },
    fetchArtifacts: async () => [],
  };

  await requestCancel(TEST_JOB, deps);
  const state = getJobState(TEST_JOB);
  assert.equal(state.phase, 'recovering');
  assert.equal(state.cancelRequested, true);
});

test('D-STRM-010: requestCancel with generic cancel error enters recovery', async () => {
  startJobTracking(TEST_JOB);
  feedJobEvent(TEST_JOB, { status: 'RUNNING' });

  const deps: JobControllerDeps = {
    pollJob: async () => ({ status: 'RUNNING' }),
    cancelJob: async () => { throw new Error('NETWORK_DOWN'); },
    fetchArtifacts: async () => [],
  };

  await requestCancel(TEST_JOB, deps);
  const state = getJobState(TEST_JOB);
  assert.equal(state.phase, 'recovering');
  assert.equal(state.cancelRequested, true);
});

test('D-STRM-010: cancelRequested flag is preserved in state', async () => {
  startJobTracking(TEST_JOB);
  feedJobEvent(TEST_JOB, { status: 'RUNNING' });

  const deps = makeDeps({ cancelResult: { status: 'CANCELED' } });
  await requestCancel(TEST_JOB, deps);

  assert.equal(getJobState(TEST_JOB).cancelRequested, true);
});

// ---------------------------------------------------------------------------
// D-STRM-010: Result retrieval
// ---------------------------------------------------------------------------

test('D-STRM-010: COMPLETED via polling triggers artifact fetch', async () => {
  startJobTracking(TEST_JOB);
  const artifacts = [{ url: 'https://cdn.example/video.mp4', mimeType: 'video/mp4' }];
  const deps = makeDeps({
    pollResponses: [{ status: 'COMPLETED' }],
    artifacts,
    pollDelayMs: 5,
  });

  startPollingRecovery(TEST_JOB, deps, { pollIntervalMs: 5 });
  await sleep(100);

  const state = getJobState(TEST_JOB);
  assert.equal(state.phase, 'terminal');
  assert.equal(state.jobStatus, 'COMPLETED');
  assert.deepEqual(state.artifacts, artifacts);
});

test('D-STRM-010: non-COMPLETED terminal does not fetch artifacts', async () => {
  startJobTracking(TEST_JOB);
  let artifactsFetched = false;
  const deps: JobControllerDeps = {
    pollJob: async () => ({ status: 'FAILED' }),
    cancelJob: async () => ({ status: 'FAILED' }),
    fetchArtifacts: async () => { artifactsFetched = true; return []; },
  };

  startPollingRecovery(TEST_JOB, deps, { pollIntervalMs: 5 });
  await sleep(100);

  assert.equal(artifactsFetched, false);
  assert.equal(getJobState(TEST_JOB).artifacts, null);
});

// ---------------------------------------------------------------------------
// D-STRM-010: Listener pattern
// ---------------------------------------------------------------------------

test('D-STRM-010: subscribeJobEvents receives state updates', () => {
  const received: ScenarioJobState[] = [];
  const unsub = subscribeJobEvents((state) => received.push({ ...state }));

  startJobTracking(TEST_JOB);
  feedJobEvent(TEST_JOB, { status: 'RUNNING' });
  feedJobEvent(TEST_JOB, { status: 'COMPLETED' });

  unsub();
  assert.equal(received.length, 3);
  assert.equal(received[0]!.phase, 'subscribing');
  assert.equal(received[1]!.jobStatus, 'RUNNING');
  assert.equal(received[2]!.phase, 'terminal');
});

test('D-STRM-010: clearJobTracking removes state', () => {
  startJobTracking(TEST_JOB);
  clearJobTracking(TEST_JOB);
  assert.equal(getJobState(TEST_JOB).phase, 'idle');
});

// ---------------------------------------------------------------------------
// D-STRM-010: ScenarioJobState type shape
// ---------------------------------------------------------------------------

test('D-STRM-010: ScenarioJobState includes pollRetryCount field', () => {
  startJobTracking(TEST_JOB);
  const state = getJobState(TEST_JOB);
  assert.equal(typeof state.pollRetryCount, 'number');
  assert.equal(state.pollRetryCount, 0);
});

test('D-STRM-010: ScenarioJobState includes cancelRequested field', () => {
  startJobTracking(TEST_JOB);
  assert.equal(getJobState(TEST_JOB).cancelRequested, false);
});

test('D-STRM-010: ScenarioJobState includes artifacts field', () => {
  startJobTracking(TEST_JOB);
  assert.equal(getJobState(TEST_JOB).artifacts, null);
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(assertion: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (assertion()) {
      return;
    }
    await sleep(10);
  }
  assert.ok(assertion(), `condition was not met within ${timeoutMs}ms`);
}

function makeDeps(options: {
  pollResponses?: JobPollResult[];
  cancelResult?: { status: JobStatus; reasonCode?: string };
  artifacts?: Array<{ url?: string; mimeType?: string }>;
  pollDelayMs?: number;
} = {}): JobControllerDeps {
  let pollIndex = 0;
  const pollResponses = options.pollResponses || [{ status: 'RUNNING' as JobStatus }];
  const pollDelayMs = options.pollDelayMs ?? 0;

  return {
    pollJob: async () => {
      if (pollDelayMs > 0) await sleep(pollDelayMs);
      const response = pollResponses[Math.min(pollIndex, pollResponses.length - 1)]!;
      pollIndex++;
      return response;
    },
    cancelJob: async () => {
      return options.cancelResult || { status: 'RUNNING' as JobStatus };
    },
    fetchArtifacts: async () => {
      return (options.artifacts || []) as Array<{ url?: string; mimeType?: string; [key: string]: unknown }>;
    },
  };
}

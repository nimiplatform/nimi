import assert from 'node:assert/strict';
import test from 'node:test';

import { parseDownloadProgressEvent, parseDownloadSessionSummary } from '../../src/runtime/index.js';
import { ReasonCode } from '../../src/types/index.js';

test('parseDownloadProgressEvent maps Runtime-owned state, reason, and retryability', () => {
  const parsed = parseDownloadProgressEvent({
    installSessionId: 'install-a',
    modelId: 'org/model-a',
    localModelId: 'hf:org-model-a',
    phase: 'download',
    bytesReceived: 512,
    bytesTotal: 1024,
    speedBytesPerSec: 128,
    etaSeconds: 4,
    message: 'downloading',
    state: 'paused',
    reasonCode: ReasonCode.LOCAL_AI_HF_DOWNLOAD_PAUSED,
    retryable: true,
    done: false,
    success: false,
  });

  assert.equal(parsed.state, 'paused');
  assert.equal(parsed.reasonCode, ReasonCode.LOCAL_AI_HF_DOWNLOAD_PAUSED);
  assert.equal(parsed.retryable, true);
});

test('parseDownloadProgressEvent fails closed when Runtime-owned state is missing', () => {
  assert.throws(
    () => parseDownloadProgressEvent({
      installSessionId: 'install-b',
      modelId: 'org/model-b',
      phase: 'download',
      done: true,
      success: true,
    }),
    /Invalid local runtime transfer state: \(missing\)/,
  );
});

test('parseDownloadProgressEvent rejects terminal flags that conflict with Runtime-owned state', () => {
  assert.throws(
    () => parseDownloadProgressEvent({
      installSessionId: 'install-b',
      modelId: 'org/model-b',
      phase: 'download',
      state: 'running',
      done: true,
      success: true,
    }),
    /Invalid local runtime transfer terminal flags for state: running/,
  );
  assert.throws(
    () => parseDownloadProgressEvent({
      installSessionId: 'install-c',
      modelId: 'org/model-c',
      phase: 'download',
      state: 'completed',
      done: true,
      success: false,
    }),
    /Invalid local runtime transfer terminal flags for state: completed/,
  );
});

test('parseDownloadProgressEvent derives terminal flags from valid Runtime-owned state when booleans are omitted', () => {
  const parsed = parseDownloadProgressEvent({
    installSessionId: 'install-d',
    modelId: 'org/model-d',
    phase: 'download',
    state: 'completed',
  });

  assert.equal(parsed.state, 'completed');
  assert.equal(parsed.done, true);
  assert.equal(parsed.success, true);
});

test('parseDownloadSessionSummary maps session state and retryability', () => {
  const parsed = parseDownloadSessionSummary({
    installSessionId: 'install-c',
    modelId: 'org/model-c',
    localModelId: 'hf:org-model-c',
    phase: 'verify',
    state: 'completed',
    bytesReceived: 2048,
    bytesTotal: 2048,
    retryable: false,
    createdAt: '2026-03-04T00:00:00.000Z',
    updatedAt: '2026-03-04T00:10:00.000Z',
  });

  assert.equal(parsed.state, 'completed');
  assert.equal(parsed.retryable, false);
  assert.equal(parsed.bytesReceived, 2048);
});

test('parseDownloadSessionSummary fails closed when Runtime-owned state is invalid', () => {
  assert.throws(
    () => parseDownloadSessionSummary({
      installSessionId: 'install-e',
      modelId: 'org/model-e',
      phase: 'download',
      state: 'complete-ish',
    }),
    /Invalid local runtime transfer state: complete-ish/,
  );
});

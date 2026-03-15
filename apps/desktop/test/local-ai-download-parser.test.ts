import assert from 'node:assert/strict';
import test from 'node:test';

import { ReasonCode } from '@nimiplatform/sdk/types';
import {
  parseDownloadProgressEvent,
  parseDownloadSessionSummary,
} from '../src/runtime/local-runtime/parsers.js';

test('parseDownloadProgressEvent maps state/reason/retryable', () => {
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

test('parseDownloadProgressEvent derives terminal state when state is missing', () => {
  const parsed = parseDownloadProgressEvent({
    installSessionId: 'install-b',
    modelId: 'org/model-b',
    phase: 'download',
    done: true,
    success: false,
  });

  assert.equal(parsed.state, 'failed');
});

test('parseDownloadSessionSummary maps session state and retryable', () => {
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

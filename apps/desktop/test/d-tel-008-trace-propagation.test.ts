import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { ReasonCode } from '@nimiplatform/sdk/types';
import { emitAuthLog } from '../src/runtime/data-sync/auth';
import { normalizeApiError } from '../src/runtime/net/error-normalize';
import { setRuntimeLogger } from '../src/runtime/telemetry/logger.js';

const DATA_SYNC_FACADE_PATH = resolve(import.meta.dirname, '../src/runtime/data-sync/facade.ts');
const KERNEL_UTILS_PATH = resolve(import.meta.dirname, '../src/runtime/execution-kernel/kernel/kernel-service-utils.ts');
const LOCAL_TURN_FLOW_PATH = resolve(import.meta.dirname, '../src/runtime/execution-kernel/kernel/flows/local-turn-flow.ts');
const LIFECYCLE_FLOW_PATH = resolve(import.meta.dirname, '../src/runtime/execution-kernel/kernel/flows/lifecycle-flow.ts');

test.afterEach(() => {
  setRuntimeLogger(null);
});

test('D-TEL-008: normalizeApiError preserves trace_id and structured fields from API bodies', () => {
  const error = normalizeApiError({
    status: 503,
    statusText: 'Service Unavailable',
    body: JSON.stringify({
      reasonCode: ReasonCode.REALM_UNAVAILABLE,
      actionHint: 'retry_later',
      trace_id: 'trace-api-001',
      retryable: true,
      message: 'realm unavailable',
    }),
  }) as Error & {
    reasonCode?: string;
    actionHint?: string;
    traceId?: string;
    retryable?: boolean;
  };

  assert.equal(error.reasonCode, 'REALM_UNAVAILABLE');
  assert.equal(error.actionHint, 'retry_later');
  assert.equal(error.traceId, 'trace-api-001');
  assert.equal(error.retryable, true);
});

test('D-TEL-008: emitAuthLog forwards top-level traceId and flowId', () => {
  const logs: Array<Record<string, unknown>> = [];
  setRuntimeLogger((payload) => {
    logs.push(payload as Record<string, unknown>);
  });

  emitAuthLog({
    level: 'error',
    message: 'action:login:failed',
    traceId: 'trace-auth-001',
    details: {
      flowId: 'flow-auth-001',
    },
  });

  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.traceId, 'trace-auth-001');
  assert.equal(logs[0]?.flowId, 'flow-auth-001');
});

test('D-TEL-008: DataSync and execution-kernel log sites propagate extracted trace fields', () => {
  const sources = [
    readFileSync(DATA_SYNC_FACADE_PATH, 'utf8'),
    readFileSync(KERNEL_UTILS_PATH, 'utf8'),
    readFileSync(LOCAL_TURN_FLOW_PATH, 'utf8'),
    readFileSync(LIFECYCLE_FLOW_PATH, 'utf8'),
  ];

  for (const source of sources) {
    assert.match(source, /traceId:\s*errorFields\.traceId/, 'traceId should be forwarded from extracted error fields');
    assert.match(source, /reasonCode:\s*errorFields\.reasonCode/, 'reasonCode should be forwarded from extracted error fields');
  }
});

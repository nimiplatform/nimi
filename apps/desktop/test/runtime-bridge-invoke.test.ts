import assert from 'node:assert/strict';
import test from 'node:test';

import { toBridgeNimiError, toBridgeUserError } from '../src/shell/renderer/bridge/runtime-bridge/invoke';

test('toBridgeUserError maps LOCAL_RUNTIME_LIFECYCLE_WRITE_DENIED reason code', () => {
  const error = toBridgeUserError(new Error('LOCAL_RUNTIME_LIFECYCLE_WRITE_DENIED: caller=sideload'));
  assert.equal(error.reasonCode, 'LOCAL_RUNTIME_LIFECYCLE_WRITE_DENIED');
  assert.equal(error.message, 'LOCAL_RUNTIME_LIFECYCLE_WRITE_DENIED: caller=sideload');
  assert.equal(String(error.details?.userMessage || ''), '当前来源无权执行模型生命周期写操作');
});

test('toBridgeUserError keeps generic fallback for unknown runtime reason', () => {
  const error = toBridgeUserError(new Error('SOME_UNKNOWN_RUNTIME_REASON'));
  assert.equal(error.message, 'SOME_UNKNOWN_RUNTIME_REASON');
});

test('toBridgeNimiError preserves structured payload fields and adds userMessage', () => {
  const error = toBridgeNimiError(JSON.stringify({
    reasonCode: 'AI_PROVIDER_TIMEOUT',
    actionHint: 'retry_or_switch_route',
    traceId: 'trace-bridge-001',
    retryable: true,
    message: 'provider timeout',
  }));
  assert.equal(error.reasonCode, 'AI_PROVIDER_TIMEOUT');
  assert.equal(error.actionHint, 'retry_or_switch_route');
  assert.equal(error.traceId, 'trace-bridge-001');
  assert.equal(error.retryable, true);
  assert.equal(error.message, 'provider timeout');
  assert.equal(
    String(error.details?.userMessage || ''),
    'AI 服务超时',
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { toBridgeUserError } from '../src/shell/renderer/bridge/runtime-bridge/invoke';

test('toBridgeUserError maps LOCAL_RUNTIME_LIFECYCLE_WRITE_DENIED reason code', () => {
  const error = toBridgeUserError(new Error('LOCAL_RUNTIME_LIFECYCLE_WRITE_DENIED: caller=sideload'));
  assert.equal(error.message, '当前来源无权执行模型生命周期写操作');
});

test('toBridgeUserError keeps generic fallback for unknown runtime reason', () => {
  const error = toBridgeUserError(new Error('SOME_UNKNOWN_RUNTIME_REASON'));
  assert.equal(error.message, 'SOME_UNKNOWN_RUNTIME_REASON');
});


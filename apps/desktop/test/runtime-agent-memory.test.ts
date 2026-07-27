import assert from 'node:assert/strict';
import test from 'node:test';

import { createRuntimeAgentMemoryAdapter } from '../src/shell/renderer/infra/runtime-agent-memory';

test('runtime agent memory adapter does not touch platform runtime before first operation', () => {
  let getRuntimeCalls = 0;
  createRuntimeAgentMemoryAdapter({
    getRuntime: () => {
      getRuntimeCalls += 1;
      throw new Error('getRuntime should not run during adapter creation');
    },
  });
  assert.equal(getRuntimeCalls, 0);
});

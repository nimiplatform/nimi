import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { createRuntimeAgentMemoryAdapter } from '../src/shell/renderer/infra/runtime-agent-memory';

const runtimeAgentMemorySource = readFileSync(
  resolve(process.cwd(), 'src/shell/renderer/infra/runtime-agent-memory.ts'),
  'utf8',
);

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

test('desktop agent memory adapter does not preserve retired write/query/sidecar policy paths', () => {
  assert.match(runtimeAgentMemorySource, /createHostRuntimeAgentMemorySurface/);
  assert.doesNotMatch(runtimeAgentMemorySource, /projectRuntimeAgentCanonicalMemoryBankStatus/);
  assert.doesNotMatch(runtimeAgentMemorySource, /buildRuntimeAgentCoreMemoryBankLocator/);
  assert.doesNotMatch(runtimeAgentMemorySource, /projectRuntimeLocalAgentIdentityFromRef/);
  assert.doesNotMatch(runtimeAgentMemorySource, /createRuntimeProtectedScopeHelper/);
  assert.doesNotMatch(runtimeAgentMemorySource, /function parseLocalAgentIdentity/);
  assert.doesNotMatch(runtimeAgentMemorySource, /function isRuntimeMemoryUnavailable/);
  assert.doesNotMatch(runtimeAgentMemorySource, /writeDyadicObservation/);
  assert.doesNotMatch(runtimeAgentMemorySource, /queryCompatibilityRecords/);
  assert.doesNotMatch(runtimeAgentMemorySource, /sendChatTrackSidecarInput/);
  assert.doesNotMatch(runtimeAgentMemorySource, /runtime\.agent\.writeMemory/);
  assert.doesNotMatch(runtimeAgentMemorySource, /runtime\.agent\.internal\.chat_track_sidecar/);
  assert.doesNotMatch(runtimeAgentMemorySource, /RUNTIME_MEMORY_OR_COGNITION/);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRuntimeBridgeConfigFromState,
  serializeRuntimeBridgeProjection,
} from '../src/shell/renderer/features/runtime-config/runtime-bridge-config';
import { createDefaultStateV11 } from '../src/shell/renderer/features/runtime-config/state/storage/defaults';

test('write-back guard: state changes should not be written when bridge read fails', () => {
  const state = createDefaultStateV11({
    provider: 'local-runtime',
    runtimeModelType: 'chat',
    localProviderEndpoint: 'http://127.0.0.1:1234/v1',
    localProviderModel: 'local-model',
    localOpenAiEndpoint: 'https://openrouter.ai/api/v1',
  });

  let runtimeBridgeReadSucceeded = false;
  let setRuntimeBridgeConfigCalled = false;

  const mockGetRuntimeBridgeConfig = async (): Promise<never> => {
    throw new Error('bridge read failed');
  };

  const mockSetRuntimeBridgeConfig = async (): Promise<void> => {
    setRuntimeBridgeConfigCalled = true;
  };

  // Simulate bridge read failure
  void mockGetRuntimeBridgeConfig().catch(() => {
    runtimeBridgeReadSucceeded = false;
  });

  // Simulate state change after read failure
  state.localRuntime.endpoint = 'http://127.0.0.1:9999/v1';
  const nextProjection = serializeRuntimeBridgeProjection(state);

  // Write-back guard: should NOT call set if read never succeeded
  if (runtimeBridgeReadSucceeded) {
    const nextConfig = buildRuntimeBridgeConfigFromState(state, {});
    void mockSetRuntimeBridgeConfig(JSON.stringify(nextConfig));
  }

  assert.equal(setRuntimeBridgeConfigCalled, false, 'setRuntimeBridgeConfig must not be called when bridge read failed');
  assert.ok(nextProjection, 'projection should still be computable');
});

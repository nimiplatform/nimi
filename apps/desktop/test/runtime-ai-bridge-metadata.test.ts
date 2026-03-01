import assert from 'node:assert/strict';
import test from 'node:test';

type TauriInvokeCall = {
  command: string;
  payload: unknown;
};

test('runtime ai bridge metadata remains managed only for token-api requests', async () => {
  const calls: TauriInvokeCall[] = [];
  const globalRecord = globalThis as Record<string, unknown>;
  const previousTauri = globalRecord.__TAURI__;

  globalRecord.__TAURI__ = {
    core: {
      invoke: async (command: string, payload?: unknown) => {
        calls.push({ command, payload });
        if (command === 'credential_get_secret') {
          return 'sk-live-in-memory';
        }
        return null;
      },
    },
  };

  try {
    const runtimeAiBridge = await import('../src/runtime/llm-adapter/execution/runtime-ai-bridge');
    const metadata = await runtimeAiBridge.buildRuntimeRequestMetadata({
      source: 'token-api',
      connectorId: 'connector-test',
      providerEndpoint: 'https://example.invalid/v1',
    });
    assert.deepEqual(metadata, {
      keySource: 'managed',
    });

    const callOptions = await runtimeAiBridge.buildRuntimeCallOptions({
      modId: 'mod.runtime.metadata',
      timeoutMs: 10_000,
      source: 'token-api',
      connectorId: 'connector-test',
      providerEndpoint: 'https://example.invalid/v1',
    });
    assert.deepEqual(callOptions.metadata, {
      callerKind: 'desktop-mod',
      callerId: 'mod:mod.runtime.metadata',
      surfaceId: 'desktop.renderer',
      keySource: 'managed',
    });

    const streamOptions = await runtimeAiBridge.buildRuntimeStreamOptions({
      modId: 'mod.runtime.metadata',
      timeoutMs: 10_000,
      source: 'token-api',
      connectorId: 'connector-test',
      providerEndpoint: 'https://example.invalid/v1',
    });
    assert.deepEqual(streamOptions.metadata, {
      callerKind: 'desktop-mod',
      callerId: 'mod:mod.runtime.metadata',
      surfaceId: 'desktop.renderer',
      keySource: 'managed',
    });

    assert.equal(
      calls.some((call) => call.command === 'credential_get_secret'),
      false,
    );
  } finally {
    if (typeof previousTauri === 'undefined') {
      delete globalRecord.__TAURI__;
    } else {
      globalRecord.__TAURI__ = previousTauri;
    }
  }
});

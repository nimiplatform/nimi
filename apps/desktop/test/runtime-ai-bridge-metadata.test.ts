import assert from 'node:assert/strict';
import test from 'node:test';

type TauriInvokeCall = {
  command: string;
  payload: unknown;
};

test('runtime ai bridge metadata remains managed only for cloud requests', async () => {
  const calls: TauriInvokeCall[] = [];
  const globalRecord = globalThis as Record<string, unknown>;
  const previousTauri = globalRecord.__TAURI__;

  globalRecord.__TAURI__ = {
    core: {
      invoke: async (command: string, payload?: unknown) => {
        calls.push({ command, payload });
        return null;
      },
    },
  };

  try {
    const runtimeAiBridge = await import('../src/runtime/llm-adapter/execution/runtime-ai-bridge');
    const metadata = await runtimeAiBridge.buildRuntimeRequestMetadata({
      source: 'cloud',
      connectorId: 'connector-test',
      providerEndpoint: 'https://example.invalid/v1',
    });
    assert.equal(metadata.keySource, 'managed');
    assert.equal(typeof metadata.traceId, 'string');
    assert.ok(String(metadata.traceId || '').trim().length > 0);
    assert.equal(metadata['x-nimi-trace-id'], metadata.traceId);

    const callOptions = await runtimeAiBridge.buildRuntimeCallOptions({
      modId: 'mod.runtime.metadata',
      timeoutMs: 10_000,
      source: 'cloud',
      connectorId: 'connector-test',
      providerEndpoint: 'https://example.invalid/v1',
    });
    assert.equal(callOptions.metadata.callerKind, 'desktop-mod');
    assert.equal(callOptions.metadata.callerId, 'mod:mod.runtime.metadata');
    assert.equal(callOptions.metadata.surfaceId, 'desktop.renderer');
    assert.equal(callOptions.metadata.keySource, 'managed');
    assert.equal(typeof callOptions.metadata.traceId, 'string');
    assert.ok(callOptions.metadata.traceId.length > 0);

    const streamOptions = await runtimeAiBridge.buildRuntimeStreamOptions({
      modId: 'mod.runtime.metadata',
      timeoutMs: 10_000,
      source: 'cloud',
      connectorId: 'connector-test',
      providerEndpoint: 'https://example.invalid/v1',
    });
    assert.equal(streamOptions.metadata.callerKind, 'desktop-mod');
    assert.equal(streamOptions.metadata.callerId, 'mod:mod.runtime.metadata');
    assert.equal(streamOptions.metadata.surfaceId, 'desktop.renderer');
    assert.equal(streamOptions.metadata.keySource, 'managed');
    assert.equal(typeof streamOptions.metadata.traceId, 'string');
    assert.ok(streamOptions.metadata.traceId.length > 0);

    assert.equal(
      calls.some((call) => call.command.startsWith('credential')),
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

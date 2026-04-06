import assert from 'node:assert/strict';
import test from 'node:test';

import { clearPlatformClient, createPlatformClient } from '@nimiplatform/sdk';
import { describeRuntimeRouteMetadata } from '../src/shell/renderer/infra/bootstrap/runtime-bootstrap-host-capabilities-route-describe.js';

type TauriInvokeCall = {
  command: string;
  payload: Record<string, unknown>;
};

type MutableGlobalTauri = Record<string, unknown> & {
  __NIMI_TAURI_TEST__?: {
    invoke?: (command: string, payload?: unknown) => Promise<unknown>;
    listen?: () => () => void;
  };
  window?: Record<string, unknown> & {
    __NIMI_TAURI_TEST__?: {
      invoke?: (command: string, payload?: unknown) => Promise<unknown>;
      listen?: () => () => void;
    };
  };
};

function unwrapPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }
  const root = payload as Record<string, unknown>;
  const nested = root.payload;
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) {
    return {};
  }
  return nested as Record<string, unknown>;
}

function installTauriRuntime(
  calls: TauriInvokeCall[],
  responseMetadata?: Record<string, string>,
): () => void {
  const target = globalThis as unknown as MutableGlobalTauri;
  const previousRoot = target.__NIMI_TAURI_TEST__;
  const previousWindow = target.window;

  const invoke = async (command: string, payload?: unknown) => {
    calls.push({
      command,
      payload: unwrapPayload(payload),
    });
    return {
      responseBytesBase64: '',
      ...(responseMetadata ? { responseMetadata } : {}),
    };
  };

  const windowObject = previousWindow || {};
  windowObject.__NIMI_TAURI_TEST__ = { invoke, listen: () => () => {} };
  target.__NIMI_TAURI_TEST__ = { invoke, listen: () => () => {} };
  target.window = windowObject;

  return () => {
    if (typeof previousRoot === 'undefined') {
      delete target.__NIMI_TAURI_TEST__;
    } else {
      target.__NIMI_TAURI_TEST__ = previousRoot;
    }
    if (typeof previousWindow === 'undefined') {
      target.window = undefined;
    } else {
      target.window = previousWindow;
    }
  };
}

function findRuntimeBridgeUnary(calls: TauriInvokeCall[]): TauriInvokeCall | undefined {
  return calls.find((call) => call.command === 'runtime_bridge_unary');
}

test('describeRuntimeRouteMetadata decodes text.generate typed metadata from runtime response header', async () => {
  const calls: TauriInvokeCall[] = [];
  const encoded = Buffer.from(JSON.stringify({
    capability: 'text.generate',
    metadataVersion: 'v1',
    resolvedBindingRef: 'binding-local-001',
    metadataKind: 'text.generate',
    metadata: {
      supportsThinking: false,
      traceModeSupport: 'none',
      supportsImageInput: true,
      supportsAudioInput: false,
      supportsVideoInput: false,
      supportsArtifactRefInput: true,
    },
  }), 'utf8').toString('base64');
  const restoreTauri = installTauriRuntime(calls, {
    'x-nimi-route-describe-result': encoded,
  });

  try {
    clearPlatformClient();
    await createPlatformClient({
      realmBaseUrl: 'http://localhost:3002',
    });

    const result = await describeRuntimeRouteMetadata({
      modId: 'core:runtime',
      capability: 'text.generate',
      resolvedBindingRef: 'binding-local-001',
      resolvedBinding: {
        capability: 'text.generate',
        source: 'local',
        provider: 'llama',
        model: 'qwen3-chat',
        modelId: 'qwen3-chat',
        localModelId: 'desktop-local-asset-1',
        goRuntimeLocalModelId: 'runtime-local-asset-1',
        engine: 'llama',
        connectorId: '',
      },
    });

    assert.equal(result.metadataKind, 'text.generate');
    assert.equal(result.metadata.supportsThinking, false);
    assert.equal(result.metadata.supportsImageInput, true);

    const unaryCall = findRuntimeBridgeUnary(calls);
    assert.ok(unaryCall);
    const requestBytesBase64 = String(unaryCall?.payload.requestBytesBase64 || '').trim();
    const requestText = Buffer.from(requestBytesBase64, 'base64').toString('utf8');
    assert.equal(requestText.includes('nimi.scenario.text_generate.route_describe'), true);
    assert.equal(requestText.includes('binding-local-001'), true);
    assert.equal(requestText.includes('desktop-local-asset-1'), true);
    assert.equal(requestText.includes('runtime-local-asset-1'), true);
    assert.equal(requestText.includes('qwen3-chat'), true);
  } finally {
    clearPlatformClient();
    restoreTauri();
  }
});

test('describeRuntimeRouteMetadata keeps Desktop inline cloud route fail-closed', async () => {
  const calls: TauriInvokeCall[] = [];
  const restoreTauri = installTauriRuntime(calls);

  try {
    clearPlatformClient();
    await createPlatformClient({
      realmBaseUrl: 'http://localhost:3002',
    });

    await assert.rejects(() => describeRuntimeRouteMetadata({
      modId: 'core:runtime',
      capability: 'text.generate',
      resolvedBindingRef: 'binding-inline-cloud',
      resolvedBinding: {
        capability: 'text.generate',
        source: 'cloud',
        provider: 'openai',
        model: 'gpt-4o-mini',
        modelId: 'gpt-4o-mini',
        connectorId: '',
      },
    }), /managed connector authority on Desktop/);

    assert.equal(calls.length, 0);
  } finally {
    clearPlatformClient();
    restoreTauri();
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { getPlatformClient, initializePlatformClient } from '../src/runtime/platform-client';

type TauriInvokeCall = {
  command: string;
  payload: Record<string, unknown>;
};

type TauriRuntime = {
  core: {
    invoke: (command: string, payload?: unknown) => Promise<unknown>;
  };
  event: {
    listen: () => () => void;
  };
};

type MutableGlobalTauri = typeof globalThis & {
  __TAURI__?: TauriRuntime;
  window?: { __TAURI__?: TauriRuntime };
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

function installTauriRuntime(calls: TauriInvokeCall[]): () => void {
  const target = globalThis as MutableGlobalTauri;
  const previousRoot = target.__TAURI__;
  const previousWindow = target.window;
  const runtime: TauriRuntime = {
    core: {
      invoke: async (command: string, payload?: unknown) => {
        calls.push({
          command,
          payload: unwrapPayload(payload),
        });
        return { responseBytesBase64: '' };
      },
    },
    event: {
      listen: () => () => {},
    },
  };

  const windowObject = previousWindow || {};
  windowObject.__TAURI__ = runtime;
  target.__TAURI__ = runtime;
  target.window = windowObject;

  return () => {
    if (typeof previousRoot === 'undefined') {
      delete target.__TAURI__;
    } else {
      target.__TAURI__ = previousRoot;
    }

    if (typeof previousWindow === 'undefined') {
      delete target.window;
    } else {
      target.window = previousWindow;
    }
  };
}

test('platform runtime call injects bearer token from accessTokenProvider', async () => {
  const calls: TauriInvokeCall[] = [];
  const restoreTauri = installTauriRuntime(calls);
  try {
    await initializePlatformClient({
      realmBaseUrl: 'http://localhost:3002',
      accessTokenProvider: () => 'token-provider-value',
    });

    await getPlatformClient().runtime.model.list({});

    const unaryCall = calls.find((item) => item.command === 'runtime_bridge_unary');
    assert.ok(unaryCall);
    assert.equal(unaryCall.payload.authorization, 'Bearer token-provider-value');
  } finally {
    restoreTauri();
  }
});

test('platform runtime call resolves fresh token on each invocation', async () => {
  const calls: TauriInvokeCall[] = [];
  const restoreTauri = installTauriRuntime(calls);
  let currentToken = 'token-initial';
  try {
    await initializePlatformClient({
      realmBaseUrl: 'http://localhost:3002',
      accessTokenProvider: () => currentToken,
    });

    await getPlatformClient().runtime.model.list({});
    currentToken = 'token-refreshed';
    await getPlatformClient().runtime.model.list({});

    const unaryCalls = calls.filter((item) => item.command === 'runtime_bridge_unary');
    assert.ok(unaryCalls.length >= 2);
    assert.equal(unaryCalls[0]?.payload.authorization, 'Bearer token-initial');
    assert.equal(unaryCalls[1]?.payload.authorization, 'Bearer token-refreshed');
  } finally {
    restoreTauri();
  }
});

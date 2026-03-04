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

function toBase64Url(input: string): string {
  return Buffer.from(input, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createJwtWithSub(sub: string): string {
  const header = toBase64Url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = toBase64Url(JSON.stringify({ sub }));
  return `${header}.${payload}.signature`;
}

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

async function invokeGenerateWithoutSubject(): Promise<void> {
  await getPlatformClient().runtime.ai.generate({
    appId: getPlatformClient().runtime.appId,
    modelId: 'cloud/default',
    modal: 1,
    input: [{
      role: 'user',
      content: 'hello',
      name: '',
    }],
    systemPrompt: '',
    tools: [],
    temperature: 0,
    topP: 0,
    maxTokens: 32,
    routePolicy: 2,
    fallback: 1,
    timeoutMs: 1000,
    connectorId: '',
  });
}

function assertUnaryRequestContains(calls: TauriInvokeCall[], expectedText: string): void {
  const unaryCall = calls.findLast((item) => item.command === 'runtime_bridge_unary');
  assert.ok(unaryCall);
  const requestBytesBase64 = String(unaryCall.payload.requestBytesBase64 || '').trim();
  assert.ok(requestBytesBase64.length > 0);
  const requestText = Buffer.from(requestBytesBase64, 'base64').toString('utf8');
  assert.equal(requestText.includes(expectedText), true);
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

test('platform runtime call injects subjectUserId from subjectUserIdProvider', async () => {
  const calls: TauriInvokeCall[] = [];
  const restoreTauri = installTauriRuntime(calls);
  try {
    await initializePlatformClient({
      realmBaseUrl: 'http://localhost:3002',
      accessTokenProvider: () => createJwtWithSub('jwt-subject-user'),
      subjectUserIdProvider: () => 'subject-from-provider',
    });

    await invokeGenerateWithoutSubject();
    assertUnaryRequestContains(calls, 'subject-from-provider');
  } finally {
    restoreTauri();
  }
});

test('platform runtime call falls back to jwt sub when subjectUserIdProvider is empty', async () => {
  const calls: TauriInvokeCall[] = [];
  const restoreTauri = installTauriRuntime(calls);
  try {
    await initializePlatformClient({
      realmBaseUrl: 'http://localhost:3002',
      accessTokenProvider: () => createJwtWithSub('jwt-subject-fallback'),
      subjectUserIdProvider: () => '',
    });

    await invokeGenerateWithoutSubject();
    assertUnaryRequestContains(calls, 'jwt-subject-fallback');
  } finally {
    restoreTauri();
  }
});

test('platform runtime call omits authorization when token provider returns empty', async () => {
  const calls: TauriInvokeCall[] = [];
  const restoreTauri = installTauriRuntime(calls);
  try {
    await initializePlatformClient({
      realmBaseUrl: 'http://localhost:3002',
      accessTokenProvider: () => '',
    });

    await getPlatformClient().runtime.model.list({});

    const unaryCall = calls.find((item) => item.command === 'runtime_bridge_unary');
    assert.ok(unaryCall);
    assert.equal(unaryCall.payload.authorization, undefined);
  } finally {
    restoreTauri();
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { getPlatformClient, createPlatformClient } from '@nimiplatform/sdk';

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

type MutableGlobalTauri = Record<string, unknown> & {
  __NIMI_TAURI_TEST__?: {
    invoke?: TauriRuntime['core']['invoke'];
    listen?: TauriRuntime['event']['listen'];
  };
  window?: Record<string, unknown> & {
    __NIMI_TAURI_TEST__?: {
      invoke?: TauriRuntime['core']['invoke'];
      listen?: TauriRuntime['event']['listen'];
    };
  };
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
  const target = globalThis as unknown as MutableGlobalTauri;
  const previousRoot = target.__NIMI_TAURI_TEST__;
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
  windowObject.__NIMI_TAURI_TEST__ = { invoke: runtime.core.invoke, listen: runtime.event.listen };
  target.__NIMI_TAURI_TEST__ = { invoke: runtime.core.invoke, listen: runtime.event.listen };
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

async function invokeGenerateWithoutSubject(): Promise<void> {
  await getPlatformClient().runtime.ai.executeScenario({
    head: {
      appId: getPlatformClient().runtime.appId,
      modelId: 'cloud/default',
      routePolicy: 2,
      timeoutMs: 1000,
      connectorId: '',
    },
    scenarioType: 1,
    executionMode: 1,
    extensions: [],
    spec: {
      spec: {
        oneofKind: 'textGenerate',
        textGenerate: {
          input: [{
            role: 'user',
            content: 'hello',
            name: '',
            parts: [],
          }],
          systemPrompt: '',
          tools: [],
          temperature: 0,
          topP: 0,
          maxTokens: 32,
        },
      },
    },
  });
}

async function invokeLocalGenerateWithoutSubject(): Promise<void> {
  await getPlatformClient().runtime.ai.executeScenario({
    head: {
      appId: getPlatformClient().runtime.appId,
      modelId: 'llama/bartowski/Qwen_Qwen3.5-0.8B-GGUF',
      routePolicy: 1,
      timeoutMs: 60_000,
      connectorId: '',
    },
    scenarioType: 1,
    executionMode: 1,
    extensions: [],
    spec: {
      spec: {
        oneofKind: 'textGenerate',
        textGenerate: {
          input: [{
            role: 'user',
            content: 'hello',
            name: '',
            parts: [],
          }],
          systemPrompt: '',
          tools: [],
          temperature: 0,
          topP: 0,
          maxTokens: 32,
        },
      },
    },
  });
}

function findUnaryCallByMethodId(
  calls: TauriInvokeCall[],
  methodId: string,
): TauriInvokeCall | undefined {
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const item = calls[index];
    if (item?.command === 'runtime_bridge_unary' && item.payload.methodId === methodId) {
      return item;
    }
  }
  return undefined;
}

function assertUnaryRequestContains(calls: TauriInvokeCall[], expectedText: string): void {
  let unaryCall: TauriInvokeCall | undefined;
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const item = calls[index];
    if (item?.command === 'runtime_bridge_unary') {
      unaryCall = item;
      break;
    }
  }
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
    await createPlatformClient({
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
    await createPlatformClient({
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
    await createPlatformClient({
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
    await createPlatformClient({
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
    await createPlatformClient({
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

test('platform local ai call omits authorization even when token provider returns a token', async () => {
  const calls: TauriInvokeCall[] = [];
  const restoreTauri = installTauriRuntime(calls);
  try {
    await createPlatformClient({
      realmBaseUrl: 'http://localhost:3002',
      accessTokenProvider: () => 'stale-realm-token',
    });

    await invokeLocalGenerateWithoutSubject();

    const unaryCall = findUnaryCallByMethodId(
      calls,
      '/nimi.runtime.v1.RuntimeAiService/ExecuteScenario',
    );
    assert.ok(unaryCall);
    assert.equal(unaryCall.payload.authorization, undefined);
  } finally {
    restoreTauri();
  }
});

test('platform local read-only calls omit authorization even when token provider returns a token', async () => {
  const calls: TauriInvokeCall[] = [];
  const restoreTauri = installTauriRuntime(calls);
  try {
    await createPlatformClient({
      realmBaseUrl: 'http://localhost:3002',
      accessTokenProvider: () => 'stale-realm-token',
    });

    await getPlatformClient().runtime.local.listLocalModels({} as never);
    await getPlatformClient().runtime.local.warmLocalModel({
      localModelId: 'local-model-1',
      timeoutMs: 60_000,
    });

    const listCall = findUnaryCallByMethodId(
      calls,
      '/nimi.runtime.v1.RuntimeLocalService/ListLocalModels',
    );
    assert.ok(listCall);
    assert.equal(listCall.payload.authorization, undefined);

    const warmCall = findUnaryCallByMethodId(
      calls,
      '/nimi.runtime.v1.RuntimeLocalService/WarmLocalModel',
    );
    assert.ok(warmCall);
    assert.equal(warmCall.payload.authorization, undefined);
  } finally {
    restoreTauri();
  }
});

test('platform cloud ai call still injects authorization', async () => {
  const calls: TauriInvokeCall[] = [];
  const restoreTauri = installTauriRuntime(calls);
  try {
    await createPlatformClient({
      realmBaseUrl: 'http://localhost:3002',
      accessTokenProvider: () => 'fresh-realm-token',
      subjectUserIdProvider: () => 'subject-user',
    });

    await invokeGenerateWithoutSubject();

    const unaryCall = findUnaryCallByMethodId(
      calls,
      '/nimi.runtime.v1.RuntimeAiService/ExecuteScenario',
    );
    assert.ok(unaryCall);
    assert.equal(unaryCall.payload.authorization, 'Bearer fresh-realm-token');
  } finally {
    restoreTauri();
  }
});

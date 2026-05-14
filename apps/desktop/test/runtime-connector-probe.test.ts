import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  clearRuntimeConnectorSdkCaches,
  listConnectorAuthOptionsForProvider,
  sdkConnectorToApiConnector,
  sdkCreateConnector,
  sdkListConnectorModelDescriptors,
  sdkListConnectors,
  providerToVendor,
  vendorToProvider,
} from '../src/shell/renderer/features/runtime-config/runtime-config-connector-sdk-service';
import { createPlatformClient } from '@nimiplatform/sdk';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { GetAccessTokenResponse, RegisterAppResponse, type ProviderCatalogEntry } from '@nimiplatform/sdk/runtime';
import { RefreshAccountSessionResponse } from '@nimiplatform/sdk/runtime/generated/runtime/v1/account';
import {
  ListConnectorModelsResponse,
  ListConnectorsResponse,
  ListProviderCatalogResponse,
} from '@nimiplatform/sdk/runtime/generated/runtime/v1/connector';

const CONNECTOR_SERVICE_SOURCE = readFileSync(
  resolve(import.meta.dirname, '../src/shell/renderer/features/runtime-config/runtime-config-connector-sdk-service.ts'),
  'utf8',
);

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
  __NIMI_TAURI_TEST__?: {
    invoke?: TauriRuntime['core']['invoke'];
    listen?: TauriRuntime['event']['listen'];
  };
  window?: {
    __NIMI_TAURI_TEST__?: {
      invoke?: TauriRuntime['core']['invoke'];
      listen?: TauriRuntime['event']['listen'];
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
  accessTokenProvider: () => string = () => 'runtime-account-access-token',
): () => void {
  const target = globalThis as MutableGlobalTauri;
  const previousRoot = target.__NIMI_TAURI_TEST__;
  const previousWindow = target.window;
  const runtime: TauriRuntime = {
    core: {
      invoke: async (command: string, payload?: unknown) => {
        const unwrapped = unwrapPayload(payload);
        calls.push({
          command,
          payload: unwrapped,
        });
        if (
          command === 'runtime_bridge_unary'
          && unwrapped.methodId === '/nimi.runtime.v1.RuntimeAuthService/RegisterApp'
        ) {
          return {
            responseBytesBase64: Buffer.from(
              RegisterAppResponse.toBinary(RegisterAppResponse.create({
                accepted: true,
              })),
            ).toString('base64'),
          };
        }
        if (
          command === 'runtime_bridge_unary'
          && unwrapped.methodId === '/nimi.runtime.v1.RuntimeAccountService/GetAccessToken'
        ) {
          return {
            responseBytesBase64: Buffer.from(
              GetAccessTokenResponse.toBinary(GetAccessTokenResponse.create({
                accepted: true,
                accessToken: accessTokenProvider(),
              })),
            ).toString('base64'),
          };
        }
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
      Reflect.deleteProperty(target, '__NIMI_TAURI_TEST__');
    } else {
      target.__NIMI_TAURI_TEST__ = previousRoot;
    }
    if (typeof previousWindow === 'undefined') {
      Reflect.deleteProperty(target, 'window');
    } else {
      target.window = previousWindow;
    }
  };
}

const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  {
    provider: 'openrouter',
    defaultEndpoint: 'https://openrouter.ai/api/v1',
    requiresExplicitEndpoint: false,
    runtimePlane: 'cloud',
    executionModule: 'cloud',
    managedSupported: true,
    inventoryMode: 'dynamic_endpoint',
  },
  {
    provider: 'deepseek',
    defaultEndpoint: 'https://api.deepseek.com/v1',
    requiresExplicitEndpoint: false,
    runtimePlane: 'cloud',
    executionModule: 'cloud',
    managedSupported: true,
    inventoryMode: 'static_source',
  },
  {
    provider: 'gemini',
    defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    requiresExplicitEndpoint: false,
    runtimePlane: 'cloud',
    executionModule: 'cloud',
    managedSupported: true,
    inventoryMode: 'static_source',
  },
];

test('sdkConnectorToApiConnector maps SDK connector shape to ApiConnector', () => {
  const sdkConnector = {
    connectorId: 'conn-123',
    provider: 'openrouter',
    endpoint: 'https://openrouter.ai/api/v1',
    label: 'My OpenRouter',
    hasCredential: true,
    ownerType: 0,
    kind: 2,
    status: 1,
  };

  const result = sdkConnectorToApiConnector(sdkConnector, PROVIDER_CATALOG);

  assert.equal(result.id, 'conn-123');
  assert.equal(result.label, 'My OpenRouter');
  assert.equal(result.vendor, 'openrouter');
  assert.equal(result.provider, 'openrouter');
  assert.equal(result.authMode, 'api_key');
  assert.equal(result.endpoint, 'https://openrouter.ai/api/v1');
  assert.equal(result.scope, 'user');
  assert.equal(result.hasCredential, true);
  assert.equal(result.isSystemOwned, false);
  assert.equal(result.status, 'idle');
  assert.equal(result.models.length, 0, 'connector models must come from runtime SDK discovery');
});

test('sdkConnectorToApiConnector marks system-owned connectors', () => {
  const sdkConnector = {
    connectorId: 'conn-sys-1',
    provider: 'gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    label: 'Gemini System',
    hasCredential: true,
    ownerType: 1,
    ownerId: 'system',
    kind: 2,
    status: 1,
  };

  const result = sdkConnectorToApiConnector(sdkConnector, PROVIDER_CATALOG);
  assert.equal(result.isSystemOwned, true);
  assert.equal(result.scope, 'runtime-system');
  assert.equal(result.vendor, 'gemini');
});

test('sdkConnectorToApiConnector marks machine-global connectors separately from runtime-managed ones', () => {
  const sdkConnector = {
    connectorId: 'conn-machine-1',
    provider: 'openrouter',
    endpoint: 'https://openrouter.ai/api/v1',
    label: 'Machine OpenRouter',
    hasCredential: true,
    ownerType: 1,
    ownerId: 'machine',
    kind: 2,
    status: 1,
  };

  const result = sdkConnectorToApiConnector(sdkConnector, PROVIDER_CATALOG);
  assert.equal(result.isSystemOwned, true);
  assert.equal(result.scope, 'machine-global');
});

test('sdkConnectorToApiConnector uses provided models over catalog defaults', () => {
  const sdkConnector = {
    connectorId: 'conn-456',
    provider: 'deepseek',
    endpoint: 'https://api.deepseek.com/v1',
    label: 'DeepSeek',
    hasCredential: false,
    ownerType: 0,
    kind: 2,
    status: 0,
  };

  const customModels = ['deepseek-chat', 'deepseek-coder'];
  const result = sdkConnectorToApiConnector(sdkConnector, PROVIDER_CATALOG, customModels);

  assert.deepEqual(result.models, ['deepseek-chat', 'deepseek-coder']);
});

test('sdkConnectorToApiConnector keeps model list empty when runtime has no models', () => {
  const sdkConnector = {
    connectorId: 'conn-789',
    provider: 'gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    label: 'Gemini',
    hasCredential: false,
    ownerType: 0,
    kind: 2,
    status: 0,
  };

  const result = sdkConnectorToApiConnector(sdkConnector, PROVIDER_CATALOG, []);
  assert.deepEqual(result.models, []);
});

test('sdkConnectorToApiConnector uses default endpoint from catalog when connector endpoint is empty', () => {
  const sdkConnector = {
    connectorId: 'conn-no-ep',
    provider: 'openrouter',
    endpoint: '',
    label: 'No Endpoint',
    hasCredential: false,
    ownerType: 0,
    kind: 2,
    status: 0,
  };

  const result = sdkConnectorToApiConnector(sdkConnector, PROVIDER_CATALOG);
  assert.ok(result.endpoint.length > 0, 'should have a fallback endpoint');
});

test('providerToVendor maps known providers correctly', () => {
  assert.equal(providerToVendor('deepseek'), 'deepseek');
  assert.equal(providerToVendor('dashscope'), 'dashscope');
  assert.equal(providerToVendor('volcengine'), 'volcengine');
  assert.equal(providerToVendor('volcengine_openspeech'), 'volcengine');
  assert.equal(providerToVendor('gemini'), 'gemini');
  assert.equal(providerToVendor('kimi'), 'kimi');
  assert.equal(providerToVendor('openai'), 'gpt');
  assert.equal(providerToVendor('openai_codex'), 'openai_codex');
  assert.equal(providerToVendor('openai_compatible'), 'openai_compatible');
  assert.equal(providerToVendor('anthropic'), 'claude');
  assert.equal(providerToVendor('openrouter'), 'openrouter');
  assert.equal(providerToVendor('unknown-provider'), 'custom');
  assert.equal(providerToVendor(''), 'custom');
});

test('vendorToProvider maps known vendors correctly', () => {
  assert.equal(vendorToProvider('dashscope'), 'dashscope');
  assert.equal(vendorToProvider('volcengine'), 'volcengine');
  assert.equal(vendorToProvider('gemini'), 'gemini');
  assert.equal(vendorToProvider('kimi'), 'kimi');
  assert.equal(vendorToProvider('deepseek'), 'deepseek');
  assert.equal(vendorToProvider('gpt'), 'openai');
  assert.equal(vendorToProvider('openai_codex'), 'openai_codex');
  assert.equal(vendorToProvider('openai_compatible'), 'openai_compatible');
  assert.equal(vendorToProvider('claude'), 'anthropic');
  assert.equal(vendorToProvider('openrouter'), 'openrouter');
  assert.equal(vendorToProvider('custom'), 'custom');
});

test('providerToVendor and vendorToProvider are bidirectional for all standard mappings', () => {
  const pairs: Array<[string, string]> = [
    ['deepseek', 'deepseek'],
    ['dashscope', 'dashscope'],
    ['volcengine', 'volcengine'],
    ['gemini', 'gemini'],
    ['kimi', 'kimi'],
    ['openai', 'gpt'],
    ['openai_codex', 'openai_codex'],
    ['openai_compatible', 'openai_compatible'],
    ['anthropic', 'claude'],
    ['openrouter', 'openrouter'],
  ];

  for (const [provider, vendor] of pairs) {
    assert.equal(providerToVendor(provider), vendor, `providerToVendor(${provider}) should be ${vendor}`);
    assert.equal(vendorToProvider(vendor as Parameters<typeof vendorToProvider>[0]), provider, `vendorToProvider(${vendor}) should be ${provider}`);
  }
});

test('providerToVendor is case-insensitive', () => {
  assert.equal(providerToVendor('DEEPSEEK'), 'deepseek');
  assert.equal(providerToVendor('Gemini'), 'gemini');
  assert.equal(providerToVendor('OpenAI'), 'gpt');
  assert.equal(providerToVendor('OPENAI_CODEX'), 'openai_codex');
  assert.equal(providerToVendor('OpenAI_Compatible'), 'openai_compatible');
});

test('listConnectorAuthOptionsForProvider exposes admitted oauth-managed options without rebuilding truth', () => {
  assert.deepEqual(
    listConnectorAuthOptionsForProvider('openai_codex').map((item) => item.value),
    ['oauth:openai_codex'],
  );
  assert.deepEqual(
    listConnectorAuthOptionsForProvider('anthropic').map((item) => item.value),
    ['api_key', 'oauth:anthropic'],
  );
  assert.deepEqual(
    listConnectorAuthOptionsForProvider('openai_compatible').map((item) => item.value),
    ['api_key', 'oauth:qwen_oauth'],
  );
});

test('sdkCreateConnector runtime calls include auto authorization and pick refreshed token', async () => {
  clearRuntimeConnectorSdkCaches();
  const calls: TauriInvokeCall[] = [];
  let token = 'connector-token-1';
  const restoreTauri = installTauriRuntime(calls, () => token);
  try {
    await createPlatformClient({
      authMode: 'local-first-party-runtime',
      realmBaseUrl: 'http://localhost:3002',
    });

    await sdkCreateConnector({
      provider: 'openai',
      endpoint: 'https://api.openai.com/v1',
      label: 'Connector A',
      apiKey: 'sk-a',
    });

    token = 'connector-token-2';
    await sdkCreateConnector({
      provider: 'openai',
      endpoint: 'https://api.openai.com/v1',
      label: 'Connector B',
      apiKey: 'sk-b',
    });

    const unaryCalls = calls.filter((call) => (
      call.command === 'runtime_bridge_unary'
      && call.payload.methodId === '/nimi.runtime.v1.RuntimeConnectorService/CreateConnector'
    ));
    assert.equal(unaryCalls.length, 2);
    const firstCall = unaryCalls[0];
    const secondCall = unaryCalls[1];
    assert.equal(firstCall?.payload.authorization, 'Bearer connector-token-1');
    assert.equal(secondCall?.payload.authorization, 'Bearer connector-token-2');
  } finally {
    restoreTauri();
  }
});

test('sdkListConnectors discovers connectors via single-path platform-client calls (no anonymous-fallback retry)', async () => {
  clearRuntimeConnectorSdkCaches();
  // Wave 3: the renderer no longer wraps Runtime calls in
  // withAnonymousReadFallback. Wave 0 classifies ListProviderCatalog as
  // anonymous_read, so Wave 2's SDK classifier filters Bearer for that
  // method at source — meaning the renderer's single direct call to
  // ListProviderCatalog goes out with no Authorization header and never
  // triggers AUTH_TOKEN_INVALID. ListConnectors is `mixed` per Wave 0
  // and still receives Bearer when a token is configured — that is the
  // existing fallthrough contract preserved by Wave 2.
  const calls: TauriInvokeCall[] = [];
  const restoreTauri = installTauriRuntime(calls, () => 'realm-token');
  try {
    await createPlatformClient({
      authMode: 'local-first-party-runtime',
      realmBaseUrl: 'http://localhost:3002',
    });

    const target = globalThis as MutableGlobalTauri;
    const invoke = target.__NIMI_TAURI_TEST__?.invoke;
    assert.ok(invoke, 'expected test tauri invoke');
    target.__NIMI_TAURI_TEST__ = {
      ...target.__NIMI_TAURI_TEST__,
      invoke: async (command: string, payload?: unknown) => {
        const unwrapped = unwrapPayload(payload);
        calls.push({ command, payload: unwrapped });
        const methodId = String(unwrapped.methodId || '');
        if (
          command === 'runtime_bridge_unary'
          && methodId === '/nimi.runtime.v1.RuntimeAccountService/GetAccessToken'
        ) {
          return {
            responseBytesBase64: Buffer.from(
              GetAccessTokenResponse.toBinary(GetAccessTokenResponse.create({
                accepted: true,
                accessToken: 'realm-token',
              })),
            ).toString('base64'),
          };
        }
        return { responseBytesBase64: '' };
      },
    };
    if (target.window?.__NIMI_TAURI_TEST__) {
      target.window.__NIMI_TAURI_TEST__.invoke = target.__NIMI_TAURI_TEST__.invoke;
    }

    await sdkListConnectors();

    const listConnectorCalls = calls.filter((call) => (
      call.command === 'runtime_bridge_unary'
      && call.payload.methodId === '/nimi.runtime.v1.RuntimeConnectorService/ListConnectors'
    ));
    const catalogCalls = calls.filter((call) => (
      call.command === 'runtime_bridge_unary'
      && call.payload.methodId === '/nimi.runtime.v1.RuntimeConnectorService/ListProviderCatalog'
    ));
    // Single-path: each method is invoked exactly once. No retry.
    assert.equal(catalogCalls.length, 1, 'ListProviderCatalog must be called exactly once (no fallback retry)');
    // Wave 2 SDK filters Bearer for anonymous_read — so the catalog call
    // never carries Authorization regardless of token state.
    assert.equal(catalogCalls[0]?.payload.authorization, undefined);
    // ListConnectors is mixed; Bearer is forwarded when token is set.
    assert.equal(listConnectorCalls.length, 1, 'ListConnectors must be called exactly once');
    assert.equal(listConnectorCalls[0]?.payload.authorization, 'Bearer realm-token');
  } finally {
    restoreTauri();
  }
});

test('sdkListConnectors coalesces concurrent inventory reads and reuses a short-lived cache', async () => {
  clearRuntimeConnectorSdkCaches();
  const calls: TauriInvokeCall[] = [];
  const restoreTauri = installTauriRuntime(calls, () => 'realm-token');
  try {
    await createPlatformClient({
      authMode: 'local-first-party-runtime',
      realmBaseUrl: 'http://localhost:3002',
    });

    const target = globalThis as MutableGlobalTauri;
    target.__NIMI_TAURI_TEST__ = {
      ...target.__NIMI_TAURI_TEST__,
      invoke: async (command: string, payload?: unknown) => {
        const unwrapped = unwrapPayload(payload);
        calls.push({ command, payload: unwrapped });
        const methodId = String(unwrapped.methodId || '');
        if (
          command === 'runtime_bridge_unary'
          && methodId === '/nimi.runtime.v1.RuntimeAccountService/GetAccessToken'
        ) {
          return {
            responseBytesBase64: Buffer.from(
              GetAccessTokenResponse.toBinary(GetAccessTokenResponse.create({
                accepted: true,
                accessToken: 'realm-token',
              })),
            ).toString('base64'),
          };
        }
        if (
          command === 'runtime_bridge_unary'
          && methodId === '/nimi.runtime.v1.RuntimeConnectorService/ListProviderCatalog'
        ) {
          return {
            responseBytesBase64: Buffer.from(
              ListProviderCatalogResponse.toBinary(ListProviderCatalogResponse.create({
                providers: PROVIDER_CATALOG,
              })),
            ).toString('base64'),
          };
        }
        if (
          command === 'runtime_bridge_unary'
          && methodId === '/nimi.runtime.v1.RuntimeConnectorService/ListConnectors'
        ) {
          return {
            responseBytesBase64: Buffer.from(
              ListConnectorsResponse.toBinary(ListConnectorsResponse.create({
                connectors: [{
                  connectorId: 'conn-1',
                  provider: 'openrouter',
                  endpoint: 'https://openrouter.ai/api/v1',
                  label: 'OpenRouter',
                  hasCredential: true,
                  ownerType: 0,
                  ownerId: '',
                  kind: 2,
                  status: 1,
                  localCategory: 0,
                  authKind: 1,
                  providerAuthProfile: '',
                }],
              })),
            ).toString('base64'),
          };
        }
        return { responseBytesBase64: '' };
      },
    };
    if (target.window?.__NIMI_TAURI_TEST__) {
      target.window.__NIMI_TAURI_TEST__.invoke = target.__NIMI_TAURI_TEST__.invoke;
    }

    const [first, second, third] = await Promise.all([
      sdkListConnectors(),
      sdkListConnectors(),
      sdkListConnectors(),
    ]);
    assert.deepEqual(
      [first[0]?.id, second[0]?.id, third[0]?.id],
      ['conn-1', 'conn-1', 'conn-1'],
    );

    first[0]?.models.push('mutated-by-test');
    const cached = await sdkListConnectors();
    assert.deepEqual(cached[0]?.models, [], 'cached connector values must be returned as clones');

    const listConnectorCalls = calls.filter((call) => (
      call.command === 'runtime_bridge_unary'
      && call.payload.methodId === '/nimi.runtime.v1.RuntimeConnectorService/ListConnectors'
    ));
    const catalogCalls = calls.filter((call) => (
      call.command === 'runtime_bridge_unary'
      && call.payload.methodId === '/nimi.runtime.v1.RuntimeConnectorService/ListProviderCatalog'
    ));
    assert.equal(listConnectorCalls.length, 1, 'concurrent connector reads must share one runtime call');
    assert.equal(catalogCalls.length, 1, 'connector reads must also share the provider catalog call');
  } finally {
    restoreTauri();
  }
});

test('sdkListConnectorModelDescriptors coalesces concurrent model inventory reads', async () => {
  clearRuntimeConnectorSdkCaches();
  const calls: TauriInvokeCall[] = [];
  const restoreTauri = installTauriRuntime(calls, () => 'realm-token');
  try {
    await createPlatformClient({
      authMode: 'local-first-party-runtime',
      realmBaseUrl: 'http://localhost:3002',
    });

    const target = globalThis as MutableGlobalTauri;
    target.__NIMI_TAURI_TEST__ = {
      ...target.__NIMI_TAURI_TEST__,
      invoke: async (command: string, payload?: unknown) => {
        const unwrapped = unwrapPayload(payload);
        calls.push({ command, payload: unwrapped });
        const methodId = String(unwrapped.methodId || '');
        if (
          command === 'runtime_bridge_unary'
          && methodId === '/nimi.runtime.v1.RuntimeAccountService/GetAccessToken'
        ) {
          return {
            responseBytesBase64: Buffer.from(
              GetAccessTokenResponse.toBinary(GetAccessTokenResponse.create({
                accepted: true,
                accessToken: 'realm-token',
              })),
            ).toString('base64'),
          };
        }
        if (
          command === 'runtime_bridge_unary'
          && methodId === '/nimi.runtime.v1.RuntimeConnectorService/ListConnectorModels'
        ) {
          return {
            responseBytesBase64: Buffer.from(
              ListConnectorModelsResponse.toBinary(ListConnectorModelsResponse.create({
                models: [{
                  modelId: 'openrouter/auto',
                  modelLabel: 'OpenRouter Auto',
                  available: true,
                  capabilities: ['text', 'tools'],
                }],
              })),
            ).toString('base64'),
          };
        }
        return { responseBytesBase64: '' };
      },
    };
    if (target.window?.__NIMI_TAURI_TEST__) {
      target.window.__NIMI_TAURI_TEST__.invoke = target.__NIMI_TAURI_TEST__.invoke;
    }

    const [first, second] = await Promise.all([
      sdkListConnectorModelDescriptors(' conn-1 '),
      sdkListConnectorModelDescriptors('conn-1'),
    ]);
    assert.deepEqual(first, [{ modelId: 'openrouter/auto', capabilities: ['text', 'tools'] }]);
    assert.deepEqual(second, first);

    first[0]?.capabilities.push('mutated-by-test');
    const cached = await sdkListConnectorModelDescriptors('conn-1');
    assert.deepEqual(cached, [{ modelId: 'openrouter/auto', capabilities: ['text', 'tools'] }]);

    const modelCallsBeforeRefresh = calls.filter((call) => (
      call.command === 'runtime_bridge_unary'
      && call.payload.methodId === '/nimi.runtime.v1.RuntimeConnectorService/ListConnectorModels'
    ));
    assert.equal(modelCallsBeforeRefresh.length, 1, 'concurrent model reads must share one runtime call');

    await sdkListConnectorModelDescriptors('conn-1', true);
    const modelCallsAfterRefresh = calls.filter((call) => (
      call.command === 'runtime_bridge_unary'
      && call.payload.methodId === '/nimi.runtime.v1.RuntimeConnectorService/ListConnectorModels'
    ));
    assert.equal(modelCallsAfterRefresh.length, 2, 'force refresh must still reach runtime');
  } finally {
    restoreTauri();
  }
});

test('sdkListConnectors refreshes local first-party account token on AUTH_TOKEN_INVALID without anonymous fallback', async () => {
  clearRuntimeConnectorSdkCaches();
  const calls: TauriInvokeCall[] = [];
  let token = 'stale-realm-token';
  const restoreTauri = installTauriRuntime(calls, () => token);
  try {
    await createPlatformClient({
      authMode: 'local-first-party-runtime',
      realmBaseUrl: 'http://localhost:3002',
    });

    const target = globalThis as MutableGlobalTauri;
    target.__NIMI_TAURI_TEST__ = {
      ...target.__NIMI_TAURI_TEST__,
      invoke: async (command: string, payload?: unknown) => {
        const unwrapped = unwrapPayload(payload);
        calls.push({ command, payload: unwrapped });
        const methodId = String(unwrapped.methodId || '');
        if (
          command === 'runtime_bridge_unary'
          && methodId === '/nimi.runtime.v1.RuntimeAccountService/GetAccessToken'
        ) {
          return {
            responseBytesBase64: Buffer.from(
              GetAccessTokenResponse.toBinary(GetAccessTokenResponse.create({
                accepted: true,
                accessToken: token,
              })),
            ).toString('base64'),
          };
        }
        if (
          command === 'runtime_bridge_unary'
          && methodId === '/nimi.runtime.v1.RuntimeAccountService/RefreshAccountSession'
        ) {
          token = 'fresh-realm-token';
          return {
            responseBytesBase64: Buffer.from(
              RefreshAccountSessionResponse.toBinary(RefreshAccountSessionResponse.create({
                accepted: true,
              })),
            ).toString('base64'),
          };
        }
        if (
          command === 'runtime_bridge_unary'
          && methodId === '/nimi.runtime.v1.RuntimeConnectorService/ListConnectors'
          && unwrapped.authorization === 'Bearer stale-realm-token'
        ) {
          throw {
            reasonCode: ReasonCode.AUTH_TOKEN_INVALID,
            message: 'token rejected by runtime authn (simulated)',
          };
        }
        if (
          command === 'runtime_bridge_unary'
          && methodId === '/nimi.runtime.v1.RuntimeConnectorService/ListConnectors'
        ) {
          return {
            responseBytesBase64: Buffer.from(
              ListConnectorsResponse.toBinary(ListConnectorsResponse.create({
                connectors: [],
              })),
            ).toString('base64'),
          };
        }
        return { responseBytesBase64: '' };
      },
    };
    if (target.window?.__NIMI_TAURI_TEST__) {
      target.window.__NIMI_TAURI_TEST__.invoke = target.__NIMI_TAURI_TEST__.invoke;
    }

    await sdkListConnectors();

    const listConnectorCalls = calls.filter((call) => (
      call.command === 'runtime_bridge_unary'
      && call.payload.methodId === '/nimi.runtime.v1.RuntimeConnectorService/ListConnectors'
    ));
    assert.equal(listConnectorCalls.length, 2, 'ListConnectors retries once after refreshing the local account token');
    assert.equal(listConnectorCalls[0]?.payload.authorization, 'Bearer stale-realm-token');
    assert.equal(listConnectorCalls[1]?.payload.authorization, 'Bearer fresh-realm-token');

    const refreshCalls = calls.filter((call) => (
      call.command === 'runtime_bridge_unary'
      && call.payload.methodId === '/nimi.runtime.v1.RuntimeAccountService/RefreshAccountSession'
    ));
    assert.equal(refreshCalls.length, 1, 'AUTH_TOKEN_INVALID should trigger one account refresh');
  } finally {
    restoreTauri();
  }
});

test('sdkCreateConnector emits oauth-managed payload when selected auth shape requires it', async () => {
  clearRuntimeConnectorSdkCaches();
  const calls: TauriInvokeCall[] = [];
  const restoreTauri = installTauriRuntime(calls, () => 'connector-token-oauth');
  try {
    await createPlatformClient({
      authMode: 'local-first-party-runtime',
      realmBaseUrl: 'http://localhost:3002',
    });

    await sdkCreateConnector({
      provider: 'openai_codex',
      endpoint: 'https://chatgpt.com/backend-api/codex',
      label: 'Codex Connector',
      credentialValue: 'codex-access-token',
      authMode: 'oauth_managed',
      providerAuthProfile: 'openai_codex',
    });

    const createCall = calls.find((call) => (
      call.command === 'runtime_bridge_unary'
      && call.payload.methodId === '/nimi.runtime.v1.RuntimeConnectorService/CreateConnector'
    ));
    assert.ok(createCall, 'expected runtime createConnector call');
    assert.equal(createCall?.payload.methodId, '/nimi.runtime.v1.RuntimeConnectorService/CreateConnector');
    const requestBytesBase64 = String(createCall?.payload.requestBytesBase64 || '').trim();
    assert.ok(requestBytesBase64.length > 0);
    const requestText = Buffer.from(requestBytesBase64, 'base64').toString('utf8');
    assert.equal(requestText.includes('openai_codex'), true);
    assert.equal(requestText.includes('https://chatgpt.com/backend-api/codex'), true);
    assert.equal(requestText.includes(JSON.stringify({ access_token: 'codex-access-token' })), true);
  } finally {
    restoreTauri();
  }
});

test('sdkCreateConnector preserves explicit credentialJson for oauth-managed providers', async () => {
  clearRuntimeConnectorSdkCaches();
  const calls: TauriInvokeCall[] = [];
  const restoreTauri = installTauriRuntime(calls, () => 'connector-token-oauth');
  try {
    await createPlatformClient({
      authMode: 'local-first-party-runtime',
      realmBaseUrl: 'http://localhost:3002',
    });

    await sdkCreateConnector({
      provider: 'openai_codex',
      endpoint: 'https://chatgpt.com/backend-api/codex',
      label: 'Codex Connector',
      credentialValue: 'stale-access-token',
      credentialJson: JSON.stringify({
        access_token: 'fresh-access-token',
        refresh_token: 'refresh-token',
        auth_mode: 'chatgpt',
        source: 'device-code',
      }),
      authMode: 'oauth_managed',
      providerAuthProfile: 'openai_codex',
    });

    const createCall = calls.find((call) => (
      call.command === 'runtime_bridge_unary'
      && call.payload.methodId === '/nimi.runtime.v1.RuntimeConnectorService/CreateConnector'
    ));
    assert.ok(createCall, 'expected runtime createConnector call');
    const requestBytesBase64 = String(createCall?.payload.requestBytesBase64 || '').trim();
    assert.ok(requestBytesBase64.length > 0);
    const requestText = Buffer.from(requestBytesBase64, 'base64').toString('utf8');
    assert.equal(requestText.includes('fresh-access-token'), true);
    assert.equal(requestText.includes('refresh-token'), true);
    assert.equal(requestText.includes('stale-access-token'), false);
  } finally {
    restoreTauri();
  }
});

test('provider catalog cache expires after a bounded TTL', () => {
  assert.match(CONNECTOR_SERVICE_SOURCE, /PROVIDER_CATALOG_CACHE_TTL_MS/);
  assert.match(CONNECTOR_SERVICE_SOURCE, /cachedProviderCatalogAt/);
  assert.match(CONNECTOR_SERVICE_SOURCE, /Date\.now\(\)/);
});

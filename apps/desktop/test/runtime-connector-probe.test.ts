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
import {
  clearDesktopNimiClientSession,
  setDesktopNimiClientSessionForTests,
  type DesktopNimiClientSession,
} from '../src/shell/renderer/infra/sdk/desktop-nimi-client-session';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { Runtime } from '@nimiplatform/sdk/runtime';
import { type ProviderCatalogEntry } from '@nimiplatform/sdk/runtime/generated';
import {
  CreateConnectorResponse,
  ListConnectorModelsResponse,
  ListConnectorsResponse,
  ListProviderCatalogResponse,
} from '../../../sdks/typescript/core-generated/runtime-protobuf/runtime/v1/connector';

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

const RUNTIME_CONNECTOR_PROBE_APP_ID = 'nimi.desktop';
const RUNTIME_CONNECTOR_PROBE_TAURI_TRANSPORT = {
  type: 'tauri-ipc',
  commandNamespace: 'runtime_bridge',
  eventNamespace: 'runtime_bridge',
} as const;

function unaryResponseBytes(bytes: Uint8Array): { responseBytesBase64: string } {
  return {
    responseBytesBase64: Buffer.from(bytes).toString('base64'),
  };
}

function createConnectorProbeResponse(provider = 'openai'): { responseBytesBase64: string } {
  return unaryResponseBytes(
    CreateConnectorResponse.toBinary(CreateConnectorResponse.create({
      connector: {
        connectorId: `conn-${provider}`,
        provider,
        endpoint: provider === 'openai_codex'
          ? 'https://chatgpt.com/backend-api/codex'
          : 'https://api.openai.com/v1',
        label: `${provider} Connector`,
        hasCredential: true,
        ownerType: 0,
        ownerId: '',
        kind: 2,
        status: 1,
        authKind: 1,
        providerAuthProfile: provider === 'openai_codex' ? 'openai_codex' : '',
      },
    })),
  );
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

function installRuntimeConnectorProbeDesktopSession(sessionTokenProvider: () => string): void {
  const runtime = new Runtime({
    appId: RUNTIME_CONNECTOR_PROBE_APP_ID,
    transport: RUNTIME_CONNECTOR_PROBE_TAURI_TRANSPORT,
    authMetadata: async (): Promise<Readonly<Record<string, string>>> => {
      const sessionToken = String(sessionTokenProvider() || '').trim();
      return sessionToken
        ? {
          'x-nimi-session-id': 'connector-probe-session',
          'x-nimi-session-token': sessionToken,
        }
        : {};
    },
  });

  setDesktopNimiClientSessionForTests({
    appId: RUNTIME_CONNECTOR_PROBE_APP_ID,
    runtime,
    realm: {},
  } as unknown as DesktopNimiClientSession);
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
          && unwrapped.methodId === '/nimi.runtime.v1.RuntimeConnectorService/ListProviderCatalog'
        ) {
          return unaryResponseBytes(ListProviderCatalogResponse.toBinary(ListProviderCatalogResponse.create({
            providers: PROVIDER_CATALOG,
          })));
        }
        if (
          command === 'runtime_bridge_unary'
          && unwrapped.methodId === '/nimi.runtime.v1.RuntimeConnectorService/ListConnectors'
        ) {
          return unaryResponseBytes(ListConnectorsResponse.toBinary(ListConnectorsResponse.create({
            connectors: [],
          })));
        }
        if (
          command === 'runtime_bridge_unary'
          && unwrapped.methodId === '/nimi.runtime.v1.RuntimeConnectorService/CreateConnector'
        ) {
          return createConnectorProbeResponse();
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
  installRuntimeConnectorProbeDesktopSession(accessTokenProvider);

  return () => {
    clearDesktopNimiClientSession();
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
    inlineSupported: true,
  },
  {
    provider: 'deepseek',
    defaultEndpoint: 'https://api.deepseek.com/v1',
    requiresExplicitEndpoint: false,
    runtimePlane: 'cloud',
    executionModule: 'cloud',
    managedSupported: true,
    inventoryMode: 'static_source',
    inlineSupported: true,
  },
  {
    provider: 'gemini',
    defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    requiresExplicitEndpoint: false,
    runtimePlane: 'cloud',
    executionModule: 'cloud',
    managedSupported: true,
    inventoryMode: 'static_source',
    inlineSupported: true,
  },
  {
    provider: 'openai_codex',
    defaultEndpoint: '',
    requiresExplicitEndpoint: false,
    runtimePlane: 'cloud',
    executionModule: 'cloud',
    managedSupported: true,
    inventoryMode: 'static_source',
    inlineSupported: false,
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

test('providerToVendor normalizes runtime provider ids without rebuilding provider truth', () => {
  assert.equal(providerToVendor('deepseek'), 'deepseek');
  assert.equal(providerToVendor('dashscope'), 'dashscope');
  assert.equal(providerToVendor('volcengine_openspeech'), 'volcengine_openspeech');
  assert.equal(providerToVendor('gemini'), 'gemini');
  assert.equal(providerToVendor('openai'), 'openai');
  assert.equal(providerToVendor('openai_codex'), 'openai_codex');
  assert.equal(providerToVendor('openai_compatible'), 'openai_compatible');
  assert.equal(providerToVendor('anthropic'), 'anthropic');
  assert.equal(providerToVendor('openrouter'), 'openrouter');
  assert.equal(providerToVendor('unknown-provider'), 'unknown-provider');
  assert.equal(providerToVendor(''), 'custom');
});

test('vendorToProvider normalizes UI provider ids without alias mapping', () => {
  assert.equal(vendorToProvider('dashscope'), 'dashscope');
  assert.equal(vendorToProvider('volcengine'), 'volcengine');
  assert.equal(vendorToProvider('gemini'), 'gemini');
  assert.equal(vendorToProvider('deepseek'), 'deepseek');
  assert.equal(vendorToProvider('openai'), 'openai');
  assert.equal(vendorToProvider('openai_codex'), 'openai_codex');
  assert.equal(vendorToProvider('openai_compatible'), 'openai_compatible');
  assert.equal(vendorToProvider('anthropic'), 'anthropic');
  assert.equal(vendorToProvider('openrouter'), 'openrouter');
  assert.equal(vendorToProvider('custom'), 'custom');
});

test('providerToVendor and vendorToProvider are pass-through for runtime provider ids', () => {
  const pairs: Array<[string, string]> = [
    ['deepseek', 'deepseek'],
    ['dashscope', 'dashscope'],
    ['volcengine_openspeech', 'volcengine_openspeech'],
    ['gemini', 'gemini'],
    ['openai', 'openai'],
    ['openai_codex', 'openai_codex'],
    ['openai_compatible', 'openai_compatible'],
    ['anthropic', 'anthropic'],
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
  assert.equal(providerToVendor('OpenAI'), 'openai');
  assert.equal(providerToVendor('OPENAI_CODEX'), 'openai_codex');
  assert.equal(providerToVendor('OpenAI_Compatible'), 'openai_compatible');
});

test('listConnectorAuthOptionsForProvider exposes admitted oauth-managed options without rebuilding truth', () => {
  assert.deepEqual(
    listConnectorAuthOptionsForProvider('openai_codex', PROVIDER_CATALOG).map((item) => item.value),
    ['oauth:openai_codex'],
  );
  assert.deepEqual(
    listConnectorAuthOptionsForProvider('anthropic', PROVIDER_CATALOG).map((item) => item.value),
    ['api_key', 'oauth:anthropic'],
  );
  assert.deepEqual(
    listConnectorAuthOptionsForProvider('openai_compatible', PROVIDER_CATALOG).map((item) => item.value),
    ['api_key', 'oauth:qwen_oauth'],
  );
});

test('sdkCreateConnector runtime calls include vNext app session metadata and pick refreshed token', async () => {
  clearRuntimeConnectorSdkCaches();
  const calls: TauriInvokeCall[] = [];
  let token = 'connector-token-1';
  const restoreTauri = installTauriRuntime(calls, () => token);
  try {
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
    assert.equal(firstCall?.payload.authorization, undefined);
    assert.equal(secondCall?.payload.authorization, undefined);
    assert.deepEqual(firstCall?.payload.appSession, {
      sessionId: 'connector-probe-session',
      sessionToken: 'connector-token-1',
    });
    assert.deepEqual(secondCall?.payload.appSession, {
      sessionId: 'connector-probe-session',
      sessionToken: 'connector-token-2',
    });
  } finally {
    restoreTauri();
  }
});

test('sdkListConnectors discovers connectors via single-path vNext Runtime calls (no anonymous-fallback retry)', async () => {
  clearRuntimeConnectorSdkCaches();
  const calls: TauriInvokeCall[] = [];
  const restoreTauri = installTauriRuntime(calls, () => 'realm-token');
  try {
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
          && methodId === '/nimi.runtime.v1.RuntimeConnectorService/ListProviderCatalog'
        ) {
          return unaryResponseBytes(ListProviderCatalogResponse.toBinary(ListProviderCatalogResponse.create({
            providers: PROVIDER_CATALOG,
          })));
        }
        if (
          command === 'runtime_bridge_unary'
          && methodId === '/nimi.runtime.v1.RuntimeConnectorService/ListConnectors'
        ) {
          return unaryResponseBytes(ListConnectorsResponse.toBinary(ListConnectorsResponse.create({
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
              authKind: 1,
              providerAuthProfile: '',
            }],
          })));
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
    assert.equal(catalogCalls[0]?.payload.authorization, undefined);
    assert.deepEqual(catalogCalls[0]?.payload.appSession, {
      sessionId: 'connector-probe-session',
      sessionToken: 'realm-token',
    });
    assert.equal(listConnectorCalls.length, 1, 'ListConnectors must be called exactly once');
    assert.equal(listConnectorCalls[0]?.payload.authorization, undefined);
    assert.deepEqual(listConnectorCalls[0]?.payload.appSession, {
      sessionId: 'connector-probe-session',
      sessionToken: 'realm-token',
    });
  } finally {
    restoreTauri();
  }
});

test('sdkListConnectors coalesces concurrent inventory reads and reuses a short-lived cache', async () => {
  clearRuntimeConnectorSdkCaches();
  const calls: TauriInvokeCall[] = [];
  const restoreTauri = installTauriRuntime(calls, () => 'realm-token');
  try {
    const target = globalThis as MutableGlobalTauri;
    target.__NIMI_TAURI_TEST__ = {
      ...target.__NIMI_TAURI_TEST__,
      invoke: async (command: string, payload?: unknown) => {
        const unwrapped = unwrapPayload(payload);
        calls.push({ command, payload: unwrapped });
        const methodId = String(unwrapped.methodId || '');
        if (
          command === 'runtime_bridge_unary'
          && methodId === '/nimi.runtime.v1.RuntimeConnectorService/ListProviderCatalog'
        ) {
          return unaryResponseBytes(ListProviderCatalogResponse.toBinary(ListProviderCatalogResponse.create({
            providers: PROVIDER_CATALOG,
          })));
        }
        if (
          command === 'runtime_bridge_unary'
          && methodId === '/nimi.runtime.v1.RuntimeConnectorService/ListConnectors'
        ) {
          return unaryResponseBytes(ListConnectorsResponse.toBinary(ListConnectorsResponse.create({
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
              authKind: 1,
              providerAuthProfile: '',
            }],
          })));
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

    const firstModels = first[0]?.models as string[] | undefined;
    firstModels?.push('mutated-by-test');
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
    const target = globalThis as MutableGlobalTauri;
    target.__NIMI_TAURI_TEST__ = {
      ...target.__NIMI_TAURI_TEST__,
      invoke: async (command: string, payload?: unknown) => {
        const unwrapped = unwrapPayload(payload);
        calls.push({ command, payload: unwrapped });
        const methodId = String(unwrapped.methodId || '');
        if (
          command === 'runtime_bridge_unary'
          && methodId === '/nimi.runtime.v1.RuntimeConnectorService/ListConnectorModels'
        ) {
          return unaryResponseBytes(ListConnectorModelsResponse.toBinary(ListConnectorModelsResponse.create({
            models: [{
              modelId: 'openrouter/auto',
              modelLabel: 'OpenRouter Auto',
              available: true,
              capabilities: ['text', 'tools'],
            }],
          })));
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

    const firstCapabilities = first[0]?.capabilities as string[] | undefined;
    firstCapabilities?.push('mutated-by-test');
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

test('sdkListConnectors propagates AUTH_TOKEN_INVALID without refresh or anonymous fallback', async () => {
  clearRuntimeConnectorSdkCaches();
  const calls: TauriInvokeCall[] = [];
  const restoreTauri = installTauriRuntime(calls, () => 'stale-realm-token');
  try {
    const target = globalThis as MutableGlobalTauri;
    target.__NIMI_TAURI_TEST__ = {
      ...target.__NIMI_TAURI_TEST__,
      invoke: async (command: string, payload?: unknown) => {
        const unwrapped = unwrapPayload(payload);
        calls.push({ command, payload: unwrapped });
        const methodId = String(unwrapped.methodId || '');
        if (
          command === 'runtime_bridge_unary'
          && methodId === '/nimi.runtime.v1.RuntimeConnectorService/ListProviderCatalog'
        ) {
          return unaryResponseBytes(ListProviderCatalogResponse.toBinary(ListProviderCatalogResponse.create({
            providers: PROVIDER_CATALOG,
          })));
        }
        if (
          command === 'runtime_bridge_unary'
          && methodId === '/nimi.runtime.v1.RuntimeConnectorService/ListConnectors'
          && (unwrapped.appSession as { sessionToken?: unknown } | undefined)?.sessionToken === 'stale-realm-token'
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
          return unaryResponseBytes(ListConnectorsResponse.toBinary(ListConnectorsResponse.create({
            connectors: [],
          })));
        }
        return { responseBytesBase64: '' };
      },
    };
    if (target.window?.__NIMI_TAURI_TEST__) {
      target.window.__NIMI_TAURI_TEST__.invoke = target.__NIMI_TAURI_TEST__.invoke;
    }

    await assert.rejects(
      () => sdkListConnectors(),
      (error: unknown) => {
        assert.equal((error as { reasonCode?: unknown }).reasonCode, ReasonCode.AUTH_TOKEN_INVALID);
        return true;
      },
    );

    const listConnectorCalls = calls.filter((call) => (
      call.command === 'runtime_bridge_unary'
      && call.payload.methodId === '/nimi.runtime.v1.RuntimeConnectorService/ListConnectors'
    ));
    assert.equal(listConnectorCalls.length, 1, 'ListConnectors must not retry through a legacy auth refresh path');
    assert.equal(listConnectorCalls[0]?.payload.authorization, undefined);
    assert.deepEqual(listConnectorCalls[0]?.payload.appSession, {
      sessionId: 'connector-probe-session',
      sessionToken: 'stale-realm-token',
    });

    const refreshCalls = calls.filter((call) => (
      call.command === 'runtime_bridge_unary'
      && call.payload.methodId === '/nimi.runtime.v1.RuntimeAccountService/RefreshAccountSession'
    ));
    assert.equal(refreshCalls.length, 0, 'AUTH_TOKEN_INVALID must not trigger legacy account-token refresh');
  } finally {
    restoreTauri();
  }
});

test('sdkCreateConnector emits oauth-managed payload when selected auth shape requires it', async () => {
  clearRuntimeConnectorSdkCaches();
  const calls: TauriInvokeCall[] = [];
  const restoreTauri = installTauriRuntime(calls, () => 'connector-token-oauth');
  try {
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

test('connector service delegates inventory ownership to the SDK client', () => {
  assert.match(CONNECTOR_SERVICE_SOURCE, /createNimiRuntimeConnectorInventoryClient/);
  assert.match(CONNECTOR_SERVICE_SOURCE, /getDesktopRuntime\(\)\.connectors/);
  assert.match(CONNECTOR_SERVICE_SOURCE, /callerId: 'runtime-config\.connector'/);
  assert.doesNotMatch(CONNECTOR_SERVICE_SOURCE, /getPlatformClient/);
  assert.doesNotMatch(CONNECTOR_SERVICE_SOURCE, /PROVIDER_CATALOG_CACHE_TTL_MS|cachedProviderCatalogAt|pendingConnectorModels/);
  assert.doesNotMatch(CONNECTOR_SERVICE_SOURCE, /listProviderCatalog\(\{\}, CONNECTOR_CALL_OPTIONS\)/);
  assert.doesNotMatch(CONNECTOR_SERVICE_SOURCE, /listConnectorModels\(request, CONNECTOR_CALL_OPTIONS\)/);
});

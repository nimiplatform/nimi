import assert from 'node:assert/strict';
import test from 'node:test';

import {
  sdkConnectorToApiConnector,
  sdkCreateConnector,
  providerToVendor,
  vendorToProvider,
} from '../src/shell/renderer/features/runtime-config/domain/provider-connectors/connector-sdk-service';
import { initializePlatformClient } from '../src/runtime/platform-client';

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

  const result = sdkConnectorToApiConnector(sdkConnector);

  assert.equal(result.id, 'conn-123');
  assert.equal(result.label, 'My OpenRouter');
  assert.equal(result.vendor, 'openrouter');
  assert.equal(result.provider, 'openrouter');
  assert.equal(result.endpoint, 'https://openrouter.ai/api/v1');
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
    kind: 2,
    status: 1,
  };

  const result = sdkConnectorToApiConnector(sdkConnector);
  assert.equal(result.isSystemOwned, true);
  assert.equal(result.vendor, 'gemini');
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
  const result = sdkConnectorToApiConnector(sdkConnector, customModels);

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

  const result = sdkConnectorToApiConnector(sdkConnector, []);
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

  const result = sdkConnectorToApiConnector(sdkConnector);
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
});

test('sdkCreateConnector runtime calls include auto authorization and pick refreshed token', async () => {
  const calls: TauriInvokeCall[] = [];
  const restoreTauri = installTauriRuntime(calls);
  let token = 'connector-token-1';
  try {
    await initializePlatformClient({
      realmBaseUrl: 'http://localhost:3002',
      accessTokenProvider: () => token,
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

    const unaryCalls = calls.filter((call) => call.command === 'runtime_bridge_unary');
    assert.ok(unaryCalls.length >= 2);
    const firstCall = unaryCalls[unaryCalls.length - 2];
    const secondCall = unaryCalls[unaryCalls.length - 1];
    assert.equal(firstCall?.payload.authorization, 'Bearer connector-token-1');
    assert.equal(secondCall?.payload.authorization, 'Bearer connector-token-2');
  } finally {
    restoreTauri();
  }
});

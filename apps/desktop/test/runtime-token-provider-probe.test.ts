import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultStateV11 } from '../src/shell/renderer/features/runtime-config/state/v11/storage/defaults';
import { createConnectorV11 } from '../src/shell/renderer/features/runtime-config/state/v11/types';

type TauriInvokeCall = {
  command: string;
  payload: unknown;
};

function installMockTauriSecret(secret: string): {
  calls: TauriInvokeCall[];
  restore: () => void;
} {
  const calls: TauriInvokeCall[] = [];
  const globalRecord = globalThis as Record<string, unknown>;
  const previousTauri = globalRecord.__TAURI__;

  globalRecord.__TAURI__ = {
    core: {
      invoke: async (command: string, payload?: unknown) => {
        calls.push({ command, payload });
        if (command === 'credential_get_secret') {
          return secret;
        }
        return null;
      },
    },
  };

  return {
    calls,
    restore: () => {
      if (typeof previousTauri === 'undefined') {
        delete globalRecord.__TAURI__;
      } else {
        globalRecord.__TAURI__ = previousTauri;
      }
    },
  };
}

test('connector discovery uses runtime probe RPC with request-injected metadata', async () => {
  const tauri = installMockTauriSecret('sk-probe');
  try {
    const platform = await import('../src/runtime/platform-client');
    await platform.initializePlatformClient({ realmBaseUrl: 'http://127.0.0.1:3000' });
    const runtime = platform.getPlatformClient().runtime as any;

    const calls: Array<{ method: string; metadata: Record<string, string> | undefined }> = [];
    runtime.ai.listTokenProviderModels = async (_request: unknown, options?: { metadata?: Record<string, string> }) => {
      calls.push({ method: 'listTokenProviderModels', metadata: options?.metadata });
      return {
        models: [{ modelId: 'gpt-4.1', modelLabel: 'GPT 4.1', available: true }],
      };
    };
    runtime.ai.checkTokenProviderHealth = async (_request: unknown, options?: { metadata?: Record<string, string> }) => {
      calls.push({ method: 'checkTokenProviderHealth', metadata: options?.metadata });
      return {
        health: {
          status: 1,
          detail: 'reachable',
        },
      };
    };

    const { discoverConnectorModelsAndHealth } = await import('../src/shell/renderer/features/runtime-config/domain/provider-connectors/discovery');
    const state = createDefaultStateV11({
      provider: 'token-api',
      runtimeModelType: 'chat',
      localProviderEndpoint: 'http://127.0.0.1:1234/v1',
      localProviderModel: 'local-model',
      localOpenAiEndpoint: 'https://openrouter.ai/api/v1',
      credentialRefId: 'connector-openrouter',
    });
    const connector = createConnectorV11('openrouter', 'OpenRouter');
    connector.id = 'connector-openrouter';
    connector.endpoint = 'https://openrouter.ai/api/v1';
    connector.models = ['openai/gpt-4.1'];

    const result = await discoverConnectorModelsAndHealth({
      state,
      connector,
    });

    assert.equal(result.normalizedStatus, 'healthy');
    assert.ok(result.discovered.includes('gpt-4.1'));
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.method, 'listTokenProviderModels');
    assert.equal(calls[1]?.method, 'checkTokenProviderHealth');
    for (const call of calls) {
      assert.equal(call.metadata?.credentialSource, 'request-injected');
      assert.equal(call.metadata?.providerApiKey, 'sk-probe');
      assert.equal(call.metadata?.providerEndpoint, 'https://openrouter.ai/api/v1');
    }

    assert.equal(
      tauri.calls.some((call) => call.command === 'credential_get_secret'),
      true,
    );
  } finally {
    tauri.restore();
  }
});

test('token-api health check path uses runtime probe RPC', async () => {
  const tauri = installMockTauriSecret('sk-health');
  try {
    const platform = await import('../src/runtime/platform-client');
    await platform.initializePlatformClient({ realmBaseUrl: 'http://127.0.0.1:3001' });
    const runtime = platform.getPlatformClient().runtime as any;

    let invoked = false;
    runtime.ai.checkTokenProviderHealth = async (_request: unknown, options?: { metadata?: Record<string, string> }) => {
      invoked = true;
      assert.equal(options?.metadata?.credentialSource, 'request-injected');
      assert.equal(options?.metadata?.providerApiKey, 'sk-health');
      return {
        health: {
          status: 2,
          detail: 'degraded',
        },
      };
    };

    const { checkLocalLlmHealth } = await import('../src/runtime/llm-adapter/execution/health-check');
    const result = await checkLocalLlmHealth({
      provider: 'openai-compatible:gpt-4.1',
      localOpenAiEndpoint: 'https://openrouter.ai/api/v1',
      localProviderModel: 'gpt-4.1',
      credentialRefId: 'connector-openrouter',
    });

    assert.equal(invoked, true);
    assert.equal(result.status, 'degraded');
    assert.equal(result.detail, 'degraded');
  } finally {
    tauri.restore();
  }
});


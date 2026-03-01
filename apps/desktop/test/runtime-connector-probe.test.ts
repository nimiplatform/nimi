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

function installMockFetch(responses: Map<string, { ok: boolean; status: number; json: unknown }>): {
  calls: Array<{ url: string; init?: RequestInit }>;
  restore: () => void;
} {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;

  (globalThis as Record<string, unknown>).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const entry = responses.get(url);
    if (!entry) {
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    }
    return {
      ok: entry.ok,
      status: entry.status,
      json: async () => entry.json,
      headers: new Headers(),
    } as Response;
  };

  return {
    calls,
    restore: () => {
      (globalThis as Record<string, unknown>).fetch = originalFetch;
    },
  };
}

test('connector discovery uses direct HTTP calls to list models and check health', async () => {
  const tauri = installMockTauriSecret('sk-probe');
  const fetchMock = installMockFetch(new Map([
    ['https://openrouter.ai/api/v1/models', {
      ok: true,
      status: 200,
      json: { data: [{ id: 'gpt-4.1' }, { id: 'gpt-4.1-mini' }] },
    }],
    ['https://openrouter.ai/api/v1/chat/completions', {
      ok: true,
      status: 200,
      json: { choices: [{ message: { content: '' } }] },
    }],
  ]));
  try {
    const { discoverConnectorModelsAndHealth } = await import('../src/shell/renderer/features/runtime-config/domain/provider-connectors/discovery');
    const state = createDefaultStateV11({
      provider: 'token-api',
      runtimeModelType: 'chat',
      localProviderEndpoint: 'http://127.0.0.1:1234/v1',
      localProviderModel: 'local-model',
      localOpenAiEndpoint: 'https://openrouter.ai/api/v1',
      connectorId: 'connector-openrouter',
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

    assert.ok(
      fetchMock.calls.some((call) => call.url.includes('/models')),
      'should call /models endpoint',
    );
    assert.ok(
      fetchMock.calls.some((call) => call.url.includes('/chat/completions')),
      'should call /chat/completions for health check',
    );

    for (const call of fetchMock.calls) {
      assert.ok(
        call.init?.headers && (call.init.headers as Record<string, string>).Authorization === 'Bearer sk-probe',
        'should include auth header with API key from vault',
      );
    }

    assert.equal(
      tauri.calls.some((call) => call.command === 'credential_get_secret'),
      true,
    );
  } finally {
    fetchMock.restore();
    tauri.restore();
  }
});

test('token-api health check path uses adapter directly', async () => {
  const tauri = installMockTauriSecret('sk-health');
  try {
    const { checkLocalLlmHealth } = await import('../src/runtime/llm-adapter/execution/health-check');
    const result = await checkLocalLlmHealth({
      provider: 'openai-compatible:gpt-4.1',
      localOpenAiEndpoint: 'https://openrouter.ai/api/v1',
      localProviderModel: 'gpt-4.1',
      connectorId: 'connector-openrouter',
    });

    assert.ok(
      ['healthy', 'unreachable', 'unsupported'].includes(result.status),
      `health status should be valid, got: ${result.status}`,
    );
    assert.ok(result.checkedAt, 'should have checkedAt timestamp');
    assert.ok(result.provider, 'should have provider');
  } finally {
    tauri.restore();
  }
});

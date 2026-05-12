import { describe, expect, it } from 'vitest';
import { createEmptyAIConfig } from '@nimiplatform/sdk/mod';
import type { RuntimeDefaults } from '@renderer/bridge';
import {
  createPolyinfoAIScopeRef,
  updateTextGenerateBinding,
} from '@renderer/data/runtime-routes.js';
import {
  runPolyinfoAppSmoke,
  type PolyinfoSmokeDeps,
} from './polyinfo-smoke.js';

const runtimeDefaults: RuntimeDefaults = {
  realm: {
    realmBaseUrl: 'http://localhost:3002',
    realtimeUrl: 'ws://localhost:3002/ws',
    accessToken: '',
    jwksUrl: 'http://localhost:3002/api/auth/jwks',
    revocationUrl: 'http://localhost:3002/api/auth/sessions/introspect',
    jwtIssuer: 'http://localhost:3002',
    jwtAudience: 'nimi-runtime',
  },
  runtime: {
    provider: 'llama',
    connectorId: '',
    localProviderModel: 'qwen3',
    localProviderEndpoint: 'http://127.0.0.1:11434',
    localOpenAiEndpoint: '',
    targetType: '',
    targetAccountId: '',
    agentId: '',
    worldId: '',
    userConfirmedUpload: false,
  },
};

function buildAIConfig() {
  return updateTextGenerateBinding(createEmptyAIConfig(createPolyinfoAIScopeRef()), {
    source: 'local',
    connectorId: '',
    model: 'qwen3',
    modelId: 'qwen3',
    localModelId: 'local-qwen3',
  });
}

function createDeps(overrides: Partial<PolyinfoSmokeDeps> = {}): PolyinfoSmokeDeps {
  return {
    hasTauriInvoke: () => true,
    getDaemonStatus: async () => ({
      running: true,
      managed: true,
      launchMode: 'RUNTIME',
      grpcAddr: '127.0.0.1:50051',
      version: 'test',
      lastError: '',
    }),
    getRuntimeAccountStatus: async () => null,
    fetchRuntimeHealthSummary: async () => ({
      runtimeHealth: {
        status: 'healthy',
        reason: '',
        queueDepth: 0,
        activeWorkflows: 0,
        activeInferenceJobs: 0,
      },
      providers: [],
    }),
    loadTextGenerateRouteOptions: async () => ({
      capability: 'text.generate',
      selected: {
        source: 'local',
        connectorId: '',
        model: 'qwen3',
        modelId: 'qwen3',
        localModelId: 'local-qwen3',
        goRuntimeLocalModelId: 'local-qwen3',
        goRuntimeStatus: 'installed',
      },
      local: {
        models: [{
          localModelId: 'local-qwen3',
          label: 'Qwen 3',
          model: 'qwen3',
          modelId: 'qwen3',
          provider: 'llama',
          engine: 'llama',
          goRuntimeLocalModelId: 'local-qwen3',
          goRuntimeStatus: 'installed',
          status: 'installed',
          capabilities: ['text.generate'],
        }],
      },
      connectors: [],
    }),
    ...overrides,
  };
}

describe('polyinfo smoke runner', () => {
  it('passes when desktop shell, runtime bridge, health, and analyst route are ready', async () => {
    const snapshot = await runPolyinfoAppSmoke({
      aiConfig: buildAIConfig(),
      runtimeDefaults,
      authStatus: 'anonymous',
    }, createDeps());

    expect(snapshot.status).toBe('pass');
    expect(snapshot.checks.map((check) => [check.id, check.status])).toContainEqual(['desktop-shell', 'pass']);
    expect(snapshot.checks.map((check) => [check.id, check.status])).toContainEqual(['runtime-account', 'pass']);
    expect(snapshot.checks.map((check) => [check.id, check.status])).toContainEqual(['analyst-route', 'pass']);
  });

  it('fails early enough to identify a plain browser run', async () => {
    const snapshot = await runPolyinfoAppSmoke({
      aiConfig: buildAIConfig(),
      runtimeDefaults,
      authStatus: 'anonymous',
    }, createDeps({
      hasTauriInvoke: () => false,
      getDaemonStatus: async () => ({
        running: false,
        managed: false,
        launchMode: 'INVALID',
        grpcAddr: '',
        version: '',
        lastError: '',
      }),
    }));

    expect(snapshot.status).toBe('fail');
    expect(snapshot.checks.find((check) => check.id === 'desktop-shell')).toMatchObject({
      status: 'fail',
    });
    expect(snapshot.checks.find((check) => check.id === 'runtime-bridge')).toMatchObject({
      status: 'fail',
    });
  });

  it('reports a stale runtime when the account service is missing', async () => {
    const snapshot = await runPolyinfoAppSmoke({
      aiConfig: buildAIConfig(),
      runtimeDefaults,
      authStatus: 'anonymous',
    }, createDeps({
      getRuntimeAccountStatus: async () => {
        throw new Error('unknown service nimi.runtime.v1.RuntimeAccountService');
      },
    }));

    expect(snapshot.status).toBe('fail');
    expect(snapshot.checks.find((check) => check.id === 'runtime-account')).toMatchObject({
      status: 'fail',
      detail: expect.stringContaining('runtime 版本过旧'),
    });
  });

  it('reports route option failures as the analyst route blocker', async () => {
    const snapshot = await runPolyinfoAppSmoke({
      aiConfig: buildAIConfig(),
      runtimeDefaults,
      authStatus: 'anonymous',
    }, createDeps({
      loadTextGenerateRouteOptions: async () => {
        throw new Error('runtime admin unavailable');
      },
    }));

    expect(snapshot.status).toBe('fail');
    expect(snapshot.checks.find((check) => check.id === 'route-options')).toMatchObject({
      status: 'fail',
      detail: 'runtime admin unavailable',
    });
  });

  it('treats account-token-only runtime details as login-required while anonymous', async () => {
    const snapshot = await runPolyinfoAppSmoke({
      aiConfig: buildAIConfig(),
      runtimeDefaults,
      authStatus: 'anonymous',
    }, createDeps({
      fetchRuntimeHealthSummary: async () => {
        throw new Error('runtime account access token unavailable: 4');
      },
      loadTextGenerateRouteOptions: async () => {
        throw new Error('runtime account access token unavailable: 4');
      },
    }));

    expect(snapshot.status).toBe('warn');
    expect(snapshot.checks.find((check) => check.id === 'runtime-health')).toMatchObject({
      status: 'warn',
      detail: expect.stringContaining('当前未登录'),
    });
    expect(snapshot.checks.find((check) => check.id === 'route-options')).toMatchObject({
      status: 'warn',
      detail: expect.stringContaining('当前未登录'),
    });
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAiClient } from '../../src/mod/ai/index.js';
import { createHookClient } from '../../src/mod/hook/index.js';
import { clearModSdkHost } from '../../src/mod/host.js';
import type { ResolvedRuntimeRouteBinding } from '../../src/mod/types/index.js';
import type { RuntimeHookRuntimeFacade } from '../../src/mod/types/runtime-hook/runtime-facade.js';

const LOCAL_ROUTE: ResolvedRuntimeRouteBinding = {
  source: 'local-runtime',
  runtimeModelType: 'chat',
  provider: 'localai',
  adapter: 'openai_compat_adapter',
  providerHints: {},
  localModelId: 'qwen2.5',
  engine: 'localai',
  model: 'qwen2.5',
  endpoint: 'http://127.0.0.1:11434/v1',
  localProviderEndpoint: 'http://127.0.0.1:11434/v1',
  localProviderModel: 'qwen2.5',
  localOpenAiEndpoint: 'http://127.0.0.1:11434/v1',
  localOpenAiApiKey: '',
  connectorId: '',
};

test('mod ai client uses injected runtime context without global host', async () => {
  clearModSdkHost();

  const routeBindingCalls: Array<{ modId?: string; routeHint: string }> = [];
  const textCalls: Array<{ provider: string; localProviderEndpoint?: string }> = [];

  const runtimeHost = {
    checkLocalLlmHealth: async () => ({ status: 'healthy' }),
    getRuntimeHookRuntime: () => ({}) as RuntimeHookRuntimeFacade,
    resolveRouteBinding: async (input: { modId?: string; routeHint: string }) => {
      routeBindingCalls.push({ modId: input.modId, routeHint: input.routeHint });
      return LOCAL_ROUTE;
    },
    getModAiDependencySnapshot: async () => ({
      modId: 'mod.context.test',
      status: 'ready',
      routeSource: 'local-runtime',
      warnings: [],
      dependencies: [],
      repairActions: [],
      updatedAt: new Date(0).toISOString(),
    }),
  };

  const runtime = {
    generateModText: async (input: { provider: string; localProviderEndpoint?: string }) => {
      textCalls.push({ provider: input.provider, localProviderEndpoint: input.localProviderEndpoint });
      return {
        text: 'hello',
        promptTraceId: 'trace-mod-context',
      };
    },
  } as unknown as RuntimeHookRuntimeFacade;

  const client = createAiClient('mod.context.test', {
    runtimeHost,
    runtime,
  });

  const result = await client.generateText({
    prompt: 'hello',
  });

  assert.equal(result.text, 'hello');
  assert.equal(result.route.source, 'local-runtime');
  assert.equal(routeBindingCalls.length, 1);
  assert.equal(routeBindingCalls[0]?.modId, 'mod.context.test');
  assert.equal(routeBindingCalls[0]?.routeHint, 'chat/default');
  assert.equal(textCalls.length, 1);
  assert.equal(textCalls[0]?.provider, 'localai');
  assert.equal(textCalls[0]?.localProviderEndpoint, 'http://127.0.0.1:11434/v1');
});

test('mod hook client llm health and route health use injected runtime context', async () => {
  clearModSdkHost();

  const healthCalls: Array<string | undefined> = [];
  const runtimeHost = {
    checkLocalLlmHealth: async (input: { provider?: string }) => {
      healthCalls.push(input.provider);
      return {
        status: 'healthy',
      };
    },
    getRuntimeHookRuntime: () => ({}) as RuntimeHookRuntimeFacade,
    resolveRouteBinding: async () => LOCAL_ROUTE,
    getModAiDependencySnapshot: async () => ({
      modId: 'mod.context.test',
      status: 'ready',
      routeSource: 'local-runtime',
      warnings: [],
      dependencies: [],
      repairActions: [],
      updatedAt: new Date(0).toISOString(),
    }),
  };

  const hookClient = createHookClient('mod.context.test', {
    runtimeHost,
    runtime: {} as RuntimeHookRuntimeFacade,
  });

  const health = await hookClient.llm.checkHealth({
    provider: 'localai',
  });
  assert.equal(health.status, 'healthy');

  const routeHealth = await hookClient.llm.checkRouteHealth({
    routeHint: 'chat/default',
  });
  assert.equal(routeHealth.reasonCode, 'RUNTIME_ROUTE_HEALTHY');
  assert.equal(routeHealth.actionHint, 'none');
  assert.equal(healthCalls.length, 2);
  assert.deepEqual(healthCalls, ['localai', 'localai']);
});

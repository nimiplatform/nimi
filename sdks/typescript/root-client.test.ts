import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createNimiClient,
  NimiClient,
  Runtime,
  createNimiError,
  isNimiError,
  type CoreTransport,
} from './index';

test('NimiClient composes explicit Runtime-backed root surfaces without singleton state', async () => {
  const unaryCalls: string[] = [];
  const transport: CoreTransport = {
    async unary(request) {
      unaryCalls.push(request.methodId);
      request.responseMetadataObserver?.({ 'x-nimi-runtime-version': '0.6.0' });
      if (request.methodId.endsWith('/GetRuntimeHealth')) {
        return { status: 3 };
      }
      if (request.methodId.endsWith('/ExecuteScenario')) {
        return {
          output: {
            output: {
              oneofKind: 'textGenerate',
              textGenerate: {
                text: 'root runtime text',
                toolCalls: [],
                sources: [],
                rawChunks: [],
                items: [{ item: { oneofKind: 'text', text: { text: 'root runtime text' } } }],
                reasoningSummary: '',
              },
            },
          },
          finishReason: 1,
          usage: { inputTokens: '1', outputTokens: '2', computeMs: '3' },
          routeDecision: 1,
          modelResolved: 'model-root',
          traceId: 'trace-root',
          ignoredExtensions: [],
        };
      }
      throw createNimiError({
        message: `unexpected Runtime method ${request.methodId}`,
        reasonCode: 'SDK_TEST_UNEXPECTED_METHOD',
        actionHint: 'fix_test_transport',
        source: 'sdk',
      });
    },
    async *serverStream() {},
  };

  const first = createNimiClient({
    appId: 'dev.nimi.root',
    runtime: { transport },
  });
  const second = createNimiClient({
    appId: 'dev.nimi.other',
    runtime: { transport },
  });

  assert(first instanceof NimiClient);
  assert(first.runtime instanceof Runtime);
  assert.notEqual(first, second);
  assert.notEqual(first.runtime, second.runtime);
  assert.equal((await first.runtime.ready()).status, 3);

  const model = first.ai.createRuntimeModel({});
  assert.deepEqual(model.model, { modelId: 'text.generate' });
  const result = await model.generateText({
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
  });

  assert.equal(result.text, 'root runtime text');
  assert.equal(unaryCalls.some((method) => method.endsWith('/ExecuteScenario')), true);
  assert.equal(first.runtime.runtimeVersion(), '0.6.0');
});

test('NimiClient fail-closes optional composition surfaces until configured', () => {
  const transport: CoreTransport = {
    async unary() {
      return {};
    },
    async *serverStream() {},
  };
  const client = createNimiClient({ appId: 'dev.nimi.root', runtime: { transport } });

  assert.throws(
    () => client.requireRealm(),
    (error) => isNimiError(error) && error.reasonCode === 'SDK_CLIENT_REALM_REQUIRED',
  );
  assert.throws(
    () => client.requireApp(),
    (error) => isNimiError(error) && error.reasonCode === 'SDK_CLIENT_APP_REQUIRED',
  );
  assert.equal('permissions' in client, false);
  assert.equal('requirePermissions' in client, false);
  assert.equal('scopes' in client, false);
  assert.equal('requireScopes' in client, false);
});

test('NimiClient carries no third-party access workflow surface', () => {
  const runtimeTransport: CoreTransport = {
    async unary() {
      return {};
    },
    async *serverStream() {},
  };
  const realmTransport: CoreTransport = {
    async unary() { return {}; },
    async *serverStream() {},
  };
  const client = createNimiClient({
    appId: 'acme.widget',
    runtime: { transport: runtimeTransport },
    realm: { transport: realmTransport },
  });

  assert.equal('permissions' in client, false);
  assert.equal('requirePermissions' in client, false);
});

test('NimiClient hard-cuts generic agent surface from root client', () => {
  const transport: CoreTransport = {
    async unary() {
      return {};
    },
    async *serverStream() {},
  };
  const client = createNimiClient({ appId: 'dev.nimi.root', runtime: { transport } });
  const rootSurface = client as unknown as Record<string, unknown>;

  assert.equal(rootSurface.agent, undefined);
  assert.equal(
    typeof client.localAgent.createRuntimeClient({ getSubjectUserId: () => 'user-1' }).sendTurn,
    'function',
  );
  assert.equal('createMemoryContextProvider' in client.localAgent, false);
  assert.equal('createKnowledgeContextProvider' in client.localAgent, false);
  assert.equal(typeof client.ai.runner.run, 'function');
  assert.equal(typeof client.ai.runner.stream, 'function');
  assert.equal(typeof client.ai.runner.createRunner, 'function');
});

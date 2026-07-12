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
              textGenerate: { text: 'root runtime text' },
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

  const model = first.ai.createRuntimeModel({
    model: { providerId: 'runtime', modelId: 'model-root' },
    targetRef: {
      kind: 'local-runtime',
      version: 'v2',
      profileBindingId: 'local-runtime:model-root',
    },
  });
  const result = await model.generateText({
    model: model.model,
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
  assert.throws(
    () => client.requirePermissions(),
    (error) => isNimiError(error) && error.reasonCode === 'SDK_CLIENT_PERMISSIONS_REQUIRED',
  );
  assert.equal(client.requireScopes().listCatalog().appId, 'dev.nimi.root');
});

test('NimiClient uses Realm-owned permission grants when Realm is configured', async () => {
  const runtimeTransport: CoreTransport = {
    async unary() {
      return {};
    },
    async *serverStream() {},
  };
  const realmCalls: string[] = [];
  const realmTransport: CoreTransport = {
    async unary(request) {
      realmCalls.push(request.methodId);
      if (request.methodId === 'listMyAppPermissionGrants') {
        return {
          items: [{
            grantId: 'grant-1',
            subjectAccountId: 'account-1',
            appId: 'tester.app',
            scopeFamily: 'account',
            scopeName: 'account.read',
            state: 'GRANTED',
            reason: 'settings diagnostics',
            version: 1,
            requestedAt: '2026-06-10T00:00:00.000Z',
            requestedByAccountId: 'account-1',
          }],
        };
      }
      throw createNimiError({
        message: `unexpected Realm method ${request.methodId}`,
        reasonCode: 'SDK_TEST_UNEXPECTED_METHOD',
        actionHint: 'fix_test_transport',
        source: 'sdk',
      });
    },
    async *serverStream() {},
  };
  const client = createNimiClient({
    appId: 'tester.app',
    runtime: { transport: runtimeTransport },
    realm: { transport: realmTransport },
  });

  const grants = await client.requirePermissions().list({ kind: 'app', ownerId: 'tester.app' });

  assert.equal(grants[0]?.state, 'granted');
  assert.deepEqual(realmCalls, ['listMyAppPermissionGrants']);
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
  assert.throws(
    () => client.localAgent.createRuntimeClient({ getSubjectUserId: () => 'user-1' }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_RUNTIME_AGENT_AUTH_REQUIRED',
  );
  assert.equal(typeof client.localAgent.createMemoryContextProvider, 'function');
  assert.equal(typeof client.localAgent.createKnowledgeContextProvider, 'function');
  assert.equal(typeof client.ai.runner.run, 'function');
  assert.equal(typeof client.ai.runner.stream, 'function');
  assert.equal(typeof client.ai.runner.createRunner, 'function');
});

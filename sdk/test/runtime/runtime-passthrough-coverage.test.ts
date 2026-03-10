import assert from 'node:assert/strict';
import test from 'node:test';

import { createCorePassthroughClients } from '../../src/runtime/runtime-modules.js';

// ---------------------------------------------------------------------------
// Exercise every passthrough method in createCorePassthroughClients to reach
// function coverage.  Each method is an arrow function; calling it once is
// sufficient to mark it as covered.
// ---------------------------------------------------------------------------

function createMockClients() {
  const guardCalls: Array<[string, string]> = [];
  const invokeCalls: string[] = [];

  const SENTINEL = Object.freeze({ __mock: true });

  // Returns a proxy that records the module.method path and resolves SENTINEL.
  function clientProxy(): Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>> {
    return new Proxy({} as Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>, {
      get(_t, mod: string) {
        return new Proxy({} as Record<string, (...args: unknown[]) => Promise<unknown>>, {
          get(_t2, method: string) {
            return async (..._args: unknown[]) => {
              invokeCalls.push(`${mod}.${method}`);
              return SENTINEL;
            };
          },
        });
      },
    });
  }

  const clients = createCorePassthroughClients({
    assertMethodAvailable: (mod, method) => { guardCalls.push([mod, method]); },
    invokeWithClient: async (operation) => operation(clientProxy() as never),
  });

  return { clients, guardCalls, invokeCalls, SENTINEL };
}

// ---------------------------------------------------------------------------
// auth (7 methods)
// ---------------------------------------------------------------------------
test('passthrough: auth module methods are callable and forwarded', async () => {
  const { clients, guardCalls, invokeCalls } = createMockClients();
  const methods = [
    'registerApp', 'openSession', 'refreshSession', 'revokeSession',
    'registerExternalPrincipal', 'openExternalPrincipalSession', 'revokeExternalPrincipalSession',
  ] as const;

  for (const m of methods) {
    await (clients.auth as Record<string, (req: unknown, opts?: unknown) => Promise<unknown>>)[m]({});
  }

  assert.equal(guardCalls.length, methods.length);
  for (const m of methods) {
    assert.ok(guardCalls.some(([mod, method]) => mod === 'auth' && method === m), `guard called for auth.${m}`);
    assert.ok(invokeCalls.includes(`auth.${m}`), `invokeWithClient called for auth.${m}`);
  }
});

// ---------------------------------------------------------------------------
// workflow (4 methods — subscribeEvents wraps with wrapModeBWorkflowStream)
// ---------------------------------------------------------------------------
test('passthrough: workflow module methods are callable and forwarded', async () => {
  const guardCalls: Array<[string, string]> = [];
  const invokeCalls: string[] = [];

  const emptyAsyncIterable = {
    async *[Symbol.asyncIterator]() {
      // empty
    },
  };

  function clientProxy(): Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>> {
    return new Proxy({} as Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>, {
      get(_t, mod: string) {
        return new Proxy({} as Record<string, (...args: unknown[]) => Promise<unknown>>, {
          get(_t2, method: string) {
            return async (..._args: unknown[]) => {
              invokeCalls.push(`${mod}.${method}`);
              if (method === 'subscribeEvents') {
                return emptyAsyncIterable;
              }
              return {};
            };
          },
        });
      },
    });
  }

  const clients = createCorePassthroughClients({
    assertMethodAvailable: (mod, method) => { guardCalls.push([mod, method]); },
    invokeWithClient: async (operation) => operation(clientProxy() as never),
  });

  await clients.workflow.submit({} as never);
  await clients.workflow.get({} as never);
  await clients.workflow.cancel({} as never);

  // subscribeEvents returns an AsyncIterable wrapped by wrapModeBWorkflowStream
  const stream = await clients.workflow.subscribeEvents({} as never);
  assert.ok(stream);
  // Consume the wrapped stream to ensure it works
  for await (const _event of stream) {
    // empty
  }

  const methods = ['submit', 'get', 'cancel', 'subscribeEvents'];
  assert.equal(guardCalls.length, methods.length);
  for (const m of methods) {
    assert.ok(guardCalls.some(([mod, method]) => mod === 'workflow' && method === m), `guard called for workflow.${m}`);
  }
});

// ---------------------------------------------------------------------------
// model (4 methods)
// ---------------------------------------------------------------------------
test('passthrough: model module methods are callable and forwarded', async () => {
  const { clients, guardCalls, invokeCalls } = createMockClients();
  const methods = ['list', 'pull', 'remove', 'checkHealth'] as const;

  for (const m of methods) {
    await (clients.model as Record<string, (req: unknown, opts?: unknown) => Promise<unknown>>)[m]({});
  }

  assert.equal(guardCalls.length, methods.length);
  for (const m of methods) {
    assert.ok(guardCalls.some(([mod, method]) => mod === 'model' && method === m), `guard called for model.${m}`);
    assert.ok(invokeCalls.includes(`model.${m}`), `invokeWithClient called for model.${m}`);
  }
});

// ---------------------------------------------------------------------------
// local (35 methods)
// ---------------------------------------------------------------------------
test('passthrough: local module methods are callable and forwarded', async () => {
  const { clients, guardCalls, invokeCalls } = createMockClients();
  const methods = [
    'listLocalModels', 'listLocalArtifacts', 'listVerifiedModels', 'listVerifiedArtifacts',
    'searchCatalogModels', 'resolveModelInstallPlan', 'installLocalModel', 'installVerifiedModel',
    'installVerifiedArtifact', 'importLocalModel', 'importLocalArtifact', 'removeLocalModel',
    'removeLocalArtifact', 'startLocalModel', 'stopLocalModel', 'checkLocalModelHealth',
    'warmLocalModel', 'collectDeviceProfile', 'resolveDependencies', 'applyDependencies',
    'listLocalServices', 'installLocalService', 'startLocalService', 'stopLocalService',
    'checkLocalServiceHealth', 'removeLocalService', 'listNodeCatalog', 'listLocalAudits',
    'appendInferenceAudit', 'appendRuntimeAudit', 'listEngines', 'ensureEngine',
    'startEngine', 'stopEngine', 'getEngineStatus',
  ] as const;

  for (const m of methods) {
    await (clients.local as Record<string, (req: unknown, opts?: unknown) => Promise<unknown>>)[m]({});
  }

  assert.equal(guardCalls.length, methods.length);
  for (const m of methods) {
    assert.ok(guardCalls.some(([mod, method]) => mod === 'local' && method === m), `guard called for local.${m}`);
    assert.ok(invokeCalls.includes(`local.${m}`), `invokeWithClient called for local.${m}`);
  }
});

// ---------------------------------------------------------------------------
// connector (11 methods)
// ---------------------------------------------------------------------------
test('passthrough: connector module methods are callable and forwarded', async () => {
  const { clients, guardCalls, invokeCalls } = createMockClients();
  const methods = [
    'createConnector', 'getConnector', 'listConnectors', 'updateConnector', 'deleteConnector',
    'testConnector', 'listConnectorModels', 'listProviderCatalog',
    'listModelCatalogProviders', 'upsertModelCatalogProvider', 'deleteModelCatalogProvider',
  ] as const;

  for (const m of methods) {
    await (clients.connector as Record<string, (req: unknown, opts?: unknown) => Promise<unknown>>)[m]({});
  }

  assert.equal(guardCalls.length, methods.length);
  for (const m of methods) {
    assert.ok(guardCalls.some(([mod, method]) => mod === 'connector' && method === m), `guard called for connector.${m}`);
    assert.ok(invokeCalls.includes(`connector.${m}`), `invokeWithClient called for connector.${m}`);
  }
});

// ---------------------------------------------------------------------------
// knowledge (3 methods)
// ---------------------------------------------------------------------------
test('passthrough: knowledge module methods are callable and forwarded', async () => {
  const { clients, guardCalls, invokeCalls } = createMockClients();
  const methods = ['buildIndex', 'searchIndex', 'deleteIndex'] as const;

  for (const m of methods) {
    await (clients.knowledge as Record<string, (req: unknown, opts?: unknown) => Promise<unknown>>)[m]({});
  }

  assert.equal(guardCalls.length, methods.length);
  for (const m of methods) {
    assert.ok(guardCalls.some(([mod, method]) => mod === 'knowledge' && method === m), `guard called for knowledge.${m}`);
    assert.ok(invokeCalls.includes(`knowledge.${m}`), `invokeWithClient called for knowledge.${m}`);
  }
});

// ---------------------------------------------------------------------------
// audit (7 methods)
// ---------------------------------------------------------------------------
test('passthrough: audit module methods are callable and forwarded', async () => {
  const { clients, guardCalls, invokeCalls } = createMockClients();
  const methods = [
    'listAuditEvents', 'exportAuditEvents', 'listUsageStats', 'getRuntimeHealth',
    'listAIProviderHealth', 'subscribeAIProviderHealthEvents', 'subscribeRuntimeHealthEvents',
  ] as const;

  for (const m of methods) {
    await (clients.audit as Record<string, (req: unknown, opts?: unknown) => Promise<unknown>>)[m]({});
  }

  assert.equal(guardCalls.length, methods.length);
  for (const m of methods) {
    assert.ok(guardCalls.some(([mod, method]) => mod === 'audit' && method === m), `guard called for audit.${m}`);
    assert.ok(invokeCalls.includes(`audit.${m}`), `invokeWithClient called for audit.${m}`);
  }
});

// ---------------------------------------------------------------------------
// Also cover: createAppClient, createRawModule, createHealthEventStreams,
// emitAuthTokenIssuedEvent, emitAuthTokenRevokedEvent — remaining uncovered
// module-level functions.
// ---------------------------------------------------------------------------
import {
  createAppClient,
  createRawModule,
  createHealthEventStreams,
  emitAuthTokenIssuedEvent,
  emitAuthTokenRevokedEvent,
} from '../../src/runtime/runtime-modules.js';

test('createAppClient: sendMessage and subscribeMessages are forwarded', async () => {
  const invokeCalls: string[] = [];
  function clientProxy(): Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>> {
    return new Proxy({} as Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>>, {
      get(_t, mod: string) {
        return new Proxy({} as Record<string, (...args: unknown[]) => Promise<unknown>>, {
          get(_t2, method: string) {
            return async (..._args: unknown[]) => {
              invokeCalls.push(`${mod}.${method}`);
              return {};
            };
          },
        });
      },
    });
  }
  const invokeWithClient: <T>(operation: (client: never) => Promise<T>) => Promise<T> = async (op) => op(clientProxy() as never);

  const appClient = createAppClient(invokeWithClient);
  await appClient.sendMessage({} as never);
  await appClient.subscribeMessages({} as never);

  assert.ok(invokeCalls.includes('app.sendAppMessage'));
  assert.ok(invokeCalls.includes('app.subscribeAppMessages'));
});

test('createRawModule: call and closeStream are forwarded', async () => {
  const rawCalls: string[] = [];
  const closedStreams: string[] = [];

  const raw = createRawModule({
    rawCall: async (methodId, _input, _opts) => { rawCalls.push(methodId); return {}; },
    invokeWithClient: async (op) => {
      const mockClient = {
        closeStream: async (streamId: string) => { closedStreams.push(streamId); },
      };
      return op(mockClient as never);
    },
  });

  await raw.call('/test.method', {});
  await raw.closeStream('stream-123');

  assert.deepEqual(rawCalls, ['/test.method']);
  assert.deepEqual(closedStreams, ['stream-123']);
});

test('createHealthEventStreams: healthEvents and providerHealthEvents are forwarded', async () => {
  const auditCalls: string[] = [];
  const emptyAsyncIterable = {
    async *[Symbol.asyncIterator]() {
      // empty
    },
  };

  const mockAudit = {
    subscribeRuntimeHealthEvents: async () => { auditCalls.push('subscribeRuntimeHealthEvents'); return emptyAsyncIterable; },
    subscribeAIProviderHealthEvents: async () => { auditCalls.push('subscribeAIProviderHealthEvents'); return emptyAsyncIterable; },
  };

  const streams = createHealthEventStreams({
    audit: mockAudit as never,
    wrapModeDStream: <T>(source: AsyncIterable<T>) => source,
  });

  const healthStream = await streams.healthEvents();
  for await (const _e of healthStream) { /* empty */ }

  const providerStream = await streams.providerHealthEvents();
  for await (const _e of providerStream) { /* empty */ }

  assert.deepEqual(auditCalls, ['subscribeRuntimeHealthEvents', 'subscribeAIProviderHealthEvents']);
});

test('emitAuthTokenIssuedEvent and emitAuthTokenRevokedEvent emit correct events', () => {
  const emitted: Array<{ name: string; payload: unknown }> = [];
  const mockBus = {
    emit: (name: string, payload: unknown) => { emitted.push({ name, payload }); },
  };

  emitAuthTokenIssuedEvent(mockBus, 'token-1');
  emitAuthTokenRevokedEvent(mockBus, 'token-2');

  assert.equal(emitted.length, 2);
  assert.equal(emitted[0]?.name, 'auth.token.issued');
  assert.equal((emitted[0]?.payload as { tokenId: string }).tokenId, 'token-1');
  assert.equal(emitted[1]?.name, 'auth.token.revoked');
  assert.equal((emitted[1]?.payload as { tokenId: string }).tokenId, 'token-2');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import type { CoreTransport } from '../core-client';
import type { CoreStreamRequest, CoreUnaryRequest } from '../types';
import { createNimiDesktopFirstPartyRuntimeClients } from './desktop-first-party-runtime';
import { createRuntime } from './index';

const fromTime = { seconds: '1000', nanos: 0 };
const toTime = { seconds: '87400', nanos: 0 };
const ownerSnapshot = {
  generationId: 'owner-generation', revision: '7', observedAt: fromTime,
  executions: [], sourceCoverage: [], recordsComplete: false,
  knownActiveAttemptCount: '0', workCountKnown: false, knownWorkCount: '0', partialReasons: ['source-not-covered'],
};
const ownerSummary = {
  generationId: 'owner-generation', readAt: toTime, fromTime, toTime, effectiveTo: toTime,
  groups: [], groupsComplete: true, estimates: [], sourceCoverage: [],
  sourceComplete: false, timeComplete: false, quantityComplete: false,
  partialReasons: ['accounting-started-within-window'],
};

test('cloud references and history use protected typed reads and reject account selectors', async () => {
  const calls: CoreUnaryRequest[] = [];
  const transport: CoreTransport = {
    async unary<Response>(request: CoreUnaryRequest): Promise<Response> { calls.push(request); return {} as Response; },
    async *serverStream<Response>(): AsyncIterable<Response> { throw new Error('not a stream'); },
  };
  const client = createNimiDesktopFirstPartyRuntimeClients({ appId: 'nimi.desktop', transport }).accountProduct;
  await client.configurationReferences.listDesktopConnectorReferences({ connectorRef: 'saved', pageSize: 50, pageToken: '' });
  await client.audit.listDesktopAICloudHistory({ fromTime, toTime, connectorRef: 'deleted', pageSize: 20, pageToken: '' });
  await client.audit.getDesktopAIUsageSummary({ fromTime, toTime, connectorRef: 'saved' });
  assert.deepEqual(calls.map(call => call.methodId), [
    '/nimi.runtime.v1.RuntimeAiService/ListDesktopConnectorReferences',
    '/nimi.runtime.v1.RuntimeAuditService/ListDesktopAICloudHistory',
    '/nimi.runtime.v1.RuntimeAuditService/GetDesktopAIUsageSummary',
  ]);
  const count = calls.length;
  assert.throws(() => client.configurationReferences.listDesktopConnectorReferences({ connectorRef: 'saved', pageSize: 50, pageToken: '', accountId: 'foreign' } as never), { reasonCode: 'SDK_AI_INPUT_INVALID' });
  assert.throws(() => client.audit.listDesktopAICloudHistory({ fromTime, toTime, connectorRef: '', pageSize: 101, pageToken: '' }), { reasonCode: 'SDK_AI_INPUT_INVALID' });
  assert.throws(() => client.audit.listDesktopAICloudHistory({ fromTime, toTime, connectorRef: '', pageSize: 20, pageToken: '', subjectUserId: 'foreign' } as never), { reasonCode: 'SDK_AI_INPUT_INVALID' });
  assert.equal(calls.length, count);
  const ordinary = createRuntime({ appId: 'ordinary.app', transport });
  await assert.rejects(ordinary.generated.listDesktopConnectorReferences({ connectorRef: 'saved', pageSize: 1, pageToken: '' }), { reasonCode: 'SDK_RUNTIME_METHOD_UNAVAILABLE' });
  await assert.rejects(ordinary.generated.listDesktopAICloudHistory({ fromTime, toTime, connectorRef: '', pageSize: 1, pageToken: '' }), { reasonCode: 'SDK_RUNTIME_METHOD_UNAVAILABLE' });
  assert.equal(calls.length, count);
});

test('Home AI observation uses only exact account-purpose reads and preserves owner uncertainty', async () => {
  const calls: Array<CoreUnaryRequest | CoreStreamRequest> = [];
  const transport: CoreTransport = {
    async unary<Response>(request: CoreUnaryRequest): Promise<Response> {
      calls.push(request);
      return (request.methodId.endsWith('/GetDesktopAIActivitySnapshot')
        ? { snapshot: ownerSnapshot } : { summary: ownerSummary }) as Response;
    },
    async *serverStream<Response>(request: CoreStreamRequest): AsyncIterable<Response> {
      calls.push(request);
      yield ownerSnapshot as Response;
    },
  };
  const clients = createNimiDesktopFirstPartyRuntimeClients({
    appId: 'nimi.desktop', transport,
    getSubjectUserId: () => { throw new Error('account must be derived by the native owner'); },
  });
  assert.deepEqual(Object.keys(clients.accountProduct.audit).sort(), [
    'getDesktopAIActivitySnapshot', 'getDesktopAIUsageSummary', 'listDesktopAICloudHistory', 'subscribeDesktopAIActivity',
  ]);
  assert.equal('getDesktopAIActivitySnapshot' in clients.machineProduct.audit, false);
  const controller = new AbortController();
  assert.strictEqual((await clients.accountProduct.audit.getDesktopAIActivitySnapshot({ limit: 50 }, { signal: controller.signal })).snapshot, ownerSnapshot);
  const snapshots = [];
  for await (const snapshot of clients.accountProduct.audit.subscribeDesktopAIActivity({ limit: 50 }, { signal: controller.signal })) snapshots.push(snapshot);
  assert.strictEqual(snapshots[0], ownerSnapshot);
  assert.strictEqual((await clients.accountProduct.audit.getDesktopAIUsageSummary({ fromTime, toTime })).summary, ownerSummary);
  assert.deepEqual(calls.map((call) => call.methodId), [
    '/nimi.runtime.v1.RuntimeAuditService/GetDesktopAIActivitySnapshot',
    '/nimi.runtime.v1.RuntimeAuditService/SubscribeDesktopAIActivity',
    '/nimi.runtime.v1.RuntimeAuditService/GetDesktopAIUsageSummary',
  ]);
  assert.deepEqual(calls.map((call) => call.body), [{ limit: 50 }, { limit: 50 }, { fromTime, toTime, connectorRef: '' }]);
  assert.strictEqual(calls[0]?.signal, controller.signal);
  assert.strictEqual(calls[1]?.signal, controller.signal);
  for (const call of calls) {
    assert.equal(call.metadata?.appId, undefined);
    assert.equal(call.metadata?.subjectUserId, undefined);
  }
});

test('Home AI observation rejects selectors and unbounded input before any transport call', async () => {
  let calls = 0;
  const transport: CoreTransport = {
    async unary<Response>(): Promise<Response> { calls += 1; throw new Error('unexpected transport'); },
    async *serverStream<Response>(): AsyncIterable<Response> { calls += 1; throw new Error('unexpected transport'); },
  };
  const audit = createNimiDesktopFirstPartyRuntimeClients({ appId: 'nimi.desktop', transport }).accountProduct.audit;
  for (const request of [{ limit: 101 }, { limit: -1 }, { limit: 1.5 }, { limit: 50, accountId: 'foreign-account' }]) {
    assert.throws(() => audit.subscribeDesktopAIActivity(request), { reasonCode: 'SDK_AI_INPUT_INVALID' });
    assert.throws(() => audit.getDesktopAIActivitySnapshot(request), { reasonCode: 'SDK_AI_INPUT_INVALID' });
  }
  for (const request of [
    { fromTime, toTime, accountId: 'foreign-account' },
    { fromTime, toTime: fromTime },
    { fromTime, toTime: { seconds: String(1000 + 8 * 86400), nanos: 0 } },
    { fromTime: { ...fromTime, subject: 'foreign' }, toTime },
  ]) {
    assert.throws(() => audit.getDesktopAIUsageSummary(request), { reasonCode: 'SDK_AI_INPUT_INVALID' });
  }
  assert.equal(calls, 0);
});

test('Home AI observation preserves owner failure and public generated reads fail before transport', async () => {
  const ownerError = new Error('protected account unavailable');
  let calls = 0;
  const transport: CoreTransport = {
    async unary<Response>(): Promise<Response> { calls += 1; throw ownerError; },
    async *serverStream<Response>(): AsyncIterable<Response> { calls += 1; throw ownerError; },
  };
  const audit = createNimiDesktopFirstPartyRuntimeClients({ appId: 'nimi.desktop', transport }).accountProduct.audit;
  await assert.rejects(audit.getDesktopAIActivitySnapshot({ limit: 0 }), ownerError);
  await assert.rejects(audit.getDesktopAIUsageSummary({ fromTime, toTime }), ownerError);
  await assert.rejects(async () => {
    for await (const _snapshot of audit.subscribeDesktopAIActivity({ limit: 0 })) assert.fail('no owner result exists');
  }, ownerError);
  assert.equal(calls, 3);
  const ordinary = createRuntime({ appId: 'ordinary.app', transport });
  await assert.rejects(ordinary.generated.getDesktopAIActivitySnapshot({ limit: 50 }), { reasonCode: 'SDK_RUNTIME_METHOD_UNAVAILABLE' });
  await assert.rejects(ordinary.generated.getDesktopAIUsageSummary({ fromTime, toTime, connectorRef: '' }), { reasonCode: 'SDK_RUNTIME_METHOD_UNAVAILABLE' });
  const deniedStream = ordinary.generated.subscribeDesktopAIActivity({ limit: 50 });
  assert.equal(typeof deniedStream[Symbol.asyncIterator], 'function');
  await assert.rejects(async () => {
    for await (const _snapshot of deniedStream) assert.fail('an ordinary App must not receive Home observations');
  }, { reasonCode: 'SDK_RUNTIME_METHOD_UNAVAILABLE' });
  assert.equal(calls, 3);
});

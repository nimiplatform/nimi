import assert from 'node:assert/strict';
import test from 'node:test';
import { createRemoteRuntimeAppClients } from './remote-app.js';
import type { RuntimeTypedClient } from '../core-generated/runtime-typed-client.js';
import { createNimiLocalAppIntegrationClient, createNimiLocalAppIntegrationRuntimeClient, type NimiLocalAppIntegrationShell } from '../core/app/local-app-runtime-platform-integration.js';
import { ListIntegrationCatalogResponse, ListIntegrationConnectionsResponse, GetIntegrationManagementResponse, PollIntegrationProviderResponse, CompleteIntegrationProviderResponse, UnregisterIntegrationProviderResponse } from '../core-generated/runtime-protobuf/runtime/v1/integration.js';

test('remote Integration projects real protobuf catalog objects and nested targets', async () => {
  const target = { targetRef: 'pc-search', integrationId: 'search', displayName: 'PC search', accountLabel: '', kind: 'app', available: true,
    operations: [{ name: 'search.run', displayName: 'Search', description: '', inputSchemaJson: '{}', outputSchemaJson: '{}', effect: 'read', supportsCancel: true, retryPolicy: 'none' }], skill: '', permittedOperations: [] };
  const catalog = ListIntegrationCatalogResponse.fromBinary(ListIntegrationCatalogResponse.toBinary({ targets: [target] }));
  const connections = ListIntegrationConnectionsResponse.fromBinary(ListIntegrationConnectionsResponse.toBinary({ connections: [target] }));
  // This is the actual direct carrier decode, not an already-flattened fixture.
  assert.notEqual(Object.getPrototypeOf(catalog), Object.prototype);
  const client = createRemoteRuntimeAppClients({ listIntegrationCatalog: async () => catalog, listIntegrationConnections: async () => connections } as unknown as RuntimeTypedClient, 'search.web').integration;
  assert.deepEqual(await client.listCatalog(), [target]);
  assert.deepEqual(await client.listConnections(), [target]);
});

test('remote Integration accepts an empty catalog decoded from the wire', async () => {
  const catalog = ListIntegrationCatalogResponse.fromBinary(new Uint8Array());
  const client = createRemoteRuntimeAppClients({ listIntegrationCatalog: async () => catalog } as unknown as RuntimeTypedClient, 'search.web').integration;
  assert.deepEqual(await client.listCatalog(), []);
});

test('typed Integration projects nested permission identities, provider calls and acknowledgements', async () => {
  const consumer = { consumerRef: 'consumer-1', appId: 'search.web', displayName: 'Web', sourceKind: 'remote' };
  const permission = { consumerRef: consumer.consumerRef, consumer, targetRef: 'pc-search', operations: ['search.run'] };
  const management = GetIntegrationManagementResponse.fromBinary(GetIntegrationManagementResponse.toBinary({ targets: [], consumers: [consumer], permissions: [permission], calls: [] }));
  const call = { callId: 'call-1', targetRef: 'pc-search', operation: 'search.run', inputJson: '{}', consumerDisplayName: 'Web', consumerRef: consumer.consumerRef };
  const poll = PollIntegrationProviderResponse.fromBinary(PollIntegrationProviderResponse.toBinary({ calls: [call], canceledCallIds: [] }));
  const client = createNimiLocalAppIntegrationRuntimeClient({
    getIntegrationManagement: async () => management,
    pollIntegrationProvider: async () => poll,
    completeIntegrationProvider: async () => CompleteIntegrationProviderResponse.fromBinary(CompleteIntegrationProviderResponse.toBinary({ accepted: true })),
    unregisterIntegrationProvider: async () => UnregisterIntegrationProviderResponse.fromBinary(UnregisterIntegrationProviderResponse.toBinary({ removed: true })),
  } as unknown as RuntimeTypedClient);
  assert.deepEqual(await client.getManagement(), { targets: [], consumers: [consumer], permissions: [permission], calls: [] });
  assert.deepEqual(await client.pollProvider({ waitMs: 0 }), { calls: [call], canceledCallIds: [] });
  assert.deepEqual(await client.completeProvider({ callId: call.callId, resultJson: '{}', errorCode: '' }), { accepted: true });
  assert.deepEqual(await client.unregisterProvider({ targetRef: 'pc-search' }), { removed: true });
});

test('remote Integration exposes consumer operations and preserves the typed owner response', async () => {
  const submitted: unknown[] = [];
  const runtime = { invokeIntegrationCall: async (input: unknown) => {
    submitted.push(input);
    return { call: { callId: 'call-1', targetRef: 'pc-search', operation: 'search.run', status: 'accepted', resultJson: '', errorCode: '',
      consumerDisplayName: 'Search web', targetDisplayName: 'PC search', accountLabel: 'Owner' } };
  } } as unknown as RuntimeTypedClient;
  const client = createRemoteRuntimeAppClients(runtime, 'search.web').integration;
  assert.deepEqual(Object.keys(client).sort(), ['cancelCall', 'getCall', 'invoke', 'listCalls', 'listCatalog', 'listConnections'].sort());
  const input = { targetRef: 'pc-search', operation: 'search.run', inputJson: '{"q":"runtime"}' };
  assert.equal((await client.invoke(input)).status, 'accepted');
  assert.deepEqual(submitted, [input]);
  await assert.rejects(client.invoke({ ...input, consumerRef: 'forged' } as typeof input), { reasonCode: 'SDK_LOCAL_APP_INPUT_INVALID' });
  assert.equal(submitted.length, 1);
});

test('provider call identity is required separately from display copy', async () => {
  const call = { callId: 'call-1', targetRef: 'pc-search', operation: 'search.run', inputJson: '{}', consumerDisplayName: 'Same name' };
  let row: Record<string, unknown> = call;
  const client = createNimiLocalAppIntegrationClient({ pollProvider: async () => ({ calls: [row], canceledCallIds: [] }) } as unknown as NimiLocalAppIntegrationShell);
  await assert.rejects(client.pollProvider({ waitMs: 0 }), { reasonCode: 'SDK_LOCAL_APP_PROJECTION_INVALID' });
  row = { ...call, consumerRef: 'actual-owner-reference' };
  assert.equal((await client.pollProvider({ waitMs: 0 })).calls[0].consumerRef, 'actual-owner-reference');
  row = { ...call, consumerRef: '' };
  await assert.rejects(client.pollProvider({ waitMs: 0 }));
});

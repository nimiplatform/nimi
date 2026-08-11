import assert from 'node:assert/strict';
import test from 'node:test';

import type { CoreTransport } from '../core-client';
import type { AIConfigCapabilityIntent } from '../core-generated/runtime-protobuf/runtime/v1/capability_configuration';
import type { CoreStreamRequest, CoreUnaryRequest } from '../types';
import { createNimiDesktopFirstPartyRuntimeClients } from './desktop-first-party-runtime';

test('Desktop machine product carries the typed Machine Local AI Configuration module', async () => {
  const calls: CoreUnaryRequest[] = [];
  const transport: CoreTransport = {
    async unary<Response>(request: CoreUnaryRequest): Promise<Response> {
      calls.push(request);
      if (request.methodId === '/nimi.runtime.v1.RuntimeLocalService/GetMachineLocalAIConfiguration') {
        return {
          aggregate: { configurations: [], selections: [] },
        } as Response;
      }
      throw new Error(`unexpected Runtime method: ${request.methodId}`);
    },
    async *serverStream<Response>(_request: CoreStreamRequest): AsyncIterable<Response> {
      throw new Error('unexpected Runtime stream');
    },
  };
  const clients = createNimiDesktopFirstPartyRuntimeClients({
    appId: 'nimi.desktop',
    transport,
  });

  const aggregate = await clients.machineProduct.local.aiConfiguration.get();

  assert.deepEqual(aggregate, { configurations: [], selections: [] });
  assert.equal(
    calls[0]?.methodId,
    '/nimi.runtime.v1.RuntimeLocalService/GetMachineLocalAIConfiguration',
  );
  assert.equal(calls[0]?.metadata?.appId, undefined, 'protected host owns caller identity');
});

test('Desktop account product exposes the profile-admitted typed ConnectorGrant client', async () => {
  const calls: CoreUnaryRequest[] = [];
  const transport: CoreTransport = {
    async unary<Response>(request: CoreUnaryRequest): Promise<Response> {
      calls.push(request);
      if (request.methodId === '/nimi.runtime.v1.RuntimeConnectorService/CreateConnectorGrant') {
        return {
          grant: {
            grantId: 'grant-1',
            connectorId: 'connector-1',
            accountId: 'account-1',
            status: 1,
            createdAt: { seconds: '1785888000', nanos: 0 },
          },
        } as Response;
      }
      throw new Error(`unexpected Runtime method: ${request.methodId}`);
    },
    async *serverStream<Response>(_request: CoreStreamRequest): AsyncIterable<Response> {
      throw new Error('unexpected Runtime stream');
    },
  };
  const clients = createNimiDesktopFirstPartyRuntimeClients({
    appId: 'nimi.desktop',
    transport,
  });

  const grant = await clients.accountProduct.connectorGrants.create('connector-1');

  assert.equal(grant.grantId, 'grant-1');
  assert.equal(grant.status, 'active');
  assert.equal(calls[0]?.methodId, '/nimi.runtime.v1.RuntimeConnectorService/CreateConnectorGrant');
  assert.equal(calls[0]?.metadata?.appId, undefined, 'protected host owns caller identity');
});

test('Desktop account product binds App AIConfig to its exact product owner', async () => {
  const calls: CoreUnaryRequest[] = [];
  const transport: CoreTransport = {
    async unary<Response>(request: CoreUnaryRequest): Promise<Response> {
      calls.push(request);
      if (request.methodId === '/nimi.runtime.v1.RuntimeAiService/GetAppAIConfig') {
        const body = request.body as { owner?: unknown };
        return { config: { owner: body.owner, capabilities: [] } } as Response;
      }
      if (request.methodId === '/nimi.runtime.v1.RuntimeAiService/OverwriteAppAIConfig') {
        const body = request.body as { config?: unknown };
        return { config: body.config } as Response;
      }
      throw new Error(`unexpected Runtime method: ${request.methodId}`);
    },
    async *serverStream<Response>(_request: CoreStreamRequest): AsyncIterable<Response> {
      throw new Error('unexpected Runtime stream');
    },
  };
  const clients = createNimiDesktopFirstPartyRuntimeClients({
    appId: 'nimi.desktop',
    transport,
  });

  const existing = await clients.accountProduct.aiConfig.get();
  assert.equal(existing.owner?.owner.oneofKind, 'app');
  if (existing.owner?.owner.oneofKind === 'app') {
    assert.equal(existing.owner.owner.app.appId, 'nimi.desktop');
  }

  const localIntent: AIConfigCapabilityIntent = {
    capabilityContract: 'text.generate',
    requiredFeatures: [],
    route: { oneofKind: 'local', local: {} },
  };
  const overwritten = await clients.accountProduct.aiConfig.overwrite([localIntent]);
  assert.equal(overwritten.capabilities[0]?.capabilityContract, 'text.generate');
  assert.equal(overwritten.owner?.owner.oneofKind, 'app');
  if (overwritten.owner?.owner.oneofKind === 'app') {
    assert.equal(overwritten.owner.owner.app.appId, 'nimi.desktop');
  }

  assert.deepEqual(calls.map((call) => call.methodId), [
    '/nimi.runtime.v1.RuntimeAiService/GetAppAIConfig',
    '/nimi.runtime.v1.RuntimeAiService/OverwriteAppAIConfig',
  ]);
  for (const call of calls) {
    assert.equal(call.metadata?.appId, undefined, 'protected host owns caller identity');
  }
});

test('Desktop account execution client carries Scenario unary and streams with Scenario jobs', async () => {
  const calls: CoreUnaryRequest[] = [];
  const streams: CoreStreamRequest[] = [];
  const transport: CoreTransport = {
    async unary<Response>(request: CoreUnaryRequest): Promise<Response> {
      calls.push(request);
      return {} as Response;
    },
    async *serverStream<Response>(request: CoreStreamRequest): AsyncIterable<Response> {
      streams.push(request);
      yield {} as Response;
    },
  };
  const clients = createNimiDesktopFirstPartyRuntimeClients({
    appId: 'nimi.desktop',
    transport,
  });

  await clients.aiExecution.executeScenario({
    head: { appId: 'nimi.desktop', subjectUserId: '', timeoutMs: 0 },
    scenarioType: 1,
    executionMode: 1,
    extensions: [],
  });
  for await (const _event of clients.aiExecution.streamScenario({
    head: { appId: 'nimi.desktop', subjectUserId: '', timeoutMs: 0 },
    scenarioType: 1,
    executionMode: 2,
    extensions: [],
  })) {
    break;
  }

  assert.equal(calls[0]?.methodId, '/nimi.runtime.v1.RuntimeAiService/ExecuteScenario');
  assert.equal(calls[0]?.metadata?.appId, undefined, 'protected host owns caller identity');
  assert.equal(streams[0]?.methodId, '/nimi.runtime.v1.RuntimeAiService/StreamScenario');
  assert.equal(streams[0]?.metadata?.appId, undefined, 'protected host owns caller identity');
});

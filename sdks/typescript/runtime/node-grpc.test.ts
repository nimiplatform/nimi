import assert from 'node:assert/strict';
import * as grpc from '@grpc/grpc-js';
import test from 'node:test';

import {
  AccountEventType,
  AgentLifecycleStatus,
  ExecutionMode,
  RoutePolicy,
  RuntimeHealthStatus,
  ScenarioType,
} from '../core-generated/runtime-typed-client';
import {
  GetRuntimeHealthRequest,
  GetRuntimeHealthResponse,
  RuntimeHealthEvent,
  SubscribeRuntimeHealthEventsRequest,
} from '../core-generated/runtime-protobuf/runtime/v1/audit';
import {
  ListAgentsResponse,
} from '../core-generated/runtime-protobuf/runtime/v1/agent_service';
import { StreamScenarioEvent } from '../core-generated/runtime-protobuf/runtime/v1/ai';
import { Runtime } from './index';
import { createRuntimeNodeGrpcTransport, type RuntimeNodeGrpcBridge } from './node-grpc';
import { ReasonCode } from '../types';

async function expectWithin<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

test('node-grpc Runtime transport encodes and decodes protobuf bytes', async () => {
  let observedBody: Uint8Array | undefined;
  const bridge: RuntimeNodeGrpcBridge = {
    async unary(request) {
      observedBody = request.body;
      assert.equal(Object.hasOwn(request, 'authorization'), false);
      assert.equal(request.endpoint, '127.0.0.1:46371');
      assert.equal(request.methodId, '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth');
      assert.equal(request.metadata?.appId, 'nimi.app');
      assert.equal(request.metadata?.['x-nimi-access-token-id'], 'bridge-token-id');
      assert.deepEqual(GetRuntimeHealthRequest.fromBinary(request.body), {});
      request.responseMetadataObserver?.({ 'x-nimi-runtime-version': '0.2.0' });
      return GetRuntimeHealthResponse.toBinary(GetRuntimeHealthResponse.create({
        status: RuntimeHealthStatus.READY,
        reason: 'bridge-ok',
      }));
    },
    async *serverStream() {
      throw new Error('unexpected stream call');
    },
  };

  const runtime = new Runtime({
    transport: { type: 'node-grpc', bridge },
    authMetadata: () => ({ 'x-nimi-access-token-id': 'bridge-token-id' }),
  });

  const health = await runtime.ready();

  assert.ok(observedBody instanceof Uint8Array);
  assert.equal(health.status, RuntimeHealthStatus.READY);
  assert.equal(health.reason, 'bridge-ok');
  assert.equal(runtime.runtimeVersion(), '0.2.0');
  assert.equal(runtime.versionCompatibility().state, 'compatible');
});

test('ordinary Runtime bridge cannot observe bearer authority', async () => {
  if (false) {
    // @ts-expect-error RuntimeOptions intentionally has no raw token or provider authority.
    new Runtime({ auth: { accessToken: 'forged-app-token' } });
  }

  const observedAuthorizationFields: boolean[] = [];
  const bridge: RuntimeNodeGrpcBridge = {
    async unary(request) {
      observedAuthorizationFields.push(Object.hasOwn(request, 'authorization'));
      return ListAgentsResponse.toBinary(ListAgentsResponse.create({ agents: [], nextPageToken: '' }));
    },
    async *serverStream() {
      throw new Error('unexpected stream call');
    },
  };
  const runtime = new Runtime({
    auth: { accessToken: 'forged-app-token' },
    transport: { type: 'node-grpc', bridge },
  } as never);

  await runtime.agents.listAgents({
    lifecycleFilter: AgentLifecycleStatus.ACTIVE,
    pageSize: 1,
    pageToken: '',
  });

  assert.deepEqual(observedAuthorizationFields, [false]);
});

test('ordinary Runtime mixed stream bridge cannot observe bearer authority', async () => {
  const observedAuthorizationFields: boolean[] = [];
  const bridge: RuntimeNodeGrpcBridge = {
    async unary() {
      throw new Error('unexpected unary call');
    },
    async *serverStream(request) {
      observedAuthorizationFields.push(Object.hasOwn(request, 'authorization'));
      yield StreamScenarioEvent.toBinary(StreamScenarioEvent.create({}));
    },
  };
  const runtime = new Runtime({ transport: { type: 'node-grpc', bridge } });

  for await (const _event of runtime.ai.streamScenario({
    head: {
      appId: 'nimi.app',
      subjectUserId: 'user-1',
      modelId: 'model-1',
      routePolicy: RoutePolicy.LOCAL,
      connectorId: '',
      timeoutMs: 0,
      fallback: 0,
    },
    scenarioType: ScenarioType.TEXT_GENERATE,
    executionMode: ExecutionMode.SYNC,
    extensions: [],
  })) {
    break;
  }

  assert.deepEqual(observedAuthorizationFields, [false]);
});

test('node-grpc Runtime transport decodes protobuf server streams', async () => {
  const bridge: RuntimeNodeGrpcBridge = {
    async unary() {
      throw new Error('unexpected unary call');
    },
    async *serverStream(request) {
      assert.equal(request.methodId, '/nimi.runtime.v1.RuntimeAuditService/SubscribeRuntimeHealthEvents');
      assert.deepEqual(SubscribeRuntimeHealthEventsRequest.fromBinary(request.body), {});
      yield RuntimeHealthEvent.toBinary(RuntimeHealthEvent.create({
        sequence: '42',
        status: RuntimeHealthStatus.READY,
        reason: 'event-ready',
      }));
    },
  };

  const transport = createRuntimeNodeGrpcTransport({ endpoint: 'http://127.0.0.1:46371', bridge });
  const runtime = new Runtime({ transport });
  const events = [];

  for await (const event of runtime.audit.subscribeRuntimeHealthEvents({})) {
    events.push(event);
  }

  assert.equal(events.length, 1);
  assert.equal(events[0]?.sequence, '42');
  assert.equal(events[0]?.status, RuntimeHealthStatus.READY);
  assert.equal(events[0]?.reason, 'event-ready');
});

test('node-grpc Runtime transport cancels pending server stream returns without waiting for chunks', async () => {
  let resolveNextStarted!: () => void;
  const nextStarted = new Promise<void>((resolve) => {
    resolveNextStarted = resolve;
  });
  let resolvePendingNext: ((result: IteratorResult<Uint8Array>) => void) | undefined;
  let returnCalled = false;

  const bridge: RuntimeNodeGrpcBridge = {
    async unary() {
      throw new Error('unexpected unary call');
    },
    serverStream(request) {
      assert.equal(request.methodId, '/nimi.runtime.v1.RuntimeAuditService/SubscribeRuntimeHealthEvents');
      assert.deepEqual(SubscribeRuntimeHealthEventsRequest.fromBinary(request.body), {});
      return {
        [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
          return {
            next: () => {
              resolveNextStarted();
              return new Promise<IteratorResult<Uint8Array>>((resolve) => {
                resolvePendingNext = resolve;
              });
            },
            return: async () => {
              returnCalled = true;
              resolvePendingNext?.({ done: true, value: undefined });
              return { done: true, value: undefined };
            },
          };
        },
      };
    },
  };

  const runtime = new Runtime({ transport: { type: 'node-grpc', bridge } });
  const iterator = runtime.audit.subscribeRuntimeHealthEvents({})[Symbol.asyncIterator]();

  const pendingNext = iterator.next();
  await expectWithin(nextStarted, 500, 'node-grpc stream next');
  const returned = await expectWithin(
    iterator.return?.() ?? Promise.resolve({ done: true, value: undefined }),
    500,
    'node-grpc stream return',
  );
  const pendingNextResult = await expectWithin(pendingNext, 500, 'pending node-grpc stream next');

  assert.deepEqual(returned, { done: true, value: undefined });
  assert.equal(returnCalled, true);
  assert.deepEqual(pendingNextResult, { done: true, value: undefined });
});

test('Runtime constructs default node-grpc transport in Node.js', () => {
  const runtime = new Runtime();

  assert.equal(typeof runtime.audit.getRuntimeHealth, 'function');
  assert.equal('core' in runtime, false);
});

test('node-grpc Runtime transport preserves structured upstream errors', async () => {
  const bridge: RuntimeNodeGrpcBridge = {
    async unary() {
      throw {
        message: 'provider timed out',
        reasonCode: ReasonCode.AI_PROVIDER_TIMEOUT,
        actionHint: 'retry_later',
        traceId: 'trace-node',
        retryable: true,
      };
    },
    async *serverStream() {
      throw new Error('unexpected stream call');
    },
  };
  const runtime = new Runtime({ transport: { type: 'node-grpc', bridge } });

  await assert.rejects(
    runtime.ready(),
    (error: unknown) => {
      const shaped = error as {
        code?: string;
        reasonCode?: string;
        actionHint?: string;
        traceId?: string;
        retryable?: boolean;
      };
      assert.equal(shaped.code, 'AI_PROVIDER_TIMEOUT');
      assert.equal(shaped.reasonCode, 'AI_PROVIDER_TIMEOUT');
      assert.equal(shaped.actionHint, 'retry_later');
      assert.equal(shaped.traceId, 'trace-node');
      assert.equal(shaped.retryable, true);
      return true;
    },
  );
});

test('node-grpc Runtime transport rejects retired caller AI input metadata on every endpoint', async () => {
  const bridge: RuntimeNodeGrpcBridge = {
    async unary() {
      throw new Error('provider key validation should run before bridge unary');
    },
    async *serverStream() {
      throw new Error('unexpected stream call');
    },
  };
  const runtime = new Runtime({
    transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371', bridge },
    metadata: { providerApiKey: 'secret-provider-key' },
  });

  await assert.rejects(
    runtime.ready(),
    (error: unknown) => {
      const shaped = error as { code?: string; reasonCode?: string; actionHint?: string };
      assert.equal(shaped.code, 'SDK_TRANSPORT_INVALID');
      assert.equal(shaped.reasonCode, 'SDK_TRANSPORT_INVALID');
      assert.equal(shaped.actionHint, 'remove_caller_selected_ai_execution_metadata');
      return true;
    },
  );
});

test('node-grpc Runtime transport rejects authorization in caller metadata', async () => {
  const bridge: RuntimeNodeGrpcBridge = {
    async unary() {
      throw new Error('authorization metadata validation should run before bridge unary');
    },
    async *serverStream() {
      throw new Error('unexpected stream call');
    },
  };
  const runtime = new Runtime({
    transport: { type: 'node-grpc', bridge },
    authMetadata: () => ({ authorization: 'Bearer bridge-token' }),
  });

  await assert.rejects(
    runtime.ready(),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_TRANSPORT_INVALID
      && String((error as { message?: string }).message || '').includes('transport auth channel'),
  );
});

import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { createServer } from 'node:net';
import * as grpc from '@grpc/grpc-js';
import test from 'node:test';
import { createNimiRuntimeAIModel } from '../core/ai';
import { textPart } from '../core/contracts';

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
  ListAgentsRequest,
  ListAgentsResponse,
} from '../core-generated/runtime-protobuf/runtime/v1/agent_service';
import { ExecuteScenarioRequest, ExecuteScenarioResponse, StreamScenarioEvent, StreamScenarioRequest } from '../core-generated/runtime-protobuf/runtime/v1/ai';
import { Runtime } from './index';
import { createRuntimeNodeGrpcTransport, type RuntimeNodeGrpcBridge } from './node-grpc';
import { ReasonCode } from '../types';

test('real gRPC releases abort listeners after unary and stream completion, failure, and return', async (t) => {
  const server = new grpc.Server();
  t.after(() => server.forceShutdown());
  let failUnary = false;
  let finishStream = true;
  server.addService({
    health: {
      path: '/nimi.runtime.v1.RuntimeAgentService/ListAgents', requestStream: false, responseStream: false,
      requestSerialize: (value: object) => Buffer.from(GetRuntimeHealthRequest.toBinary(value)),
      requestDeserialize: (bytes: Buffer) => GetRuntimeHealthRequest.fromBinary(bytes),
      responseSerialize: (value: object) => Buffer.from(GetRuntimeHealthResponse.toBinary(GetRuntimeHealthResponse.create(value))),
      responseDeserialize: (bytes: Buffer) => GetRuntimeHealthResponse.fromBinary(bytes),
    },
    events: {
      path: '/nimi.runtime.v1.RuntimeAuditService/SubscribeRuntimeHealthEvents', requestStream: false, responseStream: true,
      requestSerialize: (value: object) => Buffer.from(SubscribeRuntimeHealthEventsRequest.toBinary(value)),
      requestDeserialize: (bytes: Buffer) => SubscribeRuntimeHealthEventsRequest.fromBinary(bytes),
      responseSerialize: (value: object) => Buffer.from(RuntimeHealthEvent.toBinary(RuntimeHealthEvent.create(value))),
      responseDeserialize: (bytes: Buffer) => RuntimeHealthEvent.fromBinary(bytes),
    },
  }, {
    health: (_call: unknown, callback: grpc.sendUnaryData<object>) => failUnary
      ? callback({ code: grpc.status.UNAVAILABLE, message: 'fixture unavailable' }) : callback(null, {}),
    events: (call: grpc.ServerWritableStream<object, object>) => {
      call.write({});
      if (finishStream) call.end();
    },
  });
  const port = await new Promise<number>((resolve, reject) => {
    server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (error, value) => error ? reject(error) : resolve(value));
  });
  const transport = createRuntimeNodeGrpcTransport({ endpoint: `127.0.0.1:${port}` });
  const controller = new AbortController();
  const unary = { methodId: '/nimi.runtime.v1.RuntimeAgentService/ListAgents', body: {}, signal: controller.signal };
  for (let index = 0; index < 12; index++) await transport.unary(unary);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  failUnary = true;
  await assert.rejects(transport.unary(unary));
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  const stream = { ...unary, methodId: '/nimi.runtime.v1.RuntimeAuditService/SubscribeRuntimeHealthEvents' };
  for await (const _event of transport.serverStream(stream)) { /* drain */ }
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  finishStream = false;
  const iterator = transport.serverStream(stream)[Symbol.asyncIterator]();
  await iterator.next();
  assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
  await iterator.return?.();
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

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
      assert.equal(request.methodId, '/nimi.runtime.v1.RuntimeAgentService/ListAgents');
      assert.equal(request.metadata?.appId, 'nimi.app');
      assert.equal(request.metadata?.['x-nimi-access-token-id'], 'bridge-token-id');
      assert.equal(ListAgentsRequest.fromBinary(request.body).pageSize, 1);
      request.responseMetadataObserver?.({ 'x-nimi-runtime-version': '0.2.0' });
      return ListAgentsResponse.toBinary(ListAgentsResponse.create({ nextPageToken: 'page-2' }));
    },
    async *serverStream() {
      throw new Error('unexpected stream call');
    },
  };

  const runtime = new Runtime({
    transport: { type: 'node-grpc', bridge },
    authMetadata: () => ({ 'x-nimi-access-token-id': 'bridge-token-id' }),
  });

  const result = await runtime.agents.listAgents(ListAgentsRequest.create({ pageSize: 1 }));

  assert.ok(observedBody instanceof Uint8Array);
  assert.equal(result.nextPageToken, 'page-2');
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
  const runtime = new Runtime({ transport, hostOwnedIdentity: true });
  const events = [];

  for await (const event of runtime.desktopMachineProduct!.subscribeRuntimeHealthEvents({})) {
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

  const runtime = new Runtime({ transport: { type: 'node-grpc', bridge }, hostOwnedIdentity: true });
  const iterator = runtime.desktopMachineProduct!.subscribeRuntimeHealthEvents({})[Symbol.asyncIterator]();

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
    runtime.agents.listAgents(ListAgentsRequest.create({ pageSize: 1 })),
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
    runtime.agents.listAgents(ListAgentsRequest.create({ pageSize: 1 })),
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
    runtime.agents.listAgents(ListAgentsRequest.create({ pageSize: 1 })),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_TRANSPORT_INVALID
      && String((error as { message?: string }).message || '').includes('transport auth channel'),
  );
});

test('node-grpc reports an unavailable Runtime before submitting immediate AI calls', async () => {
  const socket = createServer();
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolve);
  });
  const address = socket.address();
  assert.ok(address && typeof address === 'object');
  await new Promise<void>((resolve, reject) => {
    socket.close((error) => error ? reject(error) : resolve());
  });
  const runtime = new Runtime({
    transport: { type: 'node-grpc', endpoint: `127.0.0.1:${address.port}` },
  });
  const request = {
    head: { appId: 'nimi.app', subjectUserId: 'user-1', timeoutMs: 5000 },
    scenarioType: ScenarioType.TEXT_GENERATE,
    extensions: [],
  };
  const verifyFailure = (error: unknown) => {
    const failure = error as { reasonCode?: string; interruption?: unknown; message?: string };
    assert.equal(failure.reasonCode, 'RUNTIME_GRPC_UNAVAILABLE');
    assert.equal(failure.interruption, undefined);
    assert.doesNotMatch(failure.message ?? '', /charges/i);
    return true;
  };
  await assert.rejects(runtime.ai.executeScenario({ ...request, executionMode: ExecutionMode.SYNC }), verifyFailure);
  const stream = runtime.ai.streamScenario({ ...request, executionMode: ExecutionMode.STREAM });
  await assert.rejects(stream[Symbol.asyncIterator]().next(), verifyFailure);

  const model = createNimiRuntimeAIModel({ runtime, appId: 'nimi.app', timeoutMs: 5000 });
  const input = { messages: [{ role: 'user' as const, content: [textPart('Say hello.')] }] };
  await assert.rejects(model.generateText(input), verifyFailure);
  await assert.rejects(model.streamText(input)[Symbol.asyncIterator]().next(), verifyFailure);
});

test('the public model preserves uncertain outcomes after a loopback gRPC server receives its calls', async (t) => {
  const server = new grpc.Server();
  t.after(() => server.forceShutdown());
  const unavailable = { code: grpc.status.UNAVAILABLE, details: 'connection lost during execution' };
  let receivedUnary = 0;
  let receivedStream = 0;
  server.addService({
    execute: {
      path: '/nimi.runtime.v1.RuntimeAiService/ExecuteScenario', requestStream: false, responseStream: false,
      requestSerialize: (value: ExecuteScenarioRequest) => Buffer.from(ExecuteScenarioRequest.toBinary(value)),
      requestDeserialize: (bytes: Buffer) => ExecuteScenarioRequest.fromBinary(bytes),
      responseSerialize: (value: ExecuteScenarioResponse) => Buffer.from(ExecuteScenarioResponse.toBinary(value)),
      responseDeserialize: (bytes: Buffer) => ExecuteScenarioResponse.fromBinary(bytes),
    },
    stream: {
      path: '/nimi.runtime.v1.RuntimeAiService/StreamScenario', requestStream: false, responseStream: true,
      requestSerialize: (value: StreamScenarioRequest) => Buffer.from(StreamScenarioRequest.toBinary(value)),
      requestDeserialize: (bytes: Buffer) => StreamScenarioRequest.fromBinary(bytes),
      responseSerialize: (value: StreamScenarioEvent) => Buffer.from(StreamScenarioEvent.toBinary(value)),
      responseDeserialize: (bytes: Buffer) => StreamScenarioEvent.fromBinary(bytes),
    },
  }, {
    execute: (_call: unknown, callback: grpc.sendUnaryData<ExecuteScenarioResponse>) => {
      receivedUnary += 1;
      callback(unavailable);
    },
    stream: (call: grpc.ServerWritableStream<StreamScenarioRequest, StreamScenarioEvent>) => {
      receivedStream += 1;
      call.emit('error', unavailable);
    },
  });
  const port = await new Promise<number>((resolve, reject) => {
    server.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (error, value) => error ? reject(error) : resolve(value));
  });
  const runtime = new Runtime({ transport: { type: 'node-grpc', endpoint: `127.0.0.1:${port}` } });
  const model = createNimiRuntimeAIModel({ runtime, appId: 'nimi.app', timeoutMs: 5000 });
  const input = { messages: [{ role: 'user' as const, content: [textPart('Say hello.')] }] };
  const verifyFailure = (error: unknown) => {
    const failure = error as { retryable?: boolean; interruption?: { resubmitDisposition?: string }; message?: string };
    assert.equal(failure.retryable, false);
    assert.equal(failure.interruption?.resubmitDisposition, 'outcome-uncertain');
    assert.match(failure.message ?? '', /charges/i);
    return true;
  };
  await assert.rejects(model.generateText(input), verifyFailure);
  await assert.rejects(model.streamText(input)[Symbol.asyncIterator]().next(), verifyFailure);
  assert.equal(receivedUnary, 1);
  assert.equal(receivedStream, 1);
});

test('node-grpc projects OUTCOME_UNCERTAIN without inferring restart when submitted immediate AI call loses transport', async () => {
  let unaryCalls = 0;
  let streamCalls = 0;
  const bridge: RuntimeNodeGrpcBridge = {
    async unary() {
      unaryCalls += 1;
      throw Object.assign(new Error('transport disconnected'), {
        reasonCode: 'RUNTIME_GRPC_UNAVAILABLE',
        actionHint: 'retry_or_check_runtime_daemon',
        retryable: true,
      });
    },
    async *serverStream() {
      streamCalls += 1;
      throw Object.assign(new Error('stream deadline exceeded'), {
        reasonCode: 'RUNTIME_GRPC_DEADLINE_EXCEEDED',
        actionHint: 'retry_or_check_runtime_daemon',
        retryable: true,
      });
    },
  };
  const runtime = new Runtime({ transport: { type: 'node-grpc', bridge } });

  // Non-execution RPC keeps its normal transport retryable attribute.
  await assert.rejects(
    runtime.agents.listAgents(ListAgentsRequest.create({ pageSize: 1 })),
    (error: unknown) => {
      const shaped = error as { retryable?: boolean; interruption?: unknown };
      assert.equal(shaped.retryable, true);
      assert.equal(shaped.interruption, undefined);
      return true;
    },
  );
  assert.equal(unaryCalls, 1);

  // Submitted immediate Cloud-capable ExecuteScenario with no Runtime detail projects OUTCOME_UNCERTAIN.
  await assert.rejects(
    runtime.ai.executeScenario({
      head: { appId: 'nimi.app', subjectUserId: 'user-1', timeoutMs: 5000 },
      scenarioType: ScenarioType.TEXT_GENERATE,
      executionMode: ExecutionMode.SYNC,
      extensions: [],
    }),
    (error: unknown) => {
      const shaped = error as {
        reasonCode?: string;
        actionHint?: string;
        retryable?: boolean;
        message?: string;
        interruption?: { cause?: string; resubmitDisposition?: string };
      };
      assert.equal(shaped.reasonCode, 'RUNTIME_GRPC_UNAVAILABLE');
      assert.equal(shaped.retryable, false);
      assert.equal(shaped.actionHint, 'confirm_outcome_and_charges_before_new_request');
      assert.deepEqual(shaped.interruption, {
        cause: 'unspecified',
        resubmitDisposition: 'outcome-uncertain',
      });
      assert.match(String(shaped.message), /unknown/i);
      assert.match(String(shaped.message), /charges/i);
      return true;
    },
  );
  assert.equal(unaryCalls, 2);

  // Pre-aborted immediate call is never submitted and does not project OUTCOME_UNCERTAIN.
  const preAborted = new AbortController();
  preAborted.abort();
  await assert.rejects(
    runtime.ai.executeScenario({
      head: { appId: 'nimi.app', subjectUserId: 'user-1', timeoutMs: 5000 },
      scenarioType: ScenarioType.TEXT_GENERATE,
      executionMode: ExecutionMode.SYNC,
      extensions: [],
    }, { signal: preAborted.signal }),
    (error: unknown) => {
      const shaped = error as { reasonCode?: string; retryable?: boolean; interruption?: unknown };
      assert.equal(shaped.reasonCode, 'OPERATION_ABORTED');
      assert.equal(shaped.retryable, false);
      assert.equal(shaped.interruption, undefined);
      return true;
    },
  );
  assert.equal(unaryCalls, 2);

  // Submitted immediate StreamScenario losing transport projects OUTCOME_UNCERTAIN without replay.
  await assert.rejects(
    (async () => {
      for await (const _event of runtime.ai.streamScenario({
        head: { appId: 'nimi.app', subjectUserId: 'user-1', timeoutMs: 5000 },
        scenarioType: ScenarioType.TEXT_GENERATE,
        executionMode: ExecutionMode.STREAM,
        extensions: [],
      })) {
        // never reached
      }
    })(),
    (error: unknown) => {
      const shaped = error as {
        reasonCode?: string;
        actionHint?: string;
        retryable?: boolean;
        interruption?: { cause?: string; resubmitDisposition?: string };
      };
      assert.equal(shaped.reasonCode, 'RUNTIME_GRPC_DEADLINE_EXCEEDED');
      assert.equal(shaped.retryable, false);
      assert.equal(shaped.actionHint, 'confirm_outcome_and_charges_before_new_request');
      assert.deepEqual(shaped.interruption, {
        cause: 'unspecified',
        resubmitDisposition: 'outcome-uncertain',
      });
      return true;
    },
  );
  assert.equal(streamCalls, 1);
});

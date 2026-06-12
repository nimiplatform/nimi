import assert from 'node:assert/strict';
import test from 'node:test';

import { AccountEventType, RuntimeHealthStatus } from '../core-generated/runtime-typed-client';
import {
  AccountSessionEvent,
  SubscribeAccountSessionEventsRequest,
} from '../core-generated/runtime-protobuf/runtime/v1/account';
import {
  GetRuntimeHealthRequest,
  GetRuntimeHealthResponse,
} from '../core-generated/runtime-protobuf/runtime/v1/audit';
import { Runtime } from './index';
import { createRuntimeNodeGrpcTransport, type RuntimeNodeGrpcBridge } from './node-grpc';
import { ReasonCode } from '../types';

test('node-grpc Runtime transport encodes and decodes protobuf bytes', async () => {
  let observedBody: Uint8Array | undefined;
  const bridge: RuntimeNodeGrpcBridge = {
    async unary(request) {
      observedBody = request.body;
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

test('node-grpc Runtime transport decodes protobuf server streams', async () => {
  const bridge: RuntimeNodeGrpcBridge = {
    async unary() {
      throw new Error('unexpected unary call');
    },
    async *serverStream(request) {
      assert.equal(request.methodId, '/nimi.runtime.v1.RuntimeAccountService/SubscribeAccountSessionEvents');
      assert.deepEqual(SubscribeAccountSessionEventsRequest.fromBinary(request.body), {
        afterSequence: '41',
      });
      yield AccountSessionEvent.toBinary(AccountSessionEvent.create({
        eventId: 'event-42',
        sequence: '42',
        eventType: AccountEventType.LOGIN_COMPLETED,
      }));
    },
  };

  const transport = createRuntimeNodeGrpcTransport({ endpoint: 'http://127.0.0.1:46371', bridge });
  const runtime = new Runtime({ transport });
  const events = [];

  for await (const event of runtime.account.subscribeAccountSessionEvents({ afterSequence: '41' })) {
    events.push(event);
  }

  assert.equal(events.length, 1);
  assert.equal(events[0]?.eventId, 'event-42');
  assert.equal(events[0]?.eventType, AccountEventType.LOGIN_COMPLETED);
});

test('Runtime constructs default node-grpc transport in Node.js', () => {
  const runtime = new Runtime();

  assert.equal(typeof runtime.unsafeRawTransport().unary, 'function');
  assert.equal(typeof runtime.unsafeRawTransport().serverStream, 'function');
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

test('node-grpc Runtime transport rejects providerApiKey over non-loopback plaintext endpoints', async () => {
  const bridge: RuntimeNodeGrpcBridge = {
    async unary() {
      throw new Error('provider key validation should run before bridge unary');
    },
    async *serverStream() {
      throw new Error('unexpected stream call');
    },
  };
  const runtime = new Runtime({
    transport: { type: 'node-grpc', endpoint: 'runtime.example.com:46371', bridge },
    metadata: { providerApiKey: 'secret-provider-key' },
  });

  await assert.rejects(
    runtime.ready(),
    (error: unknown) => {
      const shaped = error as { code?: string; reasonCode?: string; actionHint?: string };
      assert.equal(shaped.code, 'SDK_TRANSPORT_INVALID');
      assert.equal(shaped.reasonCode, 'SDK_TRANSPORT_INVALID');
      assert.equal(shaped.actionHint, 'enable_tls_or_use_loopback_for_provider_api_key');
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

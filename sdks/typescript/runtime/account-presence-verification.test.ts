import assert from 'node:assert/strict';
import test from 'node:test';

import type { CoreStreamRequest, CoreUnaryRequest } from '../types';
import type { CoreTransport } from '../core-client';
import { ReasonCode } from '../types';
import { Runtime } from './index';

class FakeRuntimeTransport implements CoreTransport {
  readonly unaryCalls: CoreUnaryRequest[] = [];

  async unary<Response>(request: CoreUnaryRequest): Promise<Response> {
    this.unaryCalls.push(request);
    throw Object.assign(new Error(`unexpected unary ${request.methodId}`), {
      code: 'unexpected_runtime_unary',
    });
  }

  async *serverStream<Response>(_request: CoreStreamRequest): AsyncIterable<Response> {
    throw Object.assign(new Error('unexpected stream'), {
      code: 'unexpected_runtime_stream',
    });
  }
}

test('public Runtime account presence verification fails closed before transport', async () => {
  const transport = new FakeRuntimeTransport();
  const runtime = new Runtime({ transport });

  assert.equal(typeof runtime.account.requestPresenceVerification, 'function');

  await assert.rejects(
    runtime.account.requestPresenceVerification({
      caller: {
        appId: 'nimi.shijing',
        appInstanceId: 'nimi.shijing.local',
        deviceId: 'desktop-device',
        mode: 1,
        scopes: ['runtime.account.presence'],
      },
      purpose: 'shijing.profile.reveal',
      ttlSeconds: 120,
    }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === ReasonCode.SDK_RUNTIME_METHOD_UNAVAILABLE,
  );
  assert.equal(transport.unaryCalls.length, 0);
});

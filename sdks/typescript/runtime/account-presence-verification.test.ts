import assert from 'node:assert/strict';
import test from 'node:test';

import type { CoreStreamRequest, CoreUnaryRequest } from '../types';
import type { CoreTransport } from '../core-client';
import {
  AccountReasonCode,
  PresenceVerificationMethod,
  PresenceVerificationState,
  ReasonCode,
} from '../core-generated/runtime-typed-client';
import { Runtime } from './index';

class FakeRuntimeTransport implements CoreTransport {
  readonly unaryCalls: CoreUnaryRequest[] = [];

  async unary<Response>(request: CoreUnaryRequest): Promise<Response> {
    this.unaryCalls.push(request);
    if (request.methodId === '/nimi.runtime.v1.RuntimeAccountService/RequestPresenceVerification') {
      return {
        accepted: true,
        state: PresenceVerificationState.VERIFIED,
        method: PresenceVerificationMethod.OS_CREDENTIAL,
        reasonCode: ReasonCode.ACTION_EXECUTED,
        accountReasonCode: AccountReasonCode.ACTION_EXECUTED,
        verifiedUntil: { seconds: BigInt(1_801_234_567), nanos: 0 },
      } as Response;
    }
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

test('Runtime account presence verification is a typed SDK account projection', async () => {
  const transport = new FakeRuntimeTransport();
  const runtime = new Runtime({ transport });

  assert.equal(typeof runtime.account.requestPresenceVerification, 'function');

  const response = await runtime.account.requestPresenceVerification({
    caller: {
      appId: 'nimi.shijing',
      appInstanceId: 'nimi.shijing.local',
      deviceId: 'desktop-device',
      mode: 1,
      scopes: ['runtime.account.presence'],
    },
    purpose: 'shijing.profile.reveal',
    ttlSeconds: 120,
  });

  assert.equal(response.accepted, true);
  assert.equal(response.state, PresenceVerificationState.VERIFIED);
  assert.equal(transport.unaryCalls[0]?.methodId, '/nimi.runtime.v1.RuntimeAccountService/RequestPresenceVerification');
  assert.deepEqual(transport.unaryCalls[0]?.body, {
    caller: {
      appId: 'nimi.shijing',
      appInstanceId: 'nimi.shijing.local',
      deviceId: 'desktop-device',
      mode: 1,
      scopes: ['runtime.account.presence'],
    },
    purpose: 'shijing.profile.reveal',
    ttlSeconds: 120,
  });
});

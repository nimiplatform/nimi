import assert from 'node:assert/strict';
import fixtures from '../fixtures/behavior-fixtures.json' with { type: 'json' };
import { CoreClient, type CoreTransport } from '../../typescript/core-client';
import {
  AccountCallerMode,
  AccountEventType,
  RuntimeTypedClient,
  type BeginLoginRequest,
} from '../../typescript/core-generated/runtime-typed-client';
import { RealmTypedClient } from '../../typescript/core-generated/realm-typed-client';
import type { CoreStreamRequest, CoreUnaryRequest } from '../../typescript/types';

class FakeTransport implements CoreTransport {
  readonly unaryCalls: CoreUnaryRequest[] = [];
  readonly streamCalls: CoreStreamRequest[] = [];

  async unary<Response>(request: CoreUnaryRequest): Promise<Response> {
    this.unaryCalls.push(request);
    if (request.signal?.aborted) {
      throw Object.assign(new Error('aborted'), { code: fixtures.cases.cancellation.reason_code });
    }
    if ((request.body as { redirectUri?: string }).redirectUri === 'force-error') {
      throw Object.assign(new Error('transport failure'), {
        code: fixtures.cases.structured_error.reason_code,
        details: fixtures.cases.structured_error.details,
      });
    }
    if (request.methodId === fixtures.cases.runtime_unary.method_id) {
      return {
        accepted: true,
        loginAttemptId: 'login-conformance',
        callbackOrigin: 'https://app.example',
      } as Response;
    }
    if (request.methodId === fixtures.cases.realm_unary.operation_id) {
      return fixtures.cases.realm_unary.response as Response;
    }
    throw Object.assign(new Error(`unexpected unary ${request.methodId}`), { code: 'SDK_RUNTIME_METHOD_UNAVAILABLE' });
  }

  async *serverStream<Response>(request: CoreStreamRequest): AsyncIterable<Response> {
    this.streamCalls.push(request);
    assert.equal(request.methodId, fixtures.cases.runtime_stream.method_id);
    yield { eventId: 'event-1', sequence: '1', eventType: AccountEventType.LOGIN_STARTED } as Response;
    yield { eventId: 'event-2', sequence: '2', eventType: AccountEventType.LOGIN_COMPLETED } as Response;
  }
}

async function main() {
  const transport = new FakeTransport();
  const core = new CoreClient({
    transport,
    authMetadata: () => fixtures.cases.metadata.auth,
  });
  const typedRuntime = new RuntimeTypedClient(core);
  const typedRealm = new RealmTypedClient(core);
  const runtimeRequest: BeginLoginRequest = {
    caller: { appId: 'app-conformance', mode: AccountCallerMode.DESKTOP_SHELL, scopes: ['account.login'] },
    redirectUri: 'https://app.example/callback',
    callbackOrigin: 'https://app.example',
    requestedScopes: ['openid', 'profile'],
    ttlSeconds: 60,
  };
  const typedRuntimeResponse = await typedRuntime.beginLogin(
    runtimeRequest,
    { metadata: fixtures.cases.metadata.caller, timeoutMs: fixtures.cases.timeout_ms },
  );
  assert.equal(typedRuntimeResponse.accepted, true);
  assert.equal(typedRuntimeResponse.loginAttemptId, 'login-conformance');

  const typedEvents = [];
  for await (const event of typedRuntime.subscribeAccountSessionEvents({
    caller: runtimeRequest.caller,
    afterSequence: '0',
  })) {
    typedEvents.push(event);
  }
  assert.equal(typedEvents[0].eventType, AccountEventType.LOGIN_STARTED);
  assert.equal(typedEvents[1].eventType, AccountEventType.LOGIN_COMPLETED);

  const realmResponse = await typedRealm.checkHandle(
    { path: {}, query: fixtures.cases.realm_unary.query },
    { metadata: fixtures.cases.metadata.caller, timeoutMs: fixtures.cases.timeout_ms },
  );
  assert.deepEqual(realmResponse, fixtures.cases.realm_unary.response);
  const realmCall = transport.unaryCalls.at(-1);
  assert.equal(realmCall?.methodId, fixtures.cases.realm_unary.operation_id);
  assert.deepEqual(realmCall?.body, { path: {}, query: fixtures.cases.realm_unary.query });
  assert.equal(realmCall?.timeoutMs, fixtures.cases.timeout_ms);
  assert.equal(
    realmCall?.metadata?.['x-nimi-access-token-id'],
    fixtures.cases.metadata.auth['x-nimi-access-token-id'],
  );
  assert.equal(realmCall?.metadata?.['x-nimi-caller'], fixtures.cases.metadata.caller['x-nimi-caller']);

  assert.equal(transport.unaryCalls[0].methodId, fixtures.cases.runtime_unary.method_id);
  assert.deepEqual(transport.unaryCalls[0].body, runtimeRequest);
  assert.equal(transport.unaryCalls[0].timeoutMs, fixtures.cases.timeout_ms);
  assert.equal(
    transport.unaryCalls[0].metadata?.['x-nimi-access-token-id'],
    fixtures.cases.metadata.auth['x-nimi-access-token-id'],
  );
  assert.equal(transport.unaryCalls[0].metadata?.['x-nimi-caller'], fixtures.cases.metadata.caller['x-nimi-caller']);

  const abortController = new AbortController();
  abortController.abort();
  await assert.rejects(
    typedRuntime.beginLogin(runtimeRequest, { signal: abortController.signal }),
    (error: unknown) => (error as { code?: string }).code === fixtures.cases.cancellation.reason_code,
  );
  await assert.rejects(
    typedRuntime.beginLogin({ ...runtimeRequest, redirectUri: 'force-error' }),
    (error: unknown) => {
      const shaped = error as { code?: string; details?: unknown };
      assert.equal(shaped.code, fixtures.cases.structured_error.reason_code);
      assert.deepEqual(shaped.details, fixtures.cases.structured_error.details);
      return true;
    },
  );

  console.log('sdks behavior conformance: OK (typescript)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

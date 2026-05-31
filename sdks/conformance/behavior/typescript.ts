import assert from 'node:assert/strict';
import fixtures from '../fixtures/behavior-fixtures.json' with { type: 'json' };
import { CoreClient, type CoreTransport } from '../../typescript/core-client';
import { RuntimeGeneratedClient } from '../../typescript/core-generated/runtime-client';
import { RealmGeneratedClient } from '../../typescript/core-generated/realm-client';
import { RuntimeTypedClient, type BeginLoginRequest } from '../../typescript/core-generated/runtime-typed-client';
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
    if ((request.body as { redirect_uri?: string }).redirect_uri === 'force-error') {
      throw Object.assign(new Error(fixtures.cases.structured_error.message), {
        code: fixtures.cases.structured_error.reason_code,
        details: fixtures.cases.structured_error.details,
      });
    }
    if (request.methodId === fixtures.cases.runtime_unary.method_id) {
      if (process.env.SDKS_CONFORMANCE_PROFILE === 'typed-core') {
        return {
          accepted: true,
          login_attempt_id: 'login-conformance',
          callback_origin: 'https://app.example',
        } as Response;
      }
      return fixtures.cases.runtime_unary.response_body as Response;
    }
    if (request.methodId === fixtures.cases.realm_operation.operation_id) {
      if (process.env.SDKS_CONFORMANCE_PROFILE === 'typed-core') {
        return {
          id: 'intent-conformance',
          status: 'ACKED',
          localAgentRef: 'local-agent',
          ownerUserId: 'owner',
          realmAgentId: 'realm-agent',
          attempts: 1,
          availableAt: '2026-01-01T00:00:00Z',
          createdAt: '2026-01-01T00:00:00Z',
        } as Response;
      }
      return fixtures.cases.realm_operation.response_body as Response;
    }
    throw Object.assign(new Error(`unexpected unary ${request.methodId}`), { code: 'SDK_RUNTIME_METHOD_UNAVAILABLE' });
  }

  async *serverStream<Response>(request: CoreStreamRequest): AsyncIterable<Response> {
    this.streamCalls.push(request);
    assert.equal(request.methodId, fixtures.cases.runtime_stream.method_id);
    if (process.env.SDKS_CONFORMANCE_PROFILE === 'typed-core') {
      yield { event_id: 'event-1', sequence: 1, event_type: 'ACCOUNT_EVENT_TYPE_LOGIN_STARTED' } as Response;
      yield { event_id: 'event-2', sequence: 2, event_type: 'ACCOUNT_EVENT_TYPE_LOGIN_COMPLETED' } as Response;
      return;
    }
    for (const event of fixtures.cases.runtime_stream.events) {
      yield event as Response;
    }
  }
}

async function main() {
  const profile = process.env.SDKS_CONFORMANCE_PROFILE ?? 'descriptor-foundation';
  const transport = new FakeTransport();
  const core = new CoreClient({
    transport,
    authMetadata: () => fixtures.cases.metadata.auth,
  });
  const runtime = new RuntimeGeneratedClient(core);
  const realm = new RealmGeneratedClient(core);
  const typedRuntime = new RuntimeTypedClient(core);
  const typedRealm = new RealmTypedClient(core);

  if (profile === 'typed-core') {
    const runtimeRequest: BeginLoginRequest = {
      caller: { app_id: 'app-conformance', mode: 'ACCOUNT_CALLER_MODE_DESKTOP_SHELL', scopes: ['account.login'] },
      redirect_uri: 'https://app.example/callback',
      callback_origin: 'https://app.example',
      requested_scopes: ['openid', 'profile'],
      ttl_seconds: 60,
    };
    const typedRuntimeResponse = await typedRuntime.beginLogin(
      runtimeRequest,
      { metadata: fixtures.cases.metadata.caller, timeoutMs: fixtures.cases.timeout_ms },
    );
    assert.equal(typedRuntimeResponse.accepted, true);
    assert.equal(typedRuntimeResponse.login_attempt_id, 'login-conformance');

    const typedEvents = [];
    for await (const event of typedRuntime.subscribeAccountSessionEvents({
      caller: runtimeRequest.caller,
      after_sequence: 0,
    })) {
      typedEvents.push(event);
    }
    assert.equal(typedEvents[0].event_type, 'ACCOUNT_EVENT_TYPE_LOGIN_STARTED');
    assert.equal(typedEvents[1].event_type, 'ACCOUNT_EVENT_TYPE_LOGIN_COMPLETED');

    const typedRealmResponse = await typedRealm.ackMyLocalAgentProvisionIntent({
      path: { intentId: 'intent-conformance' },
      body: { outcome: 'established', detail: 'ok' },
    });
    assert.equal(typedRealmResponse.id, 'intent-conformance');

    assert.equal(transport.unaryCalls[0].methodId, fixtures.cases.runtime_unary.method_id);
    assert.deepEqual(transport.unaryCalls[0].body, runtimeRequest);
    assert.equal(transport.unaryCalls[1].methodId, fixtures.cases.realm_operation.operation_id);
    assert.deepEqual(transport.unaryCalls[1].body, { path: { intentId: 'intent-conformance' }, body: { outcome: 'established', detail: 'ok' } });
    const abortController = new AbortController();
    abortController.abort();
    await assert.rejects(
      typedRuntime.beginLogin(runtimeRequest, { signal: abortController.signal }),
      (error: unknown) => (error as { code?: string }).code === fixtures.cases.cancellation.reason_code,
    );
    await assert.rejects(
      typedRuntime.beginLogin({ ...runtimeRequest, redirect_uri: 'force-error' }),
      (error: unknown) => {
        const shaped = error as { code?: string; message?: string; details?: unknown };
        assert.equal(shaped.code, fixtures.cases.structured_error.reason_code);
        assert.equal(shaped.message, fixtures.cases.structured_error.message);
        assert.deepEqual(shaped.details, fixtures.cases.structured_error.details);
        return true;
      },
    );
    assert.equal(runtime.unsafeRaw(), transport);
    assert.equal(realm.unsafeRaw(), transport);
    console.log('sdks behavior conformance: OK (typescript typed-core)');
    return;
  }

  const runtimeResponse = await runtime.call(
    fixtures.cases.runtime_unary.method_id,
    fixtures.cases.runtime_unary.request_body,
    { metadata: fixtures.cases.metadata.caller, timeoutMs: fixtures.cases.timeout_ms },
  );
  assert.deepEqual(runtimeResponse, fixtures.cases.runtime_unary.response_body);
  assert.deepEqual(transport.unaryCalls[0].body, fixtures.cases.runtime_unary.request_body);
  assert.equal(transport.unaryCalls[0].timeoutMs, fixtures.cases.timeout_ms);
  assert.equal(transport.unaryCalls[0].metadata?.authorization, fixtures.cases.metadata.auth.authorization);
  assert.equal(transport.unaryCalls[0].metadata?.['x-nimi-caller'], fixtures.cases.metadata.caller['x-nimi-caller']);

  const events = [];
  for await (const event of runtime.stream(fixtures.cases.runtime_stream.method_id, fixtures.cases.runtime_stream.request_body)) {
    events.push(event);
  }
  assert.deepEqual(events, fixtures.cases.runtime_stream.events);

  const realmResponse = await realm.operation(
    fixtures.cases.realm_operation.operation_id,
    fixtures.cases.realm_operation.request_body,
  );
  assert.deepEqual(realmResponse, fixtures.cases.realm_operation.response_body);

  const abortController = new AbortController();
  abortController.abort();
  await assert.rejects(
    runtime.call(fixtures.cases.runtime_unary.method_id, {}, { signal: abortController.signal }),
    (error: unknown) => (error as { code?: string }).code === fixtures.cases.cancellation.reason_code,
  );

  assert.equal(runtime.unsafeRaw(), transport);
  assert.equal(realm.unsafeRaw(), transport);

  console.log('sdks behavior conformance: OK (typescript)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

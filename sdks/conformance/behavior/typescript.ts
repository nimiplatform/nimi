import assert from 'node:assert/strict';
import fixtures from '../fixtures/behavior-fixtures.json' with { type: 'json' };
import { CoreClient, type CoreTransport } from '../../typescript/core-client';
import { RuntimeGeneratedClient } from '../../typescript/core-generated/runtime-client';
import { RealmGeneratedClient } from '../../typescript/core-generated/realm-client';
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
      throw Object.assign(new Error(fixtures.cases.structured_error.message), {
        code: fixtures.cases.structured_error.reason_code,
        details: fixtures.cases.structured_error.details,
      });
    }
    if (request.methodId === fixtures.cases.runtime_unary.method_id) {
      if (process.env.SDKS_CONFORMANCE_PROFILE === 'typed-core') {
        return {
          accepted: true,
          loginAttemptId: 'login-conformance',
          callbackOrigin: 'https://app.example',
        } as Response;
      }
      return fixtures.cases.runtime_unary.response_body as Response;
    }
    if (request.methodId === 'WorldCoreController_createSourceMaterializationPacket') {
      if (process.env.SDKS_CONFORMANCE_PROFILE === 'typed-core') {
        return {
          packetSchemaVersion: 'realm.source-materialization-packet/v1',
          packetId: 'packet-conformance',
          runtimeSourceRef: 'runtime-source:realmPersona:persona-conformance:hash-conformance',
          sourceKind: 'realmPersona',
          sourceId: 'persona-conformance',
          sourceWorldId: 'oasis',
          sourceContentHash: 'hash-conformance',
          sourceContentRevision: 1,
          issuedAt: '2026-01-01T00:00:00Z',
          expiresAt: '2026-01-01T00:05:00Z',
          nonce: 'nonce-conformance',
          packetHash: 'packet-hash-conformance',
          packetProof: 'hmac-sha256:proof-conformance',
          intendedRuntimeAudience: 'sdk.conformance',
          sourceDisplayMetadata: { displayName: 'Conformance Persona' },
          payload: { displayName: 'Conformance Persona' },
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
      yield { eventId: 'event-1', sequence: '1', eventType: AccountEventType.LOGIN_STARTED } as Response;
      yield { eventId: 'event-2', sequence: '2', eventType: AccountEventType.LOGIN_COMPLETED } as Response;
      return;
    }
    for (const event of fixtures.cases.runtime_stream.events) {
      yield event as Response;
    }
  }
}

async function main() {
  const profile = process.env.SDKS_CONFORMANCE_PROFILE ?? 'descriptor-foundation';
  if (profile !== 'descriptor-foundation' && profile !== 'typed-core') {
    throw Object.assign(new Error(`unsupported SDKS_CONFORMANCE_PROFILE ${profile}`), {
      code: 'SDK_CONFORMANCE_PROFILE_UNSUPPORTED',
    });
  }
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

    const typedRealmResponse = await typedRealm.worldCoreControllerCreateSourceMaterializationPacket({
      path: {},
      body: {
        intendedRuntimeAudience: 'sdk.conformance',
        sourceRef: {
          kind: 'realmPersona',
          sourceId: 'persona-conformance',
          sourceContentHash: 'hash-conformance',
          worldId: 'oasis',
        },
      },
    });
    assert.equal(typedRealmResponse.runtimeSourceRef, 'runtime-source:realmPersona:persona-conformance:hash-conformance');

    assert.equal(transport.unaryCalls[0].methodId, fixtures.cases.runtime_unary.method_id);
    assert.deepEqual(transport.unaryCalls[0].body, runtimeRequest);
    assert.equal(transport.unaryCalls[1].methodId, 'WorldCoreController_createSourceMaterializationPacket');
    assert.deepEqual(transport.unaryCalls[1].body, {
      path: {},
      body: {
        intendedRuntimeAudience: 'sdk.conformance',
        sourceRef: {
          kind: 'realmPersona',
          sourceId: 'persona-conformance',
          sourceContentHash: 'hash-conformance',
          worldId: 'oasis',
        },
      },
    });
    const abortController = new AbortController();
    abortController.abort();
    await assert.rejects(
      typedRuntime.beginLogin(runtimeRequest, { signal: abortController.signal }),
      (error: unknown) => (error as { code?: string }).code === fixtures.cases.cancellation.reason_code,
    );
    await assert.rejects(
      typedRuntime.beginLogin({ ...runtimeRequest, redirectUri: 'force-error' }),
      (error: unknown) => {
        const shaped = error as { code?: string; message?: string; details?: unknown };
        assert.equal(shaped.code, fixtures.cases.structured_error.reason_code);
        assert.equal(shaped.message, fixtures.cases.structured_error.message);
        assert.deepEqual(shaped.details, fixtures.cases.structured_error.details);
        return true;
      },
    );
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
  assert.equal(
    transport.unaryCalls[0].metadata?.['x-nimi-access-token-id'],
    fixtures.cases.metadata.auth['x-nimi-access-token-id'],
  );
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

  console.log('sdks behavior conformance: OK (typescript)');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

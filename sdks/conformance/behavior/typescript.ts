import assert from 'node:assert/strict';
import fixtures from '../fixtures/behavior-fixtures.json' with { type: 'json' };
import { CoreClient, type CoreTransport } from '../../typescript/core-client';
import { RuntimeGeneratedClient } from '../../typescript/core-generated/runtime-client';
import { RealmGeneratedClient } from '../../typescript/core-generated/realm-client';
import type { CoreStreamRequest, CoreUnaryRequest } from '../../typescript/types';

class FakeTransport implements CoreTransport {
  readonly unaryCalls: CoreUnaryRequest[] = [];
  readonly streamCalls: CoreStreamRequest[] = [];

  async unary<Response>(request: CoreUnaryRequest): Promise<Response> {
    this.unaryCalls.push(request);
    if (request.signal?.aborted) {
      throw Object.assign(new Error('aborted'), { code: fixtures.cases.cancellation.reason_code });
    }
    if (request.methodId === fixtures.cases.runtime_unary.method_id) {
      return fixtures.cases.runtime_unary.response_body as Response;
    }
    if (request.methodId === fixtures.cases.realm_operation.operation_id) {
      return fixtures.cases.realm_operation.response_body as Response;
    }
    throw Object.assign(new Error(`unexpected unary ${request.methodId}`), { code: 'SDK_RUNTIME_METHOD_UNAVAILABLE' });
  }

  async *serverStream<Response>(request: CoreStreamRequest): AsyncIterable<Response> {
    this.streamCalls.push(request);
    assert.equal(request.methodId, fixtures.cases.runtime_stream.method_id);
    for (const event of fixtures.cases.runtime_stream.events) {
      yield event as Response;
    }
  }
}

async function main() {
  const transport = new FakeTransport();
  const core = new CoreClient({
    transport,
    authMetadata: () => fixtures.cases.metadata.auth,
  });
  const runtime = new RuntimeGeneratedClient(core);
  const realm = new RealmGeneratedClient(core);

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

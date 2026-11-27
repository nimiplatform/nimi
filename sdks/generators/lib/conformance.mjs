import { writeJson } from './context.mjs';

export function writeConformanceFixtures(runtime, realm) {
  const runtimeUnaryMethod = runtime.codec_maps.find(
    (entry) => entry.kind === 'unary' && entry.method_id === '/nimi.runtime.v1.RuntimeAccountService/BeginLogin',
  );
  const runtimeStreamMethod = runtime.codec_maps.find(
    (entry) => entry.kind === 'server_stream' && entry.method_id === '/nimi.runtime.v1.RuntimeAccountService/SubscribeAccountSessionEvents',
  );
  const realmUnaryOperation = realm.operations.find((entry) => entry.operation_id === 'checkHandle');
  if (!runtimeUnaryMethod || !runtimeStreamMethod || !realmUnaryOperation) {
    throw new Error('cannot build behavior fixtures without Runtime BeginLogin/SubscribeAccountSessionEvents and Realm checkHandle samples');
  }
  writeJson('sdks/conformance/fixtures/behavior-fixtures.json', {
    cases: {
      runtime_unary: {
        method_id: runtimeUnaryMethod.method_id,
      },
      runtime_stream: {
        method_id: runtimeStreamMethod.method_id,
      },
      realm_unary: {
        operation_id: realmUnaryOperation.operation_id,
        query: { handle: 'realm-conformance' },
        response: { available: true, message: 'available' },
      },
      metadata: {
        auth: { 'x-nimi-access-token-id': 'conformance-token-id' },
        caller: { 'x-nimi-caller': 'sdks-conformance' },
      },
      timeout_ms: 1234,
      cancellation: {
        reason_code: 'OPERATION_ABORTED',
      },
      structured_error: {
        reason_code: 'SDK_RUNTIME_METHOD_UNAVAILABLE',
        details: { fixture: 'typed-core' },
      },
    },
  });
}

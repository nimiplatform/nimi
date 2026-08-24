import { writeJson } from './context.mjs';

export function writeConformanceFixtures(runtime, realm) {
  const firstUnaryMethod = runtime.codec_maps.find((entry) => entry.kind === 'unary');
  const firstStreamMethod = runtime.codec_maps.find((entry) => entry.kind === 'server_stream');
  const realmUnaryOperation = realm.operations.find((entry) => entry.operation_id === 'checkHandle');
  if (!firstUnaryMethod || !firstStreamMethod || !realmUnaryOperation) {
    throw new Error('cannot build behavior fixtures without Runtime unary/stream and Realm checkHandle samples');
  }
  writeJson('sdks/conformance/fixtures/behavior-fixtures.json', {
    cases: {
      runtime_unary: {
        method_id: firstUnaryMethod.method_id,
      },
      runtime_stream: {
        method_id: firstStreamMethod.method_id,
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

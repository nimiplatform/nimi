import { generatedBy, languages, writeJson } from './context.mjs';
import {
  realmOperationRequestType,
  realmOperationResponseType,
  typedFixtureNames,
} from './types.mjs';

export function writeConformanceFixtures(runtime, realm, errorCodes, exportsManifest) {
  const firstUnaryMethod = runtime.codec_maps.find((entry) => entry.kind === 'unary');
  const firstStreamMethod = runtime.codec_maps.find((entry) => entry.kind === 'server_stream');
  const firstRealmOperation = realm.operations.find((entry) => entry.operation_id);
  if (!firstUnaryMethod || !firstStreamMethod || !firstRealmOperation) {
    throw new Error('cannot build behavior fixtures without unary, stream, and realm operation samples');
  }
  const typedNames = typedFixtureNames(firstUnaryMethod, firstStreamMethod, firstRealmOperation);
  writeJson('sdks/conformance/fixtures/core-fixtures.manifest.json', {
    contract: 'nimi.sdks.core-conformance-fixtures.v1',
    generated_by: generatedBy,
    source_kind: 'generated_core_manifests',
    source_paths: [
      'sdks/generators/shared/generated/runtime-core.manifest.json',
      'sdks/generators/shared/generated/realm-core.manifest.json',
      'sdks/generators/shared/generated/error-codes.manifest.json',
      'sdks/generators/shared/generated/export-manifest.json',
    ],
    languages,
    fixture_groups: [
      {
        name: 'runtime_method_presence',
        count: runtime.method_ids.length,
      },
      {
        name: 'realm_operation_presence',
        count: realm.operations.length,
        source_state: realm.source_state,
      },
      {
        name: 'request_response_codecs',
        count: runtime.codec_maps.length,
      },
      {
        name: 'stream_event_branch_preservation',
        count: runtime.codec_maps.filter((entry) => entry.kind === 'server_stream').length,
      },
      {
        name: 'error_reason_code_projection',
        count: errorCodes.values.length,
      },
      {
        name: 'export_manifest',
        count: exportsManifest.core_families.length,
      },
    ],
  });
  writeJson('sdks/conformance/fixtures/behavior-fixtures.json', {
    contract: 'nimi.sdks.behavior-fixtures.v1',
    generated_by: generatedBy,
    source_kind: 'generated_core_manifests',
    source_paths: [
      'sdks/generators/shared/generated/runtime-core.manifest.json',
      'sdks/generators/shared/generated/realm-core.manifest.json',
    ],
    cases: {
      runtime_unary: {
        method_id: firstUnaryMethod.method_id,
        method: firstUnaryMethod.method,
        typed_names: typedNames.runtime_unary,
        request_type: firstUnaryMethod.request_type,
        response_type: firstUnaryMethod.response_type,
        kind: firstUnaryMethod.kind,
        request_body: { hello: 'runtime' },
        response_body: { ok: true, source: 'runtime-unary' },
      },
      runtime_stream: {
        method_id: firstStreamMethod.method_id,
        method: firstStreamMethod.method,
        typed_names: typedNames.runtime_stream,
        request_type: firstStreamMethod.request_type,
        response_type: firstStreamMethod.response_type,
        kind: firstStreamMethod.kind,
        request_body: { hello: 'stream' },
        events: [
          { index: 1, branch: 'delta' },
          { index: 2, branch: 'done' },
        ],
      },
      realm_operation: {
        operation_id: firstRealmOperation.operation_id,
        typed_names: typedNames.realm_operation,
        request_type: realmOperationRequestType(firstRealmOperation.operation_id),
        response_type: realmOperationResponseType(firstRealmOperation.operation_id),
        method: firstRealmOperation.method,
        path: firstRealmOperation.path,
        path_params: { intentId: 'intent-conformance' },
        query: { include: 'projection' },
        headers: { 'x-realm-public-projection-boundary': 'conformance' },
        request_body: { hello: 'realm' },
        response_body: { ok: true, source: 'realm-operation' },
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
        message: 'typed conformance error',
        details: { fixture: 'typed-core' },
        request_body: { force_error: 'structured' },
      },
    },
  });
  writeJson('sdks/conformance/manifests/phase1-languages.json', {
    contract: 'nimi.sdks.phase1-languages.v1',
    generated_by: generatedBy,
    source_kind: 'sdk_spec_rule',
    source_paths: ['docs/authority/sdks-client-core-rationale.md'],
    source_rule: 'S-SURFACE-019',
    languages,
    required_roots: languages.map((language) => `sdks/${language}`),
  });
}

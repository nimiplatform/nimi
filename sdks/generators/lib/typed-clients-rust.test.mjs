import assert from 'node:assert/strict';
import test from 'node:test';

import {
  renderRustRealmRequestEncoders,
  rustRealmTypedAdmittedOperationIds,
  rustRuntimeTypedAdmittedMethodIds,
} from './typed-clients-rust.mjs';

const BOOLEAN_SCHEMA = {
  kind: 'scalar',
  type: 'boolean',
  nullable: false,
};

function operation(operationId, overrides = {}) {
  return {
    operation_id: operationId,
    path_parameters: [],
    query_parameters: [],
    header_parameters: [],
    request_schema: { kind: 'unknown' },
    response_schemas: [{ status: '200', schema: { kind: 'ref', ref_name: 'ReadyDto' } }],
    ...overrides,
  };
}

test('Rust Realm typed admission excludes operations without complete encoders and decoders', () => {
  const realm = {
    operations: [
      operation('readyRead'),
      operation('bodyWrite', { request_schema: { kind: 'ref', ref_name: 'BodyDto' } }),
      operation('nestedRead', {
        response_schemas: [{ status: '200', schema: { kind: 'ref', ref_name: 'NestedDto' } }],
      }),
      operation('nullableRead', {
        response_schemas: [{ status: '200', schema: { kind: 'ref', ref_name: 'NullableDto' } }],
      }),
    ],
    model_schemas: [
      {
        name: 'ReadyDto',
        schema: {
          kind: 'object',
          properties: [{ name: 'ready', required: true, schema: BOOLEAN_SCHEMA }],
        },
      },
      {
        name: 'NestedDto',
        schema: {
          kind: 'object',
          properties: [{
            name: 'nested',
            required: true,
            schema: { kind: 'ref', ref_name: 'ReadyDto' },
          }],
        },
      },
      {
        name: 'NullableDto',
        schema: {
          kind: 'object',
          properties: [{
            name: 'updatedAt',
            required: true,
            schema: { kind: 'scalar', type: 'string', nullable: true },
          }],
        },
      },
    ],
  };

  assert.deepEqual(rustRealmTypedAdmittedOperationIds(realm), ['readyRead', 'nullableRead']);
});

test('Rust Realm required string path encoders reject empty values with a typed error', () => {
  const lines = renderRustRealmRequestEncoders(operation('readById', {
    path_parameters: [{
      name: 'id',
      required: true,
      schema: { kind: 'scalar', type: 'string', nullable: false },
    }],
  }));

  assert.ok(lines);
  const rendered = lines.join('\n');
  assert.match(rendered, /request\.path\.id\.is_empty\(\)/u);
  assert.match(rendered, /RealmTypedClientError::RequestEncode/u);
  assert.match(rendered, /operation_id: "readById"/u);
  assert.match(rendered, /field: "path\.id"/u);
  assert.doesNotMatch(rendered, /panic!/u);
});

test('Rust Runtime typed admission excludes unsupported fields and streaming kinds', () => {
  const runtime = {
    codec_maps: [
      {
        method: 'Ready',
        method_id: '/runtime/Ready',
        kind: 'unary',
        request_type: 'ReadyRequest',
        response_type: 'ReadyResponse',
      },
      {
        method: 'Nested',
        method_id: '/runtime/Nested',
        kind: 'unary',
        request_type: 'NestedRequest',
        response_type: 'ReadyResponse',
      },
      {
        method: 'Upload',
        method_id: '/runtime/Upload',
        kind: 'client_stream',
        request_type: 'ReadyRequest',
        response_type: 'ReadyResponse',
      },
    ],
    schema_types: {
      messages: ['ReadyRequest', 'ReadyResponse', 'NestedRequest'],
      enums: [],
      enum_schemas: [],
      message_schemas: [
        { name: 'ReadyRequest', fields: [{ name: 'id', type: 'string', repeated: false }] },
        { name: 'ReadyResponse', fields: [{ name: 'ready', type: 'bool', repeated: false }] },
        {
          name: 'NestedRequest',
          fields: [{ name: 'spec', type: 'ScenarioSpec', repeated: false }],
        },
      ],
    },
  };

  assert.deepEqual(rustRuntimeTypedAdmittedMethodIds(runtime), ['/runtime/Ready']);
});

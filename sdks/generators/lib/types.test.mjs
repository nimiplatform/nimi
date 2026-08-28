import assert from 'node:assert/strict';
import test from 'node:test';

import {
  goOpenApiFieldType,
  pyLiteral,
  pyOpenApiType,
  rustOpenApiFieldType,
} from './types.mjs';

const REQUIRED_NULLABLE_STRING = {
  kind: 'scalar',
  type: 'string',
  format: 'date-time',
  nullable: true,
};

test('OpenAPI nullable scalar fields preserve explicit null in Python, Go, and Rust', () => {
  assert.equal(pyOpenApiType(REQUIRED_NULLABLE_STRING), 'str | None');
  assert.equal(goOpenApiFieldType(REQUIRED_NULLABLE_STRING), '*string');
  assert.equal(rustOpenApiFieldType(REQUIRED_NULLABLE_STRING), 'Option<String>');
});

test('OpenAPI nullable references remain one nullable indirection', () => {
  const schema = { kind: 'ref', ref_name: 'NestedDto', nullable: true };
  assert.equal(pyOpenApiType(schema), 'NestedDto | None');
  assert.equal(goOpenApiFieldType(schema), '*NestedDto');
  assert.equal(rustOpenApiFieldType(schema), 'Option<Box<NestedDto>>');
});

test('OpenAPI Python literal types use Python boolean and null spellings', () => {
  assert.equal(pyLiteral(true), 'True');
  assert.equal(pyLiteral(false), 'False');
  assert.equal(pyLiteral(null), 'None');
  assert.equal(pyOpenApiType({ kind: 'enum', type: 'boolean', values: [true] }), 'Literal[True]');
});

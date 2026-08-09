import assert from 'node:assert/strict';
import test from 'node:test';

import { parseOpenApiSchema } from '../sdks/generators/lib/realm-openapi.mjs';
import {
  goOpenApiType,
  openApiSuccessSchema,
  pyOpenApiType,
  rustOpenApiType,
  tsOpenApiType,
} from '../sdks/generators/lib/types.mjs';

test('OpenAPI success schema never falls back to an error response', () => {
  const errorSchema = { kind: 'ref', ref_name: 'AuthErrorDto' };

  assert.deepEqual(openApiSuccessSchema({
    response_schemas: [
      { status: '400', schema: errorSchema },
      { status: '204', schema: undefined },
    ],
  }), { kind: 'unknown' });
});

test('OpenAPI success schema preserves an explicit success response', () => {
  const successSchema = { kind: 'ref', ref_name: 'SessionIntrospectionResponseDto' };

  assert.equal(openApiSuccessSchema({
    response_schemas: [
      { status: '200', schema: successSchema },
      { status: '400', schema: { kind: 'ref', ref_name: 'AuthErrorDto' } },
    ],
  }), successSchema);
});

test('OpenAPI numeric enums remain numeric across generated SDK types', () => {
  const schema = parseOpenApiSchema({ type: 'number', enum: [400, 401] });

  assert.deepEqual(schema.values, [400, 401]);
  assert.equal(tsOpenApiType(schema), '400 | 401');
  assert.equal(pyOpenApiType(schema), 'Literal[400, 401]');
  assert.equal(goOpenApiType(schema), 'float64');
  assert.equal(rustOpenApiType(schema), 'f64');
});

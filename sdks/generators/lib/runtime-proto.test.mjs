import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOST_PRIVATE_RUNTIME_MESSAGE_NAMES,
  HOST_PRIVATE_RUNTIME_METHOD_IDS,
  extractRuntimeProto,
  projectRuntimeForNonHostPublicSdks,
} from './runtime-proto.mjs';

test('non-Host public SDK projection omits Host-private Runtime methods and messages', () => {
  const runtime = extractRuntimeProto();
  const projected = projectRuntimeForNonHostPublicSdks(runtime);
  const rawMethods = new Set(runtime.method_ids);
  const publicMethods = new Set(projected.method_ids);
  const rawMessages = new Set(runtime.schema_types.messages);
  const publicMessages = new Set(projected.schema_types.messages);

  for (const methodId of HOST_PRIVATE_RUNTIME_METHOD_IDS) {
    assert.equal(rawMethods.has(methodId), true, `${methodId} must remain in the TypeScript Host raw core`);
    assert.equal(publicMethods.has(methodId), false, `${methodId} must not enter non-Host SDK methods`);
    assert.equal(
      projected.codec_maps.some((row) => row.method_id === methodId),
      false,
      `${methodId} must not enter non-Host SDK codecs`,
    );
  }
  for (const messageName of HOST_PRIVATE_RUNTIME_MESSAGE_NAMES) {
    assert.equal(rawMessages.has(messageName), true, `${messageName} must remain in Runtime proto`);
    assert.equal(publicMessages.has(messageName), false, `${messageName} must not enter non-Host SDK types`);
    assert.equal(
      projected.schema_types.message_schemas.some((schema) => schema.name === messageName),
      false,
      `${messageName} must not enter non-Host SDK schemas`,
    );
  }
});

test('selected model file import keeps its client stream and messages in the Host projection', () => {
  const runtime = extractRuntimeProto();
  const projected = projectRuntimeForNonHostPublicSdks(runtime);
  const methodId = '/nimi.runtime.v1.RuntimeLocalService/ImportSelectedModelFile';
  const method = runtime.codec_maps.find((row) => row.method_id === methodId);
  assert.equal(method?.kind, 'client_stream');
  assert.equal(projected.method_ids.includes(methodId), false);
  for (const message of [method.request_type, method.response_type]) {
    assert.equal(runtime.schema_types.messages.includes(message), true);
    assert.equal(projected.schema_types.messages.includes(message), false);
  }
});

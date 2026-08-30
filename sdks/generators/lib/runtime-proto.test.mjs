import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOST_PRIVATE_RUNTIME_MESSAGE_NAMES,
  HOST_PRIVATE_RUNTIME_METHOD_IDS,
  extractRuntimeProto,
  projectRuntimeForNonHostPublicSdks,
} from './runtime-proto.mjs';

test('non-Host public SDK projection hard-cuts Avatar Host methods and messages', () => {
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

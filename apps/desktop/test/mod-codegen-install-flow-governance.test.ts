import assert from 'node:assert/strict';
import test from 'node:test';

import {
  listRegisteredRuntimeModIds,
  registerRuntimeMod,
  resetRuntimeHostForTesting,
  unregisterRuntimeMod,
} from '../src/runtime/mod/host';

test('codegen registration denies T2 and enforces T1 consent', async () => {
  resetRuntimeHostForTesting();

  await assert.rejects(
    () => registerRuntimeMod({
      modId: 'world.nimi.codegen.t2',
      sourceType: 'codegen',
      capabilities: ['turn.register.pre-model'],
      setup: () => {},
    }),
    /CODEGEN_CAPABILITY_DENIED/,
  );

  await assert.rejects(
    () => registerRuntimeMod({
      modId: 'world.nimi.codegen.t1-missing-consent',
      sourceType: 'codegen',
      capabilities: ['runtime.media.image.generate'],
      setup: () => {},
    }),
    /CODEGEN_T1_CONSENT_REQUIRED/,
  );

  await registerRuntimeMod({
    modId: 'world.nimi.codegen.t1-with-consent',
    sourceType: 'codegen',
    capabilities: ['runtime.media.image.generate'],
    grantCapabilities: ['runtime.media.image.generate'],
    setup: () => {},
  });

  assert.ok(listRegisteredRuntimeModIds().includes('world.nimi.codegen.t1-with-consent'));

  unregisterRuntimeMod('world.nimi.codegen.t1-with-consent');
  resetRuntimeHostForTesting();
});

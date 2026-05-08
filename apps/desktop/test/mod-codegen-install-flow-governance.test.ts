import assert from 'node:assert/strict';
import test from 'node:test';

import {
  listRegisteredRuntimeModIds,
  registerRuntimeMod,
  resetRuntimeHostForTesting,
  unregisterRuntimeMod,
} from '../src/runtime/mod/host';

test('codegen registration denies T2 and source-ceiling capability requests', async () => {
  resetRuntimeHostForTesting();

  await assert.rejects(
    () => registerRuntimeMod({
      modId: 'world.nimi.user-hyphenated',
      sourceType: 'codegen',
      capabilities: ['runtime.ai.text.generate'],
      manifestCapabilities: ['runtime.ai.text.generate'],
      setup: () => {},
    }),
    /CODEGEN_MOD_ID_PREFIX_INVALID/,
  );

  await assert.rejects(
    () => registerRuntimeMod({
      modId: 'world.nimi.user.codegen.t2',
      sourceType: 'codegen',
      capabilities: ['turn.register.pre-model'],
      manifestCapabilities: ['turn.register.pre-model'],
      setup: () => {},
    }),
    /CODEGEN_CAPABILITY_DENIED/,
  );

  await assert.rejects(
    () => registerRuntimeMod({
      modId: 'world.nimi.user.codegen.media-without-consent',
      sourceType: 'codegen',
      capabilities: ['runtime.media.image.generate'],
      manifestCapabilities: ['runtime.media.image.generate'],
      setup: () => {},
    }),
    /CODEGEN_CAPABILITY_DENIED/,
  );

  await assert.rejects(
    () => registerRuntimeMod({
      modId: 'world.nimi.user.codegen.media-with-consent',
      sourceType: 'codegen',
      capabilities: ['runtime.media.image.generate'],
      manifestCapabilities: ['runtime.media.image.generate'],
      grantCapabilities: ['runtime.media.image.generate'],
      setup: () => {},
    }),
    /CODEGEN_CAPABILITY_DENIED/,
  );

  await assert.rejects(
    () => registerRuntimeMod({
      modId: 'world.nimi.user.codegen.wildcard',
      sourceType: 'codegen',
      capabilities: ['ui.register.ui-extension.app.*'],
      manifestCapabilities: ['ui.register.ui-extension.app.*'],
      setup: () => {},
    }),
    /CODEGEN_CAPABILITY_DENIED/,
  );

  await assert.rejects(
    () => registerRuntimeMod({
      modId: 'world.nimi.user.codegen.caller-grant',
      sourceType: 'codegen',
      capabilities: ['runtime.ai.text.generate'],
      manifestCapabilities: ['runtime.ai.text.generate'],
      grantCapabilities: ['runtime.ai.text.stream'],
      setup: () => {},
    }),
    /caller-supplied codegen grants are not host-owned/,
  );

  await registerRuntimeMod({
    modId: 'world.nimi.user.codegen.t0',
    sourceType: 'codegen',
    capabilities: ['runtime.ai.text.generate'],
    manifestCapabilities: ['runtime.ai.text.generate'],
    setup: () => {},
  });

  assert.ok(listRegisteredRuntimeModIds().includes('world.nimi.user.codegen.t0'));

  unregisterRuntimeMod('world.nimi.user.codegen.t0');
  resetRuntimeHostForTesting();
});

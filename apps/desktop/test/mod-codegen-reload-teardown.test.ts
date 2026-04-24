import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getRuntimeHookRuntime,
  registerRuntimeMod,
  resetRuntimeHostForTesting,
  listRegisteredRuntimeModIds,
  unregisterRuntimeMod,
} from '../src/runtime/mod/host';

test('reload triggers teardown without leaking previous registration', async () => {
  resetRuntimeHostForTesting();
  let teardownCount = 0;

  await registerRuntimeMod({
    modId: 'world.nimi.user.codegen.reload',
    sourceType: 'codegen',
    capabilities: ['runtime.ai.text.generate'],
    setup: () => {},
    teardown: () => {
      teardownCount += 1;
    },
  });

  await registerRuntimeMod({
    modId: 'world.nimi.user.codegen.reload',
    sourceType: 'codegen',
    capabilities: ['runtime.ai.text.generate'],
    setup: () => {},
    teardown: () => {
      teardownCount += 1;
    },
  }, {
    replaceExisting: true,
  });

  unregisterRuntimeMod('world.nimi.user.codegen.reload');

  assert.ok(teardownCount >= 2);
  resetRuntimeHostForTesting();
});

test('failed codegen reload restores previous registration and grants', async () => {
  resetRuntimeHostForTesting();
  const modId = 'world.nimi.user.codegen.reload-rollback';
  let setupCount = 0;
  let teardownCount = 0;

  await registerRuntimeMod({
    modId,
    sourceType: 'codegen',
    capabilities: ['runtime.ai.text.generate', 'runtime.media.image.generate'],
    grantCapabilities: ['runtime.media.image.generate'],
    setup: () => {
      setupCount += 1;
    },
    teardown: () => {
      teardownCount += 1;
    },
  });

  await assert.rejects(
    () => registerRuntimeMod({
      modId,
      sourceType: 'codegen',
      capabilities: ['runtime.ai.text.generate', 'runtime.media.image.generate'],
      grantCapabilities: ['runtime.media.image.generate'],
      setup: () => {
        throw new Error('replacement setup failed');
      },
    }, {
      replaceExisting: true,
    }),
    /replacement setup failed/,
  );

  assert.ok(listRegisteredRuntimeModIds().includes(modId));
  assert.equal(setupCount, 2);
  assert.equal(teardownCount, 1);
  assert.equal(
    getRuntimeHookRuntime().authorizeRuntimeCapability({
      modId,
      capabilityKey: 'runtime.media.image.generate',
    }).allowed,
    true,
  );

  unregisterRuntimeMod(modId);
  resetRuntimeHostForTesting();
});

test('failed codegen reload validation restores previous registration', async () => {
  resetRuntimeHostForTesting();
  const modId = 'world.nimi.user.codegen.reload-validation-rollback';

  await registerRuntimeMod({
    modId,
    sourceType: 'codegen',
    capabilities: ['runtime.ai.text.generate'],
    setup: () => {},
  });

  await assert.rejects(
    () => registerRuntimeMod({
      modId,
      sourceType: 'codegen',
      capabilities: ['turn.register.pre-model'],
      setup: () => {},
    }, {
      replaceExisting: true,
    }),
    /CODEGEN_CAPABILITY_DENIED/,
  );

  assert.ok(listRegisteredRuntimeModIds().includes(modId));
  assert.equal(
    getRuntimeHookRuntime().authorizeRuntimeCapability({
      modId,
      capabilityKey: 'runtime.ai.text.generate',
    }).allowed,
    true,
  );

  unregisterRuntimeMod(modId);
  resetRuntimeHostForTesting();
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  registerRuntimeMod,
  resetRuntimeHostForTesting,
  unregisterRuntimeMod,
} from '../src/runtime/mod/host';

test('reload triggers teardown without leaking previous registration', async () => {
  resetRuntimeHostForTesting();
  let teardownCount = 0;

  await registerRuntimeMod({
    modId: 'world.nimi.codegen.reload',
    sourceType: 'codegen',
    capabilities: ['runtime.ai.text.generate'],
    setup: () => {},
    teardown: () => {
      teardownCount += 1;
    },
  });

  await registerRuntimeMod({
    modId: 'world.nimi.codegen.reload',
    sourceType: 'codegen',
    capabilities: ['runtime.ai.text.generate'],
    setup: () => {},
    teardown: () => {
      teardownCount += 1;
    },
  }, {
    replaceExisting: true,
  });

  unregisterRuntimeMod('world.nimi.codegen.reload');

  assert.ok(teardownCount >= 2);
  resetRuntimeHostForTesting();
});

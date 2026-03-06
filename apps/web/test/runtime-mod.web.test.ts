import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CODEGEN_T0_CAPABILITY_PATTERNS,
  CODEGEN_T1_CAPABILITY_PATTERNS,
  CODEGEN_T2_CAPABILITY_PATTERNS,
  discoverSideloadRuntimeMods,
  getRuntimeHookRuntime,
  getRuntimeHttpContext,
  listRegisteredRuntimeModIds,
  registerInjectedRuntimeMods,
  registerRuntimeMods,
  unregisterRuntimeMods,
} from '../src/desktop-adapter/runtime-mod.web.js';
import {
  CODEGEN_T0_CAPABILITY_PATTERNS as DESKTOP_CODEGEN_T0_CAPABILITY_PATTERNS,
  CODEGEN_T1_CAPABILITY_PATTERNS as DESKTOP_CODEGEN_T1_CAPABILITY_PATTERNS,
  CODEGEN_T2_CAPABILITY_PATTERNS as DESKTOP_CODEGEN_T2_CAPABILITY_PATTERNS,
} from '../../desktop/src/runtime/mod/codegen/capability-catalog.js';

test('runtime-mod.web reuses desktop capability patterns', () => {
  assert.equal(CODEGEN_T0_CAPABILITY_PATTERNS, DESKTOP_CODEGEN_T0_CAPABILITY_PATTERNS);
  assert.equal(CODEGEN_T1_CAPABILITY_PATTERNS, DESKTOP_CODEGEN_T1_CAPABILITY_PATTERNS);
  assert.equal(CODEGEN_T2_CAPABILITY_PATTERNS, DESKTOP_CODEGEN_T2_CAPABILITY_PATTERNS);
});

test('runtime-mod.web keeps mod runtime disabled in web mode', async () => {
  const runtime = getRuntimeHookRuntime();

  assert.deepEqual(listRegisteredRuntimeModIds(), []);
  assert.deepEqual(
    await runtime.queryData({
      modId: 'world.nimi.web-test',
      capability: 'data.query.data-api.core.mods.list',
      query: {},
    }),
    { items: [] },
  );
  await assert.doesNotReject(async () => runtime.registerDataProvider({
    modId: 'world.nimi.web-test',
    capability: 'data.register.data-api.user-web-test.sessions.list',
    handler: async () => ({ items: [] }),
  }));

  assert.deepEqual(getRuntimeHttpContext(), {
    realmBaseUrl: '',
    accessToken: '',
    fetchImpl: null,
  });
  assert.deepEqual(await discoverSideloadRuntimeMods({
    manifests: [],
    readEntry: async () => '',
  }), []);
  assert.deepEqual(await registerRuntimeMods([]), {
    registeredModIds: [],
    failedMods: [],
  });
  assert.deepEqual(unregisterRuntimeMods(['world.nimi.web-test']), []);
  assert.deepEqual(await registerInjectedRuntimeMods(), {
    registeredModIds: [],
    failedMods: [],
  });
});

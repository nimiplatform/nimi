import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';

import { getModSdkHost } from '../../../sdk/src/mod/host.js';
import {
  clearInternalModSdkHost,
  getRuntimeHttpContext,
  listRegisteredRuntimeModIds,
  registerRuntimeMod,
  resetRuntimeHostState,
  setInternalModSdkHost,
  setRuntimeHttpContextProvider,
} from '../src/runtime/mod/index.js';
import {
  getRuntimeModSdkContextState,
  setRuntimeModSdkContextProviderState,
} from '../src/runtime/mod/host/runtime-exposure.js';

afterEach(() => {
  clearInternalModSdkHost();
  resetRuntimeHostState();
});

test('resetRuntimeHostState clears registered mods, providers, and mod sdk host residue', async () => {
  let teardownCalls = 0;

  setRuntimeHttpContextProvider(() => ({
    realmBaseUrl: 'http://localhost:3002',
  }));
  setRuntimeModSdkContextProviderState(
    (() => ({ ready: true })) as unknown as Parameters<typeof setRuntimeModSdkContextProviderState>[0],
  );
  setInternalModSdkHost({ host: 'desktop-runtime' } as Parameters<typeof setInternalModSdkHost>[0]);

  await registerRuntimeMod({
    modId: 'runtime.reset.contract',
    capabilities: [],
    setup: () => undefined,
    teardown: () => {
      teardownCalls += 1;
    },
  });

  assert.deepEqual(listRegisteredRuntimeModIds(), ['runtime.reset.contract']);
  assert.equal(getRuntimeHttpContext().realmBaseUrl, 'http://localhost:3002');
  assert.ok(getRuntimeModSdkContextState(), 'runtime mod sdk context must be configured before reset');
  assert.doesNotThrow(() => getModSdkHost(), 'mod sdk host must be present before reset');

  resetRuntimeHostState();

  assert.equal(teardownCalls, 1, 'reset must teardown registered runtime mods once');
  assert.deepEqual(listRegisteredRuntimeModIds(), []);
  assert.equal(getRuntimeHttpContext().realmBaseUrl, '');
  assert.equal(getRuntimeModSdkContextState(), null);
  assert.doesNotThrow(() => getModSdkHost(), 'runtime host reset alone must not clear the global mod sdk host');

  clearInternalModSdkHost();
  assert.throws(
    () => getModSdkHost(),
    /mod SDK host is not ready/,
    'clearing the internal mod sdk host must remove the global mod sdk host residue',
  );
});

test('setInternalModSdkHost replaces desktop-owned host residue on renderer re-entry', () => {
  const firstHost = { host: 'desktop-runtime:first' } as Parameters<typeof setInternalModSdkHost>[0];
  const secondHost = { host: 'desktop-runtime:second' } as Parameters<typeof setInternalModSdkHost>[0];

  setInternalModSdkHost(firstHost);
  assert.equal(getModSdkHost(), firstHost);

  assert.doesNotThrow(() => setInternalModSdkHost(secondHost));
  assert.equal(getModSdkHost(), secondHost);
});

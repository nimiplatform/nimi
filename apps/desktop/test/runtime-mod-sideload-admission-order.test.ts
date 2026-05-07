import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSideloadRuntimeModRegistration,
  createSideloadPreloadAdmission,
} from '../src/runtime/mod/discovery/external/build-registration';
import { discoverSideloadRuntimeMods } from '../src/runtime/mod/discovery/external/sideload';
import type { RuntimeLocalManifestSummaryLike, RuntimeModFactory } from '../src/runtime/mod/types';

function manifestWithCapabilities(capabilities: string[]): RuntimeLocalManifestSummaryLike {
  return {
    path: '/mods/world.nimi.sideload/mod.manifest.yaml',
    id: 'world.nimi.sideload',
    sourceType: 'dev',
    entry: 'index.ts',
    entryPath: '/mods/world.nimi.sideload/index.ts',
    stylePaths: ['/mods/world.nimi.sideload/style.css'],
    manifest: { capabilities },
  };
}

test('sideload discovery rejects missing manifest capability authority before loading entry code', async () => {
  let readEntryCalled = false;

  const registrations = await discoverSideloadRuntimeMods({
    manifests: [manifestWithCapabilities([])],
    readEntry: async () => {
      readEntryCalled = true;
      throw new Error('entry code must not be read without preload admission');
    },
  });

  assert.deepEqual(registrations, []);
  assert.equal(readEntryCalled, false);
});

test('sideload registration does not let factory output replace manifest capability authority', () => {
  const admission = createSideloadPreloadAdmission({
    manifest: manifestWithCapabilities(['ui.register.ui-extension.app.sidebar.mods']),
  });
  assert.ok(admission.admission);

  const factory: RuntimeModFactory = () => ({
    modId: 'world.nimi.sideload',
    capabilities: [],
    manifestCapabilities: ['runtime.ai.text.generate'],
    setup: () => {},
  });

  const result = buildSideloadRuntimeModRegistration({
    factory,
    manifest: manifestWithCapabilities(['ui.register.ui-extension.app.sidebar.mods']),
    admission: admission.admission,
  });

  assert.equal(result.registration, null);
  assert.equal(result.reason, 'manifest-capability-shadow-truth');
});

test('sideload registration uses admitted manifest capabilities after preload admission', () => {
  const manifest = manifestWithCapabilities(['ui.register.ui-extension.app.sidebar.mods']);
  const admission = createSideloadPreloadAdmission({ manifest });
  assert.ok(admission.admission);

  const factory: RuntimeModFactory = () => ({
    modId: 'world.nimi.sideload',
    capabilities: [],
    setup: () => {},
  });

  const result = buildSideloadRuntimeModRegistration({
    factory,
    manifest,
    admission: admission.admission,
  });

  assert.ok(result.registration);
  assert.deepEqual(result.registration.capabilities, ['ui.register.ui-extension.app.sidebar.mods']);
  assert.deepEqual(result.registration.manifestCapabilities, ['ui.register.ui-extension.app.sidebar.mods']);
  assert.deepEqual(result.registration.styleEntryPaths, ['/mods/world.nimi.sideload/style.css']);
  assert.equal(result.registration.sourceType, 'sideload');
});

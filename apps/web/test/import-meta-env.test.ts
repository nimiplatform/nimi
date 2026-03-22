import assert from 'node:assert/strict';
import test from 'node:test';
import { installBundledImportMetaEnv } from '../src/import-meta-env.js';

test('installBundledImportMetaEnv exposes import meta env to shared shell helpers', () => {
  const runtimeGlobal = globalThis as typeof globalThis & {
    __NIMI_IMPORT_META_ENV__?: Record<string, string | boolean | undefined>;
  };
  const previous = runtimeGlobal.__NIMI_IMPORT_META_ENV__;

  installBundledImportMetaEnv({
    VITE_NIMI_DEBUG_BOOT: '1',
    VITE_NIMI_SHELL_MODE: 'web',
  });

  assert.equal(runtimeGlobal.__NIMI_IMPORT_META_ENV__?.VITE_NIMI_DEBUG_BOOT, '1');
  assert.equal(runtimeGlobal.__NIMI_IMPORT_META_ENV__?.VITE_NIMI_SHELL_MODE, 'web');

  runtimeGlobal.__NIMI_IMPORT_META_ENV__ = previous;
});

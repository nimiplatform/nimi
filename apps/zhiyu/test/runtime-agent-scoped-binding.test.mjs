import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('Zhiyu Electron has no app-owned Runtime Agent binding or endpoint carrier', () => {
  const main = readFileSync(path.join(root, 'src-electron/main.ts'), 'utf8');
  const preload = readFileSync(path.join(root, 'src-electron/preload.cts'), 'utf8');
  const bundle = readFileSync(path.join(root, 'scripts/bundle-electron-preload.mjs'), 'utf8');
  assert.equal(existsSync(path.join(root, 'src-electron/runtime-agent-scoped-binding.ts')), false);
  assert.equal(existsSync(path.join(root, 'src-electron/runtime-account-caller.ts')), false);
  for (const source of [main, preload, bundle]) {
    assert.doesNotMatch(source, /createNimiClient|runtimeEndpoint|NIMI_RUNTIME_GRPC_ADDR|@grpc\/grpc-js/);
  }
  assert.match(main, /registerNimiElectronAppBridge/);
  assert.doesNotMatch(main, /registerNimiElectronRuntimeBridge/);
});

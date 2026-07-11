import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

test('Tester admits only protected artifact readback through the installed app host', () => {
  const runtime = read('src/tester/tester-runtime.ts');
  const platform = read('src/shell/auth/runtime-platform.ts');

  assert.match(runtime, /admits artifacts\.readRuntimeBytes only/);
  assert.match(runtime, /'sdk-method-unavailable'/);
  assert.match(runtime, /account, Realm, AI, realtime, lifecycle, and media operations remain blocked/);
  assert.doesNotMatch(runtime, /invokeTesterCapability|projection\.client|new Runtime/);
  assert.match(platform, /testerInstalledAppBootstrap\.artifacts\.readRuntimeBytes/);
  assert.doesNotMatch(platform, /localhost|127\.0\.0\.1|access[_-]?token|refresh[_-]?token|launch[_-]?ticket|session[_-]?token/i);
});

test('Tester default Realm, model catalog, and local asset paths fail closed', () => {
  const settingsRoute = read('src/shell/routes/settings-route.tsx');
  const modelProvider = read('src/tester/tester-runtime-model-provider.ts');
  const aiConfigPanel = read('src/tester/workbench/tester-ai-config-settings-panel.tsx');

  assert.match(settingsRoute, /throw new Error\('Realm is not admitted for this app-host authorization\.'\)/);
  assert.match(modelProvider, /throw new Error\('Runtime model catalog is not admitted for this app-host authorization\.'\)/);
  assert.match(aiConfigPanel, /return \[\] as LocalAssetEntry\[\]/);
  assert.doesNotMatch(aiConfigPanel, /listNimiRuntimeLocalAssetEntries|artifactRoles:\s*asset\.artifactRoles/);
});

test('Tester contains no legacy generic protected-operation invoker carrier', () => {
  for (const relativePath of [
    'src/tester/tester-runtime-invokers.ts',
    'src/tester/tester-runtime-invokers-core.ts',
    'src/tester/tester-runtime-invokers-media.ts',
    'src/tester/tester-runtime-invokers-media-artifacts.ts',
    'src/tester/tester-runtime-invokers-media-image-video.ts',
    'src/tester/tester-runtime-invokers-media-runtime.ts',
    'src/tester/tester-runtime-invokers-media-speech.ts',
  ]) {
    assert.equal(existsSync(path.join(root, relativePath)), false, `${relativePath} must remain absent`);
  }
});

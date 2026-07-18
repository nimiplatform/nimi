import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

test('Tester consumes only the final typed local-app operation set', () => {
  const runtime = read('src/tester/tester-runtime.ts');
  const platform = read('src/shell/auth/runtime-platform.ts');
  const client = read('src/shell/local-app-runtime-platform.ts');

  assert.match(runtime, /session posture, public permission posture\/request, and app-private JSON storage/);
  assert.match(runtime, /'sdk-method-unavailable'/);
  assert.match(runtime, /generic Runtime health, account, Realm, Agent, AI, lifecycle, and media surfaces remain unavailable/);
  assert.doesNotMatch(runtime, /invokeTesterCapability|projection\.client|new Runtime/);
  assert.match(platform, /testerLocalAppRuntimePlatform\.auth\.status/);
  assert.doesNotMatch(client, /artifacts\.readRuntimeBytes|openConversation|agentInventory/);
  assert.match(client, /createNimiLocalAppStandardShellSurface/);
  assert.doesNotMatch(platform, /localhost|127\.0\.0\.1|access[_-]?token|refresh[_-]?token|launch[_-]?ticket|session[_-]?token/i);
});

test('Tester exposes the reserved-permission denial and app-private storage success boundary', () => {
  const permissionLab = read('src/tester/local-app-permission-lab.tsx');

  assert.match(permissionLab, /'agents\.interact'/);
  assert.match(permissionLab, /'authority-lab\/app-private-storage\.json'/);
  assert.match(permissionLab, /testerLocalAppRuntimePlatform\.permissions\.status/);
  assert.match(permissionLab, /testerLocalAppRuntimePlatform\.permissions\.request/);
  assert.match(permissionLab, /testerLocalAppRuntimePlatform\.storage\.writeJson/);
  assert.match(permissionLab, /testerLocalAppRuntimePlatform\.storage\.readJson/);
  assert.match(permissionLab, /testerLocalAppRuntimePlatform\.storage\.removeJson/);
  assert.match(permissionLab, /reasonCode/);
  assert.match(permissionLab, /canRequest/);
  assert.doesNotMatch(permissionLab, /localhost|127\.0\.0\.1|access[_-]?token|refresh[_-]?token|launch[_-]?ticket|session[_-]?token|new Runtime|createNimiClient/i);
});

test('Tester default Realm, model catalog, and local asset paths fail closed', () => {
  const settingsRoute = read('src/shell/routes/settings-route.tsx');
  const modelProvider = read('src/tester/tester-runtime-model-provider.ts');
  const aiConfigPanel = read('src/tester/workbench/tester-ai-config-settings-panel.tsx');

  assert.match(settingsRoute, /throw new Error\('Realm is not admitted by the local-app carrier\.'\)/);
  assert.match(modelProvider, /throw new Error\('Runtime model catalog is not admitted by the local-app carrier\.'\)/);
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
